const { pool } = require("../db");
const {
  upsertStoreNotificationSetting,
  upsertSupplierNotificationSetting
} = require("./lineNotificationSettingsService");

const GROUP_SOURCE_TYPES = new Set(["group", "room"]);
const GROUP_TYPE_HINTS = new Set(["UNKNOWN", "STAFF_GROUP", "SUPPLIER_GROUP"]);
const CANDIDATE_STATUSES = new Set(["NEW", "LINKED", "IGNORED"]);

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeText(value, maxLength = 255) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function maskLineId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= 10) return "******";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function normalizeSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return GROUP_SOURCE_TYPES.has(normalized) ? normalized : "";
}

function normalizeHint(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return GROUP_TYPE_HINTS.has(normalized) ? normalized : "UNKNOWN";
}

function detectGroupTypeHint(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return "UNKNOWN";

  if (
    normalized.includes("員工群組") ||
    normalized.includes("员工群组") ||
    normalized.includes("직원") ||
    normalized.includes("staff")
  ) {
    return "STAFF_GROUP";
  }

  if (
    normalized.includes("供應商群組") ||
    normalized.includes("供应商群组") ||
    normalized.includes("공급사") ||
    normalized.includes("supplier")
  ) {
    return "SUPPLIER_GROUP";
  }

  return "UNKNOWN";
}

function shouldCaptureGroupCandidate(text) {
  return String(text || "").toUpperCase().includes("KINGWAY");
}

function getEventGroupId(source = {}) {
  const sourceType = normalizeSourceType(source.type);
  if (sourceType === "group") return normalizeText(source.groupId, 255);
  if (sourceType === "room") return normalizeText(source.roomId, 255);
  return "";
}

function assertManagePermission(context) {
  if (!context?.canManageSettings) {
    const error = new Error("沒有 LINE 群組候選設定權限");
    error.statusCode = 403;
    throw error;
  }
}

