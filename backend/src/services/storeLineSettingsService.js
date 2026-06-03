const crypto = require("crypto");
const { pool } = require("../db");

const DEFAULT_WEBHOOK_PREFIX = "/api/line/webhook/";
const ENV_REF_PATTERN = /^env:[A-Z][A-Z0-9_]*$/;
const MASKED_SAFE_REF = "已設定（安全參照）";
const MASKED_PENDING_STORAGE = "已提供（未安全儲存）";

const STORE_LINE_SETTINGS_DEFAULTS = {
  lineEnabled: false,
  channelId: "",
  channelSecret: "",
  channelSecretPresent: false,
  channelAccessToken: "",
  channelAccessTokenPresent: false,
  liffUrl: "",
  loginAuthUrl: "",
  webhookPath: "",
  webhookUrl: "",
  customerOaName: "",
  staffGroupEnabled: false,
  updatedAt: null,
  updatedByStaffId: null
};

function createStoreLineSettingsError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function isValidAbsoluteHttpUrl(value) {
  if (!value) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function normalizeOptionalUrl(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (!isValidAbsoluteHttpUrl(normalized)) {
    throw createStoreLineSettingsError(`${label} 必須是 http 或 https 網址`);
  }

  return normalized;
}

function isMaskedSecretPlaceholder(value) {
  return value === MASKED_SAFE_REF || value === MASKED_PENDING_STORAGE;
}

function normalizeWebhookPath(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const token = normalized.startsWith(DEFAULT_WEBHOOK_PREFIX)
    ? normalized.slice(DEFAULT_WEBHOOK_PREFIX.length)
    : normalized.replace(/^\/+/, "");

  if (!/^[A-Za-z0-9_-]{16,160}$/.test(token)) {
    throw createStoreLineSettingsError("webhookPath 格式不正確，需為安全 token 或 /api/line/webhook/<token>");
  }

  return `${DEFAULT_WEBHOOK_PREFIX}${token}`;
}

function generateWebhookPath() {
  return `${DEFAULT_WEBHOOK_PREFIX}stg_${crypto.randomBytes(18).toString("base64url")}`;
}

function buildWebhookUrl(apiBaseUrl, webhookPath) {
  if (!webhookPath) {
    return "";
  }

  const base = normalizeText(apiBaseUrl).replace(/\/$/, "");
  if (!base || !isValidAbsoluteHttpUrl(base)) {
    return webhookPath;
  }

  return `${base}${webhookPath}`;
}

function parseSecretInput(input, currentRef, currentPresent, label) {
  if (input === undefined) {
    return {
      ref: currentRef,
      present: currentPresent
    };
  }

  const normalized = normalizeText(input);
  if (!normalized) {
    return {
      ref: null,
      present: false
    };
  }

  if (isMaskedSecretPlaceholder(normalized)) {
    return {
      ref: currentRef,
      present: currentPresent
    };
  }

  if (ENV_REF_PATTERN.test(normalized)) {
    return {
      ref: normalized,
      present: true
    };
  }

  if (normalized.includes(":")) {
    throw createStoreLineSettingsError(`${label} 僅支援 env:SECRET_NAME 形式的安全參照`);
  }

  return {
    ref: currentRef,
    present: true
  };
}

function maskSecretValue(ref, present) {
  if (ref) {
    return MASKED_SAFE_REF;
  }

  if (present) {
    return MASKED_PENDING_STORAGE;
  }

  return "";
}

function maskCredentialName(name) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 6) {
    return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
  }

  return `${normalized.slice(0, 4)}***${normalized.slice(-2)}`;
}

function parseCredentialRef(ref) {
  const normalized = normalizeText(ref);
  if (!normalized) {
    return {
      type: "none",
      name: ""
    };
  }

  if (ENV_REF_PATTERN.test(normalized)) {
    return {
      type: "env",
      name: normalized.slice(4)
    };
  }

  return {
    type: "unsupported",
    name: normalized
  };
}

