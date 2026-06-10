const express = require("express");
const { pool } = require("../db");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { authenticatePlatformAdmin, requirePlatformRole } = require("../middleware/platformAuth");
const {
  FEATURE_KEYS,
  FEATURE_PRESETS,
  PLAN_PRESET_KEYS,
  ProvisioningError,
  deriveSlugFromCode,
  provisionStore
} = require("../services/storeProvisioningService");
const {
  getStoreProfileSettings,
  saveStoreProfileSettings
} = require("../services/storeProfileSettingsService");
const {
  listPlatformAuditLogs,
  recordPlatformAudit
} = require("../services/platformAuditService");

const router = express.Router();
const ALLOWED_STORE_PLANS = new Set(["free", "premium"]);
const ALLOWED_STORE_STATUSES = new Set(["active", "inactive", "suspended"]);
const IMPERSONATION_TTL_SECONDS = 2 * 60 * 60;
const IMPERSONATION_TTL_TEXT = "2 小時";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function normalizeRoleForPermissions(role) {
  return String(role || "").toUpperCase().trim();
}

function getStaffPermissions(staffRole) {
  const normalized = normalizeRoleForPermissions(staffRole);
  if (normalized === "CASHIER") {
    return ["POS", "PRODUCTS", "REPAIRS", "INVENTORY"];
  }

  return [];
}

