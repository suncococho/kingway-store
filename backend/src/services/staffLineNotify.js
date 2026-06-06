const { pool } = require("../db");
const config = require("../config");
const {
  getStoreLineSettings,
  resolveStoreLineCredentials
} = require("./storeLineSettingsService");

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const STAFF_GROUP_TYPES = ["repair", "staff", "admin"];

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

function normalizeRecordId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizeStoreId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function resolveFrontendBaseUrl() {
  const configured = String(config.frontendBaseUrl || process.env.FRONTEND_BASE_URL || "https://pos.kingway.tw").trim();
  if (!configured) {
    return "https://pos.kingway.tw";
  }
  return configured.replace(/\/$/, "");
}

function buildOrderDetailLink(orderId, options = {}) {
  const normalizedOrderId = normalizeRecordId(orderId);
  if (!normalizedOrderId) {
    return null;
  }

  const baseUrl = String(options.baseUrl || resolveFrontendBaseUrl()).trim().replace(/\/$/, "");
  return `${baseUrl}/orders/${normalizedOrderId}/edit`;
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

function buildPaymentInquiryMessage(payload = {}) {
  return [
    "【KINGWAY 付款詢問】",
    `客戶：${formatValue(payload.customerName)}`,
    `電話：${formatValue(payload.phone, "-")}`,
    `訂單：${formatValue(payload.orderNo, "-")}`,
    payload.orderLink ? `訂單連結：${payload.orderLink}` : null,
    "內容：",
    formatValue(payload.message),
    "來源：LINE 客戶中心"
  ].filter(Boolean).join("\\n");
}

function buildOrderReservationMessage(payload = {}) {
  return [
    "【KINGWAY 訂單預約】",
    `客戶：${formatValue(payload.customerName)}`,
    `電話：${formatValue(payload.phone, "-")}`,
    `訂單：${formatValue(payload.orderNo, "-")}`,
    payload.orderLink ? `訂單連結：${payload.orderLink}` : null,
    `車款：${formatValue(payload.productName, "-")}`,
    "來源：LINE 客戶中心"
  ].filter(Boolean).join("\\n");
}

async function resolveOrderReservationStoreId(payload = {}, connection = pool) {
  const scopedStoreId = normalizeStoreId(payload.storeId);
  if (scopedStoreId) {
    return scopedStoreId;
  }

  if (payload.orderId) {
    const [rows] = await connection.query(
      `
        SELECT store_id AS storeId
        FROM orders
        WHERE id = ?
        LIMIT 1
      `,
      [payload.orderId]
    );
    if (rows[0]?.storeId) {
      return normalizeStoreId(rows[0].storeId);
    }
  }

  if (!payload.orderNo) {
    return null;
  }

  const [rowsByOrderNo] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM orders
      WHERE order_no = ?
      LIMIT 1
    `,
    [payload.orderNo]
  );

  return normalizeStoreId(rowsByOrderNo[0]?.storeId);
}

async function resolvePaymentInquiryStoreId(payload = {}, connection = pool) {
  const scopedStoreId = normalizeStoreId(payload.storeId);
  if (scopedStoreId) {
    return scopedStoreId;
  }

  if (!payload.orderNo) {
    return null;
  }

  const [rows] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM orders
      WHERE order_no = ?
      LIMIT 1
    `,
    [payload.orderNo]
  );

  return normalizeStoreId(rows[0]?.storeId);
}

