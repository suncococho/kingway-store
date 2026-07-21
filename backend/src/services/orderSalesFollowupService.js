const { pool } = require("../db");
const { createError } = require("../utils/errors");

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
        handover_confirmed_at AS handoverConfirmedAt
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

  return mapFollowupRow(rows[0] || null);
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
        updated_by_staff_id
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN ? = 'COMPLETED'
          THEN NOW()
          ELSE NULL
        END,
        ?, ?
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
        updated_by_staff_id =
          VALUES(updated_by_staff_id)
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
      normalizedStaffId
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
  normalizeFollowupPayload,
  orderSalesFollowupTableExists,
  getOrderSalesFollowup,
  saveOrderSalesFollowup
};
