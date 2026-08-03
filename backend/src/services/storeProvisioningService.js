"use strict";

const crypto = require("crypto");
const { withTransaction } = require("../db");
const {
  STORE_PROFILE_DEFAULTS,
  STORE_PROFILE_SCOPE,
  normalizeStoreProfilePayload
} = require("./storeProfileSettingsService");
const { hashPassword } = require("../utils/passwords");
const { PRODUCT_CATEGORY_LABELS, PRODUCT_CATEGORY_ORDER } = require("../utils/productCategories");
const { normalizeSlug } = require("../utils/publicStoreResolver");

const STORE_STATUS = "active";
const DEFAULT_PLAN = "trial";
const DEFAULT_OWNER_ROLE = "ADMIN";
const STORE_STATUSES = new Set(["active", "inactive", "suspended"]);
const OWNER_ROLES = new Set(["ADMIN", "MANAGER"]);
const FEATURE_KEYS = [
  "pos_enabled",
  "orders_enabled",
  "repairs_enabled",
  "inventory_enabled",
  "suppliers_enabled",
  "coupons_enabled",
  "purchase_confirmations_enabled",
  "line_enabled",
  "telegram_enabled",
  "sales_dashboard_enabled",
  "staff_management_enabled",
  "staff_workday_selection_enabled"
];
const PLAN_PRESET_KEYS = ["FREE", "TRIAL", "PREMIUM"];
const FEATURE_PRESETS = {
  FREE: {
    pos_enabled: true,
    orders_enabled: true,
    repairs_enabled: true,
    inventory_enabled: true,
    suppliers_enabled: false,
    coupons_enabled: false,
    purchase_confirmations_enabled: false,
    line_enabled: true,
    telegram_enabled: false,
    sales_dashboard_enabled: false,
    staff_management_enabled: false,
    staff_workday_selection_enabled: false
  },
  PREMIUM: {
    pos_enabled: true,
    orders_enabled: true,
    repairs_enabled: true,
    inventory_enabled: true,
    suppliers_enabled: true,
    coupons_enabled: true,
    purchase_confirmations_enabled: true,
    line_enabled: true,
    telegram_enabled: false,
    sales_dashboard_enabled: true,
    staff_management_enabled: true,
    staff_workday_selection_enabled: false
  }
};
FEATURE_PRESETS.TRIAL = FEATURE_PRESETS.PREMIUM;

class ProvisioningError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "ProvisioningError";
    this.status = status;
    this.details = details;
  }
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,78}[A-Z0-9]$/.test(code)) {
    throw new ProvisioningError(400, "Invalid store code");
  }
  return code;
}

function normalizeName(value) {
  const name = String(value || "").trim();
  if (!name) {
    throw new ProvisioningError(400, "Store name is required");
  }
  if (name.length > 150) {
    throw new ProvisioningError(400, "Store name is too long");
  }
  return name;
}

function deriveSlugFromCode(code) {
  return normalizeSlug(String(code || "").trim().toLowerCase().replace(/[_\s]+/g, "-"));
}

function normalizeRequestedSlug(value, code) {
  const raw = String(value || "").trim();
  const slug = normalizeSlug(raw || deriveSlugFromCode(code));
  if (!slug) {
    throw new ProvisioningError(400, "Invalid store slug");
  }
  return slug;
}

function normalizeUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_.@-]{3,100}$/.test(username)) {
    throw new ProvisioningError(400, "Invalid owner username");
  }
  return username;
}

function normalizeOwnerName(value, storeName) {
  const ownerName = String(value || "").trim() || `${storeName} 店長`;
  if (ownerName.length > 120) {
    throw new ProvisioningError(400, "Owner name is too long");
  }
  return ownerName;
}

function normalizeOwnerRole(value) {
  const role = String(value || DEFAULT_OWNER_ROLE).trim().toUpperCase();
  if (!OWNER_ROLES.has(role)) {
    throw new ProvisioningError(400, "Invalid owner role");
  }
  return role;
}

function normalizePlan(value) {
  const plan = String(value || DEFAULT_PLAN).trim();
  if (!plan) {
    throw new ProvisioningError(400, "Invalid plan");
  }
  if (plan.length > 80) {
    throw new ProvisioningError(400, "Plan is too long");
  }
  return plan;
}

function normalizeStoreStatus(value) {
  const status = String(value || STORE_STATUS).trim().toLowerCase();
  if (!STORE_STATUSES.has(status)) {
    throw new ProvisioningError(400, "Invalid store status");
  }
  return status;
}

function generateTemporaryPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

