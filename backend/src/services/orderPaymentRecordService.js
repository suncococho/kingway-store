const { pool } = require("../db");
const { createError } = require("../utils/errors");
const { mapPaymentMethodLabel, normalizePaymentMethod } = require("../utils/paymentMethods");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const VALID_PAYMENT_STAGES = new Set(["DEPOSIT", "BALANCE", "FULL_PAYMENT", "ADJUSTMENT"]);
const TAIPEI_TZ = "Asia/Taipei";

dayjs.extend(utc);
dayjs.extend(timezone);

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeDate(value, fieldName = "reportDate") {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} 格式需為 YYYY-MM-DD`, 400);
  }
  return text;
}

function parseMoneyToCents(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw createError(`${fieldName} 為必填`, 400);
  }
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw createError(`${fieldName} 必須為 0 以上金額，最多兩位小數`, 400);
  }
  const [whole, decimal = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw createError(`${fieldName} 金額不正確`, 400);
  }
  return cents;
}

function centsToDecimal(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function normalizePaymentStage(value, fallback = "BALANCE") {
  const normalized = String(value || fallback).trim().toUpperCase();
  return VALID_PAYMENT_STAGES.has(normalized) ? normalized : fallback;
}

function normalizeTaipeiDateTime(value, fieldName = "實際付款完成日期") {
  const now = dayjs().tz(TAIPEI_TZ);
  const text = String(value || "").trim();
  if (!text) {
    return now.format("YYYY-MM-DD HH:mm:ss");
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    throw createError(`${fieldName} 格式不正確`, 400);
  }

  const [, yyyy, mm, dd, hh = "00", min = "00", ss = "00"] = match;
  const normalized = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  const parsed = dayjs.tz(normalized, TAIPEI_TZ);
  if (!parsed.isValid() || parsed.format("YYYY-MM-DD HH:mm:ss") !== normalized) {
    throw createError(`${fieldName} 不正確`, 400);
  }
  if (parsed.isAfter(now)) {
    throw createError(`${fieldName} 不可晚於現在`, 400);
  }
  return normalized;
}

function normalizePaymentCompletionPayload(payload = {}) {
  const paymentMethod = normalizePaymentMethod(payload.paymentMethod || payload.payment_method);
  if (!paymentMethod) {
    throw createError("請選擇付款方式", 400);
  }

  const receivedAmountCents = parseMoneyToCents(
    payload.receivedAmount ?? payload.received_amount ?? payload.amount,
    "實際收款金額"
  );

  return {
    paymentMethod,
    receivedAmount: centsToDecimal(receivedAmountCents),
    receivedAmountCents,
    note: String(payload.note || payload.paymentNote || "").trim().slice(0, 5000) || null,
    paymentStage: normalizePaymentStage(payload.paymentStage || payload.payment_stage),
    paymentCompletedAt: normalizeTaipeiDateTime(
      payload.paymentCompletedAt || payload.payment_completed_at || payload.finalPaymentCompletedAt || payload.final_payment_completed_at
    )
  };
}

async function getCompanyIdForStore(storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT company_id AS companyId
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
      ORDER BY FIELD(relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE') ASC, company_id ASC
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0]?.companyId || null;
}

async function createOrderPaymentRecord(connection, options = {}) {
  const storeId = toPositiveInteger(options.storeId);
  const orderId = toPositiveInteger(options.orderId);
  const staffUserId = toPositiveInteger(options.staffUserId);
  if (!storeId || !orderId || !staffUserId) {
    throw createError("缺少收款紀錄必要資料", 400);
  }

  const companyId = options.companyId ?? await getCompanyIdForStore(storeId, connection);
  const [result] = await connection.query(
    `
      INSERT INTO order_payment_records (
        company_id,
        store_id,
        order_id,
        payment_stage,
        payment_method,
        received_amount,
        note,
        received_by_staff_user_id,
        received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      companyId,
      storeId,
      orderId,
      normalizePaymentStage(options.paymentStage),
      options.paymentMethod,
      options.receivedAmount,
      options.note || null,
      staffUserId,
      options.receivedAt || options.paymentCompletedAt || null
    ]
  );

  return Number(result.insertId);
}

