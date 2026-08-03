const express = require("express");
const { pool } = require("../db");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { authenticatePlatformAdmin, requirePlatformRole } = require("../middleware/platformAuth");
const { hashPassword } = require("../utils/passwords");
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
const ALLOWED_STORE_PLANS = new Set(["free", "trial", "premium"]);
const ALLOWED_STORE_STATUSES = new Set(["active", "inactive", "suspended"]);
const IMPERSONATION_TTL_SECONDS = 2 * 60 * 60;
const IMPERSONATION_TTL_TEXT = "2 小時";
const OWNER_PASSWORD_MIN_LENGTH = 8;
const COMPANY_STATUS = new Set(["ACTIVE", "INACTIVE"]);
const COMPANY_STORE_RELATIONSHIPS = new Set(["HEADQUARTERS", "WAREHOUSE", "DIRECT_STORE", "FRANCHISE_STORE"]);
const COMPANY_MEMBER_ROLES = new Set(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]);

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

function normalizeCompanyCode(value) {
  const code = t(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,78}[A-Z0-9]$/.test(code)) {
    const error = new Error("公司代碼格式不正確");
    error.statusCode = 400;
    throw error;
  }
  return code;
}

function normalizeCompanyName(value) {
  const name = t(value).trim();
  if (!name) {
    const error = new Error("請輸入公司名稱");
    error.statusCode = 400;
    throw error;
  }
  if (name.length > 150) {
    const error = new Error("公司名稱過長");
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function normalizeCompanyStatus(value) {
  const status = t(value, "ACTIVE").trim().toUpperCase();
  return COMPANY_STATUS.has(status) ? status : "ACTIVE";
}

function normalizeCompanyStoreRelationship(value) {
  const relationship = t(value, "FRANCHISE_STORE").trim().toUpperCase();
  return COMPANY_STORE_RELATIONSHIPS.has(relationship) ? relationship : "FRANCHISE_STORE";
}

function normalizeCompanyMemberRole(value) {
  const role = t(value, "viewer").trim();
  return COMPANY_MEMBER_ROLES.has(role) ? role : "viewer";
}

function buildCompanyResponse(row, stores = [], members = []) {
  return {
    id: n(row.id),
    code: t(row.code),
    name: t(row.name),
    status: t(row.status, "ACTIVE"),
    note: t(row.note),
    storeCount: n(row.storeCount, stores.length),
    memberCount: n(row.memberCount, members.length),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    stores,
    members
  };
}

async function getCompany(companyId) {
  const [rows] = await pool.query(
    `
      SELECT
        c.id,
        c.code,
        c.name,
        c.status,
        c.note,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        CAST((SELECT COUNT(*) FROM company_stores cs WHERE cs.company_id = c.id AND cs.status = 'ACTIVE') AS UNSIGNED) AS storeCount,
        CAST((SELECT COUNT(*) FROM company_memberships cm WHERE cm.company_id = c.id AND cm.status = 'ACTIVE') AS UNSIGNED) AS memberCount
      FROM companies c
      WHERE c.id = ?
      LIMIT 1
    `,
    [companyId]
  );
  return rows[0] || null;
}

async function getCompanyStores(companyId) {
  const [rows] = await pool.query(
    `
      SELECT
        cs.id,
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cs.status,
        s.code AS storeCode,
        s.name AS storeName,
        s.status AS storeStatus,
        s.plan AS storePlan
      FROM company_stores cs
      INNER JOIN stores s ON s.id = cs.store_id
      WHERE cs.company_id = ?
      ORDER BY cs.status ASC, FIELD(cs.relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE'), s.id ASC
    `,
    [companyId]
  );
  return rows.map((row) => ({
    id: n(row.id),
    companyId: n(row.companyId),
    storeId: n(row.storeId),
    relationshipType: t(row.relationshipType),
    status: t(row.status),
    storeCode: t(row.storeCode),
    storeName: t(row.storeName),
    storeStatus: t(row.storeStatus),
    storePlan: t(row.storePlan)
  }));
}

async function getCompanyMembers(companyId) {
  const [rows] = await pool.query(
    `
      SELECT
        cm.id,
        cm.company_id AS companyId,
        cm.staff_user_id AS staffUserId,
        cm.role,
        cm.status,
        su.username,
        su.display_name AS displayName,
        su.role AS staffRole
      FROM company_memberships cm
      INNER JOIN staff_users su ON su.id = cm.staff_user_id
      WHERE cm.company_id = ?
      ORDER BY cm.status ASC, FIELD(cm.role, 'company_owner', 'hq_admin', 'finance', 'inventory_manager', 'viewer'), su.username ASC
    `,
    [companyId]
  );
  return rows.map((row) => ({
    id: n(row.id),
    companyId: n(row.companyId),
    staffUserId: n(row.staffUserId),
    role: t(row.role),
    status: t(row.status),
    username: t(row.username),
    displayName: t(row.displayName),
    staffRole: t(row.staffRole)
  }));
}

async function buildCompanyDetail(companyId) {
  const company = await getCompany(companyId);
  if (!company) return null;
  const stores = await getCompanyStores(companyId);
  const members = await getCompanyMembers(companyId);
  return buildCompanyResponse(company, stores, members);
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
    trialEndsAt: row.trialEndsAt || row.trial_ends_at || null,
    subscriptionEndsAt: row.subscriptionEndsAt || row.subscription_ends_at || null,
    paymentStatus: t(row.paymentStatus || row.payment_status || "NONE"),
    billingNote: t(row.billingNote || row.billing_note || ""),
    lastPlanChangedAt: row.lastPlanChangedAt || row.last_plan_changed_at || null,
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

async function getStaffUserColumnSet() {
  const [rows] = await pool.query("SHOW COLUMNS FROM staff_users");
  return new Set((rows || []).map((row) => t(row.Field)));
}

function normalizeStaffUsername(value) {
  const username = t(value).trim();
  if (!/^[A-Za-z0-9._@-]{3,100}$/.test(username)) {
    const error = new Error("登入帳號格式不正確，請使用 3-100 個英數字、底線、減號、點或 @");
    error.statusCode = 400;
    throw error;
  }
  return username;
}

function normalizeStaffDisplayText(value, label) {
  const text = t(value).trim();
  if (text.length > 120) {
    const error = new Error(`${label}不可超過 120 個字`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function buildPlatformStaffUserResponse(user, storeMemberships = [], companyMemberships = []) {
  const displayName = t(user.displayName || user.display_name || user.name || user.username);
  return {
    id: n(user.id),
    username: t(user.username),
    name: t(user.name, displayName),
    displayName,
    role: t(user.role),
    status: Number(user.isActive ?? user.is_active ?? 0) ? "active" : "disabled",
    isActive: Boolean(Number(user.isActive ?? user.is_active ?? 0)),
    primaryStoreId: user.primaryStoreId === null || user.primary_store_id === null ? null : n(user.primaryStoreId ?? user.primary_store_id, null),
    primaryStoreCode: t(user.primaryStoreCode || user.primary_store_code),
    primaryStoreName: t(user.primaryStoreName || user.primary_store_name),
    lineUserId: t(user.lineUserId || user.line_user_id),
    telegramUsername: t(user.telegramUsername || user.telegram_username),
    storeMemberships,
    companyMemberships
  };
}

async function getPlatformStaffUsers() {
  const columns = await getStaffUserColumnSet();
  const hasNameColumn = columns.has("name");
  const [users] = await pool.query(
    `
      SELECT
        su.id,
        su.username,
        ${hasNameColumn ? "su.name" : "su.display_name"} AS name,
        su.display_name AS displayName,
        su.role,
        su.is_active AS isActive,
        su.store_id AS primaryStoreId,
        su.line_user_id AS lineUserId,
        su.telegram_username AS telegramUsername,
        s.code AS primaryStoreCode,
        s.name AS primaryStoreName
      FROM staff_users su
      LEFT JOIN stores s ON s.id = su.store_id
      ORDER BY su.id ASC
    `
  );

  const [storeRows] = await pool.query(
    `
      SELECT
        sm.staff_user_id AS staffUserId,
        sm.id,
        sm.store_id AS storeId,
        sm.role,
        sm.status,
        sm.is_default AS isDefault,
        s.code AS storeCode,
        s.name AS storeName
      FROM store_memberships sm
      INNER JOIN stores s ON s.id = sm.store_id
      ORDER BY sm.staff_user_id ASC, sm.is_default DESC, sm.id ASC
    `
  );

  const [companyRows] = await pool.query(
    `
      SELECT
        cm.staff_user_id AS staffUserId,
        cm.id,
        cm.company_id AS companyId,
        cm.role,
        cm.status,
        c.code AS companyCode,
        c.name AS companyName
      FROM company_memberships cm
      INNER JOIN companies c ON c.id = cm.company_id
      ORDER BY cm.staff_user_id ASC, cm.id ASC
    `
  );

  const storesByStaff = new Map();
  for (const row of storeRows || []) {
    const key = n(row.staffUserId);
    if (!storesByStaff.has(key)) storesByStaff.set(key, []);
    storesByStaff.get(key).push({
      id: n(row.id),
      storeId: n(row.storeId),
      storeCode: t(row.storeCode),
      storeName: t(row.storeName),
      role: t(row.role),
      status: t(row.status),
      isDefault: Boolean(row.isDefault)
    });
  }

  const companiesByStaff = new Map();
  for (const row of companyRows || []) {
    const key = n(row.staffUserId);
    if (!companiesByStaff.has(key)) companiesByStaff.set(key, []);
    companiesByStaff.get(key).push({
      id: n(row.id),
      companyId: n(row.companyId),
      companyCode: t(row.companyCode),
      companyName: t(row.companyName),
      role: t(row.role),
      status: t(row.status)
    });
  }

  return (users || []).map((user) => buildPlatformStaffUserResponse(
    user,
    storesByStaff.get(n(user.id)) || [],
    companiesByStaff.get(n(user.id)) || []
  ));
}

async function getPlatformStaffUserDetail(staffUserId) {
  const users = await getPlatformStaffUsers();
  return users.find((user) => Number(user.id) === Number(staffUserId)) || null;
}

const FEATURE_CONFIG = [
  { key: "pos_enabled", label: "POS 銷售", description: "門市 POS 開單與收款流程。" },
  { key: "orders_enabled", label: "訂單管理", description: "訂單查詢、狀態追蹤與訂金尾款管理。" },
  { key: "repairs_enabled", label: "維修管理", description: "維修預約、報價、完修與問卷流程。" },
  { key: "inventory_enabled", label: "庫存管理", description: "商品庫存、異動與低庫存檢視。" },
  { key: "suppliers_enabled", label: "供應商管理", description: "發注、退貨與供應商確認流程。" },
  { key: "coupons_enabled", label: "歷史優惠紀錄", description: "既有優惠紀錄查詢。" },
  { key: "purchase_confirmations_enabled", label: "購買確認書", description: "購買確認書送出、簽名與 PDF 留存。" },
  { key: "line_enabled", label: "LINE 流程", description: "客戶 LINE 綁定、通知與確認按鈕流程。" },
  { key: "telegram_enabled", label: "Telegram 通知", description: "舊通知相容開關；不修改 token 設定。" },
  { key: "sales_dashboard_enabled", label: "銷售儀表板", description: "銷售統計、營運數據與管理報表。" },
  { key: "staff_management_enabled", label: "員工管理", description: "出勤、KPI、薪資與營運檢查事項。" },
  { key: "staff_workday_selection_enabled", label: "員工工作日申請", description: "員工月曆選日與管理員審核；預設停用。" }
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
        s.trial_ends_at AS trialEndsAt,
        s.subscription_ends_at AS subscriptionEndsAt,
        s.payment_status AS paymentStatus,
        s.billing_note AS billingNote,
        s.last_plan_changed_at AS lastPlanChangedAt,
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

async function getActiveStoreOwner(storeId) {
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
       AND sm.role = 'owner'
       AND sm.status = 'active'
      WHERE su.is_active = 1
      ORDER BY sm.is_default DESC, sm.id ASC
      LIMIT 1
    `,
    [storeId]
  );

  return rows[0] || null;
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
        last_plan_changed_at AS lastPlanChangedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
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

router.get("/staff-users", async (req, res, next) => {
  try {
    const staffUsers = await getPlatformStaffUsers();
    return res.json({ ok: true, staffUsers });
  } catch (error) {
    console.error("[saasAdmin/staffUsers:get] failed", error);
    return next(error);
  }
});

router.patch("/staff-users/:id", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const staffUserId = n(req.params.id, 0);
    if (!staffUserId) {
      return res.status(404).json({ message: "找不到帳號" });
    }

    const before = await getPlatformStaffUserDetail(staffUserId);
    if (!before) {
      return res.status(404).json({ message: "找不到帳號" });
    }

    const columns = await getStaffUserColumnSet();
    const hasNameColumn = columns.has("name");
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "username")) {
      const username = normalizeStaffUsername(req.body.username);
      const [duplicates] = await pool.query(
        "SELECT id FROM staff_users WHERE username = ? AND id <> ? LIMIT 1",
        [username, staffUserId]
      );
      if (duplicates[0]) {
        return res.status(409).json({ message: "登入帳號已存在" });
      }
      updates.push("username = ?");
      values.push(username);
    }

    if (hasNameColumn && Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      updates.push("name = ?");
      values.push(normalizeStaffDisplayText(req.body.name, "姓名"));
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "displayName")) {
      updates.push("display_name = ?");
      values.push(normalizeStaffDisplayText(req.body.displayName, "顯示名稱"));
    } else if (!hasNameColumn && Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      updates.push("display_name = ?");
      values.push(normalizeStaffDisplayText(req.body.name, "姓名"));
    }

    if (!updates.length) {
      return res.json({ ok: true, staffUser: before, updated: false });
    }

    values.push(staffUserId);
    await pool.query(`UPDATE staff_users SET ${updates.join(", ")} WHERE id = ? LIMIT 1`, values);

    const after = await getPlatformStaffUserDetail(staffUserId);
    await recordPlatformAudit(req, {
      action: "staff_user.update_identity",
      targetType: "staff_user",
      targetId: staffUserId,
      before,
      after
    });

    return res.json({ ok: true, staffUser: after, updated: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "登入帳號已存在" });
    }
    console.error("[saasAdmin/staffUsers:patch] failed", error);
    return next(error);
  }
});

router.get("/companies", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          c.id,
          c.code,
          c.name,
          c.status,
          c.note,
          c.created_at AS createdAt,
          c.updated_at AS updatedAt,
          CAST((SELECT COUNT(*) FROM company_stores cs WHERE cs.company_id = c.id AND cs.status = 'ACTIVE') AS UNSIGNED) AS storeCount,
          CAST((SELECT COUNT(*) FROM company_memberships cm WHERE cm.company_id = c.id AND cm.status = 'ACTIVE') AS UNSIGNED) AS memberCount
        FROM companies c
        ORDER BY c.id ASC
      `
    );

    const companies = [];
    for (const row of rows) {
      const companyId = n(row.id);
      companies.push(buildCompanyResponse(row, await getCompanyStores(companyId), await getCompanyMembers(companyId)));
    }

    return res.json({ ok: true, companies });
  } catch (error) {
    console.error("[saasAdmin/companies:get] failed", error);
    return next(error);
  }
});

router.post("/companies", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const code = normalizeCompanyCode(req.body?.code);
    const name = normalizeCompanyName(req.body?.name);
    const status = normalizeCompanyStatus(req.body?.status);
    const note = t(req.body?.note).trim() || null;

    const [result] = await pool.query(
      `
        INSERT INTO companies (code, name, status, note)
        VALUES (?, ?, ?, ?)
      `,
      [code, name, status, note]
    );

    const company = await buildCompanyDetail(result.insertId);
    await recordPlatformAudit(req, {
      action: "company.create",
      targetType: "company",
      targetId: result.insertId,
      before: null,
      after: company
    });
    return res.status(201).json({ ok: true, company });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "公司代碼已存在" });
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("[saasAdmin/companies:create] failed", error);
    return next(error);
  }
});

