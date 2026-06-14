const dotenv = require("dotenv");

dotenv.config();

const PRODUCTION_FRONTEND_URL = "https://pos.kingway.tw";

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveFrontendBaseUrl() {
  const configured = (process.env.FRONTEND_BASE_URL || "").trim();

  if (!configured) {
    return PRODUCTION_FRONTEND_URL;
  }

  try {
    const parsed = new URL(configured);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return PRODUCTION_FRONTEND_URL;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    return PRODUCTION_FRONTEND_URL;
  }
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  appEnv: process.env.APP_ENV || "",
  runSchemaBootstrap: parseBoolean(process.env.RUN_SCHEMA_BOOTSTRAP, false),
  productImportApplyEnabled: parseBoolean(process.env.PRODUCT_IMPORT_APPLY_ENABLED, false),
  productImportAdminOverrideEnabled: parseBoolean(process.env.PRODUCT_IMPORT_ADMIN_OVERRIDE_ENABLED, false),
  port: Number(process.env.PORT || 3000),
  jwtSecret: requireEnv("JWT_SECRET", "change-me-in-production"),
  frontendBaseUrl: resolveFrontendBaseUrl(),
  requireStoreIdSchema: parseBoolean(process.env.REQUIRE_STORE_ID_SCHEMA, false),
  expectedDbHost: (process.env.EXPECTED_DB_HOST || "").trim(),
  expectedDbPort: (process.env.EXPECTED_DB_PORT || "").trim(),
  expectedDbName: (process.env.EXPECTED_DB_NAME || "").trim(),
  logDbIdentity: parseBoolean(process.env.LOG_DB_IDENTITY, true),
  mysql: {
    host: requireEnv("MYSQL_HOST", "mysql"),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: requireEnv("MYSQL_USER", "kingway"),
    password: requireEnv("MYSQL_PASSWORD", "kingway"),
    database: requireEnv("MYSQL_DATABASE", "kingway_store")
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
    channelSecret: process.env.LINE_CHANNEL_SECRET || "",
    unifiedQaGroupMode: ["1", "true", "yes", "on"].includes((process.env.LINE_UNIFIED_QA_GROUP_MODE || "").trim().toLowerCase()),
    qaGroupId: (process.env.LINE_QA_GROUP_ID || "").trim()
  },
  telegram: {
    notifyBotToken: process.env.TELEGRAM_NOTIFY_BOT_TOKEN || "",
    stockBotToken: process.env.TELEGRAM_STOCK_BOT_TOKEN || "",
    orderGroupId: process.env.TELEGRAM_ORDER_GROUP_ID || "",
    hqGroupId: process.env.TELEGRAM_HQ_GROUP_ID || "",
    stockGroupId: process.env.TELEGRAM_STOCK_GROUP_ID || "",
    repairConfirmGroupId: process.env.TELEGRAM_REPAIR_CONFIRM_GROUP_ID || "",
    allowedStaffUserIds: parseCsvList(process.env.TELEGRAM_ALLOWED_STAFF_USER_IDS),
    allowedChatIds: parseCsvList(process.env.TELEGRAM_ALLOWED_CHAT_IDS)
  }
};
