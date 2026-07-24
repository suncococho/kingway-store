const { pool } = require("../db");
const { createError } = require("../utils/errors");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
const TAIPEI_TZ = "Asia/Taipei";
const ATTEMPT_STORAGE_TIMEZONE = "UTC";
const MAX_ATTEMPT_BACKDATE_HOURS = 72;
const MIN_NO_RESPONSE_INTERVAL_HOURS = 6;

const STATUS_VALUES = new Set([
  "PENDING",
  "COMPLETED",
  "CANCELED"
]);

const CONTACT_METHOD_VALUES = new Set([
  "LINE",
  "PHONE",
  "IN_PERSON",
  "OTHER"
]);

const CUSTOMER_RESULT_VALUES = new Set([
  "NO_ISSUE",
  "ISSUE_RESOLVED",
  "ISSUE_UNRESOLVED",
  "NO_RESPONSE",
  "OTHER"
]);

let tableExistsCache = null;

function normalizePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEnum(value, allowed, label, {
  nullable = false
} = {}) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    if (nullable) return null;
    throw createError(`${label}為必填`, 400);
  }

  const normalized = normalizeText(value).toUpperCase();

  if (!allowed.has(normalized)) {
    throw createError(`${label}不正確`, 400);
  }

  return normalized;
}

function normalizeBoolean(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  );
}

async function orderSalesFollowupTableExists(
  connection = pool
) {
  if (tableExistsCache === true) {
    return true;
  }

  const [rows] = await connection.query(
    `
      SELECT 1 AS existsFlag
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'order_sales_followups'
      LIMIT 1
    `
  );

  if (rows[0]) {
    tableExistsCache = true;
    return true;
  }

  return false;
}

async function assertTableExists(connection = pool) {
  if (
    !(await orderSalesFollowupTableExists(connection))
  ) {
    throw createError(
      "售後追蹤資料表尚未建立，請先執行 staging migration。",
      503
    );
  }
}

function mapFollowupRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    orderId: Number(row.orderId),
    status: row.status,
    contactMethod: row.contactMethod || null,
    customerResult: row.customerResult || null,
    employeeCausedIssue:
      normalizeBoolean(row.employeeCausedIssue),
    unresolvedEmployeeIssue:
      normalizeBoolean(row.unresolvedEmployeeIssue),
    note: row.note || "",
    completedByStaffId:
      row.completedByStaffId
        ? Number(row.completedByStaffId)
        : null,
    completedByStaffName:
      row.completedByStaffName || "",
    completedAt: row.completedAt || null,
    noResponseApprovedBy: row.noResponseApprovedBy ? Number(row.noResponseApprovedBy) : null,
    noResponseApprovedAt: row.noResponseApprovedAt || null,
    noResponseApprovalReason: row.noResponseApprovalReason || null,
    attempts: [] ,
    createdByStaffId:
      row.createdByStaffId
        ? Number(row.createdByStaffId)
        : null,
    updatedByStaffId:
      row.updatedByStaffId
        ? Number(row.updatedByStaffId)
        : null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function assertOrderExists(
  orderId,
  storeId,
  connection = pool
) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        handover_confirmed_at AS handoverConfirmedAt,
        sales_staff_id AS salesStaffId,
        sales_support_staff_id AS salesSupportStaffId
      FROM orders
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [orderId, storeId]
  );

  const order = rows[0] || null;

  if (!order) {
    throw createError("找不到訂單", 404);
  }

  return order;
}

async function resolveAttemptActor(connection, storeId, staffUserId, order) {
  const [rows] = await connection.query(`SELECT id, role FROM staff_users WHERE id = ? AND store_id = ? AND is_active = 1 LIMIT 1`, [staffUserId, storeId]);
  const actor = rows[0];
  if (!actor) throw createError("無權限新增此門市的聯絡紀錄", 403);
  const role = String(actor.role || "").toUpperCase();
  const assigned = [order.salesStaffId, order.salesSupportStaffId].some((id) => Number(id) === staffUserId);
  if (!assigned && !["ADMIN", "MANAGER"].includes(role)) throw createError("僅銷售負責人或獲授權的門市管理人員可新增聯絡紀錄", 403);
  return { id: Number(actor.id), role };
}

