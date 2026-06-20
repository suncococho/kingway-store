"use strict";

const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, requireStoreScope } = require("../middleware/auth");
const { authenticatePlatformAdmin, requirePlatformRole } = require("../middleware/platformAuth");
const {
  applyFeaturePreset,
  getStoreEffectiveAccess
} = require("../services/storeAccessService");
const { recordPlatformAudit } = require("../services/platformAuditService");

const router = express.Router();
const PLATFORM_MANAGE_ROLES = ["PLATFORM_OWNER", "PLATFORM_ADMIN"];
const PLAN_VALUES = new Set(["free", "trial", "premium"]);
const STORE_STATUSES = new Set(["active", "inactive", "suspended"]);
const PAYMENT_STATUSES = new Set(["NONE", "UNPAID", "PAID", "PAST_DUE"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizePlan(value) {
  const plan = text(value || "free").toLowerCase();
  if (!PLAN_VALUES.has(plan)) {
    const error = new Error("Invalid plan");
    error.statusCode = 400;
    throw error;
  }
  return plan;
}

function normalizeStatus(value) {
  const status = text(value || "active").toLowerCase();
  if (!STORE_STATUSES.has(status)) {
    const error = new Error("Invalid store status");
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function normalizePaymentStatus(value) {
  const status = text(value || "NONE").toUpperCase();
  if (!PAYMENT_STATUSES.has(status)) {
    const error = new Error("Invalid payment status");
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function normalizeDateOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("Invalid date");
    error.statusCode = 400;
    throw error;
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function getStoreSnapshot(storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        code,
        name,
        status,
        plan,
        trial_ends_at AS trialEndsAt,
        subscription_ends_at AS subscriptionEndsAt,
        payment_status AS paymentStatus,
        billing_note AS billingNote,
        last_plan_changed_at AS lastPlanChangedAt
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

router.get("/me", authenticate, requireStoreScope(), async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const access = await getStoreEffectiveAccess(storeId);
    return res.json({ ok: true, access });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/platform-admin/stores/:id/access",
  authenticatePlatformAdmin,
  requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"]),
  async (req, res, next) => {
    try {
      const storeId = Number(req.params.id || 0);
      const access = await getStoreEffectiveAccess(storeId);
      return res.json({ ok: true, access });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/platform-admin/stores/:id/billing",
  authenticatePlatformAdmin,
  requirePlatformRole(PLATFORM_MANAGE_ROLES),
  async (req, res, next) => {
    try {
      const storeId = Number(req.params.id || 0);
      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(404).json({ message: "Store not found" });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const nextBilling = {
        plan: normalizePlan(body.plan),
        status: normalizeStatus(body.status),
        trialEndsAt: normalizeDateOrNull(body.trialEndsAt),
        subscriptionEndsAt: normalizeDateOrNull(body.subscriptionEndsAt),
        paymentStatus: normalizePaymentStatus(body.paymentStatus),
        billingNote: text(body.billingNote).slice(0, 2000)
      };

      const result = await withTransaction(async (connection) => {
        const before = await getStoreSnapshot(storeId, connection);
        if (!before) {
          const error = new Error("Store not found");
          error.statusCode = 404;
          throw error;
        }
        await connection.query(
          `
            UPDATE stores
            SET
              plan = ?,
              status = ?,
              trial_ends_at = ?,
              subscription_ends_at = ?,
              payment_status = ?,
              billing_note = ?,
              last_plan_changed_at = NOW()
            WHERE id = ?
          `,
          [
            nextBilling.plan,
            nextBilling.status,
            nextBilling.trialEndsAt,
            nextBilling.subscriptionEndsAt,
            nextBilling.paymentStatus,
            nextBilling.billingNote || null,
            storeId
          ]
        );
        const after = await getStoreSnapshot(storeId, connection);
        const access = await getStoreEffectiveAccess(storeId, connection);
        return { before, after, access };
      });

      await recordPlatformAudit(req, {
        action: "store.billing.update",
        targetType: "store",
        targetId: storeId,
        before: result.before,
        after: result.after
      });

      return res.json({ ok: true, store: result.after, access: result.access });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      return next(error);
    }
  }
);

router.put(
  "/platform-admin/stores/:id/feature-preset",
  authenticatePlatformAdmin,
  requirePlatformRole(PLATFORM_MANAGE_ROLES),
  async (req, res, next) => {
    try {
      const storeId = Number(req.params.id || 0);
      const preset = normalizePlan(req.body?.preset || "free");
      const result = await withTransaction(async (connection) => {
        const before = await getStoreEffectiveAccess(storeId, connection);
        const access = await applyFeaturePreset(storeId, preset, connection);
        await connection.query(
          "UPDATE stores SET plan = ?, last_plan_changed_at = NOW() WHERE id = ?",
          [preset, storeId]
        );
        const after = await getStoreEffectiveAccess(storeId, connection);
        return { before, access: after || access };
      });
      await recordPlatformAudit(req, {
        action: "store.feature_preset.apply",
        targetType: "store_features",
        targetId: storeId,
        before: result.before,
        after: { preset, access: result.access }
      });
      return res.json({ ok: true, preset, access: result.access });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      return next(error);
    }
  }
);

module.exports = router;
