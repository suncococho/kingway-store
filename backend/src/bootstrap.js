const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { seedDefaultSettings } = require("./services/settingsService");
const { hashPassword, verifyPassword } = require("./utils/passwords");

function readOptionalEnvFile(fileName) {
  const envPath = path.join(__dirname, "..", "..", fileName);

  if (!fs.existsSync(envPath)) {
    return {};
  }

  const parsed = {};
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

function getPlatformAdminSeedConfig() {
  const stagingRestoreEnv = readOptionalEnvFile(".env.staging-restore");
  return {
    email: (process.env.PLATFORM_ADMIN_EMAIL || stagingRestoreEnv.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.PLATFORM_ADMIN_PASSWORD || stagingRestoreEnv.PLATFORM_ADMIN_PASSWORD || "",
    displayName: (process.env.PLATFORM_ADMIN_NAME || stagingRestoreEnv.PLATFORM_ADMIN_NAME || "").trim()
  };
}

async function ensureDefaultAdmin() {
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "123456";
  const displayName = process.env.DEFAULT_ADMIN_DISPLAY_NAME || "System Admin";

  const [rows] = await pool.query(
    `
      SELECT id
      FROM staff_users
      WHERE username = ?
      LIMIT 1
    `,
    [username]
  );

  if (rows[0]) {
    return false;
  }

  const passwordHash = await hashPassword(password);
  await pool.query(
    `
      INSERT INTO staff_users (username, password_hash, display_name, role)
      VALUES (?, ?, ?, 'ADMIN')
    `,
    [username, passwordHash, displayName]
  );

  return true;
}

async function ensurePlatformAdminUsersSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_admin_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(120) NOT NULL,
      role ENUM('PLATFORM_OWNER','PLATFORM_ADMIN','SUPPORT') NOT NULL DEFAULT 'PLATFORM_ADMIN',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function seedPlatformAdminFromEnv() {
  const seed = getPlatformAdminSeedConfig();
  if (!seed.email || !seed.password || !seed.displayName) {
    return { created: false, skipped: true };
  }

  const [rows] = await pool.query(
    `
      SELECT id
      FROM platform_admin_users
      WHERE email = ?
      LIMIT 1
    `,
    [seed.email]
  );

  if (rows[0]) {
    return { created: false, skipped: false };
  }

  const passwordHash = await hashPassword(seed.password);
  await pool.query(
    `
      INSERT INTO platform_admin_users (email, password_hash, display_name, role)
      VALUES (?, ?, ?, 'PLATFORM_OWNER')
    `,
    [seed.email, passwordHash, seed.displayName]
  );

  return { created: true, skipped: false };
}

async function ensureStoreFeaturesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_features (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL UNIQUE,
      pos_enabled TINYINT(1) NOT NULL DEFAULT 1,
      orders_enabled TINYINT(1) NOT NULL DEFAULT 1,
      repairs_enabled TINYINT(1) NOT NULL DEFAULT 1,
      inventory_enabled TINYINT(1) NOT NULL DEFAULT 1,
      suppliers_enabled TINYINT(1) NOT NULL DEFAULT 1,
      coupons_enabled TINYINT(1) NOT NULL DEFAULT 1,
      purchase_confirmations_enabled TINYINT(1) NOT NULL DEFAULT 1,
      line_enabled TINYINT(1) NOT NULL DEFAULT 1,
      telegram_enabled TINYINT(1) NOT NULL DEFAULT 1,
      sales_dashboard_enabled TINYINT(1) NOT NULL DEFAULT 1,
      staff_management_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await addColumnIfMissing("store_features", "pos_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "orders_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "repairs_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "inventory_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "suppliers_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "coupons_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "purchase_confirmations_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "line_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "telegram_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "sales_dashboard_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
  await addColumnIfMissing("store_features", "staff_management_enabled", "TINYINT(1) NOT NULL DEFAULT 1");

  await pool.query(`
    INSERT INTO store_features (store_id)
    SELECT s.id
    FROM stores s
    LEFT JOIN store_features sf ON sf.store_id = s.id
    WHERE sf.id IS NULL
  `);
}

async function ensureStoreLineSettingsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_line_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      line_enabled TINYINT(1) NOT NULL DEFAULT 0,
      channel_id VARCHAR(120) NULL,
      channel_secret_ref VARCHAR(255) NULL,
      channel_secret_direct_value TEXT NULL,
      channel_secret_present TINYINT(1) NOT NULL DEFAULT 0,
      channel_access_token_ref VARCHAR(255) NULL,
      channel_access_token_direct_value TEXT NULL,
      channel_access_token_present TINYINT(1) NOT NULL DEFAULT 0,
      liff_url VARCHAR(500) NULL,
      login_auth_url VARCHAR(500) NULL,
      webhook_path VARCHAR(255) NULL,
      customer_oa_name VARCHAR(190) NULL,
      staff_group_enabled TINYINT(1) NOT NULL DEFAULT 0,
      updated_by_staff_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_store_line_settings_store (store_id),
      UNIQUE KEY uk_store_line_settings_channel_id (channel_id),
      UNIQUE KEY uk_store_line_settings_webhook_path (webhook_path)
    )
  `);

  await addColumnIfMissing("store_line_settings", "store_id", "BIGINT UNSIGNED NOT NULL");
  await addColumnIfMissing("store_line_settings", "line_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("store_line_settings", "channel_id", "VARCHAR(120) NULL");
  await addColumnIfMissing("store_line_settings", "channel_secret_ref", "VARCHAR(255) NULL");
  await addColumnIfMissing("store_line_settings", "channel_secret_direct_value", "TEXT NULL");
  await addColumnIfMissing("store_line_settings", "channel_secret_present", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("store_line_settings", "channel_access_token_ref", "VARCHAR(255) NULL");
  await addColumnIfMissing("store_line_settings", "channel_access_token_direct_value", "TEXT NULL");
  await addColumnIfMissing("store_line_settings", "channel_access_token_present", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("store_line_settings", "liff_url", "VARCHAR(500) NULL");
  await addColumnIfMissing("store_line_settings", "login_auth_url", "VARCHAR(500) NULL");
  await addColumnIfMissing("store_line_settings", "webhook_path", "VARCHAR(255) NULL");
  await addColumnIfMissing("store_line_settings", "customer_oa_name", "VARCHAR(190) NULL");
  await addColumnIfMissing("store_line_settings", "staff_group_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("store_line_settings", "updated_by_staff_id", "BIGINT UNSIGNED NULL");

  await ensureIndexIfMissing("store_line_settings", "uk_store_line_settings_store", "UNIQUE INDEX uk_store_line_settings_store (store_id)");
  await ensureIndexIfMissing("store_line_settings", "uk_store_line_settings_channel_id", "UNIQUE INDEX uk_store_line_settings_channel_id (channel_id)");
  await ensureIndexIfMissing("store_line_settings", "uk_store_line_settings_webhook_path", "UNIQUE INDEX uk_store_line_settings_webhook_path (webhook_path)");
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return Boolean(rows[0]);
}

async function getColumnDefinition(tableName, columnName) {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows[0]?.COLUMN_TYPE || null;
}

function enumColumnIncludes(columnType, value) {
  return typeof columnType === "string" && columnType.split("'").includes(value);
}

async function ensureOrderStatusColumn() {
  const definition =
    "ENUM('PENDING','PENDING_PAYMENT','REPAIRING','COMPLETED','CANCELED') NOT NULL DEFAULT 'PENDING'";
  const columnType = await getColumnDefinition("orders", "status");

  if (!columnType) {
    return;
  }

  const requiredValues = ["PENDING", "PENDING_PAYMENT", "REPAIRING", "COMPLETED", "CANCELED"];
  const missingValue = requiredValues.find((value) => !enumColumnIncludes(columnType, value));
  if (!missingValue) {
    return;
  }

  await pool.query(`ALTER TABLE orders MODIFY COLUMN status ${definition}`);
}

async function ensureOrderTypeColumn() {
  const definition = "ENUM('GENERAL','REPAIR') NOT NULL DEFAULT 'GENERAL'";
  if (!(await columnExists("orders", "order_type"))) {
    await pool.query(`ALTER TABLE orders ADD COLUMN order_type ${definition}`);
    return;
  }

  const columnType = await getColumnDefinition("orders", "order_type");
  if (!enumColumnIncludes(columnType, "GENERAL") || !enumColumnIncludes(columnType, "REPAIR")) {
    await pool.query(`ALTER TABLE orders MODIFY COLUMN order_type ${definition}`);
  }
}

async function ensureOrderSourceColumn() {
  const definition = "VARCHAR(50) NULL";
  if (!(await columnExists("orders", "source"))) {
    await pool.query(`ALTER TABLE orders ADD COLUMN source ${definition}`);
  }
}

async function ensureRepairQuoteStatusColumn() {
  const definition = "VARCHAR(50) NOT NULL DEFAULT 'pending'";
  if (!(await columnExists("repair_orders", "quote_status"))) {
    await pool.query(`ALTER TABLE repair_orders ADD COLUMN quote_status ${definition}`);
    return;
  }

  await pool.query(`ALTER TABLE repair_orders MODIFY COLUMN quote_status ${definition}`);
  await pool.query("UPDATE repair_orders SET quote_status = 'approved' WHERE quote_status = 'accepted'");
  await pool.query("UPDATE repair_orders SET quote_status = 'pending' WHERE quote_status = 'draft' OR quote_status IS NULL OR quote_status = ''");
}

async function ensureDefaultStaff() {
  const username = "staff";
  const password = "123456";
  const displayName = "門市員工";
  const role = "CASHIER";
  const permissions = ["POS", "PRODUCTS", "REPAIRS", "INVENTORY"];
  const permissionsColumnType = await getColumnDefinition("staff_users", "permissions");

  const [rows] = await pool.query(
    `
      SELECT id, password_hash, display_name, role, is_active${permissionsColumnType ? ", permissions" : ""}
      FROM staff_users
      WHERE username = ?
      LIMIT 1
    `,
    [username]
  );

  const roleColumnType = await getColumnDefinition("staff_users", "role");
  if (!enumColumnIncludes(roleColumnType, role)) {
    return {
      created: false,
      updated: false,
      skipped: true,
      reason: "staff_users.role does not allow CASHIER"
    };
  }

  if (rows[0]) {
    const existing = rows[0];
    const { isMatch, needsRehash } = await verifyPassword(password, existing.password_hash);
    const permissionJson = JSON.stringify(permissions);
    const permissionsMatch = !permissionsColumnType || String(existing.permissions || "") === permissionJson;
    const needsUpdate =
      !isMatch ||
      needsRehash ||
      String(existing.display_name || "") !== displayName ||
      String(existing.role || "").toUpperCase() !== role ||
      Number(existing.is_active) !== 1 ||
      !permissionsMatch;

    if (!needsUpdate) {
      return { created: false, updated: false, skipped: false };
    }

    const passwordHash = await hashPassword(password);
    if (permissionsColumnType) {
      await pool.query(
        `
          UPDATE staff_users
          SET password_hash = ?, display_name = ?, role = ?, permissions = ?, is_active = 1
          WHERE id = ?
        `,
        [passwordHash, displayName, role, JSON.stringify(permissions), rows[0].id]
      );
    } else {
      await pool.query(
        `
          UPDATE staff_users
          SET password_hash = ?, display_name = ?, role = ?, is_active = 1
          WHERE id = ?
        `,
        [passwordHash, displayName, role, rows[0].id]
      );
    }

    return { created: false, updated: true, skipped: false };
  }

  const passwordHash = await hashPassword(password);
  if (permissionsColumnType) {
    await pool.query(
      `
        INSERT INTO staff_users (username, password_hash, display_name, role, permissions)
        VALUES (?, ?, ?, ?, ?)
      `,
      [username, passwordHash, displayName, role, JSON.stringify(permissions)]
    );
  } else {
    await pool.query(
      `
        INSERT INTO staff_users (username, password_hash, display_name, role)
        VALUES (?, ?, ?, ?)
      `,
      [username, passwordHash, displayName, role]
    );
  }

  return { created: true, updated: false, skipped: false };
}

async function addColumnIfMissing(tableName, columnName, definition) {
  if (await columnExists(tableName, columnName)) {
    return false;
  }

  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );

  return Boolean(rows[0]);
}

async function ensureIndexIfMissing(tableName, indexName, definition) {
  if (await indexExists(tableName, indexName)) {
    return false;
  }

  await pool.query(`ALTER TABLE ${tableName} ADD ${definition}`);
  return true;
}

async function ensureAppSettingsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      store_id BIGINT UNSIGNED NULL,
      setting_scope ENUM('STORE', 'SYSTEM', 'STORE_PROFILE') NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_by_staff_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope),
      INDEX idx_app_settings_store_scope (store_id, setting_scope)
    )
  `);

  await addColumnIfMissing("app_settings", "store_id", "BIGINT UNSIGNED NULL");

  const appSettingsScopeType = await getColumnDefinition("app_settings", "setting_scope");
  if (!enumColumnIncludes(appSettingsScopeType, "STORE_PROFILE")) {
    await pool.query("ALTER TABLE app_settings MODIFY COLUMN setting_scope ENUM('STORE', 'SYSTEM', 'STORE_PROFILE') NOT NULL");
  }
  await pool.query(`
    UPDATE app_settings
    SET store_id = 1
    WHERE store_id IS NULL
      AND setting_scope IN ('STORE', 'SYSTEM', 'STORE_PROFILE')
  `);

  await ensureIndexIfMissing(
    "app_settings",
    "idx_app_settings_store_scope",
    "INDEX idx_app_settings_store_scope (store_id, setting_scope)"
  );
}