router.patch("/companies/:id", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const companyId = n(req.params.id, 0);
    const before = await buildCompanyDetail(companyId);
    if (!before) {
      return res.status(404).json({ message: "找不到公司" });
    }

    const updates = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "code")) {
      updates.push("code = ?");
      values.push(normalizeCompanyCode(req.body.code));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      updates.push("name = ?");
      values.push(normalizeCompanyName(req.body.name));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      updates.push("status = ?");
      values.push(normalizeCompanyStatus(req.body.status));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) {
      updates.push("note = ?");
      values.push(t(req.body.note).trim() || null);
    }

    if (updates.length) {
      values.push(companyId);
      await pool.query(`UPDATE companies SET ${updates.join(", ")} WHERE id = ?`, values);
    }

    const company = await buildCompanyDetail(companyId);
    if (updates.length) {
      await recordPlatformAudit(req, {
        action: "company.update",
        targetType: "company",
        targetId: companyId,
        before,
        after: company
      });
    }
    return res.json({ ok: true, company });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "公司代碼已存在" });
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("[saasAdmin/companies:patch] failed", error);
    return next(error);
  }
});

router.post("/companies/:id/stores", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const companyId = n(req.params.id, 0);
    const storeId = n(req.body?.storeId || req.body?.store_id, 0);
    if (!companyId || !storeId) {
      return res.status(400).json({ message: "請提供公司與門市" });
    }
    const company = await getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: "找不到公司" });
    }
    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "找不到門市" });
    }

    const relationship = normalizeCompanyStoreRelationship(req.body?.relationshipType || req.body?.relationship_type);
    const status = normalizeCompanyStatus(req.body?.status);
    const before = await buildCompanyDetail(companyId);
    await pool.query(
      `
        INSERT INTO company_stores (company_id, store_id, relationship_type, status)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE relationship_type = VALUES(relationship_type), status = VALUES(status)
      `,
      [companyId, storeId, relationship, status]
    );

    const after = await buildCompanyDetail(companyId);
    await recordPlatformAudit(req, {
      action: "company.store.upsert",
      targetType: "company",
      targetId: companyId,
      before,
      after
    });
    return res.status(201).json({ ok: true, company: after });
  } catch (error) {
    console.error("[saasAdmin/companies:storeUpsert] failed", error);
    return next(error);
  }
});