async function storesTableHasSlug(connection) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'stores'
        AND COLUMN_NAME = 'slug'
      LIMIT 1
    `
  );
  return Boolean(rows[0]);
}

async function storesTableHasBillingColumns(connection) {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'stores'
        AND COLUMN_NAME IN ('trial_ends_at', 'subscription_ends_at', 'payment_status', 'billing_note', 'last_plan_changed_at')
    `
  );
  return Number(rows[0]?.count || 0) >= 5;
}

async function assertStoreCodeAvailable(connection, code) {
  const [rows] = await connection.query("SELECT id FROM stores WHERE code = ? LIMIT 1", [code]);
  if (rows[0]) {
    throw new ProvisioningError(409, "Store code already exists");
  }
}

async function assertStoreSlugAvailable(connection, slug, hasSlugColumn) {
  if (hasSlugColumn) {
    const [rows] = await connection.query("SELECT id FROM stores WHERE slug = ? LIMIT 1", [slug]);
    if (rows[0]) {
      throw new ProvisioningError(409, "Store slug already exists");
    }
    return;
  }

  const [rows] = await connection.query("SELECT id, code FROM stores");
  const conflictingStore = rows.find((row) => deriveSlugFromCode(row.code) === slug);
  if (conflictingStore) {
    throw new ProvisioningError(409, "Store slug already exists");
  }
}

async function assertOwnerUsernameAvailable(connection, username) {
  const [rows] = await connection.query("SELECT id FROM staff_users WHERE username = ? LIMIT 1", [username]);
  if (rows[0]) {
    throw new ProvisioningError(409, "Owner username already exists");
  }
}

async function insertStore(connection, payload, hasSlugColumn, hasBillingColumns = false) {
  const baseColumns = ["code", "name"];
  const baseValues = [payload.code, payload.name];
  if (hasSlugColumn) {
    baseColumns.push("slug");
    baseValues.push(payload.slug);
  }
  baseColumns.push("status", "plan");
  baseValues.push(payload.status || STORE_STATUS, payload.plan);
  if (hasBillingColumns) {
    baseColumns.push("trial_ends_at", "subscription_ends_at", "payment_status", "billing_note", "last_plan_changed_at");
    baseValues.push(
      payload.trialEndsAt || null,
      payload.subscriptionEndsAt || null,
      payload.paymentStatus || "NONE",
      payload.billingNote || null,
      null
    );
  }

  const [result] = await connection.query(
    `
      INSERT INTO stores (${baseColumns.join(", ")})
      VALUES (${baseColumns.map(() => "?").join(", ")})
    `,
    baseValues
  );
  return result.insertId;
}

async function insertStoreFeatures(connection, storeId, plan = DEFAULT_PLAN) {
  const columns = FEATURE_KEYS.join(", ");
  const placeholders = FEATURE_KEYS.map(() => "?").join(", ");
  const presetKey = String(plan || "").trim().toUpperCase();
  const preset = FEATURE_PRESETS[presetKey] || FEATURE_PRESETS.FREE;
  const values = FEATURE_KEYS.map((key) => (preset[key] ? 1 : 0));

  await connection.query(
    `
      INSERT INTO store_features (store_id, ${columns})
      VALUES (?, ${placeholders})
    `,
    [storeId, ...values]
  );
}

async function productCategoriesTableExists(connection) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'product_categories'
      LIMIT 1
    `
  );
  return Boolean(rows[0]);
}

async function insertDefaultProductCategories(connection, storeId) {
  if (!(await productCategoriesTableExists(connection))) {
    return false;
  }

  const rows = PRODUCT_CATEGORY_ORDER.map((code, index) => [
    storeId,
    code,
    PRODUCT_CATEGORY_LABELS[code] || code,
    (index + 1) * 10,
    1
  ]);

  await connection.query(
    `
      INSERT INTO product_categories (store_id, code, name, sort_order, is_active)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        sort_order = VALUES(sort_order),
        is_active = VALUES(is_active)
    `,
    [rows]
  );
  return true;
}

async function insertOwner(connection, payload) {
  const [result] = await connection.query(
    `
      INSERT INTO staff_users (username, password_hash, display_name, role, is_active, store_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `,
    [payload.ownerUsername, payload.passwordHash, payload.ownerName, payload.ownerRole, payload.storeId]
  );
  return result.insertId;
}

async function insertOwnerMembership(connection, payload) {
  await connection.query(
    `
      INSERT INTO store_memberships (store_id, staff_user_id, role, is_default, status)
      VALUES (?, ?, 'owner', 1, 'active')
    `,
    [payload.storeId, payload.staffUserId]
  );
}

async function appSettingsTableHasStoreIdColumn(connection) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'app_settings'
        AND COLUMN_NAME = 'store_id'
      LIMIT 1
    `
  );
  return Boolean(rows[0]);
}