function normalizeCandidate(row = {}) {
  return {
    id: Number(row.id),
    lineGroupIdMasked: maskLineId(row.lineGroupId || row.line_group_id),
    groupTypeHint: row.groupTypeHint || row.group_type_hint || "UNKNOWN",
    sourceType: row.sourceType || row.source_type || "",
    lastMessageText: row.lastMessageText || row.last_message_text || "",
    displayName: row.displayName || row.display_name || "",
    linkedStoreId: row.linkedStoreId == null && row.linked_store_id == null
      ? null
      : Number(row.linkedStoreId ?? row.linked_store_id),
    linkedSupplierId: row.linkedSupplierId == null && row.linked_supplier_id == null
      ? null
      : Number(row.linkedSupplierId ?? row.linked_supplier_id),
    status: row.status || "NEW",
    detectedAt: row.detectedAt || row.detected_at || null,
    lastSeenAt: row.lastSeenAt || row.last_seen_at || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

async function fetchCandidateForUpdate(connection, candidateId) {
  const id = toPositiveInteger(candidateId);
  if (!id) {
    const error = new Error("候選群組 ID 不正確");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await connection.query(
    `
      SELECT *
      FROM line_group_candidates
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [id]
  );

  if (!rows[0]) {
    const error = new Error("找不到 LINE 群組候選資料");
    error.statusCode = 404;
    throw error;
  }

  if (rows[0].status === "IGNORED") {
    const error = new Error("此 LINE 群組候選已忽略");
    error.statusCode = 409;
    throw error;
  }

  return rows[0];
}

async function upsertLineGroupCandidate(input = {}, connection = pool) {
  const sourceType = normalizeSourceType(input.sourceType);
  const groupId = normalizeText(input.groupId, 255);
  if (!sourceType || !groupId) return null;

  const messageText = normalizeText(input.messageText, 255);
  const hint = normalizeHint(input.hint || detectGroupTypeHint(messageText));
  const displayName = normalizeText(input.displayName, 255) || null;

  await connection.query(
    `
      INSERT INTO line_group_candidates (
        line_group_id,
        group_type_hint,
        source_type,
        last_message_text,
        display_name,
        status,
        detected_at,
        last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, 'NEW', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        group_type_hint = CASE
          WHEN VALUES(group_type_hint) <> 'UNKNOWN' THEN VALUES(group_type_hint)
          ELSE group_type_hint
        END,
        source_type = VALUES(source_type),
        last_message_text = VALUES(last_message_text),
        display_name = COALESCE(VALUES(display_name), display_name),
        last_seen_at = NOW()
    `,
    [groupId, hint, sourceType, messageText || null, displayName]
  );

  const [rows] = await connection.query(
    `
      SELECT id,
             line_group_id AS lineGroupId,
             group_type_hint AS groupTypeHint,
             source_type AS sourceType,
             last_message_text AS lastMessageText,
             display_name AS displayName,
             linked_store_id AS linkedStoreId,
             linked_supplier_id AS linkedSupplierId,
             status,
             detected_at AS detectedAt,
             last_seen_at AS lastSeenAt,
             created_at AS createdAt,
             updated_at AS updatedAt
      FROM line_group_candidates
      WHERE line_group_id = ?
      LIMIT 1
    `,
    [groupId]
  );
  return rows[0] ? normalizeCandidate(rows[0]) : null;
}

async function listCandidates(context, filters = {}, connection = pool) {
  const statuses = String(filters.status || "NEW")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => CANDIDATE_STATUSES.has(item));
  const effectiveStatuses = statuses.length ? statuses : ["NEW"];
  const limit = Math.min(toPositiveInteger(filters.limit, 50), 100);

  const [rows] = await connection.query(
    `
      SELECT id,
             line_group_id AS lineGroupId,
             group_type_hint AS groupTypeHint,
             source_type AS sourceType,
             last_message_text AS lastMessageText,
             display_name AS displayName,
             linked_store_id AS linkedStoreId,
             linked_supplier_id AS linkedSupplierId,
             status,
             detected_at AS detectedAt,
             last_seen_at AS lastSeenAt,
             created_at AS createdAt,
             updated_at AS updatedAt
      FROM line_group_candidates
      WHERE status IN (${effectiveStatuses.map(() => "?").join(",")})
      ORDER BY last_seen_at DESC, id DESC
      LIMIT ?
    `,
    [...effectiveStatuses, limit]
  );

  return rows.map(normalizeCandidate);
}

async function ignoreCandidate(context, candidateId) {
  assertManagePermission(context);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const candidate = await fetchCandidateForUpdate(connection, candidateId);
    await connection.query(
      `
        UPDATE line_group_candidates
        SET status = 'IGNORED',
            updated_at = NOW()
        WHERE id = ?
      `,
      [candidate.id]
    );
    await connection.commit();
    return { ok: true, candidate: normalizeCandidate({ ...candidate, status: "IGNORED" }) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function linkCandidateToStore(context, candidateId, payload = {}) {
  assertManagePermission(context);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const candidate = await fetchCandidateForUpdate(connection, candidateId);
    const setting = await upsertStoreNotificationSetting(
      context,
      {
        storeId: payload.storeId,
        channelType: payload.channelType || "LINE",
        purpose: payload.purpose || "STAFF_GROUP",
        targetId: candidate.line_group_id,
        enabled: payload.enabled ?? true,
        notifyOrderReservation: payload.notifyOrderReservation ?? true,
        notifyRepairReservation: payload.notifyRepairReservation ?? true,
        notifyPurchaseConfirmation: payload.notifyPurchaseConfirmation ?? true,
        notifyRepairConfirmation: payload.notifyRepairConfirmation ?? true,
        notifyReplenishment: payload.notifyReplenishment ?? true,
        notifyTransfer: payload.notifyTransfer ?? true,
        notifyInbound: payload.notifyInbound ?? true,
        notifyDailyTasks: payload.notifyDailyTasks ?? true,
        notifyInternalMessages: payload.notifyInternalMessages ?? true
      },
      connection
    );

    await connection.query(
      `
        UPDATE line_group_candidates
        SET status = 'LINKED',
            linked_store_id = ?,
            linked_supplier_id = NULL,
            updated_at = NOW()
        WHERE id = ?
      `,
      [setting.storeId, candidate.id]
    );

    await connection.commit();
    return {
      ok: true,
      setting,
      candidate: normalizeCandidate({ ...candidate, status: "LINKED", linked_store_id: setting.storeId })
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function linkCandidateToSupplier(context, candidateId, payload = {}) {
  assertManagePermission(context);
  const supplierId = toPositiveInteger(payload.supplierId);
  if (!supplierId) {
    const error = new Error("請選擇供應商");
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const candidate = await fetchCandidateForUpdate(connection, candidateId);
    const setting = await upsertSupplierNotificationSetting(
      context,
      supplierId,
      {
        lineGroupId: candidate.line_group_id,
        enabled: payload.enabled ?? true,
        notifyPurchaseOrder: payload.notifyPurchaseOrder ?? true,
        notifyReturn: payload.notifyReturn ?? true,
        notifySettlement: payload.notifySettlement ?? false
      },
      connection
    );

    await connection.query(
      `
        UPDATE line_group_candidates
        SET status = 'LINKED',
            linked_store_id = ?,
            linked_supplier_id = ?,
            updated_at = NOW()
        WHERE id = ?
      `,
      [setting.storeId || context.storeId, setting.supplierId, candidate.id]
    );

    await connection.commit();
    return {
      ok: true,
      setting,
      candidate: normalizeCandidate({
        ...candidate,
        status: "LINKED",
        linked_store_id: setting.storeId || context.storeId,
        linked_supplier_id: setting.supplierId
      })
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  detectGroupTypeHint,
  getEventGroupId,
  ignoreCandidate,
  linkCandidateToStore,
  linkCandidateToSupplier,
  listCandidates,
  maskLineId,
  shouldCaptureGroupCandidate,
  upsertLineGroupCandidate
};