function buildMaskedCredentialStatus(ref, present) {
  const parsedRef = parseCredentialRef(ref);
  const envValue = parsedRef.type === "env" ? process.env[parsedRef.name] : "";
  const hasResolvedValue = Boolean(envValue);

  if (parsedRef.type === "env") {
    return {
      present: true,
      source: "env",
      maskedLabel: `env:${maskCredentialName(parsedRef.name)}`,
      resolvable: hasResolvedValue
    };
  }

  if (parsedRef.type === "unsupported") {
    return {
      present: true,
      source: "unsupported_ref",
      maskedLabel: "ref:unsupported",
      resolvable: false
    };
  }

  if (present) {
    return {
      present: true,
      source: "pending_storage",
      maskedLabel: MASKED_PENDING_STORAGE,
      resolvable: false
    };
  }

  return {
    present: false,
    source: "none",
    maskedLabel: "",
    resolvable: false
  };
}

function buildResolvedCredential(status, ref) {
  if (status.source !== "env" || !status.resolvable) {
    return null;
  }

  const parsedRef = parseCredentialRef(ref);
  return parsedRef.name ? process.env[parsedRef.name] || null : null;
}

function mapRowToSettings(row, apiBaseUrl) {
  const webhookPath = normalizeText(row?.webhookPath || row?.webhook_path);
  const channelSecretPresent = normalizeBoolean(row?.channelSecretPresent ?? row?.channel_secret_present, false);
  const channelAccessTokenPresent = normalizeBoolean(row?.channelAccessTokenPresent ?? row?.channel_access_token_present, false);
  const channelSecretRef = normalizeText(row?.channelSecretRef || row?.channel_secret_ref);
  const channelAccessTokenRef = normalizeText(row?.channelAccessTokenRef || row?.channel_access_token_ref);

  return {
    lineEnabled: normalizeBoolean(row?.lineEnabled ?? row?.line_enabled, false),
    channelId: normalizeText(row?.channelId || row?.channel_id),
    channelSecret: maskSecretValue(channelSecretRef, channelSecretPresent),
    channelSecretPresent,
    channelAccessToken: maskSecretValue(channelAccessTokenRef, channelAccessTokenPresent),
    channelAccessTokenPresent,
    liffUrl: normalizeText(row?.liffUrl || row?.liff_url),
    loginAuthUrl: normalizeText(row?.loginAuthUrl || row?.login_auth_url),
    webhookPath,
    webhookUrl: buildWebhookUrl(apiBaseUrl, webhookPath),
    customerOaName: normalizeText(row?.customerOaName || row?.customer_oa_name),
    staffGroupEnabled: normalizeBoolean(row?.staffGroupEnabled ?? row?.staff_group_enabled, false),
    updatedAt: row?.updatedAt || row?.updated_at || null,
    updatedByStaffId: row?.updatedByStaffId ?? row?.updated_by_staff_id ?? null
  };
}

async function loadStoreLineSettingsRow(storeId) {
  if (!storeId) {
    throw createStoreLineSettingsError("Store scope required", 403);
  }

  const [rows] = await pool.query(
    `
      SELECT
        store_id AS storeId,
        line_enabled AS lineEnabled,
        channel_id AS channelId,
        channel_secret_ref AS channelSecretRef,
        channel_secret_present AS channelSecretPresent,
        channel_access_token_ref AS channelAccessTokenRef,
        channel_access_token_present AS channelAccessTokenPresent,
        liff_url AS liffUrl,
        login_auth_url AS loginAuthUrl,
        webhook_path AS webhookPath,
        customer_oa_name AS customerOaName,
        staff_group_enabled AS staffGroupEnabled,
        updated_by_staff_id AS updatedByStaffId,
        updated_at AS updatedAt
      FROM store_line_settings
      WHERE store_id = ?
      LIMIT 1
    `,
    [storeId]
  );

  return rows[0] || null;
}

async function loadStoreLineSettingsScope({ storeId = null, storeCode = null } = {}) {
  if (!storeId && !storeCode) {
    throw createStoreLineSettingsError("storeId 또는 storeCode가 필요합니다");
  }

  const filters = [];
  const values = [];

  if (storeId) {
    filters.push("s.id = ?");
    values.push(storeId);
  }

  if (storeCode) {
    filters.push("s.code = ?");
    values.push(storeCode);
  }

  const [rows] = await pool.query(
    `
      SELECT
        s.id AS storeId,
        s.code AS storeCode,
        sls.line_enabled AS lineEnabled,
        sls.channel_id AS channelId,
        sls.channel_secret_ref AS channelSecretRef,
        sls.channel_secret_present AS channelSecretPresent,
        sls.channel_access_token_ref AS channelAccessTokenRef,
        sls.channel_access_token_present AS channelAccessTokenPresent,
        sls.webhook_path AS webhookPath,
        sls.customer_oa_name AS customerOaName,
        sls.updated_at AS updatedAt
      FROM stores s
      LEFT JOIN store_line_settings sls ON sls.store_id = s.id
      WHERE ${filters.join(" OR ")}
      LIMIT 1
    `,
    values
  );

  return rows[0] || null;
}

