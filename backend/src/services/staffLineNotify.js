const { pool } = require("../db");
const config = require("../config");
const {
  getStoreLineSettings,
  resolveStoreLineCredentials
} = require("./storeLineSettingsService");
const {
  buildIdempotencyKey,
  createStaffLineNotification,
  markStaffLineNotificationDelivery
} = require("./staffLineNotificationService");

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const STAFF_GROUP_TYPES = ["staff"];

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

function maskPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= 6) return "***";
  return `${text.slice(0, 2)}*****${text.slice(-3)}`;
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("zh-TW") : "0";
}

function formatStaffName(value) {
  return formatValue(value || "門市人員");
}

function formatRepairDate(value) {
  return formatValue(value);
}

function compactText(value, maxLength = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "-";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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

function buildStaffPageUrl(pathname = "/", query = "") {
  const baseUrl = resolveFrontendBaseUrl();
  const normalizedPath = String(pathname || "/").startsWith("/") ? String(pathname || "/") : `/${pathname}`;
  const normalizedQuery = String(query || "").trim();
  return `${baseUrl}${normalizedPath}${normalizedQuery ? `?${normalizedQuery.replace(/^\?/, "")}` : ""}`;
}

function createPostbackAction(label, action, id, extra = {}) {
  const params = new URLSearchParams({
    action,
    id: String(id),
    ...Object.fromEntries(
      Object.entries(extra)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, String(value)])
    )
  });

  return {
    type: "postback",
    label,
    data: params.toString(),
    displayText: label
  };
}

function createUriAction(label, uri) {
  return {
    type: "uri",
    label,
    uri
  };
}

function createFlexMessage(altText, title, bodyLines, actions = []) {
  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: String(title || altText || "KINGWAY 通知").slice(0, 80),
          weight: "bold",
          size: "lg",
          wrap: true,
          color: "#111827"
        },
        ...bodyLines.filter(Boolean).map((line) => ({
          type: "text",
          text: String(line),
          size: "sm",
          wrap: true,
          color: "#374151",
          margin: "md"
        }))
      ]
    }
  };

  if (actions.length > 0) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: actions.slice(0, 4).map((action, index) => ({
        type: "button",
        style: index === 0 ? "primary" : "secondary",
        height: "sm",
        action
      }))
    };
  }

  return {
    type: "flex",
    altText: String(altText || title || "KINGWAY 通知").slice(0, 400),
    contents: bubble
  };
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
    `預約：${reservationDateTime || "-"}`,
    `內容：${formatValue(repairContent)}`,
    payload.storeName ? `門市：${formatValue(payload.storeName)}` : `store_id：${formatValue(payload.storeId)}`,
    payload.adminUrl ? `管理連結：${payload.adminUrl}` : null
  ].filter(Boolean).join("\n");
}

