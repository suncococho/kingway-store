const { pool } = require("../db");

const STORE_PROFILE_SCOPE = "STORE_PROFILE";
const STORE_PROFILE_DEFAULTS = {
  displayName: "",
  address: "",
  phone: "",
  businessHours: "",
  timezone: "Asia/Taipei",
  defaultLanguage: "zh-TW",
  invoiceDisplayName: "",
  businessNumber: "",
  logoUrl: "",
  lineSettings: {
    status: "placeholder"
  }
};

const FORBIDDEN_LINE_SETTING_KEYS = new Set([
  "token",
  "secret",
  "accessToken",
  "channelAccessToken",
  "channelSecret",
  "webhookSecret",
  "refreshToken",
  "clientSecret"
]);

let appSettingsStoreIdColumnExists = null;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
}

function mergeObjects(defaults, payload) {
  return {
    ...defaults,
    ...(payload && typeof payload === "object" ? payload : {})
  };
}

function createStoreProfileError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeLineSettingsPlaceholder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...STORE_PROFILE_DEFAULTS.lineSettings };
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    if (FORBIDDEN_LINE_SETTING_KEYS.has(String(key))) {
      throw createStoreProfileError("lineSettings placeholder cannot include raw token or secret fields");
    }
  }

  return {
    status: normalizeText(value.status) || STORE_PROFILE_DEFAULTS.lineSettings.status
  };
}

function normalizeStoreProfilePayload(input = {}) {
  const merged = mergeObjects(STORE_PROFILE_DEFAULTS, input);
  return {
    displayName: normalizeText(merged.displayName),
    address: normalizeText(merged.address),
    phone: normalizeText(merged.phone),
    businessHours: normalizeText(merged.businessHours),
    timezone: normalizeText(merged.timezone) || STORE_PROFILE_DEFAULTS.timezone,
    defaultLanguage: normalizeText(merged.defaultLanguage) || STORE_PROFILE_DEFAULTS.defaultLanguage,
    invoiceDisplayName: normalizeText(merged.invoiceDisplayName),
    businessNumber: normalizeText(merged.businessNumber),
    logoUrl: normalizeText(merged.logoUrl),
    lineSettings: normalizeLineSettingsPlaceholder(merged.lineSettings)
  };
}

async function appSettingsHasStoreIdColumn() {
  if (appSettingsStoreIdColumnExists !== null) {
    return appSettingsStoreIdColumnExists;
  }

  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS columnCount
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'app_settings'
        AND COLUMN_NAME = 'store_id'
    `
  );

  appSettingsStoreIdColumnExists = Number(rows[0]?.columnCount || 0) > 0;
  return appSettingsStoreIdColumnExists;
}

async function loadStoreProfileRow(storeId) {
  if (!storeId) {
    throw createStoreProfileError("Store scope required", 403);
  }

  if (!(await appSettingsHasStoreIdColumn())) {
    return null;
  }

  const [rows] = await pool.query(
    `
      SELECT payload_json AS payloadJson
      FROM app_settings
      WHERE store_id = ?
        AND setting_scope = ?
      LIMIT 1
    `,
    [storeId, STORE_PROFILE_SCOPE]
  );

  return rows[0] || null;
}

function parsePayload(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

async function getStoreProfileSettings(storeId) {
  const row = await loadStoreProfileRow(storeId);
  return normalizeStoreProfilePayload(parsePayload(row?.payloadJson) || STORE_PROFILE_DEFAULTS);
}

async function saveStoreProfileSettings(storeId, payload, updatedByStaffId = null) {
  if (!storeId) {
    throw createStoreProfileError("Store scope required", 403);
  }

  if (!(await appSettingsHasStoreIdColumn())) {
    throw createStoreProfileError("Store profile settings schema not ready", 500);
  }

  const current = await getStoreProfileSettings(storeId);
  const normalized = normalizeStoreProfilePayload({
    ...current,
    ...(payload && typeof payload === "object" ? payload : {}),
    lineSettings: Object.prototype.hasOwnProperty.call(payload || {}, "lineSettings")
      ? payload.lineSettings
      : current.lineSettings
  });
  const payloadJson = JSON.stringify(normalized);

  const [updateResult] = await pool.query(
    `
      UPDATE app_settings
      SET payload_json = ?, updated_by_staff_id = ?
      WHERE store_id = ?
        AND setting_scope = ?
    `,
    [payloadJson, updatedByStaffId, storeId, STORE_PROFILE_SCOPE]
  );

  if (Number(updateResult.affectedRows || 0) === 0) {
    await pool.query(
      `
        INSERT INTO app_settings (store_id, setting_scope, payload_json, updated_by_staff_id)
        VALUES (?, ?, ?, ?)
      `,
      [storeId, STORE_PROFILE_SCOPE, payloadJson, updatedByStaffId]
    );
  }

  return normalized;
}

module.exports = {
  STORE_PROFILE_DEFAULTS,
  STORE_PROFILE_SCOPE,
  getStoreProfileSettings,
  normalizeStoreProfilePayload,
  saveStoreProfileSettings
};
