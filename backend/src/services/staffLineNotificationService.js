const { pool } = require("../db");

const TABLE_NAME = "staff_line_notifications";
const FINAL_SUCCESS_STATUSES = new Set(["ACTION_COMPLETED", "CUSTOMER_SENT"]);
const CUSTOMER_SEND_CLAIM_STATUSES = ["PENDING", "ACKNOWLEDGED", "ASSIGNED"];
let tableAvailability = null;

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildIdempotencyKey(eventType, storeId, relatedId, action) {
  return [
    normalizeText(eventType).toUpperCase(),
    toPositiveInteger(storeId) || 0,
    toPositiveInteger(relatedId) || 0,
    normalizeText(action).toUpperCase()
  ].join(":");
}

async function hasStaffLineNotificationTable(connection = pool) {
  if (tableAvailability !== null && connection === pool) {
    return tableAvailability;
  }

  try {
    const [rows] = await connection.query(
      `
        SELECT 1 AS existsFlag
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        LIMIT 1
      `,
      [TABLE_NAME]
    );
    const exists = Boolean(rows[0]);
    if (connection === pool) {
      tableAvailability = exists;
    }
    return exists;
  } catch (error) {
    throw error;
  }
}

async function requireStaffLineNotificationTable(connection = pool) {
  return hasStaffLineNotificationTable(connection);
}

function normalizeNotification(row = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    eventType: row.eventType,
    relatedType: row.relatedType,
    relatedId: Number(row.relatedId),
    status: row.status,
    assignedStaffId: row.assignedStaffId == null ? null : Number(row.assignedStaffId),
    assignedStaffName: row.assignedStaffName || null,
    acknowledgedBy: row.acknowledgedBy == null ? null : Number(row.acknowledgedBy),
    acknowledgedName: row.acknowledgedName || null,
    acknowledgedAt: row.acknowledgedAt || null,
    customerMessageSentAt: row.customerMessageSentAt || null,
    customerMessageSentBy: row.customerMessageSentBy == null ? null : Number(row.customerMessageSentBy),
    lineGroupRegistrationId: row.lineGroupRegistrationId == null ? null : Number(row.lineGroupRegistrationId),
    lineMessageId: row.lineMessageId || null,
    idempotencyKey: row.idempotencyKey,
    payloadJson: row.payloadJson || null,
    lastErrorCode: row.lastErrorCode || null,
    sendingStartedAt: row.sendingStartedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const selectColumns = `
  id,
  store_id AS storeId,
  event_type AS eventType,
  related_type AS relatedType,
  related_id AS relatedId,
  status,
  assigned_staff_id AS assignedStaffId,
  assigned_staff_name AS assignedStaffName,
  acknowledged_by AS acknowledgedBy,
  acknowledged_name AS acknowledgedName,
  acknowledged_at AS acknowledgedAt,
  customer_message_sent_at AS customerMessageSentAt,
  customer_message_sent_by AS customerMessageSentBy,
  line_group_registration_id AS lineGroupRegistrationId,
  line_message_id AS lineMessageId,
  idempotency_key AS idempotencyKey,
  payload_json AS payloadJson,
  last_error_code AS lastErrorCode,
  sending_started_at AS sendingStartedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

async function loadNotificationByKey(idempotencyKey, connection = pool, options = {}) {
  if (!(await hasStaffLineNotificationTable(connection))) {
    return null;
  }
  const storeId = toPositiveInteger(options.storeId);
  const storeClause = storeId ? "AND store_id = ?" : "";
  const params = storeId ? [idempotencyKey, storeId] : [idempotencyKey];
  const [rows] = await connection.query(
    `SELECT ${selectColumns} FROM ${TABLE_NAME} WHERE idempotency_key = ? ${storeClause} LIMIT 1`,
    params
  );
  return normalizeNotification(rows[0]);
}

async function loadNotificationById(id, connection = pool, options = {}) {
  const notificationId = toPositiveInteger(id);
  if (!notificationId || !(await hasStaffLineNotificationTable(connection))) {
    return null;
  }
  const storeId = toPositiveInteger(options.storeId);
  const storeClause = storeId ? "AND store_id = ?" : "";
  const params = storeId ? [notificationId, storeId] : [notificationId];
  const [rows] = await connection.query(
    `SELECT ${selectColumns} FROM ${TABLE_NAME} WHERE id = ? ${storeClause} LIMIT 1`,
    params
  );
  return normalizeNotification(rows[0]);
}

async function createStaffLineNotification(input = {}, connection = pool) {
  if (!(await hasStaffLineNotificationTable(connection))) {
    return { available: false, notification: null, duplicate: false, shouldSend: true };
  }

  const storeId = toPositiveInteger(input.storeId);
  const relatedId = toPositiveInteger(input.relatedId);
  const eventType = normalizeText(input.eventType).toUpperCase();
  const relatedType = normalizeText(input.relatedType).toUpperCase();
  const idempotencyKey = normalizeText(input.idempotencyKey)
    || buildIdempotencyKey(eventType, storeId, relatedId, input.action || "GROUP_NOTIFY");

  if (!storeId || !relatedId || !eventType || !relatedType || !idempotencyKey) {
    return { available: true, notification: null, duplicate: false, shouldSend: true };
  }

  const existing = await loadNotificationByKey(idempotencyKey, connection, { storeId });
  if (existing) {
    return {
      available: true,
      notification: existing,
      duplicate: true,
      shouldSend: existing.status === "FAILED"
    };
  }

  await connection.query(
    `
      INSERT INTO ${TABLE_NAME} (
        store_id,
        event_type,
        related_type,
        related_id,
        status,
        line_group_registration_id,
        idempotency_key,
        payload_json
      )
      VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `,
    [
      storeId,
      eventType,
      relatedType,
      relatedId,
      toPositiveInteger(input.lineGroupRegistrationId),
      idempotencyKey,
      input.payloadJson == null ? null : JSON.stringify(input.payloadJson)
    ]
  );

  return {
    available: true,
    notification: await loadNotificationByKey(idempotencyKey, connection, { storeId }),
    duplicate: false,
    shouldSend: true
  };
}

async function markStaffLineNotificationDelivery(notificationId, delivery = {}, connection = pool) {
  const id = toPositiveInteger(notificationId);
  if (!id || !(await hasStaffLineNotificationTable(connection))) {
    return null;
  }
  const delivered = Number(delivery.delivered || 0) > 0;
  await connection.query(
    `
      UPDATE ${TABLE_NAME}
      SET status = ?,
          line_group_registration_id = COALESCE(?, line_group_registration_id),
          line_message_id = COALESCE(?, line_message_id)
      WHERE id = ?
    `,
    [
      delivered ? "PENDING" : "FAILED",
      toPositiveInteger(delivery.lineGroupRegistrationId),
      normalizeText(delivery.lineMessageId) || null,
      id
    ]
  );
  return loadNotificationById(id, connection);
}

async function resolveStaffByLineUserId(lineUserId, connection = pool) {
  const normalizedLineUserId = normalizeText(lineUserId);
  if (!normalizedLineUserId) {
    return null;
  }
  const [rows] = await connection.query(
    `
      SELECT id, display_name AS name, store_id AS storeId, is_active AS isActive
      FROM staff_users
      WHERE line_user_id = ?
        AND is_active = 1
      LIMIT 1
    `,
    [normalizedLineUserId]
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    name: rows[0].name || `員工 #${rows[0].id}`,
    storeId: toPositiveInteger(rows[0].storeId),
    isActive: Number(rows[0].isActive) === 1
  };
}