function normalizePaymentRecord(row = {}) {
  return {
    id: Number(row.id),
    orderId: Number(row.orderId ?? row.order_id),
    paymentStage: row.paymentStage || row.payment_stage,
    paymentMethod: row.paymentMethod || row.payment_method,
    paymentMethodLabel: mapPaymentMethodLabel(row.paymentMethod || row.payment_method),
    receivedAmount: String(row.receivedAmount ?? row.received_amount ?? "0.00"),
    note: row.note || "",
    receivedByStaffUserId: row.receivedByStaffUserId == null && row.received_by_staff_user_id == null
      ? null
      : Number(row.receivedByStaffUserId ?? row.received_by_staff_user_id),
    receivedByName: row.receivedByName || row.received_by_name || row.receivedByUsername || row.received_by_username || "",
    receivedAt: row.receivedAt || row.received_at || null
  };
}

async function getPaymentRecordsForOrder(orderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT r.id,
             r.order_id AS orderId,
             r.payment_stage AS paymentStage,
             r.payment_method AS paymentMethod,
             r.received_amount AS receivedAmount,
             r.note,
             r.received_by_staff_user_id AS receivedByStaffUserId,
             r.received_at AS receivedAt,
             staff.display_name AS receivedByName,
             staff.username AS receivedByUsername
      FROM order_payment_records r
      LEFT JOIN staff_users staff ON staff.id = r.received_by_staff_user_id
      WHERE r.order_id = ?
        AND r.store_id = ?
      ORDER BY r.received_at DESC, r.id DESC
    `,
    [orderId, storeId]
  );
  return rows.map(normalizePaymentRecord);
}

async function getCashReferenceForDate(context, filters = {}) {
  const reportDate = normalizeDate(filters.reportDate || filters.report_date);
  const requestedStoreId = toPositiveInteger(filters.storeId || filters.store_id, context.storeId);
  const storeId = requestedStoreId === context.storeId ||
    (context.canViewAllStores && context.accessibleStoreIds.includes(requestedStoreId))
    ? requestedStoreId
    : null;

  if (!storeId) {
    throw createError("無權限查看其他門市現金參考值", 403);
  }

  const [paymentRows] = await pool.query(
    `
      SELECT payment_stage AS paymentStage,
             COALESCE(SUM(received_amount), 0) AS amount
      FROM order_payment_records
      WHERE store_id = ?
        AND payment_method = 'CASH'
        AND received_at >= ?
        AND received_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY payment_stage
    `,
    [storeId, reportDate, reportDate]
  );

  const sums = paymentRows.reduce((map, row) => {
    map[row.paymentStage] = String(row.amount || "0.00");
    return map;
  }, {});

  const [receivableRows] = await pool.query(
    `
      SELECT COALESCE(SUM(unpaid_balance), 0) AS amount
      FROM orders
      WHERE store_id = ?
        AND business_date = ?
        AND deleted_at IS NULL
        AND COALESCE(unpaid_balance, 0) > 0
    `,
    [storeId, reportDate]
  );

  const orderCashAmount = Number(sums.BALANCE || 0) + Number(sums.ADJUSTMENT || 0);
  const reservationDepositCashAmount = Number(sums.DEPOSIT || 0);
  const sameDayFullCashAmount = Number(sums.FULL_PAYMENT || 0);
  const totalCashPaymentAmount = orderCashAmount + reservationDepositCashAmount + sameDayFullCashAmount;

  return {
    reportDate,
    storeId,
    orderCashAmount: orderCashAmount.toFixed(2),
    reservationDepositCashAmount: reservationDepositCashAmount.toFixed(2),
    sameDayFullCashAmount: sameDayFullCashAmount.toFixed(2),
    cashReceivableAmount: String(receivableRows[0]?.amount || "0.00"),
    totalCashPaymentAmount: totalCashPaymentAmount.toFixed(2)
  };
}

module.exports = {
  centsToDecimal,
  createOrderPaymentRecord,
  getCashReferenceForDate,
  getCompanyIdForStore,
  getPaymentRecordsForOrder,
  normalizeTaipeiDateTime,
  normalizePaymentCompletionPayload,
  normalizePaymentRecord
};
