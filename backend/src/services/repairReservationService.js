const config = require("../config");
const { pool } = require("../db");
const { sendLineMessage } = require("../utils/line");

function normalizeCustomerType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OFFLINE_WITH_PHONE" || normalized === "OFFLINE_NO_PHONE") {
    return normalized;
  }
  if (normalized === "OFFLINE") {
    return "OFFLINE_WITH_PHONE";
  }
  return "LINE";
}

function isLineCustomerType(value) {
  return normalizeCustomerType(value) === "LINE";
}

function normalizeStoreId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function buildGroupConfirmedBy(source, staffId, actorLabel) {
  if (actorLabel) {
    return actorLabel;
  }
  if (staffId) {
    return source === "telegram_callback" ? `Telegram staff#${staffId}` : `staff#${staffId}`;
  }
  if (source === "telegram_callback") {
    return "Telegram";
  }
  if (source === "line_postback") {
    return "LINE 群組";
  }
  if (source === "web_admin") {
    return "後台";
  }
  return source || "系統";
}

function requireScopedStoreId(value, label = "store scope") {
  const scopedStoreId = normalizeStoreId(value);
  if (!scopedStoreId) {
    throw new Error(`Missing ${label}`);
  }
  return scopedStoreId;
}

async function applyRepairReservationDecision(
  repairId,
  approved,
  staffId = null,
  source = "web_admin",
  connection = pool,
  options = {}
) {
  const scopedStoreId = normalizeStoreId(options.storeId);
  const [rows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.status,
        ro.reservation_status AS reservationStatus,
        ro.group_confirmed AS groupConfirmed,
        ro.group_confirmed_at AS groupConfirmedAt,
        ro.group_confirmed_by AS groupConfirmedBy,
        COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType,
        c.line_user_id AS lineUserId
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND (? IS NULL OR c.store_id = ?)
      WHERE ro.id = ?
        AND (? IS NULL OR ro.store_id = ?)
      LIMIT 1
    `,
    [scopedStoreId, scopedStoreId, repairId, scopedStoreId, scopedStoreId]
  );

  if (!rows[0]) {
    return null;
  }

  const nextReservationStatus = approved ? "approved" : "rejected";
  const nextStatus = approved ? "reserved" : "canceled";
  const expectedGroupConfirmed = approved ? 1 : 0;
  const groupConfirmedBy = buildGroupConfirmedBy(source, staffId, options.actorLabel || null);
  const sameDecision =
    rows[0].reservationStatus === nextReservationStatus &&
    rows[0].status === nextStatus;
  const needsGroupSync =
    Number(rows[0].groupConfirmed || 0) !== expectedGroupConfirmed ||
    !rows[0].groupConfirmedAt ||
    !rows[0].groupConfirmedBy;
  const alreadyProcessed = sameDecision;

  if (!sameDecision) {
    await connection.query(
      `
        UPDATE repair_orders
        SET status = ?,
            reservation_status = ?,
            group_confirmed = ?,
            group_confirmed_at = NOW(),
            group_confirmed_by = ?
        WHERE id = ?
          AND (? IS NULL OR store_id = ?)
      `,
      [nextStatus, nextReservationStatus, approved ? 1 : 0, groupConfirmedBy, repairId, scopedStoreId, scopedStoreId]
    );

    await connection.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, ?, ?)
      `,
      [
        repairId,
        approved ? "reserved" : "canceled",
        source === "telegram_callback"
          ? approved ? "Telegram 群組已核准維修預約" : "Telegram 群組已拒絕維修預約"
          : source === "line_postback"
            ? approved ? "內部群組已核准維修預約" : "內部群組已拒絕維修預約"
            : approved ? "後台已確認維修預約" : "後台已拒絕維修預約"
      ]
    );
  } else if (needsGroupSync) {
    await connection.query(
      `
        UPDATE repair_orders
        SET group_confirmed = ?,
            group_confirmed_at = COALESCE(group_confirmed_at, NOW()),
            group_confirmed_by = COALESCE(group_confirmed_by, ?)
        WHERE id = ?
          AND (? IS NULL OR store_id = ?)
      `,
      [approved ? 1 : 0, groupConfirmedBy, repairId, scopedStoreId, scopedStoreId]
    );
  }

  if (typeof options.logWorkflowEvent === "function") {
    await options.logWorkflowEvent(
      "repair_reservation_staff_response",
      "REPAIR_ORDER",
      repairId,
      {
        approved,
        source,
        alreadyProcessed,
        actorLabel: groupConfirmedBy,
        telegramUser: options.telegramUser || null
      },
      staffId,
      connection
    );
  }

  return {
    id: repairId,
    approved,
    alreadyProcessed,
    customerType: normalizeCustomerType(rows[0].customerType),
    lineUserId: rows[0].lineUserId || null,
    groupConfirmedBy,
    customerMessage: approved
      ? "您的維修預約已確認，請依預約時間到店。"
      : "您的維修預約未通過，請聯繫門市重新安排。"
  };
}