function normalizeImpersonationReason(value, maxLength = 256) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function t(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function getSchemaGuardStatus() {
  const requireStoreIdSchema = String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true";
  return {
    requireStoreIdSchema,
    status: requireStoreIdSchema ? "STRICT_ON" : "WARN_ONLY"
  };
}

function buildOwnerResponse(row) {
  if (!row?.ownerUserId) {
    return null;
  }

  const username = t(row.ownerUsername);
  return {
    id: n(row.ownerUserId),
    username,
    displayName: t(row.ownerDisplayName, username || "-"),
    role: t(row.ownerStaffRole),
    membershipRole: t(row.ownerMembershipRole),
    email: username.includes("@") ? username : null,
    phone: null
  };
}

function buildStoreResponse(row) {
  const owner = buildOwnerResponse(row);
  return {
    id: n(row.id),
    code: t(row.code, "UNKNOWN"),
    name: t(row.name, t(row.code, "UNKNOWN")),
    slug: deriveSlugFromCode(row.code),
    status: t(row.status, "unknown"),
    plan: t(row.plan, "unknown"),
    owner,
    hasOwner: Boolean(owner),
    staffCount: n(row.staffCount),
    ownerCount: n(row.ownerCount),
    adminCount: n(row.adminCount),
    memberStaffCount: n(row.memberStaffCount),
    productCount: n(row.productCount),
    customerCount: n(row.customerCount),
    orderCount: n(row.orderCount),
    repairCount: n(row.repairCount)
  };
}

function buildStoreStaffMemberResponse(row) {
  if (!row) {
    return null;
  }

  return {
    id: n(row.id),
    username: t(row.username, ""),
    displayName: t(row.displayName, t(row.username)),
    staffRole: t(row.staffRole),
    storeRole: t(row.storeRole),
    membershipStatus: t(row.membershipStatus),
    isActive: Boolean(row.isActive)
  };
}

const FEATURE_CONFIG = [
  { key: "pos_enabled", label: "POS 銷售", description: "門市 POS 開單與收款流程。" },
  { key: "orders_enabled", label: "訂單管理", description: "訂單查詢、狀態追蹤與訂金尾款管理。" },
  { key: "repairs_enabled", label: "維修管理", description: "維修預約、報價、完修與問卷流程。" },
  { key: "inventory_enabled", label: "庫存管理", description: "商品庫存、異動與低庫存檢視。" },
  { key: "suppliers_enabled", label: "供應商管理", description: "發注、退貨與供應商確認流程。" },
  { key: "coupons_enabled", label: "優惠券管理", description: "新好友與 Google 評論優惠券管理。" },
  { key: "purchase_confirmations_enabled", label: "購買確認書", description: "購買確認書送出、簽名與 PDF 留存。" },
  { key: "line_enabled", label: "LINE 流程", description: "客戶 LINE 綁定、通知與確認按鈕流程。" },
  { key: "telegram_enabled", label: "Telegram 通知", description: "舊通知相容開關；不修改 token 設定。" },
  { key: "sales_dashboard_enabled", label: "銷售儀表板", description: "銷售統計、營運數據與管理報表。" },
  { key: "staff_management_enabled", label: "員工管理", description: "出勤、KPI、薪資與營運檢查事項。" }
];

function rowToFeatures(row) {
  return FEATURE_CONFIG.map((feature) => ({
    ...feature,
    enabled: Boolean(row?.[feature.key])
  }));
}

async function getStore(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        s.id,
        s.code,
        s.name,
        s.status,
        s.plan,
        su.id AS ownerUserId,
        su.username AS ownerUsername,
        su.display_name AS ownerDisplayName,
        su.role AS ownerStaffRole,
        sm.role AS ownerMembershipRole,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.status = 'active') AS UNSIGNED) AS staffCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'owner' AND msm.status = 'active') AS UNSIGNED) AS ownerCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'admin' AND msm.status = 'active') AS UNSIGNED) AS adminCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'staff' AND msm.status = 'active') AS UNSIGNED) AS memberStaffCount
      FROM stores s
      LEFT JOIN store_memberships sm
        ON sm.store_id = s.id
       AND sm.role = 'owner'
       AND sm.status = 'active'
      LEFT JOIN staff_users su
        ON su.id = sm.staff_user_id
      WHERE s.id = ?
      ORDER BY sm.is_default DESC, sm.id ASC
      LIMIT 1
    `,
    [storeId]
  );

  const store = rows[0];
  if (!store) return null;

  return buildStoreResponse(store);
}

async function getStoreForImpersonation(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        CAST(id AS UNSIGNED) AS id,
        code,
        name,
        status,
        plan
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );

  const store = rows[0];
  if (!store) {
    return null;
  }

  return {
    id: n(store.id),
    code: t(store.code, "UNKNOWN"),
    name: t(store.name, t(store.code, "UNKNOWN")),
    status: t(store.status, "unknown"),
    plan: t(store.plan, "unknown")
  };
}

async function getActiveStaffMembersByStore(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.role AS staffRole,
        sm.role AS storeRole,
        sm.status AS membershipStatus,
        su.is_active AS isActive
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.is_active = 1
      ORDER BY FIELD(sm.role, 'owner', 'admin', 'staff'), su.username ASC
    `,
    [storeId]
  );

  return (rows || []).map(buildStoreStaffMemberResponse);
}