function buildRepairStaffWorkflowNotification(input = {}) {
  const repairId = normalizeRecordId(input.repairId);
  const event = String(input.event || input.eventType || "").trim();
  const amount = `NT$ ${formatCurrency(input.amount ?? input.estimateAmount ?? input.totalAmount)}`;
  const staffName = formatStaffName(input.staffName);
  const updatedAt = String(input.updatedAt || input.diagnosisUpdatedAt || input.crossCheckedAt || "").trim();
  const eventKeySuffix = updatedAt ? `:${updatedAt}` : "";
  const repairKey = `repair:${repairId || 0}`;

  if (event === "reservation_created") {
    return {
      eventType: "REPAIR_RESERVATION_CREATED",
      title: "【新維修預約】",
      altText: "新維修預約",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `車型：${formatValue(input.bikeModel)}`,
        `預約日期：${formatRepairDate(input.date || input.reservationDate)}`,
        "狀態：待門市確認"
      ],
      idempotencyKey: `${repairKey}:reservation_created`
    };
  }

  if (event === "reservation_confirmed") {
    return {
      eventType: "REPAIR_RESERVATION_CONFIRMED",
      title: "【維修預約已確認】",
      altText: "維修預約已確認",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `確認人員：${staffName}`,
        "下一步：請填寫初步診斷"
      ],
      idempotencyKey: `${repairKey}:reservation_confirmed`
    };
  }

  if (event === "diagnosis_saved") {
    return {
      eventType: "REPAIR_DIAGNOSIS_SAVED",
      title: "【初步診斷已完成】",
      altText: "初步診斷已完成",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `診斷人員：${staffName}`,
        input.diagnosisSummary ? `診斷摘要：${compactText(input.diagnosisSummary, 60)}` : null,
        "下一步：請建立維修報價草稿"
      ],
      idempotencyKey: `${repairKey}:diagnosis_saved${eventKeySuffix}`
    };
  }

  if (event === "quote_draft_saved") {
    return {
      eventType: "REPAIR_QUOTE_DRAFT_SAVED",
      title: "【維修報價草稿已儲存】",
      altText: "維修報價草稿已儲存",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `報價金額：${amount}`,
        "下一步：請完成交叉確認"
      ],
      idempotencyKey: `${repairKey}:quote_draft_saved${eventKeySuffix}`
    };
  }

  if (event === "cross_check_approved") {
    return {
      eventType: "REPAIR_CROSS_CHECK_APPROVED",
      title: "【交叉確認完成】",
      altText: "交叉確認完成",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `確認人員：${staffName}`,
        "結果：確認無誤",
        "下一步：可發送報價給客戶"
      ],
      idempotencyKey: `${repairKey}:cross_check${eventKeySuffix}`
    };
  }

  if (event === "cross_check_needs_revision") {
    return {
      eventType: "REPAIR_CROSS_CHECK_NEEDS_REVISION",
      title: "【交叉確認結果】",
      altText: "交叉確認結果",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        "結果：需要修正",
        `備註：${compactText(input.note, 80)}`
      ],
      idempotencyKey: `${repairKey}:cross_check${eventKeySuffix}`
    };
  }

  if (event === "customer_quote_ready") {
    return {
      eventType: "REPAIR_CUSTOMER_QUOTE_READY",
      title: "【客戶報價發送準備完成】",
      altText: "客戶報價發送準備完成",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        "狀態：可發送報價給客戶"
      ],
      idempotencyKey: `${repairKey}:customer_quote_ready${eventKeySuffix}`
    };
  }

  if (event === "customer_approved") {
    return {
      eventType: "REPAIR_CUSTOMER_APPROVED",
      title: "【客戶已同意維修報價】",
      altText: "客戶已同意維修報價",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `報價金額：${amount}`,
        "下一步：等待相關零件到店後開始維修"
      ],
      idempotencyKey: `${repairKey}:customer_approved`
    };
  }

  if (event === "customer_rejected") {
    return {
      eventType: "REPAIR_CUSTOMER_REJECTED",
      title: "【客戶拒絕維修報價】",
      altText: "客戶拒絕維修報價",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        "請由門市聯絡客戶確認後續處理"
      ],
      idempotencyKey: `${repairKey}:customer_rejected`
    };
  }

  if (event === "repair_started") {
    return {
      eventType: "REPAIR_STARTED",
      title: "【維修已開始】",
      altText: "維修已開始",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        `處理人員：${staffName}`
      ],
      idempotencyKey: `${repairKey}:repair_started`
    };
  }

  if (event === "repair_completed") {
    return {
      eventType: "REPAIR_COMPLETED",
      title: "【維修已完成】",
      altText: "維修已完成",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        "狀態：等待客戶取車"
      ],
      idempotencyKey: `${repairKey}:repair_completed`
    };
  }

  if (event === "picked_up") {
    return {
      eventType: "REPAIR_PICKED_UP",
      title: "【客戶已取車】",
      altText: "客戶已取車",
      bodyLines: [
        `維修單號：#${formatValue(repairId)}`,
        "本次維修流程已完成"
      ],
      idempotencyKey: `${repairKey}:picked_up`
    };
  }

  return null;
}

async function notifyRepairStaffWorkflowEvent(input = {}, options = {}) {
  const repairId = normalizeRecordId(input.repairId);
  const storeId = normalizeStoreId(input.storeId) || await resolveRepairStoreId({ repairId });
  const notification = buildRepairStaffWorkflowNotification(input);
  if (!repairId || !storeId || !notification) {
    return { delivered: 0, skipped: true, reason: "missing_repair_staff_workflow_fields" };
  }

  return notifyStaffActionRequired({
    eventType: notification.eventType,
    relatedType: "REPAIR",
    relatedId: repairId,
    storeId,
    title: notification.title,
    altText: notification.altText,
    bodyLines: notification.bodyLines,
    idempotencyKey: notification.idempotencyKey,
    actions: Array.isArray(input.actions) ? input.actions : [],
    payload: {
      repairId,
      event: input.event || input.eventType,
      amount: input.amount ?? input.estimateAmount ?? input.totalAmount ?? null,
      source: input.source || null
    }
  }, {
    registrationTypes: ["staff"],
    purpose: options.purpose || `${notification.eventType.toLowerCase()}_staff_group_notify`
  });
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
  ].filter(Boolean).join("\n");
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
  ].filter(Boolean).join("\n");
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