async function getStoreLineSettings(storeId, options = {}) {
  const row = await loadStoreLineSettingsRow(storeId);
  if (!row) {
    return {
      ...STORE_LINE_SETTINGS_DEFAULTS,
      webhookUrl: ""
    };
  }

  return mapRowToSettings(row, options.apiBaseUrl);
}

async function resolveStoreLineCredentials({ storeId = null, storeCode = null, purpose = null } = {}) {
  const scopedRow = await loadStoreLineSettingsScope({ storeId, storeCode });
  if (!scopedRow) {
    return {
      storeId: storeId ?? null,
      storeCode: storeCode ?? null,
      purpose: normalizeText(purpose) || null,
      lineEnabled: false,
      found: false,
      channelAccessToken: null,
      channelSecret: null,
      channelAccessTokenStatus: buildMaskedCredentialStatus(null, false),
      channelSecretStatus: buildMaskedCredentialStatus(null, false)
    };
  }

  const channelAccessTokenStatus = buildMaskedCredentialStatus(
    scopedRow.channelAccessTokenRef,
    normalizeBoolean(scopedRow.channelAccessTokenPresent, false)
  );
  const channelSecretStatus = buildMaskedCredentialStatus(
    scopedRow.channelSecretRef,
    normalizeBoolean(scopedRow.channelSecretPresent, false)
  );

  return {
    storeId: scopedRow.storeId ?? null,
    storeCode: scopedRow.storeCode ?? null,
    purpose: normalizeText(purpose) || null,
    lineEnabled: normalizeBoolean(scopedRow.lineEnabled, false),
    found: true,
    channelAccessToken: buildResolvedCredential(channelAccessTokenStatus, scopedRow.channelAccessTokenRef),
    channelSecret: buildResolvedCredential(channelSecretStatus, scopedRow.channelSecretRef),
    channelAccessTokenStatus,
    channelSecretStatus
  };
}

async function getMaskedLineCredentialStatus({ storeId = null, storeCode = null } = {}) {
  const resolved = await resolveStoreLineCredentials({ storeId, storeCode, purpose: "status" });
  return {
    storeId: resolved.storeId,
    storeCode: resolved.storeCode,
    found: resolved.found,
    lineEnabled: resolved.lineEnabled,
    channelAccessToken: resolved.channelAccessTokenStatus,
    channelSecret: resolved.channelSecretStatus
  };
}

function normalizePatchPayload(input, current) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const channelSecretState = parseSecretInput(
    body.channelSecret,
    current.channelSecretRef,
    current.channelSecretPresent,
    "channelSecret"
  );
  const channelAccessTokenState = parseSecretInput(
    body.channelAccessToken,
    current.channelAccessTokenRef,
    current.channelAccessTokenPresent,
    "channelAccessToken"
  );

  const requestedWebhookPath = Object.prototype.hasOwnProperty.call(body, "webhookPath")
    ? normalizeWebhookPath(body.webhookPath)
    : current.webhookPath || "";

  const webhookPath = requestedWebhookPath || current.webhookPath || generateWebhookPath();

  return {
    lineEnabled: Object.prototype.hasOwnProperty.call(body, "lineEnabled")
      ? normalizeBoolean(body.lineEnabled, current.lineEnabled)
      : current.lineEnabled,
    channelId: Object.prototype.hasOwnProperty.call(body, "channelId")
      ? normalizeText(body.channelId).slice(0, 120)
      : current.channelId,
    channelSecretRef: channelSecretState.ref,
    channelSecretPresent: channelSecretState.present,
    channelAccessTokenRef: channelAccessTokenState.ref,
    channelAccessTokenPresent: channelAccessTokenState.present,
    liffUrl: Object.prototype.hasOwnProperty.call(body, "liffUrl")
      ? normalizeOptionalUrl(body.liffUrl, "liffUrl")
      : current.liffUrl,
    loginAuthUrl: Object.prototype.hasOwnProperty.call(body, "loginAuthUrl")
      ? normalizeOptionalUrl(body.loginAuthUrl, "loginAuthUrl")
      : current.loginAuthUrl,
    webhookPath,
    customerOaName: Object.prototype.hasOwnProperty.call(body, "customerOaName")
      ? normalizeText(body.customerOaName).slice(0, 190)
      : current.customerOaName,
    staffGroupEnabled: Object.prototype.hasOwnProperty.call(body, "staffGroupEnabled")
      ? normalizeBoolean(body.staffGroupEnabled, current.staffGroupEnabled)
      : current.staffGroupEnabled
  };
}