async function getActiveStoreMember(staffUserId, storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.role AS staffRole,
        sm.role AS storeRole,
        sm.status AS membershipStatus,
        su.is_active AS isActive
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.id = ?
        AND su.is_active = 1
      LIMIT 1
    `,
    [storeId, staffUserId]
  );

  if (!rows[0]) {
    return null;
  }

  return buildStoreStaffMemberResponse(rows[0]);
}

async function getDefaultImpersonationTarget(storeId) {
  const [ownerRows] = await pool.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.role AS staffRole,
        sm.role AS storeRole,
        sm.status AS membershipStatus,
        su.is_active AS isActive
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.is_active = 1
        AND sm.role = 'owner'
      ORDER BY su.id ASC
      LIMIT 1
    `,
    [storeId]
  );
  if (ownerRows[0]) {
    return buildStoreStaffMemberResponse(ownerRows[0]);
  }

  const [adminRows] = await pool.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.role AS staffRole,
        sm.role AS storeRole,
        sm.status AS membershipStatus,
        su.is_active AS isActive
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.is_active = 1
        AND sm.role = 'admin'
      ORDER BY su.id ASC
      LIMIT 1
    `,
    [storeId]
  );

  return buildStoreStaffMemberResponse(adminRows[0] || null);
}

async function ensureStoreFeatureRow(storeId) {
  const [rows] = await pool.query(
    "SELECT id FROM store_features WHERE store_id = ? LIMIT 1",
    [storeId]
  );

  if (rows[0]) {
    return;
  }

  await pool.query(
    `
      INSERT IGNORE INTO store_features (store_id)
      VALUES (?)
    `,
    [storeId]
  );
}

async function getStoreFeatureRow(storeId) {
  await ensureStoreFeatureRow(storeId);
  const [rows] = await pool.query(
    "SELECT " + FEATURE_KEYS.join(", ") + " FROM store_features WHERE store_id = ? LIMIT 1",
    [storeId]
  );
  return rows[0] || null;
}

function buildStoreFeatureResponse(store, featureRow) {
  return {
    ok: true,
    readOnly: false,
    store,
    presetKeys: PLAN_PRESET_KEYS,
    features: rowToFeatures(featureRow)
  };
}

function buildStoreSettingsResponse(store, settings) {
  return {
    ok: true,
    store,
    settings
  };
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

async function getStoreAuditSnapshot(storeId) {
  const [rows] = await pool.query(
    `
      SELECT id, code, name, status, plan, created_at AS createdAt, updated_at AS updatedAt
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

async function getStoreFeatureAuditSnapshot(storeId) {
  await ensureStoreFeatureRow(storeId);
  const [rows] = await pool.query(
    `
      SELECT
        store_id AS storeId,
        ${FEATURE_KEYS.join(", ")},
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM store_features
      WHERE store_id = ?
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

async function getStoreProfileAuditSnapshot(storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        store_id AS storeId,
        setting_scope AS settingScope,
        payload_json AS payloadJson,
        updated_by_staff_id AS updatedByStaffId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM app_settings
      WHERE store_id = ?
        AND setting_scope = 'STORE_PROFILE'
      LIMIT 1
    `,
    [storeId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    storeId: row.storeId,
    settingScope: row.settingScope,
    payload: parseJson(row.payloadJson),
    updatedByStaffId: row.updatedByStaffId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function getStoreFeaturesHandler(req, res, next) {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    const featureRow = await getStoreFeatureRow(storeId);
    return res.json(buildStoreFeatureResponse(store, featureRow));
  } catch (error) {
    console.error("[saasAdmin/storeFeatures:get] failed", error);
    return next(error);
  }
}

async function patchStoreFeaturesHandler(req, res, next) {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    await ensureStoreFeatureRow(storeId);
    const before = await getStoreFeatureAuditSnapshot(storeId);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];

    for (const key of FEATURE_KEYS) {
      if (typeof body[key] === "boolean") {
        updates.push(key + " = ?");
        values.push(body[key] ? 1 : 0);
      }
    }

    if (updates.length) {
      values.push(storeId);
      await pool.query("UPDATE store_features SET " + updates.join(", ") + " WHERE store_id = ?", values);
    }

    const featureRow = await getStoreFeatureRow(storeId);
    if (updates.length) {
      await recordPlatformAudit(req, {
        action: "store_features.update",
        targetType: "store_features",
        targetId: storeId,
        before,
        after: await getStoreFeatureAuditSnapshot(storeId)
      });
    }
    return res.json(buildStoreFeatureResponse(store, featureRow));
  } catch (error) {
    console.error("[saasAdmin/storeFeatures:patch] failed", error);
    return next(error);
  }
}

