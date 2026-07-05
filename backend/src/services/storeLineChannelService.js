const config = require("../config");
const { pool } = require("../db");
const { resolveSecretRef } = require("../utils/lineSecretResolver");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const DIRECT_RELATIONSHIP_TYPES = new Set(["DIRECT_STORE"]);
const FRANCHISE_RELATIONSHIP_TYPES = new Set(["FRANCHISE_STORE"]);
const MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const COMPANY_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const OWNERSHIP_TYPES = new Set(["HQ_MANAGED", "FRANCHISE_OWNED", "INDEPENDENT_OWNED"]);
const CONNECTION_STATUSES = new Set(["NOT_TESTED", "DRY_RUN_OK", "DRY_RUN_FAILED", "DISABLED"]);
const REF_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(\/\/)?/i;
const WEBHOOK_PREFIX = "/api/line/webhook/channel/";

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value, maxLength = 255) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function normalizeOptionalText(value, maxLength = 255) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1") return true;
  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "on"].includes(text)) return true;
  if (["false", "no", "off", "0"].includes(text)) return false;
  return fallback;
}

function formatDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return String(value).replace("T", " ").slice(0, 19);
}

function normalizeOwnershipType(value, fallback = "HQ_MANAGED") {
  const text = String(value || fallback).trim().toUpperCase();
  if (!OWNERSHIP_TYPES.has(text)) {
    throw createError("ownership_type 不正確", 400);
  }
  return text;
}

function normalizeConnectionStatus(value) {
  const text = String(value || "NOT_TESTED").trim().toUpperCase();
  return CONNECTION_STATUSES.has(text) ? text : "NOT_TESTED";
}

function normalizeChannelId(value) {
  const text = normalizeText(value, 255);
  if (!text) {
    throw createError("請輸入 Channel ID", 400);
  }
  if (!/^[A-Za-z0-9._-]{4,255}$/.test(text)) {
    throw createError("Channel ID 格式不正確", 400);
  }
  return text;
}

function rejectRawSecretLikeValue(value, fieldLabel = "secret ref") {
  const text = String(value || "").trim();
  if (!text) return null;

  if (/^bearer\s+/i.test(text) || /^eyJ[A-Za-z0-9_-]+\./.test(text)) {
    throw createError(`${fieldLabel} 不可輸入 token 原文，請輸入 secret ref / token ref`, 400);
  }

  if (!REF_SCHEME_PATTERN.test(text)) {
    throw createError(`${fieldLabel} 必須是 secret ref / token ref，不可輸入原文`, 400);
  }

  if (text.length > 255) {
    throw createError(`${fieldLabel} 長度不可超過 255`, 400);
  }

  return text;
}

function normalizeSecretRef(value, fieldLabel) {
  const text = String(value || "").trim();
  if (!text) return null;
  return rejectRawSecretLikeValue(text, fieldLabel);
}