router.patch("/companies/:id/stores/:storeId", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const companyId = n(req.params.id, 0);
    const storeId = n(req.params.storeId, 0);
    const before = await buildCompanyDetail(companyId);
    if (!before) {
      return res.status(404).json({ message: "找不到公司" });
    }

    const relationship = normalizeCompanyStoreRelationship(req.body?.relationshipType || req.body?.relationship_type);
    const status = normalizeCompanyStatus(req.body?.status);
    const [result] = await pool.query(
      `
        UPDATE company_stores
        SET relationship_type = ?, status = ?
        WHERE company_id = ?
          AND store_id = ?
      `,
      [relationship, status, companyId, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到公司門市關聯" });
    }

    const after = await buildCompanyDetail(companyId);
    await recordPlatformAudit(req, {
      action: "company.store.update",
      targetType: "company",
      targetId: companyId,
      before,
      after
    });
    return res.json({ ok: true, company: after });
  } catch (error) {
    console.error("[saasAdmin/companies:storePatch] failed", error);
    return next(error);
  }
});

router.post("/companies/:id/members", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const companyId = n(req.params.id, 0);
    const staffUserId = n(req.body?.staffUserId || req.body?.staff_user_id, 0);
    if (!companyId || !staffUserId) {
      return res.status(400).json({ message: "請提供公司與人員" });
    }
    const company = await getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: "找不到公司" });
    }
    const [staffRows] = await pool.query("SELECT id FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1", [staffUserId]);
    if (!staffRows[0]) {
      return res.status(404).json({ message: "找不到啟用中的人員" });
    }

    const role = normalizeCompanyMemberRole(req.body?.role);
    const status = normalizeCompanyStatus(req.body?.status);
    const before = await buildCompanyDetail(companyId);
    await pool.query(
      `
        INSERT INTO company_memberships (company_id, staff_user_id, role, status)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status)
      `,
      [companyId, staffUserId, role, status]
    );

    const after = await buildCompanyDetail(companyId);
    await recordPlatformAudit(req, {
      action: "company.member.upsert",
      targetType: "company",
      targetId: companyId,
      before,
      after
    });
    return res.status(201).json({ ok: true, company: after });
  } catch (error) {
    console.error("[saasAdmin/companies:memberUpsert] failed", error);
    return next(error);
  }
});