async function applyStoreFeaturePresetHandler(req, res, next) {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    const presetKey = String(req.body?.preset || "").trim().toUpperCase();
    const preset = FEATURE_PRESETS[presetKey];
    if (!preset) {
      return res.status(400).json({ message: "Invalid preset" });
    }

    await ensureStoreFeatureRow(storeId);
    const before = {
      store: await getStoreAuditSnapshot(storeId),
      features: await getStoreFeatureAuditSnapshot(storeId)
    };

    const updates = FEATURE_KEYS.map((key) => key + " = ?");
    const values = FEATURE_KEYS.map((key) => (preset[key] ? 1 : 0));
    values.push(storeId);

    await pool.query("UPDATE store_features SET " + updates.join(", ") + " WHERE store_id = ?", values);
    await pool.query("UPDATE stores SET plan = ? WHERE id = ?", [presetKey.toLowerCase(), storeId]);

    const nextStore = await getStore(storeId);
    const featureRow = await getStoreFeatureRow(storeId);
    await recordPlatformAudit(req, {
      action: "store_features.apply_preset",
      targetType: "store_features",
      targetId: storeId,
      before,
      after: {
        appliedPreset: presetKey,
        store: await getStoreAuditSnapshot(storeId),
        features: await getStoreFeatureAuditSnapshot(storeId)
      }
    });
    return res.json({
      ...buildStoreFeatureResponse(nextStore, featureRow),
      appliedPreset: presetKey
    });
  } catch (error) {
    console.error("[saasAdmin/storeFeatures:preset] failed", error);
    return next(error);
  }
}

router.use(authenticatePlatformAdmin);
router.use(requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"]));

router.get("/audit-logs", async (req, res, next) => {
  try {
    const logs = await listPlatformAuditLogs({
      targetType: req.query.targetType,
      targetId: req.query.targetId,
      action: req.query.action,
      limit: req.query.limit
    });
    return res.json({ ok: true, logs });
  } catch (error) {
    console.error("[saasAdmin/auditLogs] failed", error);
    return next(error);
  }
});

router.post("/stores", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const result = await provisionStore(req.body, req.platformAdmin);
    await recordPlatformAudit(req, {
      action: "store.create",
      targetType: "store",
      targetId: result.store?.id || null,
      before: null,
      after: {
        store: result.store,
        owner: {
          username: result.owner.username
        }
      }
    });
    return res.status(201).json({
      ok: true,
      store: result.store,
      owner: {
        username: result.owner.username
      },
      temporaryPassword: result.temporaryPassword
    });
  } catch (error) {
    if (error instanceof ProvisioningError) {
      return res.status(error.status).json({
        message: error.message,
        details: error.details || undefined
      });
    }

    console.error("[saasAdmin/stores:create] failed", error);
    return next(error);
  }
});

router.post(
  "/stores/:id/features/preset",
  requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]),
  applyStoreFeaturePresetHandler
);

router
  .route("/stores/:id/features")
  .get(getStoreFeaturesHandler)
  .patch(patchStoreFeaturesHandler);

router.get("/stores/:id/staff-members", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "找不到店家" });
    }

    const store = await getStoreForImpersonation(storeId);
    if (!store) {
      return res.status(404).json({ message: "找不到店家" });
    }

    const members = await getActiveStaffMembersByStore(storeId);
    return res.json({ ok: true, storeId: store.id, members });
  } catch (error) {
    console.error("[saasAdmin/storeStaffMembers:get] failed", error);
    return next(error);
  }
});