function maskLineId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-1)}`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function getRefScheme(value) {
  const text = String(value || "").trim();
  if (!text || !text.includes(":")) return "";
  return text.slice(0, text.indexOf(":")).toLowerCase();
}

function normalizeWebhookPath(value) {
  const raw = normalizeText(value, 255);
  if (!raw) {
    throw createError("請輸入 webhook path", 400);
  }

  let token = raw;
  if (token.startsWith(WEBHOOK_PREFIX)) {
    token = token.slice(WEBHOOK_PREFIX.length);
  } else if (token.startsWith("/api/line/webhook/")) {
    token = token.slice("/api/line/webhook/".length);
  }
  token = token.replace(/^\/+/, "");

  if (!/^[A-Za-z0-9_-]{6,160}$/.test(token)) {
    throw createError("webhook_path 格式不正確，需為 6-160 字元英數、底線或連字號", 400);
  }
  return token;
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function buildWebhookUrl(payload = {}) {
  const providedUrl = normalizeText(payload.webhookUrl || payload.webhook_url, 500);
  if (providedUrl) {
    if (!isValidHttpUrl(providedUrl)) {
      throw createError("webhook_url 必須是 http 或 https 網址", 400);
    }
    return providedUrl;
  }

  const webhookPath = normalizeWebhookPath(payload.webhookPath || payload.webhook_path);
  const base = String(payload.baseUrl || config.frontendBaseUrl || "").replace(/\/$/, "");
  return `${base}${WEBHOOK_PREFIX}${webhookPath}`;
}

function defaultOwnershipForRelationship(relationshipType) {
  const relationship = normalizeRole(relationshipType);
  if (FRANCHISE_RELATIONSHIP_TYPES.has(relationship)) return "FRANCHISE_OWNED";
  if (!relationship) return "INDEPENDENT_OWNED";
  return "HQ_MANAGED";
}

async function getStoreProfile(storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT s.id,
             s.name,
             s.code,
             cs.company_id AS companyId,
             cs.relationship_type AS relationshipType
      FROM stores s
      LEFT JOIN company_stores cs
        ON cs.store_id = s.id
       AND cs.status = 'ACTIVE'
      WHERE s.id = ?
      ORDER BY FIELD(cs.relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE') ASC,
               cs.company_id ASC
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

async function resolveStoreLineChannelContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    throw createError("Store scope required", 403);
  }

  const [relations] = await connection.query(
    `
      SELECT
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cm.role AS companyRole
      FROM company_stores cs
      LEFT JOIN company_memberships cm
        ON cm.company_id = cs.company_id
       AND cm.staff_user_id = ?
       AND cm.status = 'ACTIVE'
      WHERE cs.status = 'ACTIVE'
        AND (cs.store_id = ? OR cm.id IS NOT NULL)
    `,
    [staffUserId, storeId]
  );

  const currentRelations = relations.filter((row) => Number(row.storeId) === storeId);
  const currentRelationshipTypes = currentRelations.map((row) => normalizeRole(row.relationshipType)).filter(Boolean);
  const hqCompanyIds = [...new Set(currentRelations
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(normalizeRole(row.relationshipType)))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const writableCompanyIds = [...new Set(relations
    .filter((row) => COMPANY_WRITE_ROLES.has(String(row.companyRole || "").trim()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const accessibleCompanyIds = [...new Set([...hqCompanyIds, ...writableCompanyIds])];

  let accessibleStoreIds = [storeId];
  if (accessibleCompanyIds.length) {
    const [storeRows] = await connection.query(
      `
        SELECT DISTINCT store_id AS storeId
        FROM company_stores
        WHERE status = 'ACTIVE'
          AND company_id IN (${accessibleCompanyIds.map(() => "?").join(",")})
      `,
      accessibleCompanyIds
    );
    accessibleStoreIds = [...new Set(storeRows.map((row) => toPositiveInteger(row.storeId)).filter(Boolean))];
  }

  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);
  const canManageOwnStore = MANAGER_ROLES.has(role) || STORE_MANAGER_ROLES.has(storeRole);
  const canManageCompanyChannels = accessibleCompanyIds.length > 0 && canManageOwnStore;

  return {
    staffUserId,
    storeId,
    role,
    storeRole,
    hqCompanyIds,
    writableCompanyIds,
    accessibleCompanyIds,
    accessibleStoreIds,
    currentRelationshipTypes,
    isHqStore: currentRelationshipTypes.some((type) => HQ_RELATIONSHIP_TYPES.has(type)),
    isDirectStore: currentRelationshipTypes.some((type) => DIRECT_RELATIONSHIP_TYPES.has(type)),
    isFranchiseStore: currentRelationshipTypes.some((type) => FRANCHISE_RELATIONSHIP_TYPES.has(type)),
    isIndependent: currentRelationshipTypes.length === 0,
    canManageOwnStore,
    canManageCompanyChannels,
    canManageSettings: canManageOwnStore || writableCompanyIds.length > 0
  };
}

function assertManagePermission(context) {
  if (!context.canManageSettings) {
    throw createError("沒有 LINE Channel 管理權限", 403);
  }
}

function resolveReadableStoreId(context, requestedStoreId = null) {
  const requested = toPositiveInteger(requestedStoreId);
  if (!requested) return null;
  if (requested === context.storeId) return requested;
  if (context.canManageCompanyChannels && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限查看其他門市 LINE Channel", 403);
}

function resolveWritableStoreId(context, requestedStoreId = null) {
  assertManagePermission(context);
  const requested = toPositiveInteger(requestedStoreId, context.storeId);
  if (requested === context.storeId) return requested;
  if (context.canManageCompanyChannels && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限修改其他門市 LINE Channel", 403);
}

async function getAccessibleStores(context, connection = pool) {
  const ids = context.canManageCompanyChannels ? context.accessibleStoreIds : [context.storeId];
  if (!ids.length) return [];
  const [rows] = await connection.query(
    `
      SELECT s.id,
             s.name,
             s.code,
             cs.company_id AS companyId,
             cs.relationship_type AS relationshipType
      FROM stores s
      LEFT JOIN company_stores cs
        ON cs.store_id = s.id
       AND cs.status = 'ACTIVE'
      WHERE s.id IN (${ids.map(() => "?").join(",")})
      ORDER BY s.id ASC
    `,
    ids
  );
  const seen = new Set();
  return rows
    .filter((row) => {
      if (seen.has(Number(row.id))) return false;
      seen.add(Number(row.id));
      return true;
    })
    .map((row) => ({
      id: Number(row.id),
      name: row.name || `Store ${row.id}`,
      code: row.code || "",
      companyId: row.companyId == null ? null : Number(row.companyId),
      relationshipType: row.relationshipType || "INDEPENDENT",
      defaultOwnershipType: defaultOwnershipForRelationship(row.relationshipType)
    }));
}

function hasSensitiveRefPayload(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, "line_channel_secret_ref")
    || Object.prototype.hasOwnProperty.call(payload, "lineChannelSecretRef")
    || Object.prototype.hasOwnProperty.call(payload, "channel_access_token_ref")
    || Object.prototype.hasOwnProperty.call(payload, "channelAccessTokenRef");
}

async function assertCanWriteChannel(context, storeId, ownershipType, payload = {}, existing = null, connection = pool) {
  const targetStoreId = resolveWritableStoreId(context, storeId);
  const profile = await getStoreProfile(targetStoreId, connection);
  if (!profile) throw createError("找不到門市", 404);

  const relationship = normalizeRole(profile.relationshipType);
  const isDirectStore = DIRECT_RELATIONSHIP_TYPES.has(relationship);
  const isCompanyManager = context.canManageCompanyChannels && context.accessibleStoreIds.includes(targetStoreId);

  if (isDirectStore && !isCompanyManager) {
    if (!existing) {
      throw createError("直營門市 LINE Channel 由本部管理", 403);
    }
    if ((ownershipType || existing.ownershipType || existing.ownership_type) === "HQ_MANAGED" && hasSensitiveRefPayload(payload)) {
      throw createError("直營門市不可修改本部管理的 token ref / secret ref", 403);
    }
  }

  return { targetStoreId, profile };
}

function validateStoreLineChannelPayload(payload = {}, options = {}) {
  const partial = Boolean(options.partial);
  const result = {};

  if (!partial || payload.storeId !== undefined || payload.store_id !== undefined) {
    result.storeId = toPositiveInteger(payload.storeId ?? payload.store_id);
    if (!result.storeId) throw createError("請選擇門市", 400);
  }

  if (!partial || payload.ownershipType !== undefined || payload.ownership_type !== undefined) {
    result.ownershipType = normalizeOwnershipType(payload.ownershipType ?? payload.ownership_type);
  }

  if (!partial || payload.lineChannelId !== undefined || payload.line_channel_id !== undefined) {
    result.lineChannelId = normalizeChannelId(payload.lineChannelId ?? payload.line_channel_id);
  }

  if (!partial || payload.webhookPath !== undefined || payload.webhook_path !== undefined) {
    result.webhookPath = normalizeWebhookPath(payload.webhookPath ?? payload.webhook_path);
  }

  if (!partial || payload.webhookUrl !== undefined || payload.webhook_url !== undefined || result.webhookPath) {
    const webhookPath = result.webhookPath || payload.webhookPath || payload.webhook_path;
    result.webhookUrl = buildWebhookUrl({ ...payload, webhookPath });
  }

  const secretProvided = payload.lineChannelSecretRef !== undefined || payload.line_channel_secret_ref !== undefined;
  if (secretProvided) {
    result.lineChannelSecretRef = normalizeSecretRef(payload.lineChannelSecretRef ?? payload.line_channel_secret_ref, "Channel Secret Ref");
  }

  const tokenProvided = payload.channelAccessTokenRef !== undefined || payload.channel_access_token_ref !== undefined;
  if (tokenProvided) {
    result.channelAccessTokenRef = normalizeSecretRef(payload.channelAccessTokenRef ?? payload.channel_access_token_ref, "Access Token Ref");
  }

  if (!partial || payload.lineOfficialAccountName !== undefined || payload.line_official_account_name !== undefined) {
    result.lineOfficialAccountName = normalizeOptionalText(payload.lineOfficialAccountName ?? payload.line_official_account_name, 255);
  }
  if (!partial || payload.lineOfficialAccountId !== undefined || payload.line_official_account_id !== undefined) {
    result.lineOfficialAccountId = normalizeOptionalText(payload.lineOfficialAccountId ?? payload.line_official_account_id, 255);
  }
  if (!partial || payload.lineBasicId !== undefined || payload.line_basic_id !== undefined) {
    result.lineBasicId = normalizeOptionalText(payload.lineBasicId ?? payload.line_basic_id, 255);
  }
  if (!partial || payload.liffId !== undefined || payload.liff_id !== undefined) {
    result.liffId = normalizeOptionalText(payload.liffId ?? payload.liff_id, 255);
  }
  if (!partial || payload.isPrimary !== undefined || payload.is_primary !== undefined) {
    result.isPrimary = normalizeBoolean(payload.isPrimary ?? payload.is_primary, true) ? 1 : 0;
  }
  if (!partial || payload.enabled !== undefined) {
    result.enabled = normalizeBoolean(payload.enabled, false) ? 1 : 0;
  }

  return result;
}

function selectStoreLineChannelSql(whereClause = "") {
  return `
    SELECT slc.id,
           slc.company_id AS companyId,
           slc.store_id AS storeId,
           s.name AS storeName,
           s.code AS storeCode,
           slc.ownership_type AS ownershipType,
           slc.line_official_account_name AS lineOfficialAccountName,
           slc.line_official_account_id AS lineOfficialAccountId,
           slc.line_basic_id AS lineBasicId,
           slc.line_channel_id AS lineChannelId,
           slc.line_channel_secret_ref AS lineChannelSecretRef,
           slc.channel_access_token_ref AS channelAccessTokenRef,
           slc.liff_id AS liffId,
           slc.webhook_path AS webhookPath,
           slc.webhook_url AS webhookUrl,
           slc.is_primary AS isPrimary,
           slc.enabled,
           slc.connection_status AS connectionStatus,
           slc.last_dry_run_test_at AS lastDryRunTestAt,
           slc.last_webhook_at AS lastWebhookAt,
           slc.last_error_at AS lastErrorAt,
           slc.last_error_message AS lastErrorMessage,
           slc.created_by_staff_user_id AS createdByStaffUserId,
           slc.updated_by_staff_user_id AS updatedByStaffUserId,
           created_staff.username AS createdByUsername,
           created_staff.display_name AS createdByName,
           updated_staff.username AS updatedByUsername,
           updated_staff.display_name AS updatedByName,
           slc.created_at AS createdAt,
           slc.updated_at AS updatedAt
    FROM store_line_channels slc
    LEFT JOIN stores s ON s.id = slc.store_id
    LEFT JOIN staff_users created_staff ON created_staff.id = slc.created_by_staff_user_id
    LEFT JOIN staff_users updated_staff ON updated_staff.id = slc.updated_by_staff_user_id
    ${whereClause}
  `;
}

function maskLineChannelRecord(row = {}) {
  const hasSecretRef = Boolean(row.lineChannelSecretRef || row.line_channel_secret_ref);
  const hasTokenRef = Boolean(row.channelAccessTokenRef || row.channel_access_token_ref);
  const secretScheme = getRefScheme(row.lineChannelSecretRef || row.line_channel_secret_ref);
  const tokenScheme = getRefScheme(row.channelAccessTokenRef || row.channel_access_token_ref);

  return {
    id: Number(row.id),
    companyId: row.companyId == null && row.company_id == null ? null : Number(row.companyId ?? row.company_id),
    storeId: Number(row.storeId ?? row.store_id),
    storeName: row.storeName || row.store_name || "",
    storeCode: row.storeCode || row.store_code || "",
    ownershipType: row.ownershipType || row.ownership_type || "HQ_MANAGED",
    lineOfficialAccountName: row.lineOfficialAccountName || row.line_official_account_name || "",
    lineOfficialAccountId: row.lineOfficialAccountId || row.line_official_account_id || "",
    lineBasicId: row.lineBasicId || row.line_basic_id || "",
    lineChannelIdMasked: maskLineId(row.lineChannelId || row.line_channel_id),
    hasLineChannelSecretRef: hasSecretRef,
    lineChannelSecretRefScheme: secretScheme,
    lineChannelSecretRefStatus: hasSecretRef ? "已設定" : "未設定",
    hasChannelAccessTokenRef: hasTokenRef,
    channelAccessTokenRefScheme: tokenScheme,
    channelAccessTokenRefStatus: hasTokenRef ? "已設定" : "未設定",
    liffId: row.liffId || row.liff_id || "",
    webhookPath: row.webhookPath || row.webhook_path || "",
    webhookUrl: row.webhookUrl || row.webhook_url || "",
    isPrimary: Boolean(row.isPrimary ?? row.is_primary),
    enabled: Boolean(row.enabled),
    connectionStatus: normalizeConnectionStatus(row.connectionStatus || row.connection_status),
    lastDryRunTestAt: formatDateTime(row.lastDryRunTestAt || row.last_dry_run_test_at),
    lastWebhookAt: formatDateTime(row.lastWebhookAt || row.last_webhook_at),
    lastErrorAt: formatDateTime(row.lastErrorAt || row.last_error_at),
    lastErrorMessage: row.lastErrorMessage || row.last_error_message || "",
    createdByStaffUserId: row.createdByStaffUserId == null && row.created_by_staff_user_id == null ? null : Number(row.createdByStaffUserId ?? row.created_by_staff_user_id),
    updatedByStaffUserId: row.updatedByStaffUserId == null && row.updated_by_staff_user_id == null ? null : Number(row.updatedByStaffUserId ?? row.updated_by_staff_user_id),
    createdByName: row.createdByName || row.created_by_name || row.createdByUsername || row.created_by_username || "",
    updatedByName: row.updatedByName || row.updated_by_name || row.updatedByUsername || row.updated_by_username || "",
    createdAt: formatDateTime(row.createdAt || row.created_at),
    updatedAt: formatDateTime(row.updatedAt || row.updated_at)
  };
}

async function fetchStoreLineChannelById(connection, id, forUpdate = false) {
  const [rows] = await connection.query(
    `${selectStoreLineChannelSql("WHERE slc.id = ?")} ${forUpdate ? "FOR UPDATE" : ""}`,
    [id]
  );
  return rows[0] || null;
}

async function resolveStoreLineChannelByWebhookPath(webhookPath, connection = pool) {
  const normalizedPath = normalizeWebhookPath(webhookPath);
  const [rows] = await connection.query(
    `
      ${selectStoreLineChannelSql(`
        WHERE slc.webhook_path = ?
          AND slc.enabled = 1
          AND s.status = 'active'
      `)}
      LIMIT 2
    `,
    [normalizedPath]
  );

  if (rows.length > 1) {
    throw createError("LINE Channel webhook path 設定重複", 409);
  }

  const row = rows[0] || null;
  if (!row) {
    throw createError("找不到啟用中的 LINE Channel webhook 設定", 404);
  }

  if (!row.lineChannelSecretRef) {
    throw createError("LINE Channel Secret Ref 尚未設定", 503);
  }

  if (!row.channelAccessTokenRef) {
    throw createError("LINE Channel Access Token Ref 尚未設定", 503);
  }

  const channelSecret = resolveSecretRef(row.lineChannelSecretRef);
  if (!channelSecret.resolved) {
    throw createError(`LINE Channel Secret Ref 無法解析：${channelSecret.reason}`, 503);
  }

  const channelAccessToken = resolveSecretRef(row.channelAccessTokenRef);
  if (!channelAccessToken.resolved) {
    throw createError(`LINE Channel Access Token Ref 無法解析：${channelAccessToken.reason}`, 503);
  }

  return {
    channel: row,
    channelSecret,
    channelAccessToken
  };
}

async function recordStoreLineChannelWebhookReceived(channelId, connection = pool) {
  const normalizedId = toPositiveInteger(channelId);
  if (!normalizedId) return;

  await connection.query(
    `
      UPDATE store_line_channels
      SET last_webhook_at = NOW(),
          last_error_at = NULL,
          last_error_message = NULL
      WHERE id = ?
    `,
    [normalizedId]
  );
}

async function listStoreLineChannels(context, filters = {}, connection = pool) {
  const requestedStoreId = resolveReadableStoreId(context, filters.storeId || filters.store_id);
  const storeIds = requestedStoreId ? [requestedStoreId] : (context.canManageCompanyChannels ? context.accessibleStoreIds : [context.storeId]);
  const clauses = [`slc.store_id IN (${storeIds.map(() => "?").join(",")})`];
  const params = [...storeIds];

  const requestedCompanyId = toPositiveInteger(filters.companyId || filters.company_id);
  if (requestedCompanyId) {
    if (!context.accessibleCompanyIds.includes(requestedCompanyId)) {
      throw createError("無權限查看其他公司 LINE Channel", 403);
    }
    clauses.push("slc.company_id = ?");
    params.push(requestedCompanyId);
  }

  if (filters.enabled !== undefined && filters.enabled !== "") {
    clauses.push("slc.enabled = ?");
    params.push(normalizeBoolean(filters.enabled, false) ? 1 : 0);
  }

  if (filters.ownershipType || filters.ownership_type) {
    clauses.push("slc.ownership_type = ?");
    params.push(normalizeOwnershipType(filters.ownershipType || filters.ownership_type));
  }

  const limit = Math.min(toPositiveInteger(filters.limit, 80), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const [rows] = await connection.query(
    `
      ${selectStoreLineChannelSql(`WHERE ${clauses.join(" AND ")}`)}
      ORDER BY slc.store_id ASC, slc.is_primary DESC, slc.updated_at DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  return {
    channels: rows.map(maskLineChannelRecord),
    stores: await getAccessibleStores(context, connection),
    currentStoreId: context.storeId,
    canManageSettings: context.canManageSettings,
    canManageCompanyChannels: context.canManageCompanyChannels
  };
}