async function resolveStaffLineGroupTarget(connection = pool, registrationTypes = STAFF_GROUP_TYPES, options = {}) {
  const resolvedRegistrationTypes = Array.isArray(registrationTypes) && registrationTypes.length > 0
    ? [...registrationTypes]
    : [...STAFF_GROUP_TYPES];
  const scopedStoreId = normalizeStoreId(options.storeId);
  const storeClause = scopedStoreId ? "AND store_id = ?" : "";
  const params = scopedStoreId
    ? [resolvedRegistrationTypes, scopedStoreId]
    : [resolvedRegistrationTypes];

  const orderCases = resolvedRegistrationTypes.map((type, index) => `WHEN '${type}' THEN ${index + 1}`).join(" ");
  const [rows] = await connection.query(
    `
      SELECT id, line_group_id AS lineGroupId, registration_type AS registrationType, group_name AS groupName
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN (?)
        ${storeClause}
      ORDER BY CASE registration_type ${orderCases} ELSE 99 END, updated_at DESC, id DESC
      LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

async function pushTextToLineGroup(lineGroupId, text, accessToken) {
  return pushMessagesToLineGroup(lineGroupId, [{ type: "text", text }], accessToken);
}

async function pushMessagesToLineGroup(lineGroupId, messages, accessToken) {
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
      messages: Array.isArray(messages) ? messages.slice(0, 5) : []
    })
  });

  if (!response.ok) {
    return { delivered: 0, skipped: false, error: `LINE API ${response.status}` };
  }

  return { delivered: 1, skipped: false };
}

async function pushStaffLineGroupMessages(storeId, messages, options = {}) {
  const normalizedStoreId = normalizeStoreId(storeId);
  const targetRegistrationTypes = Array.isArray(options.registrationTypes) && options.registrationTypes.length > 0
    ? options.registrationTypes
    : STAFF_GROUP_TYPES;

  if (!normalizedStoreId) {
    return { delivered: 0, skipped: true, reason: "missing_store_scope" };
  }

  const target = await resolveStaffLineGroupTarget(pool, targetRegistrationTypes, { storeId: normalizedStoreId });

  if (isStaffLineNotifySuppressed()) {
    return {
      delivered: 0,
      skipped: true,
      reason: "environment_suppressed",
      targetGroupIds: target?.lineGroupId ? [target.lineGroupId] : [],
      registrationType: target?.registrationType || null,
      lineGroupId: target?.lineGroupId ? maskLineGroupId(target.lineGroupId) : null,
      lineGroupRegistrationId: target?.id || null,
      storeId: normalizedStoreId
    };
  }

  const [storeSettings, credentials] = await Promise.all([
    getStoreLineSettings(normalizedStoreId),
    resolveStoreLineCredentials({ storeId: normalizedStoreId, purpose: options.purpose || "staff_group_notify" })
  ]);

  if (!storeSettings.lineEnabled || !storeSettings.staffGroupEnabled || !credentials.credentialsResolved) {
    return { delivered: 0, skipped: true, reason: "store_line_settings_incomplete", storeId: normalizedStoreId };
  }

  if (!target?.lineGroupId) {
    return { delivered: 0, skipped: true, reason: "no_active_line_group_registration", targetGroupIds: [], storeId: normalizedStoreId };
  }

  const result = await pushMessagesToLineGroup(target.lineGroupId, messages, credentials.channelAccessToken);
  return {
    ...result,
    targetGroupIds: [target.lineGroupId],
    registrationType: target.registrationType,
    lineGroupId: maskLineGroupId(target.lineGroupId),
    lineGroupRegistrationId: target.id || null,
    storeId: normalizedStoreId
  };
}

async function sendStaffLineFollowup(storeId, text, options = {}) {
  return pushStaffLineGroupMessages(
    storeId,
    [{ type: "text", text }],
    { ...options, purpose: options.purpose || "staff_group_followup" }
  );
}

async function notifyStaffActionRequired(input = {}, options = {}) {
  const storeId = normalizeStoreId(input.storeId);
  const relatedId = normalizeRecordId(input.relatedId);
  const eventType = String(input.eventType || "").trim().toUpperCase();
  const relatedType = String(input.relatedType || "").trim().toUpperCase();
  if (!storeId || !relatedId || !eventType || !relatedType) {
    return { delivered: 0, skipped: true, reason: "missing_required_fields" };
  }

  const targetRegistrationTypes = Array.isArray(options.registrationTypes) && options.registrationTypes.length > 0
    ? options.registrationTypes
    : STAFF_GROUP_TYPES;
  const target = await resolveStaffLineGroupTarget(pool, targetRegistrationTypes, { storeId });
  const idempotencyKey = input.idempotencyKey || buildIdempotencyKey(eventType, storeId, relatedId, "GROUP_NOTIFY");
  const notificationRecord = await createStaffLineNotification({
    storeId,
    eventType,
    relatedType,
    relatedId,
    idempotencyKey,
    lineGroupRegistrationId: target?.id || null,
    payloadJson: input.payload || null
  });

  if (notificationRecord.available && notificationRecord.duplicate && !notificationRecord.shouldSend) {
    return {
      delivered: 0,
      skipped: true,
      reason: "duplicate_idempotency_key",
      notificationId: notificationRecord.notification?.id || null,
      idempotencyKey
    };
  }

  const notificationId = notificationRecord.notification?.id || null;
  const actionMeta = {
    notificationId: notificationId || "",
    notificationKey: idempotencyKey,
    storeId
  };
  const actions = (Array.isArray(input.actions) ? input.actions : []).map((action) => {
    if (action?.type === "uri") return action;
    return createPostbackAction(action.label, action.action, relatedId, {
      ...actionMeta,
      ...(action.extra || {})
    });
  });

  const message = createFlexMessage(
    input.altText || input.title || "KINGWAY 通知",
    input.title || "KINGWAY 通知",
    Array.isArray(input.bodyLines) ? input.bodyLines : [],
    actions
  );

  const result = await pushStaffLineGroupMessages(storeId, [message], {
    registrationTypes: targetRegistrationTypes,
    purpose: options.purpose || `${eventType.toLowerCase()}_staff_group_notify`
  });

  if (notificationId) {
    await markStaffLineNotificationDelivery(notificationId, {
      delivered: result.delivered,
      reason: result.reason,
      error: result.error,
      lineGroupRegistrationId: result.lineGroupRegistrationId
    });
  }

  return {
    ...result,
    notificationId,
    idempotencyKey
  };
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

    return notifyRepairStaffWorkflowEvent({
      ...payload,
      event: "reservation_created",
      storeId,
      actions: [
        { label: "✅ 已確認預約", action: "repair_reservation_approve" },
        { label: "🙋 我來處理", action: "staff_line_assign" },
        createUriAction("📋 查看詳情", payload.adminUrl || buildStaffPageUrl(`/repairs/${payload.repairId}`))
      ]
    }, {
      registrationTypes: targetRegistrationTypes,
      purpose: "repair_created_staff_group_notify"
    });
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
        targetRegistrationTypes,
        { storeId }
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
      targetRegistrationTypes,
      { storeId }
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

    return notifyStaffActionRequired({
      eventType: "NEW_BIKE_ORDER",
      relatedType: "ORDER",
      relatedId: resolvedOrderId,
      storeId,
      title: "🛒 新增客戶訂單",
      altText: "新增客戶訂單",
      bodyLines: [
        `訂單：#${formatValue(resolvedOrderId || payload.orderNo)}`,
        `客戶：${formatValue(payload.customerName || payload.name)}`,
        `商品：${formatValue(payload.productName)}`,
        payload.color ? `顏色：${formatValue(payload.color)}` : null,
        `數量：${formatValue(payload.quantity || 1)}`
      ].filter(Boolean),
      actions: [
        { label: "✅ 確認訂單", action: "staff_line_order_confirm" },
        { label: "🙋 我來處理", action: "staff_line_assign" },
        createUriAction("📋 查看詳情", orderUrl || buildStaffPageUrl("/orders"))
      ],
      payload: { ...payload, orderId: resolvedOrderId, orderLink: orderUrl }
    }, {
      registrationTypes: targetRegistrationTypes,
      purpose: "new_bike_order_staff_group_notify"
    });
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
  buildRepairStaffWorkflowNotification,
  buildStaffPageUrl,
  createFlexMessage,
  createPostbackAction,
  createUriAction,
  isStaffLineNotifySuppressed,
  notifyStaffActionRequired,
  notifyOrderReservationCreated,
  notifyPaymentInquiryCreated,
  notifyRepairReservationCreated,
  notifyRepairStaffWorkflowEvent,
  pushStaffLineGroupMessages,
  resolveStaffLineGroupTarget,
  sendStaffLineFollowup
};
