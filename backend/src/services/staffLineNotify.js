const { pool } = require("../db");
const config = require("../config");

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const STAFF_GROUP_TYPES = ["repair", "admin", "staff", "daily"];

function maskLineGroupId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function formatValue(value, fallback = "-") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildRepairReservationMessage(payload = {}) {
  const reservationDateTime = [
    formatValue(payload.reservationDate),
    formatValue(payload.reservationTime, "")
  ].filter(Boolean).join(" ");

  const repairContent = [payload.bikeModel, payload.issueDescription]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" / ");

  return [
    "🔧 維修預約接收",
    `工單：#${formatValue(payload.repairId)}`,
    `客戶：${formatValue(payload.customerName)}`,
    `電話：${formatValue(payload.customerPhone)}`,
    `預約：${reservationDateTime || "-"}`,
    `內容：${formatValue(repairContent)}`,
    payload.storeName ? `門市：${formatValue(payload.storeName)}` : `store_id：${formatValue(payload.storeId)}`,
    payload.adminUrl ? `管理連結：${payload.adminUrl}` : null
  ].filter(Boolean).join("\\n");
}

async function resolveStaffLineGroupTarget(connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT line_group_id AS lineGroupId, registration_type AS registrationType, group_name AS groupName
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN (?)
      ORDER BY FIELD(registration_type, 'repair', 'admin', 'staff', 'daily'), updated_at DESC, id DESC
      LIMIT 1
    `,
    [STAFF_GROUP_TYPES]
  );

  return rows[0] || null;
}

async function pushTextToLineGroup(lineGroupId, text) {
  if (!config.line.channelAccessToken) {
    return { delivered: 0, skipped: true, reason: "missing_line_channel_access_token" };
  }

  if (!lineGroupId) {
    return { delivered: 0, skipped: true, reason: "missing_line_group_id" };
  }

  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.line.channelAccessToken}`
    },
    body: JSON.stringify({
      to: lineGroupId,
      messages: [{ type: "text", text }]
    })
  });

  if (!response.ok) {
    return { delivered: 0, skipped: false, error: `LINE API ${response.status}` };
  }

  return { delivered: 1, skipped: false };
}

async function notifyRepairReservationCreated(payload = {}) {
  try {
    const target = await resolveStaffLineGroupTarget();
    if (!target?.lineGroupId) {
      console.warn("[staff-line] repair reservation skipped: no active LINE group registration");
      return { delivered: 0, skipped: true, reason: "no_active_line_group_registration" };
    }

    const result = await pushTextToLineGroup(target.lineGroupId, buildRepairReservationMessage(payload));
    if (result.delivered === 0 && !result.skipped) {
      console.warn("[staff-line] repair reservation delivery failed", {
        registrationType: target.registrationType,
        groupName: target.groupName || null,
        lineGroupId: maskLineGroupId(target.lineGroupId),
        error: result.error || null
      });
    }
    return {
      ...result,
      registrationType: target.registrationType,
      lineGroupId: maskLineGroupId(target.lineGroupId)
    };
  } catch (error) {
    console.warn("[staff-line] repair reservation delivery isolated failure", {
      message: error.message
    });
    return { delivered: 0, skipped: false, error: error.message };
  }
}

module.exports = {
  buildRepairReservationMessage,
  notifyRepairReservationCreated,
  resolveStaffLineGroupTarget
};
