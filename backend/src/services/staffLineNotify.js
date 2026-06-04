const { pool } = require("../db");
const config = require("../config");
const {
  getStoreLineSettings,
  resolveStoreLineCredentials
} = require("./storeLineSettingsService");

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const STAFF_GROUP_TYPES = ["repair", "daily", "admin", "staff"];

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

function normalizeStoreId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isStaffLineNotifySuppressed() {
  const nodeEnv = String(process.env.NODE_ENV || config.nodeEnv || "").trim().toLowerCase();
  const appEnv = String(process.env.APP_ENV || config.appEnv || "").trim().toLowerCase();
  const stagingMode = String(process.env.STAGING_MODE || "").trim().toLowerCase();
  const lineMockMode = parseBoolean(process.env.LINE_MOCK_MODE, false);
  const lineMessagingEnabled = parseBoolean(process.env.LINE_MESSAGING_ENABLED, true);
  const webhooksEnabled = parseBoolean(process.env.WEBHOOKS_ENABLED, true);

  return (
    nodeEnv === "staging" ||
    appEnv === "staging_restore" ||
    stagingMode === "true" ||
    lineMockMode ||
    !lineMessagingEnabled ||
    !webhooksEnabled
  );
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

async function resolveRepairStoreId(payload = {}, connection = pool) {
  const scopedStoreId = normalizeStoreId(payload.storeId);
  if (scopedStoreId) {
    return scopedStoreId;
  }

  const repairId = Number(payload.repairId || 0);
  if (!Number.isSafeInteger(repairId) || repairId <= 0) {
    return null;
  }

  const [rows] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM repair_orders
      WHERE id = ?
      LIMIT 1
    `,
    [repairId]
  );

  return normalizeStoreId(rows[0]?.storeId);
}

async function resolveStaffLineGroupTarget(connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT line_group_id AS lineGroupId, registration_type AS registrationType, group_name AS groupName
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN (?)
      ORDER BY FIELD(registration_type, 'repair', 'daily', 'admin', 'staff'), updated_at DESC, id DESC
      LIMIT 1
    `,
    [STAFF_GROUP_TYPES]
  );

  return rows[0] || null;
}

async function pushTextToLineGroup(lineGroupId, text, accessToken) {
  if (!accessToken) {
    return { delivered: 0, skipped: true, reason: "missing_line_channel_access_token" };
  }

  if (!lineGroupId) {
    return { delivered: 0, skipped: true, reason: "missing_line_group_id" };
  }

  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
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
    const storeId = await resolveRepairStoreId(payload);
    if (!storeId) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId: null
      });
      return { delivered: 0, skipped: true, reason: "missing_store_scope" };
    }

    if (isStaffLineNotifySuppressed()) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
      return { delivered: 0, skipped: true, reason: "environment_suppressed" };
    }

    const [storeSettings, credentials] = await Promise.all([
      getStoreLineSettings(storeId),
      resolveStoreLineCredentials({ storeId, purpose: "repair_staff_group_notify" })
    ]);

    if (!storeSettings.lineEnabled || !storeSettings.staffGroupEnabled || !credentials.credentialsResolved) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
      return { delivered: 0, skipped: true, reason: "store_line_settings_incomplete" };
    }

    const target = await resolveStaffLineGroupTarget();
    if (!target?.lineGroupId) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
      return { delivered: 0, skipped: true, reason: "no_active_line_group_registration" };
    }

    const result = await pushTextToLineGroup(
      target.lineGroupId,
      buildRepairReservationMessage({
        ...payload,
        storeId
      }),
      credentials.channelAccessToken
    );

    if (result.delivered > 0) {
      console.info("[staff-line] repair_notify_sent", {
        repairId: payload.repairId || null,
        storeId
      });
    } else {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
    }

    return {
      ...result,
      registrationType: target.registrationType,
      lineGroupId: maskLineGroupId(target.lineGroupId),
      storeId
    };
  } catch (error) {
    console.info("[staff-line] repair_notify_skipped", {
      repairId: payload.repairId || null,
      storeId: normalizeStoreId(payload.storeId)
    });
    return { delivered: 0, skipped: false, error: error.message };
  }
}

module.exports = {
  buildRepairReservationMessage,
  isStaffLineNotifySuppressed,
  notifyRepairReservationCreated,
  resolveStaffLineGroupTarget
};
