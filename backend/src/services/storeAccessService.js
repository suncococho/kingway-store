"use strict";

const { pool } = require("../db");

const BASIC_FEATURES = new Set([
  "dashboard",
  "orders",
  "products",
  "repairs",
  "customers",
  "line_customer",
  "staff",
  "platform_admin"
]);
const ADVANCED_FEATURES = new Set([
  "suppliers",
  "supplier_purchases",
  "store_transfers",
  "company_store_settlements",
  "headquarters"
]);
const FEATURE_KEYS = [...BASIC_FEATURES, ...ADVANCED_FEATURES];
const STORE_FEATURE_COLUMN_MAP = {
  dashboard: "sales_dashboard_enabled",
  orders: "orders_enabled",
  products: "inventory_enabled",
  repairs: "repairs_enabled",
  line_customer: "line_enabled",
  suppliers: "suppliers_enabled",
  supplier_purchases: "suppliers_enabled",
  staff: "staff_management_enabled"
};
const FEATURE_PRESETS = {
  free: {
    pos_enabled: 1,
    orders_enabled: 1,
    repairs_enabled: 1,
    inventory_enabled: 1,
    suppliers_enabled: 0,
    coupons_enabled: 0,
    purchase_confirmations_enabled: 0,
    line_enabled: 1,
    telegram_enabled: 0,
    sales_dashboard_enabled: 1,
    staff_management_enabled: 1
  },
  trial: {
    pos_enabled: 1,
    orders_enabled: 1,
    repairs_enabled: 1,
    inventory_enabled: 1,
    suppliers_enabled: 1,
    coupons_enabled: 1,
    purchase_confirmations_enabled: 1,
    line_enabled: 1,
    telegram_enabled: 0,
    sales_dashboard_enabled: 1,
    staff_management_enabled: 1
  },
  premium: {
    pos_enabled: 1,
    orders_enabled: 1,
    repairs_enabled: 1,
    inventory_enabled: 1,
    suppliers_enabled: 1,
    coupons_enabled: 1,
    purchase_confirmations_enabled: 1,
    line_enabled: 1,
    telegram_enabled: 0,
    sales_dashboard_enabled: 1,
    staff_management_enabled: 1
  }
};

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePlan(value) {
  const plan = String(value || "free").trim().toLowerCase();
  if (plan === "premium" || plan === "trial" || plan === "free") return plan;
  return "free";
}

function normalizePaymentStatus(value) {
  const status = String(value || "NONE").trim().toUpperCase();
  return ["NONE", "UNPAID", "PAID", "PAST_DUE"].includes(status) ? status : "NONE";
}

function computeEffectiveStatus(store) {
  const now = new Date();
  const plan = normalizePlan(store?.plan);
  const status = String(store?.status || "active").trim().toLowerCase();
  const paymentStatus = normalizePaymentStatus(store?.payment_status || store?.paymentStatus);
  const trialEndsAt = toDate(store?.trial_ends_at || store?.trialEndsAt);
  const subscriptionEndsAt = toDate(store?.subscription_ends_at || store?.subscriptionEndsAt);

  if (status === "suspended" || status === "inactive") return "SUSPENDED";
  if (plan === "trial" && trialEndsAt && trialEndsAt.getTime() < now.getTime()) return "TRIAL_EXPIRED";
  if (subscriptionEndsAt && subscriptionEndsAt.getTime() < now.getTime()) return "PAST_DUE";
  if (paymentStatus === "PAST_DUE") return "PAST_DUE";
  if (plan === "trial") return "TRIALING";
  return "ACTIVE";
}

function getWarningMessage(effectiveStatus) {
  if (effectiveStatus === "TRIALING") {
    return "試用中，部分進階功能將於試用期結束後鎖定。";
  }
  if (effectiveStatus === "TRIAL_EXPIRED") {
    return "試用已到期，部分功能已鎖定。請聯絡平台管理員。";
  }
  if (effectiveStatus === "PAST_DUE") {
    return "付款狀態異常，部分功能已鎖定。";
  }
  if (effectiveStatus === "SUSPENDED") {
    return "帳號已停用，請聯絡平台管理員。";
  }
  return null;
}

function canUseFeatureFromAccess(access, featureKey) {
  if (!featureKey || BASIC_FEATURES.has(featureKey)) return true;
  return Array.isArray(access?.enabledFeatures) && access.enabledFeatures.includes(featureKey);
}

