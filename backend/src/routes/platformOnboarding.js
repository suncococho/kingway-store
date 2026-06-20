"use strict";

const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticatePlatformAdmin, requirePlatformRole } = require("../middleware/platformAuth");
const {
  ProvisioningError,
  provisionStoreWithConnection
} = require("../services/storeProvisioningService");
const { recordPlatformAudit } = require("../services/platformAuditService");

const router = express.Router();

const PLATFORM_MANAGE_ROLES = ["PLATFORM_OWNER", "PLATFORM_ADMIN"];
const COMPANY_STATUS = new Set(["ACTIVE", "INACTIVE"]);
const STORE_STATUS = new Set(["active", "inactive", "suspended"]);
const STORE_PLANS = ["free", "trial", "premium", "single_store"];
const RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE", "DIRECT_STORE", "FRANCHISE_STORE"]);
const WAREHOUSE_COMPANY_ROLES = new Set(["hq_admin", "inventory_manager"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function upperCode(value, label) {
  const code = text(value).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,78}[A-Z0-9]$/.test(code)) {
    const error = new ProvisioningError(400, `${label} code is invalid`);
    throw error;
  }
  return code;
}

function requiredText(value, label, maxLength = 150) {
  const normalized = text(value);
  if (!normalized) {
    throw new ProvisioningError(400, `${label} is required`);
  }
  if (normalized.length > maxLength) {
    throw new ProvisioningError(400, `${label} is too long`);
  }
  return normalized;
}

