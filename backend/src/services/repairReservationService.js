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

async function applyRepairReservationDecision(
  repairId,
  approved,
  staffId = null,
  source = "web_admin",
  connection = pool,
  options = {}
) {
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
      INNER JOIN customers c ON c.id = ro.customer_id
      WHERE ro.id = ?
      LIMIT 1
    `,
    [repairId]
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
      `,
      [nextStatus, nextReservationStatus, approved ? 1 : 0, groupConfirmedBy, repairId]
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
      `,
      [approved ? 1 : 0, groupConfirmedBy, repairId]
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

async function notifyRepairCustomer(repairId, text) {
  const [rows] = await pool.query(
    `
      SELECT c.line_user_id AS lineUserId
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id
      WHERE ro.id = ?
      LIMIT 1
    `,
    [repairId]
  );

  if (rows[0]?.lineUserId && config.line.channelAccessToken) {
    await sendLineMessage(config, rows[0].lineUserId, [{ type: "text", text }]);
  }
}

module.exports = {
  applyRepairReservationDecision,
  isLineCustomerType,
  normalizeCustomerType,
  notifyRepairCustomer
};