async function resolveOrderIdByOrderNo(payload = {}, connection = pool) {
  const orderNo = String(payload.orderNo || "").trim();
  if (!orderNo) {
    return null;
  }

  const [rows] = await connection.query(
    `
      SELECT id
      FROM orders
      WHERE order_no = ?
      LIMIT 1
    `,
    [orderNo]
  );

  return normalizeRecordId(rows[0]?.id);
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

async function resolveStaffLineGroupTarget(connection = pool, registrationTypes = STAFF_GROUP_TYPES) {
  const resolvedRegistrationTypes = Array.isArray(registrationTypes) && registrationTypes.length > 0
    ? [...registrationTypes]
    : [...STAFF_GROUP_TYPES];

  const orderCases = resolvedRegistrationTypes.map((type, index) => `WHEN '${type}' THEN ${index + 1}`).join(" ");
  const [rows] = await connection.query(
    `
      SELECT line_group_id AS lineGroupId, registration_type AS registrationType, group_name AS groupName
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN (?)
      ORDER BY CASE registration_type ${orderCases} ELSE 99 END, updated_at DESC, id DESC
      LIMIT 1
    `,
    [resolvedRegistrationTypes]
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

async function notifyRepairReservationCreated(payload = {}, options = {}) {
  const targetRegistrationTypes = Array.isArray(options.registrationTypes) && options.registrationTypes.length > 0
    ? options.registrationTypes
    : STAFF_GROUP_TYPES;

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
      const target = await resolveStaffLineGroupTarget(
        pool,
        targetRegistrationTypes
      );
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "environment_suppressed",
        targetGroupIds: target?.lineGroupId ? [target.lineGroupId] : [],
        registrationType: target?.registrationType || null,
        lineGroupId: target?.lineGroupId ? maskLineGroupId(target.lineGroupId) : null
      };
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

    const target = await resolveStaffLineGroupTarget(
      pool,
      targetRegistrationTypes
    );
    if (!target?.lineGroupId) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: payload.repairId || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "no_active_line_group_registration",
        targetGroupIds: [],
        registrationType: null,
        lineGroupId: null
      };
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
      targetGroupIds: [target.lineGroupId],
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

async function notifyPaymentInquiryCreated(payload = {}, options = {}) {
  const targetRegistrationTypes = Array.isArray(options.registrationTypes) && options.registrationTypes.length > 0
    ? options.registrationTypes
    : ["staff", "admin"];
  let resolvedOrderId = null;
  let orderUrl = null;

  try {
    resolvedOrderId = normalizeRecordId(payload.orderId) || await resolveOrderIdByOrderNo(payload);
    orderUrl = buildOrderDetailLink(resolvedOrderId, { baseUrl: config.frontendBaseUrl });
    const storeId = await resolvePaymentInquiryStoreId(payload);
    if (!storeId) {
      console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId: null
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "missing_store_scope",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl
      };
    }

    if (isStaffLineNotifySuppressed()) {
      const target = await resolveStaffLineGroupTarget(
        pool,
        targetRegistrationTypes
      );
      console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "environment_suppressed",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: target?.lineGroupId ? [target.lineGroupId] : [],
        registrationType: target?.registrationType || null,
        lineGroupId: target?.lineGroupId ? maskLineGroupId(target.lineGroupId) : null
      };
    }

    const [storeSettings, credentials] = await Promise.all([
      getStoreLineSettings(storeId),
      resolveStoreLineCredentials({ storeId, purpose: "payment_inquiry_staff_group_notify" })
    ]);

    if (!storeSettings.lineEnabled || !storeSettings.staffGroupEnabled || !credentials.credentialsResolved) {
      console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "store_line_settings_incomplete",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: [],
        registrationType: null,
        lineGroupId: null
      };
    }

    const target = await resolveStaffLineGroupTarget(
      pool,
      targetRegistrationTypes
    );
    if (!target?.lineGroupId) {
      console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "no_active_line_group_registration",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: [],
        registrationType: null,
        lineGroupId: null
      };
    }

    const result = await pushTextToLineGroup(
      target.lineGroupId,
      buildPaymentInquiryMessage({
        ...payload,
        customerName: payload.customerName || payload.name,
        orderId: resolvedOrderId,
        orderLink: orderUrl
      }),
      credentials.channelAccessToken
    );

    if (result.delivered > 0) {
      console.info("[staff-line] payment_inquiry_notify_sent", {
        orderNo: payload.orderNo || null,
        storeId
      });
    } else {
      console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
    }

    return {
      ...result,
      targetGroupIds: [target.lineGroupId],
      registrationType: target.registrationType,
      lineGroupId: maskLineGroupId(target.lineGroupId),
      orderId: resolvedOrderId || null,
      orderLink: orderUrl,
      storeId
    };
  } catch (error) {
    console.info("[staff-line] payment_inquiry_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId: normalizeStoreId(payload.storeId)
      });
    return {
      delivered: 0,
      skipped: false,
      orderId: resolvedOrderId || null,
      orderLink: buildOrderDetailLink(resolvedOrderId, { baseUrl: config.frontendBaseUrl }),
      error: error.message
    };
  }
}