async function recordStaffLineAction(input = {}, connection = pool) {
  if (!(await hasStaffLineNotificationTable(connection))) {
    return { available: false, notification: null, staff: null, changed: false };
  }

  const storeId = toPositiveInteger(input.storeId);
  const scopeOptions = storeId ? { storeId } : {};
  const notification = input.notificationId
    ? await loadNotificationById(input.notificationId, connection, scopeOptions)
    : await loadNotificationByKey(input.idempotencyKey, connection, scopeOptions);

  if (!notification) {
    return { available: true, notification: null, staff: null, changed: false };
  }

  const staff = await resolveStaffByLineUserId(input.lineUserId, connection);
  const staffId = toPositiveInteger(input.staffId) || staff?.id || null;
  const staffName = normalizeText(input.staffName) || staff?.name || "LINE 群組成員";
  const action = normalizeText(input.action).toUpperCase();

  if (action === "ACKNOWLEDGE") {
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = CASE
              WHEN status = 'PENDING' THEN 'ACKNOWLEDGED'
              ELSE status
            END,
            acknowledged_by = COALESCE(acknowledged_by, ?),
            acknowledged_name = COALESCE(acknowledged_name, ?),
            acknowledged_at = COALESCE(acknowledged_at, NOW())
        WHERE id = ?
      `,
      [staffId, staffName, notification.id]
    );
  } else if (action === "ASSIGN") {
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = CASE
              WHEN assigned_staff_id IS NULL THEN 'ASSIGNED'
              ELSE status
            END,
            assigned_staff_id = COALESCE(assigned_staff_id, ?),
            assigned_staff_name = COALESCE(assigned_staff_name, ?)
        WHERE id = ?
      `,
      [staffId, staffName, notification.id]
    );
  } else if (action === "ACTION_COMPLETED") {
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = CASE
              WHEN status IN ('CUSTOMER_SENT', 'CANCELED') THEN status
              ELSE 'ACTION_COMPLETED'
            END
        WHERE id = ?
      `,
      [notification.id]
    );
  } else if (action === "CUSTOMER_SENT") {
    const latest = await loadNotificationById(notification.id, connection);
    if (FINAL_SUCCESS_STATUSES.has(String(latest?.status || ""))) {
      return { available: true, notification: latest, staff, changed: false, alreadyProcessed: true };
    }
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = 'CUSTOMER_SENT',
            customer_message_sent_at = COALESCE(customer_message_sent_at, NOW()),
            customer_message_sent_by = COALESCE(customer_message_sent_by, ?),
            sending_started_at = NULL,
            last_error_code = NULL
        WHERE id = ?
      `,
      [staffId, notification.id]
    );
  }

  return {
    available: true,
    notification: await loadNotificationById(notification.id, connection),
    staff,
    changed: true
  };
}