router.patch("/companies/:id/members/:membershipId", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const companyId = n(req.params.id, 0);
    const membershipId = n(req.params.membershipId, 0);
    const before = await buildCompanyDetail(companyId);
    if (!before) {
      return res.status(404).json({ message: "找不到公司" });
    }

    const role = normalizeCompanyMemberRole(req.body?.role);
    const status = normalizeCompanyStatus(req.body?.status);
    const [result] = await pool.query(
      `
        UPDATE company_memberships
        SET role = ?, status = ?
        WHERE id = ?
          AND company_id = ?
      `,
      [role, status, membershipId, companyId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到公司權限人員" });
    }

    const after = await buildCompanyDetail(companyId);
    await recordPlatformAudit(req, {
      action: "company.member.update",
      targetType: "company",
      targetId: companyId,
      before,
      after
    });
    return res.json({ ok: true, company: after });
  } catch (error) {
    console.error("[saasAdmin/companies:memberPatch] failed", error);
    return next(error);
  }
});

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

router.post(
  "/stores/:id/owner-password-reset",
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

      const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
      if (newPassword.length < OWNER_PASSWORD_MIN_LENGTH) {
        return res.status(400).json({ message: "Owner 密碼至少需要 8 個字元" });
      }

      const owner = await getActiveStoreOwner(storeId);
      if (!owner?.id) {
        return res.status(404).json({ message: "找不到啟用中的 owner 帳號" });
      }

      const passwordHash = await hashPassword(newPassword);
      const [result] = await pool.query(
        `
          UPDATE staff_users
          SET password_hash = ?
          WHERE id = ?
            AND is_active = 1
          LIMIT 1
        `,
        [passwordHash, owner.id]
      );

      if (result.affectedRows !== 1) {
        return res.status(409).json({ message: "Owner 密碼重設失敗" });
      }

      await recordPlatformAudit(req, {
        action: "STORE_OWNER_PASSWORD_RESET",
        targetType: "store",
        targetId: storeId,
        before: null,
        after: {
          targetStoreId: storeId,
          targetUserId: n(owner.id),
          ownerUsername: t(owner.username)
        }
      });

      return res.json({
        ok: true,
        storeId,
        ownerUsername: t(owner.username),
        updated: true
      });
    } catch (error) {
      console.error("[saasAdmin/storeOwnerPasswordReset] failed", error);
      return next(error);
    }
  }
);

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
        return res.status(400).json({ message: "方案只能設定為免費版、試用版或進階版" });
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
        s.trial_ends_at AS trialEndsAt,
        s.subscription_ends_at AS subscriptionEndsAt,
        s.payment_status AS paymentStatus,
        s.billing_note AS billingNote,
        s.last_plan_changed_at AS lastPlanChangedAt,
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