async function getStoreLineChannel(context, id, connection = pool) {
  const channelId = toPositiveInteger(id);
  if (!channelId) throw createError("找不到 LINE Channel", 404);
  const row = await fetchStoreLineChannelById(connection, channelId);
  if (!row) throw createError("找不到 LINE Channel", 404);
  resolveReadableStoreId(context, row.storeId);
  return { channel: maskLineChannelRecord(row) };
}

function handleDuplicateError(error) {
  if (error?.code !== "ER_DUP_ENTRY") return;
  if (String(error.message || "").includes("uk_store_line_channels_channel")) {
    throw createError("Channel ID 已存在", 409);
  }
  if (String(error.message || "").includes("uk_store_line_channels_webhook_path")) {
    throw createError("Webhook path 已存在", 409);
  }
  throw createError("LINE Channel 設定已存在", 409);
}

async function createStoreLineChannel(context, payload = {}) {
  const normalized = validateStoreLineChannelPayload(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const { targetStoreId, profile } = await assertCanWriteChannel(context, normalized.storeId, normalized.ownershipType, payload, null, connection);
    const companyId = profile.companyId || null;

    const [result] = await connection.query(
      `
        INSERT INTO store_line_channels (
          company_id,
          store_id,
          ownership_type,
          line_official_account_name,
          line_official_account_id,
          line_basic_id,
          line_channel_id,
          line_channel_secret_ref,
          channel_access_token_ref,
          liff_id,
          webhook_path,
          webhook_url,
          is_primary,
          enabled,
          connection_status,
          created_by_staff_user_id,
          updated_by_staff_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        companyId,
        targetStoreId,
        normalized.ownershipType,
        normalized.lineOfficialAccountName,
        normalized.lineOfficialAccountId,
        normalized.lineBasicId,
        normalized.lineChannelId,
        normalized.lineChannelSecretRef,
        normalized.channelAccessTokenRef,
        normalized.liffId,
        normalized.webhookPath,
        normalized.webhookUrl,
        normalized.isPrimary,
        normalized.enabled,
        normalized.enabled ? "NOT_TESTED" : "DISABLED",
        context.staffUserId,
        context.staffUserId
      ]
    );

    if (normalized.isPrimary) {
      await connection.query(
        "UPDATE store_line_channels SET is_primary = 0 WHERE store_id = ? AND id <> ?",
        [targetStoreId, result.insertId]
      );
    }

    const row = await fetchStoreLineChannelById(connection, result.insertId);
    await connection.commit();
    return { channel: maskLineChannelRecord(row), created: true, id: Number(result.insertId) };
  } catch (error) {
    await connection.rollback();
    handleDuplicateError(error);
    throw error;
  } finally {
    connection.release();
  }
}

async function updateStoreLineChannel(context, id, payload = {}) {
  const channelId = toPositiveInteger(id);
  if (!channelId) throw createError("找不到 LINE Channel", 404);
  const normalized = validateStoreLineChannelPayload(payload, { partial: true });
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const existing = await fetchStoreLineChannelById(connection, channelId, true);
    if (!existing) throw createError("找不到 LINE Channel", 404);
    const targetStoreId = existing.storeId;
    const ownershipType = normalized.ownershipType || existing.ownershipType;
    await assertCanWriteChannel(context, targetStoreId, ownershipType, payload, existing, connection);

    const next = {
      ownershipType,
      lineOfficialAccountName: normalized.lineOfficialAccountName !== undefined ? normalized.lineOfficialAccountName : existing.lineOfficialAccountName,
      lineOfficialAccountId: normalized.lineOfficialAccountId !== undefined ? normalized.lineOfficialAccountId : existing.lineOfficialAccountId,
      lineBasicId: normalized.lineBasicId !== undefined ? normalized.lineBasicId : existing.lineBasicId,
      lineChannelId: normalized.lineChannelId || existing.lineChannelId,
      lineChannelSecretRef: Object.prototype.hasOwnProperty.call(normalized, "lineChannelSecretRef") ? normalized.lineChannelSecretRef : existing.lineChannelSecretRef,
      channelAccessTokenRef: Object.prototype.hasOwnProperty.call(normalized, "channelAccessTokenRef") ? normalized.channelAccessTokenRef : existing.channelAccessTokenRef,
      liffId: normalized.liffId !== undefined ? normalized.liffId : existing.liffId,
      webhookPath: normalized.webhookPath || existing.webhookPath,
      webhookUrl: normalized.webhookUrl || existing.webhookUrl,
      isPrimary: normalized.isPrimary !== undefined ? normalized.isPrimary : (existing.isPrimary ? 1 : 0),
      enabled: normalized.enabled !== undefined ? normalized.enabled : (existing.enabled ? 1 : 0)
    };

    await connection.query(
      `
        UPDATE store_line_channels
        SET ownership_type = ?,
            line_official_account_name = ?,
            line_official_account_id = ?,
            line_basic_id = ?,
            line_channel_id = ?,
            line_channel_secret_ref = ?,
            channel_access_token_ref = ?,
            liff_id = ?,
            webhook_path = ?,
            webhook_url = ?,
            is_primary = ?,
            enabled = ?,
            connection_status = CASE
              WHEN ? = 0 THEN 'DISABLED'
              WHEN connection_status = 'DISABLED' THEN 'NOT_TESTED'
              ELSE connection_status
            END,
            updated_by_staff_user_id = ?
        WHERE id = ?
      `,
      [
        next.ownershipType,
        next.lineOfficialAccountName,
        next.lineOfficialAccountId,
        next.lineBasicId,
        next.lineChannelId,
        next.lineChannelSecretRef,
        next.channelAccessTokenRef,
        next.liffId,
        next.webhookPath,
        next.webhookUrl,
        next.isPrimary,
        next.enabled,
        next.enabled,
        context.staffUserId,
        channelId
      ]
    );

    if (next.isPrimary) {
      await connection.query(
        "UPDATE store_line_channels SET is_primary = 0 WHERE store_id = ? AND id <> ?",
        [targetStoreId, channelId]
      );
    }

    const row = await fetchStoreLineChannelById(connection, channelId);
    await connection.commit();
    return { channel: maskLineChannelRecord(row), updated: true };
  } catch (error) {
    await connection.rollback();
    handleDuplicateError(error);
    throw error;
  } finally {
    connection.release();
  }
}

function buildDryRunChecks(row = {}) {
  const channel = maskLineChannelRecord(row);
  const checks = [
    { key: "store", label: "門市存在", ok: Boolean(row.storeId) },
    { key: "lineChannelId", label: "Channel ID 已設定", ok: Boolean(row.lineChannelId) },
    { key: "webhookPath", label: "Webhook path 已設定", ok: Boolean(row.webhookPath) },
    { key: "webhookUrl", label: "Webhook URL 可產生", ok: Boolean(row.webhookUrl) },
    { key: "secretRef", label: "Channel Secret Ref 已設定", ok: Boolean(row.lineChannelSecretRef) },
    { key: "tokenRef", label: "Access Token Ref 已設定", ok: Boolean(row.channelAccessTokenRef) },
    { key: "enabled", label: channel.enabled ? "已啟用" : "未啟用，本次仍只做 dry-run", ok: true }
  ];
  return checks;
}

async function dryRunStoreLineChannel(context, id, connection = pool) {
  assertManagePermission(context);
  const channelId = toPositiveInteger(id);
  if (!channelId) throw createError("找不到 LINE Channel", 404);
  const row = await fetchStoreLineChannelById(connection, channelId);
  if (!row) throw createError("找不到 LINE Channel", 404);
  resolveReadableStoreId(context, row.storeId);

  const checks = buildDryRunChecks(row);
  const ok = checks.every((item) => item.ok);
  const status = ok ? "DRY_RUN_OK" : "DRY_RUN_FAILED";
  const errorMessage = ok ? null : checks.filter((item) => !item.ok).map((item) => item.label).join("；");

  await connection.query(
    `
      UPDATE store_line_channels
      SET connection_status = ?,
          last_dry_run_test_at = NOW(),
          last_error_at = ?,
          last_error_message = ?,
          updated_by_staff_user_id = ?
      WHERE id = ?
    `,
    [status, ok ? null : new Date(), errorMessage, context.staffUserId, channelId]
  );

  const updated = await fetchStoreLineChannelById(connection, channelId);
  return {
    ok,
    dryRun: true,
    actualLineApiCalled: false,
    message: ok
      ? "Dry-run 成功：未呼叫 LINE API，僅驗證設定完整性。"
      : "Dry-run 失敗：請確認 Channel ID / secret ref / token ref / webhook path。",
    checks,
    channel: maskLineChannelRecord(updated)
  };
}

async function verifyStoreLineChannel(context, id, connection = pool) {
  assertManagePermission(context);
  const channelId = toPositiveInteger(id);
  if (!channelId) throw createError("找不到 LINE Channel", 404);
  const row = await fetchStoreLineChannelById(connection, channelId);
  if (!row) throw createError("找不到 LINE Channel", 404);
  resolveReadableStoreId(context, row.storeId);

  const checks = [
    { key: "channelSecretRef", label: "Channel Secret Ref 可解析", ok: false },
    { key: "channelAccessTokenRef", label: "Access Token Ref 可解析", ok: false },
    { key: "lineApi", label: "LINE API 輕量驗證", ok: false }
  ];

  const secretResult = resolveSecretRef(row.lineChannelSecretRef);
  checks[0].ok = Boolean(secretResult.resolved);
  const tokenResult = resolveSecretRef(row.channelAccessTokenRef);
  checks[1].ok = Boolean(tokenResult.resolved);

  let lineApiStatus = null;
  let errorMessage = "";

  if (secretResult.resolved && tokenResult.resolved) {
    try {
      const response = await fetch("https://api.line.me/v2/bot/info", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tokenResult.secret}`
        }
      });
      lineApiStatus = response.status;
      checks[2].ok = response.ok;
      if (!response.ok) {
        errorMessage = `LINE API verify failed: ${response.status}`;
      }
    } catch (error) {
      errorMessage = "LINE API verify request failed";
    }
  } else {
    errorMessage = checks.filter((item) => !item.ok).map((item) => item.label).join("；");
  }

  const ok = checks.every((item) => item.ok);
  await connection.query(
    `
      UPDATE store_line_channels
      SET connection_status = ?,
          last_dry_run_test_at = NOW(),
          last_error_at = ?,
          last_error_message = ?,
          updated_by_staff_user_id = ?
      WHERE id = ?
    `,
    [ok ? "DRY_RUN_OK" : "DRY_RUN_FAILED", ok ? null : new Date(), ok ? null : errorMessage, context.staffUserId, channelId]
  );

  const updated = await fetchStoreLineChannelById(connection, channelId);
  return {
    ok,
    verify: true,
    actualLineApiCalled: Boolean(secretResult.resolved && tokenResult.resolved),
    lineApiStatus,
    message: ok
      ? "Verify 成功：secret ref / token ref 可解析，LINE API 輕量驗證成功。"
      : "Verify 失敗：請確認 secret ref / token ref 與 LINE Channel 設定。",
    checks,
    channel: maskLineChannelRecord(updated)
  };
}

function getWebhookPreview(context, query = {}) {
  const storeId = resolveReadableStoreId(context, query.storeId || query.store_id) || context.storeId;
  const webhookPath = normalizeWebhookPath(query.webhookPath || query.webhook_path || query.lineChannelId || query.line_channel_id || `store-${storeId}-line-channel`);
  const webhookUrl = buildWebhookUrl({ webhookPath, webhookUrl: query.webhookUrl || query.webhook_url });
  return {
    storeId,
    webhookPath,
    webhookUrl,
    dryRun: true,
    actualLineApiCalled: false
  };
}

module.exports = {
  buildWebhookUrl,
  createStoreLineChannel,
  dryRunStoreLineChannel,
  getStoreLineChannel,
  getWebhookPreview,
  listStoreLineChannels,
  maskLineChannelRecord,
  rejectRawSecretLikeValue,
  recordStoreLineChannelWebhookReceived,
  resolveStoreLineChannelByWebhookPath,
  resolveStoreLineChannelContext,
  updateStoreLineChannel,
  validateStoreLineChannelPayload,
  verifyStoreLineChannel
};