async function notifyRepairCustomer(repairId, text, storeId) {
  let scopedStoreId = normalizeStoreId(storeId);
  if (!scopedStoreId) {
    const [repairRows] = await pool.query(
      `
        SELECT store_id AS storeId
        FROM repair_orders
        WHERE id = ?
        LIMIT 1
      `,
      [repairId]
    );
    scopedStoreId = requireScopedStoreId(repairRows[0]?.storeId, "repair customer notification store scope");
  }
  const [rows] = await pool.query(
    `
      SELECT c.line_user_id AS lineUserId
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
      LIMIT 1
    `,
    [repairId, scopedStoreId]
  );

  if (rows[0]?.lineUserId) {
    await sendLineMessage(config, rows[0].lineUserId, [{ type: "text", text }]);
  }
}

function buildRepairLineNotifyFailureNote(error, options = {}) {
  const lineApiStatus = error?.lineApiStatus || error?.status || null;
  const safeDetails = error?.safeDetails || null;
  const message = error?.message || "LINE_PUSH_FAILED";
  const isQuotaOrRateLimit =
    Number(lineApiStatus) === 429 ||
    /quota|rate limit|too many requests|429/i.test(`${message} ${safeDetails || ""}`);

  return JSON.stringify({
    error: message,
    lineApiStatus,
    safeDetails,
    quotaOrRateLimit: isQuotaOrRateLimit,
    context: options.context || options.source || null,
    source: options.source || null,
    lineUserStatus: options.lineUserId ? "HAS_LINE_USER" : "NO_LINE_USER"
  });
}

async function logRepairLineNotifyFailure(repairId, action, error, options = {}, connection = pool) {
  await connection.query(
    `
      INSERT INTO repair_logs (repair_order_id, action, note)
      VALUES (?, ?, ?)
    `,
    [
      repairId,
      action,
      buildRepairLineNotifyFailureNote(error, options)
    ]
  );
}

async function notifyRepairCustomerSafely(repairId, text, options = {}) {
  try {
    await notifyRepairCustomer(repairId, text, options.storeId);
    return { ok: true };
  } catch (error) {
    try {
      await logRepairLineNotifyFailure(
        repairId,
        options.failureAction || "repair_customer_notify_failed",
        error,
        {
          source: options.source || null,
          context: options.context || null,
          lineUserId: options.lineUserId || null
        },
        options.connection || pool
      );
    } catch (notifyLogError) {
      console.warn("[repair-notify] log customer notification failure failed", {
        repairId,
        message: notifyLogError.message
      });
    }
    return {
      ok: false,
      warning: options.warning || "LINE 客戶通知發送失敗，請手動聯繫顧客。",
      error
    };
  }
}

module.exports = {
  applyRepairReservationDecision,
  buildRepairLineNotifyFailureNote,
  isLineCustomerType,
  logRepairLineNotifyFailure,
  normalizeCustomerType,
  notifyRepairCustomer,
  notifyRepairCustomerSafely
};
