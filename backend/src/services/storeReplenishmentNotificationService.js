const config = require("../config");
const { pool } = require("../db");
const { sendLineMessage } = require("../utils/line");

const HQ_NOTIFY_ROLES = ["company_owner", "hq_admin", "inventory_manager"];

function formatValue(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildRequestMessage(payload = {}) {
  return [
    "門市請貨通知",
    `門市：${formatValue(payload.storeName || payload.storeCode)}`,
    `申請單：${formatValue(payload.requestNo)}`,
    `品項：${formatValue(payload.itemCount, "0")}`,
    `備註：${formatValue(payload.note)}`,
    "請至 POS 本部請貨管理查看。"
  ].join("\n");
}

function parseBoolean(value, fallback = false) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  return ["1", "true", "yes", "on"].includes(text);
}

function isNotificationSuppressed() {
  const nodeEnv = String(process.env.NODE_ENV || config.nodeEnv || "").trim().toLowerCase();
  const appEnv = String(process.env.APP_ENV || config.appEnv || "").trim().toLowerCase();
  const stagingMode = String(process.env.STAGING_MODE || "").trim().toLowerCase();
  return (
    nodeEnv === "staging" ||
    appEnv === "staging_restore" ||
    stagingMode === "true" ||
    parseBoolean(process.env.LINE_MOCK_MODE, false) ||
    !parseBoolean(process.env.LINE_MESSAGING_ENABLED, true) ||
    !parseBoolean(process.env.WEBHOOKS_ENABLED, true)
  );
}

async function loadDirectRecipients(companyId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT u.id, u.line_user_id AS lineUserId
      FROM company_memberships cm
      INNER JOIN staff_users u ON u.id = cm.staff_user_id
      WHERE cm.company_id = ?
        AND cm.status = 'ACTIVE'
        AND cm.role IN (?)
        AND u.is_active = 1
        AND u.line_user_id IS NOT NULL
        AND u.line_user_id <> ''
      ORDER BY FIELD(cm.role, 'company_owner', 'hq_admin', 'inventory_manager'), u.id ASC
    `,
    [companyId, HQ_NOTIFY_ROLES]
  );
  return rows;
}

async function loadFallbackGroup(connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT line_group_id AS lineGroupId, registration_type AS registrationType
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN ('inventory', 'admin', 'staff')
      ORDER BY FIELD(registration_type, 'inventory', 'admin', 'staff'), updated_at DESC, id DESC
      LIMIT 1
    `
  );
  return rows[0] || null;
}

async function notifyStoreReplenishmentSubmitted(payload = {}) {
  const companyId = Number(payload.companyId || 0);
  const requestId = Number(payload.requestId || 0);
  const requestNo = String(payload.requestNo || "").trim();
  const message = buildRequestMessage(payload);

  if (!companyId || !requestId) {
    console.info("[store-replenishment] notify_skipped", {
      requestId: requestId || null,
      requestNo: requestNo || null,
      reason: "missing_request_context"
    });
    return { delivered: 0, skipped: true, reason: "missing_request_context" };
  }

  if (isNotificationSuppressed()) {
    console.info("[store-replenishment] notify_skipped", {
      requestId,
      requestNo,
      reason: "environment_suppressed"
    });
    return { delivered: 0, skipped: true, reason: "environment_suppressed" };
  }

  if (!config.line.channelAccessToken) {
    console.info("[store-replenishment] notify_skipped", {
      requestId,
      requestNo,
      reason: "missing_line_channel_access_token"
    });
    return { delivered: 0, skipped: true, reason: "missing_line_channel_access_token" };
  }

  try {
    const recipients = await loadDirectRecipients(companyId);
    let delivered = 0;

    for (const recipient of recipients) {
      try {
        await sendLineMessage(config, recipient.lineUserId, [{ type: "text", text: message }]);
        delivered += 1;
      } catch (error) {
        console.info("[store-replenishment] direct_notify_failed", {
          requestId,
          requestNo,
          staffUserId: Number(recipient.id),
          error: error.message
        });
      }
    }

    if (delivered > 0) {
      console.info("[store-replenishment] notify_sent", {
        requestId,
        requestNo,
        delivered,
        channel: "staff_direct"
      });
      return { delivered, skipped: false, channel: "staff_direct" };
    }

    const fallbackGroup = await loadFallbackGroup();
    if (!fallbackGroup?.lineGroupId) {
      console.info("[store-replenishment] notify_skipped", {
        requestId,
        requestNo,
        reason: "no_staff_line_recipients"
      });
      return { delivered: 0, skipped: true, reason: "no_staff_line_recipients" };
    }

    await sendLineMessage(config, fallbackGroup.lineGroupId, [{ type: "text", text: message }]);
    console.info("[store-replenishment] notify_sent", {
      requestId,
      requestNo,
      delivered: 1,
      channel: "line_group",
      registrationType: fallbackGroup.registrationType || null
    });
    return { delivered: 1, skipped: false, channel: "line_group" };
  } catch (error) {
    console.info("[store-replenishment] notify_failed", {
      requestId,
      requestNo,
      error: error.message
    });
    return { delivered: 0, skipped: false, error: error.message };
  }
}

module.exports = {
  notifyStoreReplenishmentSubmitted
};