async function insertStoreProfileSettings(connection, storeId, payload = {}) {
  if (!(await appSettingsTableHasStoreIdColumn(connection))) {
    return false;
  }

  const normalized = normalizeStoreProfilePayload({
    ...STORE_PROFILE_DEFAULTS,
    ...payload
  });

  await connection.query(
    `
      INSERT INTO app_settings (store_id, setting_scope, payload_json, updated_by_staff_id)
      VALUES (?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)
    `,
    [storeId, STORE_PROFILE_SCOPE, JSON.stringify(normalized)]
  );

  return true;
}

function sanitizeStoreResponse(store) {
  return {
    id: Number(store.id),
    code: String(store.code),
    name: String(store.name),
    slug: String(store.slug),
    status: String(store.status),
    plan: String(store.plan)
  };
}

async function provisionStoreWithConnection(connection, input, actor = null) {
  const code = normalizeCode(input?.code);
  const name = normalizeName(input?.name);
  const slug = normalizeRequestedSlug(input?.slug, code);
  const ownerUsername = normalizeUsername(input?.ownerUsername);
  const ownerRole = normalizeOwnerRole(input?.ownerRole);
  const plan = normalizePlan(input?.plan);
  const status = normalizeStoreStatus(input?.status);
  const ownerName = normalizeOwnerName(input?.ownerName, name);
  const paymentStatus = String(input?.paymentStatus || (plan === "premium" ? "PAID" : "NONE")).trim().toUpperCase();
  const trialEndsAt = input?.trialEndsAt || input?.trial_ends_at || null;
  const subscriptionEndsAt = input?.subscriptionEndsAt || input?.subscription_ends_at || null;
  const billingNote = input?.billingNote || input?.billing_note || null;
  const providedPassword = typeof input?.ownerPassword === "string" ? input.ownerPassword.trim() : "";
  const temporaryPassword = providedPassword || generateTemporaryPassword();
  if (temporaryPassword.length < 8) {
    throw new ProvisioningError(400, "Owner password must be at least 8 characters");
  }

  const passwordHash = await hashPassword(temporaryPassword);

  const hasSlugColumn = await storesTableHasSlug(connection);
  const hasBillingColumns = await storesTableHasBillingColumns(connection);
  await assertStoreCodeAvailable(connection, code);
  await assertStoreSlugAvailable(connection, slug, hasSlugColumn);
  await assertOwnerUsernameAvailable(connection, ownerUsername);

  const storeId = await insertStore(connection, {
    code,
    name,
    slug,
    status,
    plan,
    trialEndsAt,
    subscriptionEndsAt,
    paymentStatus,
    billingNote
  }, hasSlugColumn, hasBillingColumns);
  await insertStoreFeatures(connection, storeId, plan);
  const productCategoriesPersisted = await insertDefaultProductCategories(connection, storeId);
  const staffUserId = await insertOwner(connection, {
    ownerUsername,
    passwordHash,
    ownerName,
    ownerRole,
    storeId
  });
  await insertOwnerMembership(connection, { storeId, staffUserId });
  const profileSettingsPersisted = await insertStoreProfileSettings(connection, storeId, {
    ...(input?.profileSettings && typeof input.profileSettings === "object" ? input.profileSettings : {}),
    displayName: input?.profileSettings?.displayName || name
  });

  return {
    actor: actor ? { id: actor.id, email: actor.email, role: actor.role } : null,
    store: sanitizeStoreResponse({
      id: storeId,
      code,
      name,
      slug,
      status,
      plan,
      trialEndsAt,
      subscriptionEndsAt,
      paymentStatus,
      billingNote
    }),
    owner: {
      id: staffUserId,
      username: ownerUsername,
      role: ownerRole,
      displayName: ownerName,
      storeRole: "owner"
    },
    temporaryPassword: providedPassword ? null : temporaryPassword,
    slugPersisted: hasSlugColumn,
    profileSettingsPersisted,
    productCategoriesPersisted
  };
}

async function provisionStore(input, actor = null) {
  return withTransaction(async (connection) => {
    return provisionStoreWithConnection(connection, input, actor);
  });
}

module.exports = {
  FEATURE_KEYS,
  FEATURE_PRESETS,
  PLAN_PRESET_KEYS,
  ProvisioningError,
  deriveSlugFromCode,
  provisionStore,
  provisionStoreWithConnection
};