function normalizeClientRequestId(value) {
  const requestId = normalizeText(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw createError("clientRequestId 必須為 UUID", 400);
  return requestId.toLowerCase();
}

function normalizeAttemptedAt(value, handoverConfirmedAt, now = dayjs()) {
  const text = String(value || "").trim();
  const parsed = !text ? now : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? dayjs.tz(text, TAIPEI_TZ) : dayjs(text);
  if (!parsed.isValid()) throw createError("聯絡時間不正確", 400);
  if (parsed.isAfter(now)) throw createError("聯絡時間不可晚於現在", 400);
  if (parsed.isBefore(now.subtract(MAX_ATTEMPT_BACKDATE_HOURS, "hour"))) throw createError(`聯絡時間不可回填超過 ${MAX_ATTEMPT_BACKDATE_HOURS} 小時`, 400);
  const handover = dayjs.utc(handoverConfirmedAt);
  if (!handover.isValid() || parsed.utc().isBefore(handover)) throw createError("聯絡時間不可早於交車完成時間", 400);
  return parsed.utc().format("YYYY-MM-DD HH:mm:ss");
}

async function getOrderSalesFollowup(
  orderId,
  storeId,
  connection = pool
) {
  await assertTableExists(connection);

  const normalizedOrderId =
    normalizePositiveId(orderId);
  const normalizedStoreId =
    normalizePositiveId(storeId);

  if (!normalizedOrderId || !normalizedStoreId) {
    throw createError("找不到訂單", 404);
  }

  await assertOrderExists(
    normalizedOrderId,
    normalizedStoreId,
    connection
  );

  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        order_id AS orderId,
        status,
        contact_method AS contactMethod,
        customer_result AS customerResult,
        employee_caused_issue AS employeeCausedIssue,
        unresolved_employee_issue
          AS unresolvedEmployeeIssue,
        note,
        completed_by_staff_id AS completedByStaffId,
        completed_by_staff_name AS completedByStaffName,
        completed_at AS completedAt,
        no_response_approved_by AS noResponseApprovedBy,
        no_response_approved_at AS noResponseApprovedAt,
        no_response_approval_reason AS noResponseApprovalReason,
        created_by_staff_id AS createdByStaffId,
        updated_by_staff_id AS updatedByStaffId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM order_sales_followups
      WHERE order_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [normalizedOrderId, normalizedStoreId]
  );

  const followup = mapFollowupRow(rows[0] || null);
  if (!followup) return null;
  const [attemptRows] = await connection.query(
    `SELECT id, client_request_id AS clientRequestId, staff_user_id AS staffUserId, attempted_at AS attemptedAt, contact_method AS contactMethod, result, note, created_at AS createdAt FROM order_sales_followup_attempts WHERE store_id = ? AND order_id = ? ORDER BY attempted_at ASC, id ASC`,
    [normalizedStoreId, normalizedOrderId]
  );
  followup.attempts = attemptRows.map((row) => ({ ...row, id: Number(row.id), staffUserId: Number(row.staffUserId) }));
  return followup;
}