async function shouldSeedStoreAwareSettings() {
  return columnExists("app_settings", "store_id");
}

async function ensureCustomerTypeColumn(tableName) {
  const definition = "ENUM('LINE','OFFLINE_WITH_PHONE','OFFLINE_NO_PHONE') NOT NULL DEFAULT 'LINE'";
  if (!(await columnExists(tableName, "customer_type"))) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN customer_type ${definition}`);
    return;
  }

  const columnType = await getColumnDefinition(tableName, "customer_type");
  if (!enumColumnIncludes(columnType, "OFFLINE_WITH_PHONE") || !enumColumnIncludes(columnType, "OFFLINE_NO_PHONE")) {
    await pool.query(`ALTER TABLE ${tableName} MODIFY COLUMN customer_type ENUM('LINE','OFFLINE','OFFLINE_WITH_PHONE','OFFLINE_NO_PHONE') NOT NULL DEFAULT 'LINE'`);
    await pool.query(
      `
        UPDATE ${tableName}
        SET customer_type = CASE
          WHEN customer_type = 'OFFLINE' THEN 'OFFLINE_WITH_PHONE'
          ELSE customer_type
        END
      `
    );
    await pool.query(`ALTER TABLE ${tableName} MODIFY COLUMN customer_type ${definition}`);
  }
}

async function ensureProductCategoryColumn() {
  const definition = "ENUM('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT') NOT NULL DEFAULT 'OT'";
  if (!(await columnExists("products", "category"))) {
    await pool.query(`ALTER TABLE products ADD COLUMN category ${definition}`);
    return;
  }

  const columnType = await getColumnDefinition("products", "category");
  if (String(columnType || "").toLowerCase() === definition.toLowerCase()) {
    return;
  }

  await pool.query(`ALTER TABLE products MODIFY COLUMN category ${definition}`);
}

async function makeColumnNullableIfNeeded(tableName, columnName, definition) {
  const [rows] = await pool.query(
    `
      SELECT IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  if (!rows[0] || rows[0].IS_NULLABLE === "YES") {
    return false;
  }

  await pool.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definition}`);
  return true;
}

async function foreignKeyExists(tableName, constraintName) {
  const [rows] = await pool.query(
    `
      SELECT CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      LIMIT 1
    `,
    [tableName, constraintName]
  );
  return Boolean(rows[0]);
}

async function ensureV2Schema() {
  await addColumnIfMissing("customers", "crm_stage", "VARCHAR(80) NULL");
  await addColumnIfMissing("customers", "budget", "VARCHAR(120) NULL");
  await addColumnIfMissing("customers", "purchase_timing", "VARCHAR(120) NULL");
  await addColumnIfMissing("customers", "usage_purpose", "VARCHAR(255) NULL");
  await addColumnIfMissing("customers", "interested_model", "VARCHAR(150) NULL");
  await addColumnIfMissing("customers", "assigned_staff_id", "BIGINT UNSIGNED NULL");
  await addColumnIfMissing("customers", "last_contact_at", "DATETIME NULL");
  await addColumnIfMissing("customers", "follow_up_due_at", "DATETIME NULL");
  await ensureCustomerTypeColumn("customers");
  await ensureProductCategoryColumn();

  await addColumnIfMissing("products", "description", "TEXT NULL");
  await addColumnIfMissing("products", "image_url", "TEXT NULL");
  await addColumnIfMissing("products", "cost_price", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("products", "location", "VARCHAR(120) NULL");
  await addColumnIfMissing("products", "inputter_name", "VARCHAR(120) NULL");
  await addColumnIfMissing("products", "source", "VARCHAR(40) NULL");

  await addColumnIfMissing("orders", "is_reservation_order", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("orders", "deposit_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("orders", "unpaid_balance", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing(
    "orders",
    "final_payment_status",
    "ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'PAID'"
  );
  await addColumnIfMissing("orders", "final_paid_at", "DATETIME NULL");
  await addColumnIfMissing("orders", "purchase_confirmation_sent_at", "DATETIME NULL");
  await addColumnIfMissing("orders", "handover_confirmed_at", "DATETIME NULL");
  await addColumnIfMissing("orders", "handover_confirmed_by_staff_id", "BIGINT UNSIGNED NULL");
  await ensureCustomerTypeColumn("orders");
  await ensureOrderStatusColumn();
  await ensureOrderTypeColumn();
  await ensureOrderSourceColumn();

  await addColumnIfMissing("purchase_confirmations", "handover_confirmed_at", "DATETIME NULL");
  await addColumnIfMissing("purchase_confirmations", "handover_confirmed_by_staff_id", "BIGINT UNSIGNED NULL");
  await addColumnIfMissing("purchase_confirmations", "buyer_name", "VARCHAR(120) NULL");
  await addColumnIfMissing("purchase_confirmations", "buyer_phone", "VARCHAR(40) NULL");
  await addColumnIfMissing("purchase_confirmations", "buyer_id_number", "VARCHAR(40) NULL");
  await addColumnIfMissing("purchase_confirmations", "delivery_checks_json", "LONGTEXT NULL");
  await addColumnIfMissing("purchase_confirmations", "staff_explanations_json", "LONGTEXT NULL");
  await addColumnIfMissing("purchase_confirmations", "terms_accepted", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("purchase_confirmations", "final_confirmation_accepted", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("purchase_confirmations", "html_snapshot", "LONGTEXT NULL");
  await makeColumnNullableIfNeeded("purchase_confirmations", "order_id", "BIGINT UNSIGNED NULL");
  await makeColumnNullableIfNeeded("purchase_confirmations", "customer_id", "BIGINT UNSIGNED NULL");

  await addColumnIfMissing("repair_orders", "reservation_time", "VARCHAR(20) NULL");
  await addColumnIfMissing(
    "repair_orders",
    "reservation_status",
    "ENUM('pending_approval','approved','rejected') NOT NULL DEFAULT 'approved'"
  );
  await addColumnIfMissing("repair_orders", "estimate_details", "TEXT NULL");
  await addColumnIfMissing("repair_orders", "estimate_sent_at", "DATETIME NULL");
  await addColumnIfMissing(
    "repair_orders",
    "customer_estimate_response",
    "ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'"
  );
  await addColumnIfMissing("repair_orders", "customer_estimate_responded_at", "DATETIME NULL");
  await addColumnIfMissing("repair_orders", "survey_id", "BIGINT UNSIGNED NULL");
  await ensureCustomerTypeColumn("repair_orders");
  await addColumnIfMissing("repair_orders", "source", "ENUM('LINE','WEB','POS') NOT NULL DEFAULT 'WEB'");
  await addColumnIfMissing("repair_orders", "group_confirmed", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("repair_orders", "group_confirmed_at", "DATETIME NULL");
  await addColumnIfMissing("repair_orders", "group_confirmed_by", "VARCHAR(255) NULL");
  await addColumnIfMissing("repair_orders", "order_id", "BIGINT UNSIGNED NULL");
  await addColumnIfMissing("repair_orders", "inspection_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("repair_orders", "parts_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("repair_orders", "labor_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0");
  await ensureRepairQuoteStatusColumn();
  await addColumnIfMissing("repair_orders", "quote_notes", "TEXT NULL");
  await addColumnIfMissing("repair_orders", "quote_items_json", "LONGTEXT NULL");
  await addColumnIfMissing("repair_orders", "customer_confirmed_at", "DATETIME NULL");
  await addColumnIfMissing("orders", "repair_order_id", "BIGINT UNSIGNED NULL");
  await pool.query(`
    UPDATE repair_orders ro
    SET source = 'LINE'
    WHERE source <> 'LINE'
      AND EXISTS (
        SELECT 1
        FROM repair_logs rl
        WHERE rl.repair_order_id = ro.id
          AND rl.note LIKE '%LINE 維修預約%'
      )
  `);

  await addColumnIfMissing(
    "coupons",
    "status",
    "ENUM('pending_approval','approved','rejected','issued','used','expired') NOT NULL DEFAULT 'issued'"
  );
  await addColumnIfMissing("coupons", "eligible_category", "VARCHAR(30) NOT NULL DEFAULT 'EB'");
  await addColumnIfMissing("coupons", "approved_at", "DATETIME NULL");
  await addColumnIfMissing("coupons", "rejected_at", "DATETIME NULL");
  await addColumnIfMissing("coupons", "rejection_reason", "TEXT NULL");

  await addColumnIfMissing("surveys", "repair_order_id", "BIGINT UNSIGNED NULL");
  if (await foreignKeyExists("surveys", "fk_surveys_order")) {
    await pool.query("ALTER TABLE surveys DROP FOREIGN KEY fk_surveys_order");
  }
  await pool.query("ALTER TABLE surveys MODIFY order_id BIGINT UNSIGNED NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_crm_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      stage VARCHAR(80) NULL,
      note TEXT NULL,
      created_by_staff_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_customer_crm_events_customer (customer_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follow_up_tasks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      action_type ENUM('3_day','7_day','14_day','manual') NOT NULL,
      status ENUM('pending','sent','done','canceled') NOT NULL DEFAULT 'pending',
      message TEXT NULL,
      created_by_staff_id BIGINT UNSIGNED NULL,
      sent_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_follow_up_tasks_customer (customer_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      request_type ENUM('PURCHASE_ORDER','RETURN') NOT NULL,
      status ENUM('PENDING_SUPPLIER','APPROVED','REJECTED','PARTIALLY_RECEIVED','RECEIVED','RETURN_CONFIRMED','CANCELED') NOT NULL DEFAULT 'PENDING_SUPPLIER',
      supplier_name VARCHAR(150) NULL,
      note TEXT NULL,
      requested_by_staff_id BIGINT UNSIGNED NOT NULL,
      supplier_response_note TEXT NULL,
      supplier_responded_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_supplier_requests_status (status, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_request_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      supplier_request_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      quantity INT NOT NULL,
      received_quantity INT NOT NULL DEFAULT 0,
      reason VARCHAR(255) NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_supplier_request_items_request (supplier_request_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operational_checklists (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      staff_user_id BIGINT UNSIGNED NOT NULL,
      checklist_date DATE NOT NULL,
      item_key VARCHAR(80) NOT NULL,
      item_label VARCHAR(150) NOT NULL,
      is_done TINYINT(1) NOT NULL DEFAULT 0,
      completed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_operational_checklists_item (staff_user_id, checklist_date, item_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS v2_workflow_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      ref_type VARCHAR(80) NULL,
      ref_id BIGINT UNSIGNED NULL,
      payload JSON NULL,
      created_by_staff_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_v2_workflow_events_ref (ref_type, ref_id, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_webhook_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_key VARCHAR(191) NOT NULL,
      route_path VARCHAR(120) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      line_user_id VARCHAR(64) NULL,
      line_group_id VARCHAR(64) NULL,
      payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_line_webhook_events_key (event_key),
      INDEX idx_line_webhook_events_created_at (created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_chat_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      line_user_id VARCHAR(64) NOT NULL,
      flow_type VARCHAR(80) NOT NULL,
      step_key VARCHAR(80) NOT NULL,
      payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_line_chat_sessions_user_flow (line_user_id, flow_type),
      INDEX idx_line_chat_sessions_flow (flow_type, updated_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_chat_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bot_name VARCHAR(32) NOT NULL,
      chat_id BIGINT NOT NULL,
      telegram_user_id BIGINT NOT NULL,
      flow_type VARCHAR(80) NOT NULL,
      step_key VARCHAR(80) NOT NULL,
      payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_telegram_chat_sessions_actor (bot_name, chat_id, telegram_user_id),
      INDEX idx_telegram_chat_sessions_flow (flow_type, updated_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_payment_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
      payment_kind VARCHAR(40) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      unpaid_balance_after DECIMAL(12,2) NOT NULL DEFAULT 0,
      note TEXT NULL,
      source VARCHAR(50) NULL,
      created_by_staff_id BIGINT UNSIGNED NULL,
      created_by_label VARCHAR(191) NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_payment_events_order (order_id, created_at)
    )
  `);

  await ensurePlatformAdminUsersSchema();
  await seedPlatformAdminFromEnv();
  await ensureStoreFeaturesSchema();
  await ensureStoreLineSettingsSchema();

  await ensureAppSettingsSchema();

  await seedDefaultSettings((await shouldSeedStoreAwareSettings()) ? 1 : null);
}

function ensureStorageDirectories() {
  fs.mkdirSync(path.join(__dirname, "..", "storage", "pdfs"), { recursive: true });
}

module.exports = {
  ensureDefaultAdmin,
  ensureDefaultStaff,
  ensurePlatformAdminUsersSchema,
  seedPlatformAdminFromEnv,
  ensureStoreFeaturesSchema,
  ensureStoreLineSettingsSchema,
  ensureV2Schema,
  ensureStorageDirectories
};