async function saveStoreLineSettings(storeId, payload, updatedByStaffId = null, options = {}) {
  if (!storeId) {
    throw createStoreLineSettingsError("Store scope required", 403);
  }

  const existingRow = await loadStoreLineSettingsRow(storeId);
  const current = existingRow
    ? {
        lineEnabled: normalizeBoolean(existingRow.lineEnabled, false),
        channelId: normalizeText(existingRow.channelId),
        channelSecretRef: normalizeText(existingRow.channelSecretRef),
        channelSecretPresent: normalizeBoolean(existingRow.channelSecretPresent, false),
        channelAccessTokenRef: normalizeText(existingRow.channelAccessTokenRef),
        channelAccessTokenPresent: normalizeBoolean(existingRow.channelAccessTokenPresent, false),
        liffUrl: normalizeText(existingRow.liffUrl),
        loginAuthUrl: normalizeText(existingRow.loginAuthUrl),
        webhookPath: normalizeText(existingRow.webhookPath),
        customerOaName: normalizeText(existingRow.customerOaName),
        staffGroupEnabled: normalizeBoolean(existingRow.staffGroupEnabled, false)
      }
    : {
        lineEnabled: false,
        channelId: "",
        channelSecretRef: "",
        channelSecretPresent: false,
        channelAccessTokenRef: "",
        channelAccessTokenPresent: false,
        liffUrl: "",
        loginAuthUrl: "",
        webhookPath: "",
        customerOaName: "",
        staffGroupEnabled: false
      };

  const normalized = normalizePatchPayload(payload, current);

  const values = [
    normalized.lineEnabled ? 1 : 0,
    normalized.channelId || null,
    normalized.channelSecretRef || null,
    normalized.channelSecretPresent ? 1 : 0,
    normalized.channelAccessTokenRef || null,
    normalized.channelAccessTokenPresent ? 1 : 0,
    normalized.liffUrl || null,
    normalized.loginAuthUrl || null,
    normalized.webhookPath || null,
    normalized.customerOaName || null,
    normalized.staffGroupEnabled ? 1 : 0,
    updatedByStaffId,
    storeId
  ];

  try {
    const [updateResult] = await pool.query(
      `
        UPDATE store_line_settings
        SET line_enabled = ?,
            channel_id = ?,
            channel_secret_ref = ?,
            channel_secret_present = ?,
            channel_access_token_ref = ?,
            channel_access_token_present = ?,
            liff_url = ?,
            login_auth_url = ?,
            webhook_path = ?,
            customer_oa_name = ?,
            staff_group_enabled = ?,
            updated_by_staff_id = ?
        WHERE store_id = ?
      `,
      values
    );

    if (Number(updateResult.affectedRows || 0) === 0) {
      await pool.query(
        `
          INSERT INTO store_line_settings (
            line_enabled,
            channel_id,
            channel_secret_ref,
            channel_secret_present,
            channel_access_token_ref,
            channel_access_token_present,
            liff_url,
            login_auth_url,
            webhook_path,
            customer_oa_name,
            staff_group_enabled,
            updated_by_staff_id,
            store_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        values
      );
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw createStoreLineSettingsError("channelId 或 webhookPath 已被其他門市使用", 409);
    }
    throw error;
  }

  const savedRow = await loadStoreLineSettingsRow(storeId);
  return mapRowToSettings(savedRow, options.apiBaseUrl);
}

module.exports = {
  MASKED_PENDING_STORAGE,
  MASKED_SAFE_REF,
  STORE_LINE_SETTINGS_DEFAULTS,
  createStoreLineSettingsError,
  getStoreLineSettings,
  getMaskedLineCredentialStatus,
  resolveStoreLineCredentials,
  saveStoreLineSettings
};