function normalizeFollowupPayload(
  payload = {},
  staffUserId,
  staffUserName
) {
  const status = normalizeEnum(
    payload.status || "PENDING",
    STATUS_VALUES,
    "售後追蹤狀態"
  );

  let contactMethod = normalizeEnum(
    payload.contactMethod,
    CONTACT_METHOD_VALUES,
    "聯絡方式",
    { nullable: status !== "COMPLETED" }
  );

  let customerResult = normalizeEnum(
    payload.customerResult,
    CUSTOMER_RESULT_VALUES,
    "客戶結果",
    { nullable: status !== "COMPLETED" }
  );

  let employeeCausedIssue =
    normalizeBoolean(payload.employeeCausedIssue);

  let unresolvedEmployeeIssue =
    normalizeBoolean(
      payload.unresolvedEmployeeIssue
    );

  if (status === "COMPLETED" && !staffUserId) {
    throw createError("無法確認完成員工", 400);
  }

  if (customerResult === "NO_ISSUE") {
    employeeCausedIssue = false;
    unresolvedEmployeeIssue = false;
  } else if (
    customerResult === "ISSUE_RESOLVED"
  ) {
    unresolvedEmployeeIssue = false;
  } else if (
    unresolvedEmployeeIssue &&
    !employeeCausedIssue
  ) {
    throw createError(
      "只有員工造成的問題才能標記為尚未解決",
      400
    );
  }

  if (!employeeCausedIssue) {
    unresolvedEmployeeIssue = false;
  }

  if (status !== "COMPLETED") {
    contactMethod =
      contactMethod || null;
    customerResult =
      customerResult || null;
  }

  return {
    status,
    contactMethod,
    customerResult,
    employeeCausedIssue,
    unresolvedEmployeeIssue,
    note: normalizeText(payload.note),
    completedByStaffId:
      status === "COMPLETED"
        ? normalizePositiveId(staffUserId)
        : null,
    completedByStaffName:
      status === "COMPLETED"
        ? normalizeText(staffUserName)
        : null
  };
}