router.post("/stores/:id/impersonate", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "找不到店家" });
    }

    const store = await getStoreForImpersonation(storeId);
    if (!store) {
      return res.status(404).json({ message: "找不到店家" });
    }
    if (String(store.status).toLowerCase() !== "active") {
      return res.status(409).json({ message: "目前店家不是啟用狀態，無法模擬登入" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    let targetStaffUserId = n(body.targetStaffUserId, 0);
    let member = null;

    if (targetStaffUserId) {
      member = await getActiveStoreMember(targetStaffUserId, storeId);
      if (!member) {
        return res.status(404).json({ message: "找不到可用的目標員工" });
      }
    } else {
      member = await getDefaultImpersonationTarget(storeId);
      if (!member?.id) {
        return res.status(404).json({ message: "此店家沒有可用目標員工" });
      }

      targetStaffUserId = n(member.id, 0);
    }

    const staffRole = t(member.staffRole);
    const storeRole = t(member.storeRole);
    const token = jwt.sign(
      {
        id: member.id,
        username: member.username,
        role: staffRole,
        displayName: t(member.displayName, member.username),
        storeId: store.id,
        storeRole,
        storeName: t(store.name, "KINGWAY 門市"),
        permissions: getStaffPermissions(staffRole),
        impersonation: true,
        impersonatedByPlatformAdminId: req.platformAdmin?.id || null,
        impersonatedByPlatformAdminEmail: t(req.platformAdmin?.email)
      },
      config.jwtSecret,
      { expiresIn: `${IMPERSONATION_TTL_SECONDS}s` }
    );

    const payload = {
      storeId: store.id,
      storeCode: store.code,
      storeName: t(store.name, t(store.code)),
      targetStaffUserId: member.id,
      targetUsername: member.username,
      targetStoreRole: storeRole,
      ttl: IMPERSONATION_TTL_TEXT,
      reason: normalizeImpersonationReason(body.reason),
      targetDisplayName: t(member.displayName, t(member.username))
    };

    await recordPlatformAudit(req, {
      action: "store.impersonation.start",
      targetType: "store",
      targetId: store.id,
      before: null,
      after: payload
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: member.id,
        username: member.username,
        role: staffRole,
        displayName: t(member.displayName, member.username),
        storeId: store.id,
        storeRole,
        storeName: t(store.name, t(store.code)),
        permissions: getStaffPermissions(staffRole)
      },
      expiresIn: `${IMPERSONATION_TTL_TEXT}`,
      impersonation: true,
      metadata: payload
    });
  } catch (error) {
    console.error("[saasAdmin/storeImpersonation:start] failed", error);
    return next(error);
  }
});

router.post(
  "/stores/:id/impersonation/stop",
  requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]),
  async (req, res, next) => {
    try {
      const storeId = n(req.params.id, 0);
      if (!storeId) {
        return res.status(404).json({ message: "找不到店家" });
      }

      const store = await getStoreForImpersonation(storeId);
      if (!store) {
        return res.status(404).json({ message: "找不到店家" });
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const targetStaffUserId = n(body.targetStaffUserId, 0);

      let targetStaff = null;
      if (targetStaffUserId) {
        targetStaff = await getActiveStoreMember(targetStaffUserId, storeId);
      }

      await recordPlatformAudit(req, {
        action: "store.impersonation.stop",
        targetType: "store",
        targetId: storeId,
        before: null,
        after: {
          storeId,
          storeName: t(store.name),
          targetStaffUserId: targetStaff?.id ? n(targetStaff.id) : targetStaffUserId || null,
          targetUsername: targetStaff?.username || null,
          targetStoreRole: targetStaff?.storeRole || null,
          reason: normalizeImpersonationReason(body.reason)
        }
      });

      return res.json({
        ok: true,
        storeId: store.id,
        storeName: t(store.name)
      });
    } catch (error) {
      console.error("[saasAdmin/storeImpersonation:stop] failed", error);
      return next(error);
    }
  }
);

router.get("/stores/:id/settings", async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    const settings = await getStoreProfileSettings(storeId);
    return res.json(buildStoreSettingsResponse(store, settings));
  } catch (error) {
    console.error("[saasAdmin/storeSettings:get] failed", error);
    return next(error);
  }
});

router.patch("/stores/:id/settings", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }
    const before = await getStoreProfileAuditSnapshot(storeId);

    const settings = await saveStoreProfileSettings(storeId, req.body || {}, req.platformAdmin?.id || null);
    await recordPlatformAudit(req, {
      action: "store_settings.update",
      targetType: "store_settings",
      targetId: storeId,
      before,
      after: await getStoreProfileAuditSnapshot(storeId)
    });
    return res.json(buildStoreSettingsResponse(store, settings));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error("[saasAdmin/storeSettings:patch] failed", error);
    return next(error);
  }
});