function optionalText(value, maxLength = 255) {
  const normalized = text(value);
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizePlan(value) {
  const plan = text(value || "trial").toLowerCase();
  return STORE_PLANS.includes(plan) ? plan : "trial";
}

function normalizeStoreStatus(value) {
  const status = text(value || "active").toLowerCase();
  if (!STORE_STATUS.has(status)) {
    throw new ProvisioningError(400, "Invalid store status");
  }
  return status;
}

function normalizeCompanyStatus(value) {
  const status = text(value || "ACTIVE").toUpperCase();
  return COMPANY_STATUS.has(status) ? status : "ACTIVE";
}

function normalizeRelationshipType(value) {
  const relationshipType = text(value || "FRANCHISE_STORE").toUpperCase();
  if (!RELATIONSHIP_TYPES.has(relationshipType)) {
    throw new ProvisioningError(400, "Invalid relationship type");
  }
  return relationshipType;
}

function normalizeTemporaryPassword(value) {
  const password = typeof value === "string" ? value.trim() : "";
  if (password.length < 8) {
    throw new ProvisioningError(400, "Temporary password must be at least 8 characters");
  }
  return password;
}

function defaultTrialEndsAt(plan) {
  if (String(plan || "").trim().toLowerCase() !== "trial") return null;
  const date = new Date();
  date.setDate(date.getDate() + 30);
  date.setHours(23, 59, 59, 0);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizePaymentStatusForPlan(value, plan) {
  const raw = text(value).toUpperCase();
  if (["NONE", "UNPAID", "PAID", "PAST_DUE"].includes(raw)) return raw;
  if (String(plan || "").trim().toLowerCase() === "premium") return "PAID";
  return "NONE";
}

function normalizeStorePayload(body, prefix = "") {
  const storeCodeKey = prefix ? `${prefix}StoreCode` : "storeCode";
  const storeNameKey = prefix ? `${prefix}StoreName` : "storeName";
  const ownerUsernameKey = prefix ? `${prefix}OwnerUsername` : "ownerUsername";
  const ownerNameKey = prefix ? `${prefix}OwnerName` : "ownerName";
  const ownerPhoneKey = prefix ? `${prefix}OwnerPhone` : "ownerPhone";
  const ownerEmailKey = prefix ? `${prefix}OwnerEmail` : "ownerEmail";

  const storeName = requiredText(body?.[storeNameKey], "Store name");
  const ownerPhone = optionalText(body?.[ownerPhoneKey], 80);
  const ownerEmail = optionalText(body?.[ownerEmailKey], 120);

  const plan = normalizePlan(body?.plan);
  return {
    code: upperCode(body?.[storeCodeKey], "Store"),
    name: storeName,
    ownerUsername: requiredText(body?.[ownerUsernameKey], "Owner username", 100),
    ownerName: requiredText(body?.[ownerNameKey], "Owner name", 120),
    ownerPassword: normalizeTemporaryPassword(body?.temporaryPassword || body?.ownerPassword),
    ownerRole: "ADMIN",
    plan,
    status: normalizeStoreStatus(body?.status),
    trialEndsAt: body?.trialEndsAt || defaultTrialEndsAt(plan),
    subscriptionEndsAt: body?.subscriptionEndsAt || null,
    paymentStatus: normalizePaymentStatusForPlan(body?.paymentStatus, plan),
    billingNote: optionalText(body?.billingNote, 500),
    profileSettings: {
      displayName: storeName,
      phone: ownerPhone,
      email: ownerEmail
    }
  };
}

async function assertCompanyCodeAvailable(connection, code) {
  const [rows] = await connection.query("SELECT id FROM companies WHERE code = ? LIMIT 1", [code]);
  if (rows[0]) {
    throw new ProvisioningError(409, "Company code already exists");
  }
}

async function getCompany(connection, companyId) {
  const [rows] = await connection.query(
    "SELECT id, code, name, status FROM companies WHERE id = ? LIMIT 1",
    [companyId]
  );
  return rows[0] || null;
}

async function insertCompany(connection, payload) {
  await assertCompanyCodeAvailable(connection, payload.code);
  const [result] = await connection.query(
    `
      INSERT INTO companies (code, name, status, note)
      VALUES (?, ?, ?, ?)
    `,
    [payload.code, payload.name, payload.status, payload.note || null]
  );
  return {
    id: Number(result.insertId),
    code: payload.code,
    name: payload.name,
    status: payload.status,
    note: payload.note || ""
  };
}

async function insertCompanyStore(connection, companyId, storeId, relationshipType) {
  await connection.query(
    `
      INSERT INTO company_stores (company_id, store_id, relationship_type, status)
      VALUES (?, ?, ?, 'ACTIVE')
    `,
    [companyId, storeId, relationshipType]
  );
}

async function insertCompanyMembership(connection, companyId, staffUserId, role) {
  await connection.query(
    `
      INSERT INTO company_memberships (company_id, staff_user_id, role, status)
      VALUES (?, ?, ?, 'ACTIVE')
    `,
    [companyId, staffUserId, role]
  );
}

function publicStoreResult(result) {
  return {
    store: result.store,
    owner: {
      id: result.owner.id,
      username: result.owner.username,
      displayName: result.owner.displayName,
      storeRole: result.owner.storeRole
    },
    profileSettingsPersisted: result.profileSettingsPersisted,
    productCategoriesPersisted: result.productCategoriesPersisted
  };
}

function handleProvisioningError(res, error) {
  if (error instanceof ProvisioningError) {
    return res.status(error.status).json({ message: error.message, details: error.details || undefined });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Duplicate onboarding data" });
  }
  return null;
}

router.use(authenticatePlatformAdmin);

router.get("/options", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"]), async (req, res, next) => {
  try {
    const [companies] = await pool.query(
      `
        SELECT id, code, name, status
        FROM companies
        ORDER BY id ASC
      `
    );
    return res.json({
      ok: true,
      plans: [
        { value: "trial", label: "試用版" },
        { value: "free", label: "免費版" },
        { value: "premium", label: "進階版" },
        { value: "single_store", label: "單店版" }
      ],
      statuses: [
        { value: "active", label: "啟用" },
        { value: "suspended", label: "暫停" },
        { value: "inactive", label: "停用" }
      ],
      relationshipTypes: [
        { value: "DIRECT_STORE", label: "直營門市" },
        { value: "FRANCHISE_STORE", label: "加盟門市" },
        { value: "WAREHOUSE", label: "倉庫" }
      ],
      companies
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/preview", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"]), async (req, res, next) => {
  try {
    const storeCode = text(req.query.storeCode).toUpperCase();
    const username = text(req.query.ownerUsername || req.query.username);
    const companyCode = text(req.query.companyCode).toUpperCase();
    const checks = {};

    if (storeCode) {
      const [rows] = await pool.query("SELECT id FROM stores WHERE code = ? LIMIT 1", [storeCode]);
      checks.storeCodeAvailable = !rows[0];
    }
    if (username) {
      const [rows] = await pool.query("SELECT id FROM staff_users WHERE username = ? LIMIT 1", [username]);
      checks.ownerUsernameAvailable = !rows[0];
    }
    if (companyCode) {
      const [rows] = await pool.query("SELECT id FROM companies WHERE code = ? LIMIT 1", [companyCode]);
      checks.companyCodeAvailable = !rows[0];
    }

    return res.json({ ok: true, checks });
  } catch (error) {
    return next(error);
  }
});

router.post("/independent-store", requirePlatformRole(PLATFORM_MANAGE_ROLES), async (req, res, next) => {
  try {
    const storePayload = normalizeStorePayload(req.body || "");
    const result = await withTransaction(async (connection) => {
      return provisionStoreWithConnection(connection, storePayload, req.platformAdmin);
    });
    await recordPlatformAudit(req, {
      action: "platform_onboarding.independent_store.create",
      targetType: "store",
      targetId: result.store.id,
      before: null,
      after: {
        store: result.store,
        owner: { id: result.owner.id, username: result.owner.username }
      }
    });
    return res.status(201).json({ ok: true, type: "independent_store", ...publicStoreResult(result) });
  } catch (error) {
    const handled = handleProvisioningError(res, error);
    if (handled) return handled;
    return next(error);
  }
});

router.post("/franchise-company", requirePlatformRole(PLATFORM_MANAGE_ROLES), async (req, res, next) => {
  try {
    const body = req.body || {};
    const companyPayload = {
      code: upperCode(body.companyCode, "Company"),
      name: requiredText(body.companyName, "Company name"),
      status: normalizeCompanyStatus(body.companyStatus || "ACTIVE"),
      note: optionalText(body.note, 500)
    };
    const storePayload = normalizeStorePayload(body, "hq");

    const result = await withTransaction(async (connection) => {
      const company = await insertCompany(connection, companyPayload);
      const storeResult = await provisionStoreWithConnection(connection, storePayload, req.platformAdmin);
      await insertCompanyStore(connection, company.id, storeResult.store.id, "HEADQUARTERS");
      await insertCompanyMembership(connection, company.id, storeResult.owner.id, "company_owner");
      return { company, storeResult, relationshipType: "HEADQUARTERS", companyRole: "company_owner" };
    });

    await recordPlatformAudit(req, {
      action: "platform_onboarding.franchise_company.create",
      targetType: "company",
      targetId: result.company.id,
      before: null,
      after: {
        company: result.company,
        store: result.storeResult.store,
        owner: { id: result.storeResult.owner.id, username: result.storeResult.owner.username },
        relationshipType: result.relationshipType,
        companyRole: result.companyRole
      }
    });

    return res.status(201).json({
      ok: true,
      type: "franchise_company",
      company: result.company,
      relationshipType: result.relationshipType,
      companyRole: result.companyRole,
      ...publicStoreResult(result.storeResult)
    });
  } catch (error) {
    const handled = handleProvisioningError(res, error);
    if (handled) return handled;
    return next(error);
  }
});

router.post("/company-store", requirePlatformRole(PLATFORM_MANAGE_ROLES), async (req, res, next) => {
  try {
    const body = req.body || {};
    const companyId = Number(body.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: "Company is required" });
    }
    const relationshipType = normalizeRelationshipType(body.relationshipType);
    if (relationshipType === "HEADQUARTERS") {
      return res.status(400).json({ message: "Please create headquarters through franchise company onboarding" });
    }
    const storePayload = normalizeStorePayload(body);
    const requestedCompanyRole = text(body.companyRole);
    const companyRole = relationshipType === "WAREHOUSE" && WAREHOUSE_COMPANY_ROLES.has(requestedCompanyRole)
      ? requestedCompanyRole
      : null;

    const result = await withTransaction(async (connection) => {
      const company = await getCompany(connection, companyId);
      if (!company) {
        throw new ProvisioningError(404, "Company not found");
      }
      const storeResult = await provisionStoreWithConnection(connection, storePayload, req.platformAdmin);
      await insertCompanyStore(connection, company.id, storeResult.store.id, relationshipType);
      if (companyRole) {
        await insertCompanyMembership(connection, company.id, storeResult.owner.id, companyRole);
      }
      return { company, storeResult, relationshipType, companyRole };
    });

    await recordPlatformAudit(req, {
      action: "platform_onboarding.company_store.create",
      targetType: "company",
      targetId: result.company.id,
      before: null,
      after: {
        company: result.company,
        store: result.storeResult.store,
        owner: { id: result.storeResult.owner.id, username: result.storeResult.owner.username },
        relationshipType: result.relationshipType,
        companyRole: result.companyRole
      }
    });

    return res.status(201).json({
      ok: true,
      type: "company_store",
      company: result.company,
      relationshipType: result.relationshipType,
      companyRole: result.companyRole,
      ...publicStoreResult(result.storeResult)
    });
  } catch (error) {
    const handled = handleProvisioningError(res, error);
    if (handled) return handled;
    return next(error);
  }
});

module.exports = router;