function buildAccess(store, featureRow = null) {
  const plan = normalizePlan(store?.plan);
  const paymentStatus = normalizePaymentStatus(store?.payment_status || store?.paymentStatus);
  const effectiveStatus = computeEffectiveStatus(store);
  const advancedLockedByStatus = ["TRIAL_EXPIRED", "PAST_DUE", "SUSPENDED"].includes(effectiveStatus);
  const preset = FEATURE_PRESETS[plan] || FEATURE_PRESETS.free;
  const enabledFeatures = [];
  const lockedFeatures = [];

  for (const featureKey of FEATURE_KEYS) {
    let enabled = true;
    if (ADVANCED_FEATURES.has(featureKey)) {
      enabled = plan !== "free" && !advancedLockedByStatus;
    }

    const column = STORE_FEATURE_COLUMN_MAP[featureKey];
    if (column && featureRow && featureRow[column] !== null && featureRow[column] !== undefined) {
      enabled = Boolean(featureRow[column]);
      if (ADVANCED_FEATURES.has(featureKey) && (plan === "free" || advancedLockedByStatus)) {
        enabled = false;
      }
    } else if (column && preset[column] !== undefined) {
      enabled = Boolean(preset[column]);
      if (ADVANCED_FEATURES.has(featureKey) && (plan === "free" || advancedLockedByStatus)) {
        enabled = false;
      }
    }

    if (enabled) {
      enabledFeatures.push(featureKey);
    } else {
      lockedFeatures.push(featureKey);
    }
  }

  return {
    storeId: Number(store?.id || store?.storeId || 0),
    plan,
    status: String(store?.status || "active").trim().toLowerCase(),
    paymentStatus,
    trialEndsAt: store?.trial_ends_at || store?.trialEndsAt || null,
    subscriptionEndsAt: store?.subscription_ends_at || store?.subscriptionEndsAt || null,
    billingNote: store?.billing_note || store?.billingNote || "",
    lastPlanChangedAt: store?.last_plan_changed_at || store?.lastPlanChangedAt || null,
    effectiveStatus,
    isTrialExpired: effectiveStatus === "TRIAL_EXPIRED",
    isSubscriptionExpired: effectiveStatus === "PAST_DUE",
    enabledFeatures,
    lockedFeatures,
    warningMessage: getWarningMessage(effectiveStatus)
  };
}

async function getStoreEffectiveAccess(storeId, connection = pool) {
  const normalizedStoreId = Number(storeId || 0);
  if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
    const error = new Error("Store is required");
    error.statusCode = 400;
    throw error;
  }

  const [storeRows] = await connection.query(
    `
      SELECT
        id,
        code,
        name,
        status,
        plan,
        trial_ends_at,
        subscription_ends_at,
        payment_status,
        billing_note,
        last_plan_changed_at
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [normalizedStoreId]
  );
  const store = storeRows[0];
  if (!store) {
    const error = new Error("Store not found");
    error.statusCode = 404;
    throw error;
  }

  const [featureRows] = await connection.query(
    "SELECT * FROM store_features WHERE store_id = ? LIMIT 1",
    [normalizedStoreId]
  );

  return buildAccess(store, featureRows[0] || null);
}

async function canUseFeature(storeId, featureKey, connection = pool) {
  const access = await getStoreEffectiveAccess(storeId, connection);
  return canUseFeatureFromAccess(access, featureKey);
}

function resolveStoreId(req) {
  const rawStoreId = req.storeId ?? req.user?.store_id ?? req.user?.storeId;
  const storeId = Number(rawStoreId);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 0;
}

function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      if (req.platformAdmin) return next();
      const storeId = resolveStoreId(req);
      const access = await getStoreEffectiveAccess(storeId);
      req.storeAccess = access;
      if (canUseFeatureFromAccess(access, featureKey)) {
        return next();
      }
      return res.status(403).json({
        error: "FEATURE_LOCKED",
        message: access.warningMessage || "此功能不包含在目前方案，請聯絡平台管理員",
        featureKey,
        requiredPlan: "premium",
        access
      });
    } catch (error) {
      return next(error);
    }
  };
}

async function applyFeaturePreset(storeId, presetKey, connection = pool) {
  const normalizedPreset = normalizePlan(presetKey);
  const preset = FEATURE_PRESETS[normalizedPreset];
  if (!preset) {
    const error = new Error("Invalid preset");
    error.statusCode = 400;
    throw error;
  }
  const columns = Object.keys(preset);
  const insertColumns = ["store_id", ...columns];
  const values = [storeId, ...columns.map((key) => preset[key])];
  const updates = columns.map((key) => `${key} = VALUES(${key})`).join(", ");
  await connection.query(
    `
      INSERT INTO store_features (${insertColumns.join(", ")})
      VALUES (${insertColumns.map(() => "?").join(", ")})
      ON DUPLICATE KEY UPDATE ${updates}
    `,
    values
  );
  return getStoreEffectiveAccess(storeId, connection);
}

module.exports = {
  ADVANCED_FEATURES,
  BASIC_FEATURES,
  FEATURE_KEYS,
  FEATURE_PRESETS,
  applyFeaturePreset,
  canUseFeature,
  getStoreEffectiveAccess,
  requireFeature
};