async function claimCustomerLineSend(input = {}, connection = pool) {
  const storeId = toPositiveInteger(input.storeId);
  const notificationId = toPositiveInteger(input.notificationId);
  const idempotencyKey = normalizeText(input.idempotencyKey);
  if (!storeId || (!notificationId && !idempotencyKey)) {
    return { available: true, claimed: false, reason: "missing_notification_scope" };
  }
  if (!(await requireStaffLineNotificationTable(connection))) {
    return { available: false, claimed: false, reason: "missing_table" };
  }

  const notification = notificationId
    ? await loadNotificationById(notificationId, connection, { storeId })
    : await loadNotificationByKey(idempotencyKey, connection, { storeId });
  if (!notification) {
    return { available: true, claimed: false, reason: "notification_not_found" };
  }
  if (notification.status === "CUSTOMER_SENT") {
    return { available: true, claimed: false, alreadySent: true, notification };
  }
  if (notification.status === "SENDING") {
    return { available: true, claimed: false, inProgress: true, notification };
  }

  const [result] = await connection.query(
    `
      UPDATE ${TABLE_NAME}
      SET status = 'SENDING',
          sending_started_at = NOW(),
          last_error_code = NULL,
          updated_at = NOW()
      WHERE id = ?
        AND store_id = ?
        AND status IN (${CUSTOMER_SEND_CLAIM_STATUSES.map(() => "?").join(", ")})
    `,
    [notification.id, storeId, ...CUSTOMER_SEND_CLAIM_STATUSES]
  );

  if (result.affectedRows !== 1) {
    const latest = await loadNotificationById(notification.id, connection, { storeId });
    return {
      available: true,
      claimed: false,
      alreadySent: latest?.status === "CUSTOMER_SENT",
      inProgress: latest?.status === "SENDING",
      reason: "claim_conflict",
      notification: latest
    };
  }

  return {
    available: true,
    claimed: true,
    notification: await loadNotificationById(notification.id, connection, { storeId })
  };
}

async function finalizeCustomerLineSend(input = {}, connection = pool) {
  const storeId = toPositiveInteger(input.storeId);
  const notificationId = toPositiveInteger(input.notificationId);
  if (!storeId || !notificationId || !(await requireStaffLineNotificationTable(connection))) {
    return null;
  }

  if (input.success) {
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = 'CUSTOMER_SENT',
            customer_message_sent_at = COALESCE(customer_message_sent_at, NOW()),
            customer_message_sent_by = COALESCE(?, customer_message_sent_by),
            sending_started_at = NULL,
            last_error_code = NULL,
            updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
          AND status = 'SENDING'
      `,
      [toPositiveInteger(input.staffId), notificationId, storeId]
    );
  } else {
    const errorCode = normalizeText(input.errorCode).slice(0, 80) || "CUSTOMER_SEND_FAILED";
    await connection.query(
      `
        UPDATE ${TABLE_NAME}
        SET status = 'FAILED',
            sending_started_at = NULL,
            last_error_code = ?,
            payload_json = JSON_SET(COALESCE(payload_json, JSON_OBJECT()), '$.customerSendErrorCode', ?),
            updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
          AND status = 'SENDING'
      `,
      [errorCode, errorCode, notificationId, storeId]
    );
  }

  return loadNotificationById(notificationId, connection, { storeId });
}

module.exports = {
  buildIdempotencyKey,
  claimCustomerLineSend,
  createStaffLineNotification,
  finalizeCustomerLineSend,
  hasStaffLineNotificationTable,
  loadNotificationById,
  loadNotificationByKey,
  markStaffLineNotificationDelivery,
  recordStaffLineAction,
  requireStaffLineNotificationTable,
  resolveStaffByLineUserId
};