async function notifyOrderReservationCreated(payload = {}, options = {}) {
  const targetRegistrationTypes = Array.isArray(options.registrationTypes) && options.registrationTypes.length > 0
    ? options.registrationTypes
    : ["staff", "admin"];
  let resolvedOrderId = null;
  let orderUrl = null;

  try {
    resolvedOrderId = normalizeRecordId(payload.orderId) || await resolveOrderIdByOrderNo(payload);
    orderUrl = buildOrderDetailLink(resolvedOrderId, { baseUrl: config.frontendBaseUrl });
    const storeId = await resolveOrderReservationStoreId(payload);
    if (!storeId) {
      console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId: null
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "missing_store_scope",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl
      };
    }

    if (isStaffLineNotifySuppressed()) {
      const target = await resolveStaffLineGroupTarget(
        pool,
        targetRegistrationTypes
      );
      console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "environment_suppressed",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: target?.lineGroupId ? [target.lineGroupId] : [],
        registrationType: target?.registrationType || null,
        lineGroupId: target?.lineGroupId ? maskLineGroupId(target.lineGroupId) : null
      };
    }

    const [storeSettings, credentials] = await Promise.all([
      getStoreLineSettings(storeId),
      resolveStoreLineCredentials({ storeId, purpose: "order_reservation_staff_group_notify" })
    ]);

    if (!storeSettings.lineEnabled || !storeSettings.staffGroupEnabled || !credentials.credentialsResolved) {
      console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "store_line_settings_incomplete",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: [],
        registrationType: null,
        lineGroupId: null
      };
    }

    const target = await resolveStaffLineGroupTarget(
      pool,
      targetRegistrationTypes
    );
    if (!target?.lineGroupId) {
      console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
      return {
        delivered: 0,
        skipped: true,
        reason: "no_active_line_group_registration",
        orderId: resolvedOrderId || null,
        orderLink: orderUrl,
        targetGroupIds: [],
        registrationType: null,
        lineGroupId: null
      };
    }

    const result = await pushTextToLineGroup(
      target.lineGroupId,
      buildOrderReservationMessage({
        ...payload,
        customerName: payload.customerName || payload.name,
        orderId: resolvedOrderId,
        orderLink: orderUrl
      }),
      credentials.channelAccessToken
    );

    if (result.delivered > 0) {
      console.info("[staff-line] order_reservation_notify_sent", {
        orderNo: payload.orderNo || null,
        storeId
      });
    } else {
      console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId
      });
    }

    return {
      ...result,
      targetGroupIds: [target.lineGroupId],
      registrationType: target.registrationType,
      lineGroupId: maskLineGroupId(target.lineGroupId),
      orderId: resolvedOrderId || null,
      orderLink: orderUrl,
      storeId
    };
  } catch (error) {
    console.info("[staff-line] order_reservation_notify_skipped", {
        orderNo: payload.orderNo || null,
        storeId: normalizeStoreId(payload.storeId)
      });
    return {
      delivered: 0,
      skipped: false,
      orderId: resolvedOrderId || null,
      orderLink: buildOrderDetailLink(resolvedOrderId, { baseUrl: config.frontendBaseUrl }),
      error: error.message
    };
  }
}

module.exports = {
  buildOrderDetailLink,
  buildRepairReservationMessage,
  isStaffLineNotifySuppressed,
  notifyOrderReservationCreated,
  notifyPaymentInquiryCreated,
  notifyRepairReservationCreated,
  resolveStaffLineGroupTarget
};