router.patch("/stores/:id", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "找不到店家" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "找不到店家" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];
    const before = await getStoreAuditSnapshot(storeId);

    if (Object.prototype.hasOwnProperty.call(body, "plan")) {
      const plan = t(body.plan).trim().toLowerCase();
      if (!ALLOWED_STORE_PLANS.has(plan)) {
        return res.status(400).json({ message: "方案只能設定為免費版或進階版" });
      }
      updates.push("plan = ?");
      values.push(plan);
    }

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      const status = t(body.status).trim().toLowerCase();
      if (!ALLOWED_STORE_STATUSES.has(status)) {
        return res.status(400).json({ message: "狀態只能設定為啟用、停用或暫停" });
      }
      updates.push("status = ?");
      values.push(status);
    }

    if (!updates.length) {
      return res.json({ ok: true, store });
    }

    values.push(storeId);
    await pool.query(
      `
        UPDATE stores
        SET ${updates.join(", ")}
        WHERE id = ?
      `,
      values
    );

    const nextStore = await getStore(storeId);
    await recordPlatformAudit(req, {
      action: "store.update_plan_status",
      targetType: "store",
      targetId: storeId,
      before,
      after: await getStoreAuditSnapshot(storeId)
    });
    return res.json({ ok: true, store: nextStore });
  } catch (error) {
    console.error("[saasAdmin/stores:patch] failed", error);
    return next(error);
  }
});

router.get("/stores", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CAST(s.id AS UNSIGNED) AS id,
        s.code,
        s.name,
        s.status,
        s.plan,
        su.id AS ownerUserId,
        su.username AS ownerUsername,
        su.display_name AS ownerDisplayName,
        su.role AS ownerStaffRole,
        sm.role AS ownerMembershipRole,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.status = 'active') AS UNSIGNED) AS staffCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'owner' AND msm.status = 'active') AS UNSIGNED) AS ownerCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'admin' AND msm.status = 'active') AS UNSIGNED) AS adminCount,
        CAST((SELECT COUNT(*) FROM store_memberships msm WHERE msm.store_id = s.id AND msm.role = 'staff' AND msm.status = 'active') AS UNSIGNED) AS memberStaffCount,
        CAST((SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS UNSIGNED) AS productCount,
        CAST((SELECT COUNT(*) FROM customers c WHERE c.store_id = s.id) AS UNSIGNED) AS customerCount,
        CAST((SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS UNSIGNED) AS orderCount,
        CAST((SELECT COUNT(*) FROM repair_orders r WHERE r.store_id = s.id) AS UNSIGNED) AS repairCount
      FROM stores s
      LEFT JOIN store_memberships sm
        ON sm.store_id = s.id
       AND sm.role = 'owner'
       AND sm.status = 'active'
      LEFT JOIN staff_users su
        ON su.id = sm.staff_user_id
      ORDER BY s.id ASC
    `);

    const stores = rows.map(buildStoreResponse);

    return res.json({
      ok: true,
      environment: t(process.env.APP_ENV || process.env.NODE_ENV, "unknown"),
      schemaGuard: getSchemaGuardStatus(),
      totalStores: stores.length,
      totals: stores.reduce((acc, store) => {
        acc.productCount += store.productCount;
        acc.customerCount += store.customerCount;
        acc.orderCount += store.orderCount;
        acc.repairCount += store.repairCount;
        return acc;
      }, { productCount: 0, customerCount: 0, orderCount: 0, repairCount: 0 }),
      stores
    });
  } catch (error) {
    console.error("[saasAdmin/stores] failed", error);
    return next(error);
  }
});

module.exports = router;