async function addOrderSalesFollowupAttempt(orderId, storeId, payload, staffUserId, connection = pool) {
  await assertTableExists(connection);
  const normalizedOrderId = normalizePositiveId(orderId);
  const normalizedStoreId = normalizePositiveId(storeId);
  const normalizedStaffId = normalizePositiveId(staffUserId);
  const order = await assertOrderExists(normalizedOrderId, normalizedStoreId, connection);
  await resolveAttemptActor(connection, normalizedStoreId, normalizedStaffId, order);
  const method = normalizeEnum(payload.contactMethod, CONTACT_METHOD_VALUES, "聯絡方式");
  const result = normalizeEnum(payload.result, CUSTOMER_RESULT_VALUES, "聯絡結果");
  const attemptedAt = normalizeAttemptedAt(payload.attemptedAt, order.handoverConfirmedAt);
  const clientRequestId = normalizeClientRequestId(payload.clientRequestId);
  await connection.query(`SELECT id FROM order_sales_followups WHERE store_id = ? AND order_id = ? FOR UPDATE`, [normalizedStoreId, normalizedOrderId]);
  await connection.query(
    `INSERT INTO order_sales_followup_attempts (order_id, store_id, staff_user_id, client_request_id, attempted_at, contact_method, result, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [normalizedOrderId, normalizedStoreId, normalizedStaffId, clientRequestId, attemptedAt, method, result, normalizeText(payload.note) || null]
  );
  return getOrderSalesFollowup(normalizedOrderId, normalizedStoreId, connection);
}

async function saveOrderSalesFollowup(
  orderId,
  storeId,
  payload,
  staffUserId,
  staffUserName,
  connection = pool
) {
  await assertTableExists(connection);

  const normalizedOrderId =
    normalizePositiveId(orderId);
  const normalizedStoreId =
    normalizePositiveId(storeId);
  const normalizedStaffId =
    normalizePositiveId(staffUserId);

  if (!normalizedOrderId || !normalizedStoreId) {
    throw createError("找不到訂單", 404);
  }

  const order = await assertOrderExists(
    normalizedOrderId,
    normalizedStoreId,
    connection
  );

  const normalized =
    normalizeFollowupPayload(
      payload,
      normalizedStaffId,
      staffUserName
    );


  const [actorRows] = await connection.query(`SELECT id, role FROM staff_users WHERE id = ? AND store_id = ? AND is_active = 1 LIMIT 1`, [normalizedStaffId, normalizedStoreId]);
  const actor = actorRows[0];
  if (!actor) throw createError("無權限更新此門市的售後追蹤", 403);
  await connection.query(`SELECT id FROM order_sales_followups WHERE store_id = ? AND order_id = ? FOR UPDATE`, [normalizedStoreId, normalizedOrderId]);

  if (normalized.status === "COMPLETED" && normalized.customerResult === "NO_RESPONSE") {
    const [attemptRows] = await connection.query(
      `SELECT id, attempted_at AS attemptedAt FROM order_sales_followup_attempts WHERE store_id = ? AND order_id = ? AND result = 'NO_RESPONSE' ORDER BY attempted_at ASC, id ASC FOR UPDATE`,
      [normalizedStoreId, normalizedOrderId]
    );
    const hasValidInterval = attemptRows.some((row, index) => index > 0 && dayjs.utc(row.attemptedAt).diff(dayjs.utc(attemptRows[index - 1].attemptedAt), "hour", true) >= MIN_NO_RESPONSE_INTERVAL_HOURS);
    const isAdmin = String(actor.role || "").toUpperCase() === "ADMIN";
    const reason = normalizeText(payload.noResponseApprovalReason);
    if (attemptRows.length < 2 || !hasValidInterval) throw createError("客戶未回覆至少需要兩次且間隔六小時以上的有效聯絡紀錄。", 409);
    if (!isAdmin || !reason) throw createError("客戶未回覆須由管理員填寫原因後核准。", 403);
    normalized.noResponseApprovedBy = normalizedStaffId;
    normalized.noResponseApprovalReason = reason;
  }

  if (
    normalized.status === "COMPLETED" &&
    !order.handoverConfirmedAt
  ) {
    throw createError(
      "請先完成交車，再完成售後追蹤。",
      409
    );
  }

  await connection.query(
    `
      INSERT INTO order_sales_followups (
        store_id,
        order_id,
        status,
        contact_method,
        customer_result,
        employee_caused_issue,
        unresolved_employee_issue,
        note,
        completed_by_staff_id,
        completed_by_staff_name,
        completed_at,
        created_by_staff_id,
        updated_by_staff_id,
        no_response_approved_by,
        no_response_approved_at,
        no_response_approval_reason
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN ? = 'COMPLETED'
          THEN NOW()
          ELSE NULL
        END,
        ?, ?, ?, CASE WHEN ? IS NOT NULL THEN NOW() ELSE NULL END, ?
      )
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        contact_method = VALUES(contact_method),
        customer_result = VALUES(customer_result),
        employee_caused_issue =
          VALUES(employee_caused_issue),
        unresolved_employee_issue =
          VALUES(unresolved_employee_issue),
        note = VALUES(note),
        completed_by_staff_id =
          VALUES(completed_by_staff_id),
        completed_by_staff_name =
          VALUES(completed_by_staff_name),
        completed_at =
          CASE
            WHEN VALUES(status) = 'COMPLETED'
              THEN COALESCE(
                completed_at,
                NOW()
              )
            ELSE NULL
          END,
        updated_by_staff_id = VALUES(updated_by_staff_id),
        no_response_approved_by = COALESCE(VALUES(no_response_approved_by), no_response_approved_by),
        no_response_approved_at = COALESCE(VALUES(no_response_approved_at), no_response_approved_at),
        no_response_approval_reason = COALESCE(VALUES(no_response_approval_reason), no_response_approval_reason)
    `,
    [
      normalizedStoreId,
      normalizedOrderId,
      normalized.status,
      normalized.contactMethod,
      normalized.customerResult,
      normalized.employeeCausedIssue ? 1 : 0,
      normalized.unresolvedEmployeeIssue ? 1 : 0,
      normalized.note || null,
      normalized.completedByStaffId,
      normalized.completedByStaffName,
      normalized.status,
      normalizedStaffId,
      normalizedStaffId,
      normalized.noResponseApprovedBy || null,
      normalized.noResponseApprovedBy || null,
      normalized.noResponseApprovalReason || null
    ]
  );

  return getOrderSalesFollowup(
    normalizedOrderId,
    normalizedStoreId,
    connection
  );
}

module.exports = {
  STATUS_VALUES,
  CONTACT_METHOD_VALUES,
  CUSTOMER_RESULT_VALUES,
  TAIPEI_TZ,
  ATTEMPT_STORAGE_TIMEZONE,
  MAX_ATTEMPT_BACKDATE_HOURS,
  MIN_NO_RESPONSE_INTERVAL_HOURS,
  normalizeAttemptedAt,
  normalizeFollowupPayload,
  orderSalesFollowupTableExists,
  getOrderSalesFollowup,
  saveOrderSalesFollowup,
  addOrderSalesFollowupAttempt
};
