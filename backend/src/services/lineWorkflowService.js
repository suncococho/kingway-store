const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const dayjs = require("dayjs");
const { pool, withTransaction } = require("../db");
const config = require("../config");
const {
  normalizeLineSendOptions,
  resolveLineAccessToken,
  sendLineMessage: sendLinePushMessage
} = require("../utils/line");
const { createError } = require("../utils/errors");
const { validateRepairReservationDate } = require("./repairService");
const { getPublicStoreSettings } = require("./settingsService");
const { sendInternalTelegram } = require("./telegramService");
const { applyRepairReservationDecision, notifyRepairCustomer } = require("./repairReservationService");
const { getTableColumns, hasColumn } = require("../utils/schema");
const { notifyRepairReservationCreated } = require("./staffLineNotify");

const lineAccessTokenOptionsStorage = new AsyncLocalStorage();

function getScopedLineAccessTokenOptions(options = {}) {
  const scopedOptions = normalizeLineSendOptions(lineAccessTokenOptionsStorage.getStore() || {});
  return normalizeLineSendOptions({
    ...scopedOptions,
    ...(options || {})
  });
}

function runWithLineAccessTokenOptions(options = {}, callback) {
  return lineAccessTokenOptionsStorage.run(normalizeLineSendOptions(options), callback);
}

async function sendLineMessage(configArg, to, messages, options = {}) {
  return sendLinePushMessage(
    configArg,
    to,
    messages,
    getScopedLineAccessTokenOptions(options)
  );
}

function makeCode(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
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

function createMessageAction(label, text = label) {
  return {
    type: "message",
    label,
    text
  };
}

function createDatetimePickerAction(label, data, mode, options = {}) {
  return {
    type: "datetimepicker",
    label,
    data,
    mode,
    ...options
  };
}

function createButtonMessage(title, text, actions) {
  return {
    type: "template",
    altText: title,
    template: {
      type: "buttons",
      title: title.slice(0, 40),
      text: text.slice(0, 160),
      actions: actions.slice(0, 4)
    }
  };
}

function createConfirmTemplate(title, text, actions) {
  return {
    type: "template",
    altText: title,
    template: {
      type: "confirm",
      text: text.slice(0, 240),
      actions: actions.slice(0, 2)
    }
  };
}

function createQuickReplyText(text, actions) {
  return {
    type: "text",
    text,
    quickReply: buildQuickReply(actions)
  };
}

function createFlexMessage(altText, title, bodyLines, actions = []) {
  const bodyContents = [
    {
      type: "text",
      text: title,
      weight: "bold",
      size: "lg",
      wrap: true,
      color: "#111827"
    },
    ...bodyLines.filter(Boolean).map((line) => ({
      type: "text",
      text: line,
      size: "sm",
      wrap: true,
      color: "#374151",
      margin: "md"
    }))
  ];

  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: bodyContents
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
    altText,
    contents: bubble
  };
}

async function getRegisteredGroupsByTypes(registrationTypes) {
  const [groups] = await pool.query(
    `
      SELECT
        line_group_id AS lineGroupId,
        registration_type AS registrationType,
        updated_at AS updatedAt,
        id
      FROM line_group_registrations
      WHERE is_active = 1
        AND registration_type IN (?)
    `,
    [registrationTypes]
  );
  return groups;
}

async function resolveGroupTargets(registrationTypes) {
  if (!config.line.channelAccessToken) {
    return [];
  }

  if (config.line.unifiedQaGroupMode) {
    if (config.line.qaGroupId) {
      return [config.line.qaGroupId];
    }

    const qaTypes = ["admin", "staff", "repair", "inventory", "daily"];
    const qaGroups = await getRegisteredGroupsByTypes(qaTypes);
    const latestQaGroup = qaGroups
      .filter((group) => group.lineGroupId)
      .sort((left, right) => {
        const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
        const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }
        return Number(right.id || 0) - Number(left.id || 0);
      })[0];

    if (latestQaGroup) {
      return [latestQaGroup.lineGroupId];
    }
  }

  const groups = await getRegisteredGroupsByTypes(registrationTypes);
  return [...new Set(groups.map((group) => group.lineGroupId).filter(Boolean))];
}

async function sendToGroups(registrationTypes, messages) {
  const result = await sendInternalTelegram(registrationTypes, messages);
  return result.delivered;
}

async function sendToGroupsWithResult(registrationTypes, messages) {
  return sendInternalTelegram(registrationTypes, messages);
}

async function logWorkflowEvent(eventType, refType, refId, payload = null, staffId = null, connection = pool) {
  await connection.query(
    `
      INSERT INTO v2_workflow_events (event_type, ref_type, ref_id, payload, created_by_staff_id)
      VALUES (?, ?, ?, ?, ?)
    `,
    [eventType, refType, refId || null, payload ? JSON.stringify(payload) : null, staffId || null]
  );
}

function buildLineWebhookEventKey(event) {
  if (event?.webhookEventId) {
    return `webhook:${event.webhookEventId}`;
  }

  const fallbackPayload = {
    mode: event?.mode || null,
    type: event?.type || null,
    timestamp: event?.timestamp || null,
    replyToken: event?.replyToken || null,
    sourceType: event?.source?.type || null,
    userId: event?.source?.userId || null,
    groupId: event?.source?.groupId || null,
    roomId: event?.source?.roomId || null,
    messageId: event?.message?.id || null,
    messageType: event?.message?.type || null,
    messageText: event?.message?.type === "text" ? event?.message?.text || null : null,
    postbackData: event?.postback?.data || null,
    redelivery: Boolean(event?.deliveryContext?.isRedelivery)
  };

  const digest = crypto.createHash("sha256").update(JSON.stringify(fallbackPayload)).digest("hex");
  return `fallback:${digest}`;
}

async function claimLineWebhookEvent(event, routePath, connection = pool) {
  const eventKey = buildLineWebhookEventKey(event);

  try {
    await connection.query(
      `
        INSERT INTO line_webhook_events (event_key, route_path, event_type, line_user_id, line_group_id, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        eventKey,
        routePath,
        event?.type || "unknown",
        event?.source?.userId || null,
        event?.source?.groupId || event?.source?.roomId || null,
        JSON.stringify(event || {})
      ]
    );

    return { claimed: true, eventKey };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return { claimed: false, eventKey };
    }
    throw error;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

async function findOrCreateLineCustomer(lineUserId, fallbackName = "LINE 客戶", storeId = null) {
  const storeContext = await resolveLineWorkflowStoreContext({
    storeId,
    lineUserId,
    connection: pool,
    reason: "find_or_create_line_customer"
  });
  const resolvedStoreId = storeContext.storeId;

  const [existing] = await pool.query(
    `
      SELECT *
      FROM customers
      WHERE line_user_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [lineUserId, resolvedStoreId]
  );

  if (existing[0]) {
    const customer = existing[0];
    const normalizedFallback = normalizeText(fallbackName);
    if (
      normalizedFallback &&
      isPlaceholderCustomerName(customer.name) &&
      normalizedFallback !== customer.name
    ) {
      await pool.query(
        `
          UPDATE customers
          SET name = ?, line_display_name = ?
          WHERE id = ? AND store_id = ?
        `,
        [normalizedFallback, normalizedFallback, customer.id, resolvedStoreId]
      );
      customer.name = normalizedFallback;
      customer.line_display_name = normalizedFallback;
    }

    return customer;
  }

  const [result] = await pool.query(
    `
      INSERT INTO customers (name, line_user_id, line_display_name, crm_stage, last_contact_at, store_id)
      VALUES (?, ?, ?, 'new_line_friend', NOW(), ?)
    `,
    [fallbackName, lineUserId, fallbackName, resolvedStoreId]
  );

  await pool.query(
    `
      INSERT INTO customer_crm_events (customer_id, event_type, stage, note)
      VALUES (?, 'line_friend_added', 'new_line_friend', 'LINE 新好友加入')
    `,
    [result.insertId]
  );

  return {
    id: result.insertId,
    name: fallbackName,
    line_user_id: lineUserId,
    phone: null,
    store_id: resolvedStoreId,
    storeId: resolvedStoreId
  };
}

async function bindPhoneAndIssueNewFriendCoupon(lineUserId, phone, displayName = "") {
  const normalizedDisplayName = normalizeText(displayName);
  return withTransaction(async (connection) => {
    const storeContext = await resolveLineWorkflowStoreContext({
      lineUserId,
      connection,
      reason: "new_friend_coupon_binding"
    });
    const storeId = storeContext.storeId;

    const [matches] = await connection.query(
      `
        SELECT
          id,
          name,
          phone,
          line_user_id AS lineUserId,
          line_display_name AS lineDisplayName,
          store_id AS storeId
        FROM customers
        WHERE (line_user_id = ? OR phone = ?)
          AND store_id = ?
        ORDER BY line_user_id = ? DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [lineUserId, phone, storeId, lineUserId]
    );

    let customer = matches[0];
    if (!customer) {
      const fallbackName = normalizedDisplayName || "LINE 客戶";
      const [inserted] = await connection.query(
        `
          INSERT INTO customers (name, phone, line_user_id, line_display_name, crm_stage, last_contact_at, store_id)
          VALUES (?, ?, ?, ?, 'phone_bound', NOW(), ?)
        `,
        [fallbackName, phone, lineUserId, fallbackName, storeId]
      );
      customer = {
        id: inserted.insertId,
        name: fallbackName,
        phone,
        lineUserId,
        storeId,
        store_id: storeId
      };
    } else {
      const updates = [];
      const params = [];
      if (normalizedDisplayName && isPlaceholderCustomerName(customer.name)) {
        updates.push("name = ?");
        updates.push("line_display_name = ?");
        params.push(normalizedDisplayName, normalizedDisplayName);
      } else if (normalizedDisplayName && !customer.lineDisplayName) {
        updates.push("line_display_name = ?");
        params.push(normalizedDisplayName);
      }
      if (!customer.phone) {
        updates.push("phone = ?");
        params.push(phone);
      }
      if (!customer.lineUserId) {
        updates.push("line_user_id = ?");
        params.push(lineUserId);
      }
      updates.push("crm_stage = 'phone_bound'", "last_contact_at = NOW()");
      params.push(customer.id);
      if (updates.length > 2) {
        await connection.query(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`, params);
      }
    }

    await connection.query(
      `
        INSERT INTO customer_crm_events (customer_id, event_type, stage, note)
        VALUES (?, 'phone_bound', 'phone_bound', ?)
      `,
      [customer.id, `手機綁定：${phone}`]
    );

    await logWorkflowEvent("line_phone_bound", "CUSTOMER", customer.id, { couponIssued: false }, null, connection);
    return { customerId: customer.id, couponCode: null };
  });
}

async function getPurchaseConfirmationEligibility(orderId, connection = pool, options = {}) {
  const storeContext = await resolveLineWorkflowStoreContext({
    storeId: options.storeId,
    connection,
    reason: "purchase_confirmation_eligibility"
  });
  const storeId = storeContext.storeId;
  const [rows] = await connection.query(
    `
      SELECT
        o.id AS orderId,
        o.store_id AS storeId,
        o.status AS orderStatus,
        o.deleted_at AS deletedAt,
        o.final_payment_status AS finalPaymentStatus,
        o.unpaid_balance AS unpaidBalance,
        EXISTS (
          SELECT 1
          FROM order_items oi
          INNER JOIN products p ON p.id = oi.product_id
            AND (? IS NULL OR p.store_id = ?)
          WHERE oi.order_id = o.id
            AND (? IS NULL OR oi.store_id = ?)
            AND p.requires_purchase_confirmation = 1
        ) AS hasRequiredPurchaseConfirmationProduct
      FROM orders o
      WHERE o.id = ?
        AND (? IS NULL OR o.store_id = ?)
      LIMIT 1
    `,
    [storeId, storeId, storeId, storeId, orderId, storeId, storeId]
  );

  const order = rows[0];
  if (!order) {
    return { ok: false, reason: "not_found", message: "找不到訂單" };
  }

  const orderStatus = String(order.orderStatus || "").trim().toUpperCase();
  if (order.deletedAt || ["CANCELED", "CANCELLED", "DELETED", "VOID"].includes(orderStatus)) {
    return { ok: false, reason: "canceled", message: "此訂單已取消，無法產生購買確認書" };
  }

  const finalPaymentStatus = String(order.finalPaymentStatus || "").trim().toUpperCase();
  const unpaidBalance = Number(order.unpaidBalance || 0);
  const isPaid = finalPaymentStatus === "PAID" || order.finalPaymentStatus === "已完款" || unpaidBalance <= 0;
  if (!isPaid) {
    return { ok: false, reason: "unpaid", message: "尚未完款，無法產生購買確認書" };
  }

  if (!order.hasRequiredPurchaseConfirmationProduct) {
    return { ok: false, reason: "no_required_product", message: "此訂單沒有需要購買確認書的商品" };
  }

  return { ok: true, order };
}

async function createPurchaseConfirmationForOrder(orderId, connection = pool, options = {}) {
  const storeContext = await resolveLineWorkflowStoreContext({
    storeId: options.storeId,
    connection,
    reason: "purchase_confirmation_order_helper"
  });
  const storeId = storeContext.storeId;
  const eligibility = await getPurchaseConfirmationEligibility(orderId, connection, { storeId });
  if (!eligibility.ok) {
    return null;
  }

  const normalizedCustomerPhone = sqlNormalizedPhone("c.phone");
  const [rows] = await connection.query(
    `
      SELECT
        o.id AS orderId,
        o.store_id AS storeId,
        o.order_no AS orderNo,
        o.customer_id AS customerId,
        COALESCE(o.customer_phone, c.phone) AS customerPhone,
        COALESCE(o.customer_name, c.name) AS customerName,
        c.line_user_id AS orderLineUserId,
        COALESCE(o.customer_type, c.customer_type, 'LINE') AS customerType,
        o.status AS orderStatus,
        o.final_payment_status AS finalPaymentStatus,
        o.purchase_confirmation_sent_at AS purchaseConfirmationSentAt
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
        AND (? IS NULL OR c.store_id = ?)
      WHERE o.id = ?
        AND (? IS NULL OR o.store_id = ?)
      LIMIT 1
    `,
    [storeId, storeId, orderId, storeId, storeId]
  );

  const order = rows[0];
  if (!order) {
    return null;
  }

  const effectiveStoreId = storeId || order.storeId || null;
  const normalizedPhone = normalizePhoneForMatch(order.customerPhone);
  let targetCustomerId = order.customerId || null;
  let lineUserId = order.orderLineUserId || null;

  if (order.customerType === "LINE" && !lineUserId && normalizedPhone) {
    const [matchedCustomers] = await connection.query(
      `
        SELECT id, line_user_id AS lineUserId
        FROM customers c
        WHERE (${normalizedCustomerPhone}) = ?
          AND (? IS NULL OR c.store_id = ?)
        ORDER BY
          CASE WHEN c.line_user_id IS NOT NULL AND c.line_user_id <> '' THEN 0 ELSE 1 END,
          id DESC
        LIMIT 1
      `,
      [normalizedPhone, effectiveStoreId, effectiveStoreId]
    );

    if (matchedCustomers[0]) {
      targetCustomerId = matchedCustomers[0].id;
      lineUserId = matchedCustomers[0].lineUserId || null;
    }
  }

  if (!targetCustomerId) {
    await logWorkflowEvent("purchase_confirmation_manual_tablet_required", "ORDER", order.orderId, {
      reason: "missing_customer_for_token",
      orderNo: order.orderNo,
      normalizedPhone
    }, null, connection);
    return {
      token: null,
      link: null,
      lineUserId: null,
      orderId: order.orderId,
      customerId: null,
      manualTabletRequired: true
    };
  }

  const [completedConfirmations] = await connection.query(
    `
      SELECT id
      FROM purchase_confirmations
      WHERE order_id = ?
        AND (? IS NULL OR store_id = ?)
        AND (
          status = 'COMPLETED'
          OR submitted_at IS NOT NULL
          OR final_confirmation_accepted = 1
          OR (signature_data IS NOT NULL AND signature_data <> '')
        )
      LIMIT 1
    `,
    [orderId, effectiveStoreId, effectiveStoreId]
  );

  if (completedConfirmations[0]) {
    return null;
  }

  const [existing] = await connection.query(
    `
      SELECT pct.token
      FROM purchase_confirmation_tokens pct
      INNER JOIN orders o ON o.id = pct.order_id
      WHERE pct.order_id = ?
        AND pct.customer_id = ?
        AND o.store_id = ?
        AND pct.used_at IS NULL
        AND pct.expires_at >= NOW()
      ORDER BY pct.id DESC
      LIMIT 1
    `,
     [orderId, targetCustomerId, effectiveStoreId]
  );

  if (existing[0]) {
    if (!lineUserId) {
      await logWorkflowEvent("purchase_confirmation_manual_tablet_required", "ORDER", order.orderId, {
        reason: "no_line_binding",
        orderNo: order.orderNo,
        customerId: targetCustomerId,
        normalizedPhone
      }, null, connection);
    }
    return {
      token: existing[0].token,
      link: `${config.frontendBaseUrl}/purchase-confirm/${existing[0].token}`,
      lineUserId,
      orderId: order.orderId,
      customerId: targetCustomerId,
      purchaseConfirmationSentAt: order.purchaseConfirmationSentAt || null,
      manualTabletRequired: !lineUserId
    };
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [pendingConfirmations] = await connection.query(
    `
      SELECT id
      FROM purchase_confirmations
      WHERE order_id = ?
        AND customer_id = ?
        AND (? IS NULL OR store_id = ?)
        AND status = 'PENDING'
      ORDER BY id DESC
      LIMIT 1
    `,
    [orderId, targetCustomerId, effectiveStoreId, effectiveStoreId]
  );

  await connection.query(
    `
      INSERT INTO purchase_confirmation_tokens (token, order_id, customer_id, expires_at)
      VALUES (?, ?, ?, ?)
    `,
    [token, order.orderId, targetCustomerId, expiresAt]
  );

  if (pendingConfirmations[0]) {
    await connection.query(
      `
        UPDATE purchase_confirmations
        SET token = ?,
            status = 'PENDING'
        WHERE id = ?
          AND (? IS NULL OR store_id = ?)
      `,
      [token, pendingConfirmations[0].id, effectiveStoreId, effectiveStoreId]
    );
  } else {
    await connection.query(
      `
        INSERT INTO purchase_confirmations (store_id, token, customer_id, order_id, status, created_at)
        VALUES (?, ?, ?, ?, 'PENDING', NOW())
      `,
      [effectiveStoreId, token, targetCustomerId, order.orderId]
    );
  }

  if (!lineUserId) {
    await logWorkflowEvent("purchase_confirmation_manual_tablet_required", "ORDER", order.orderId, {
      reason: "no_line_binding",
      orderNo: order.orderNo,
      customerId: targetCustomerId,
      normalizedPhone
    }, null, connection);
  }

  return {
    token,
    link: `${config.frontendBaseUrl}/purchase-confirm/${token}`,
    lineUserId,
    orderId: order.orderId,
    customerId: targetCustomerId,
    purchaseConfirmationSentAt: order.purchaseConfirmationSentAt || null,
    manualTabletRequired: !lineUserId
  };
}

const LINE_KEYWORDS = {
  menu: ["功能", "功能選單", "選單", "開始", "menu", "MENU", "幫助"],
  repair: ["維修預約", "預約維修", "我要維修", "我要預約維修"],
  orderStatus: ["我的訂單", "訂單查詢", "查詢訂單", "尾款查詢", "查詢尾款", "訂單", "尾款"],
  googleReview: ["Google評論", "Google 評論", "我要評論"],
  purchaseConfirmation: ["購買確認", "購買確認書", "交車確認"],
  survey: ["滿意度調查", "問卷", "維修問卷"],
  progress: ["查詢進度", "維修進度", "我的維修"],
  storeInfo: ["門市資訊", "地址", "營業時間"],
  support: ["客服協助", "真人客服", "聯絡門市"]
};

const REPAIR_RESERVATION_FLOW = "repair_reservation";
const STAFF_REPAIR_ESTIMATE_FLOW = "staff_repair_estimate";
const REPAIR_RESERVATION_STEPS = {
  date: "date",
  time: "time",
  bikeModel: "bike_model",
  issueDescription: "issue_description",
  confirm: "confirm"
};
const STAFF_REPAIR_ESTIMATE_STEPS = {
  repairId: "repair_id",
  items: "items",
  laborFee: "labor_fee",
  notes: "notes",
  totalAmount: "total_amount"
};
const REPAIR_RESERVATION_CANCEL_KEYWORDS = ["取消維修預約", "取消預約", "取消"];
const REPAIR_RESERVATION_CONFIRM_KEYWORDS = ["確認送出維修預約", "確認送出"];
const STAFF_REPAIR_ESTIMATE_CANCEL_KEYWORDS = ["取消", "取消估價", "結束", "退出"];
const STAFF_REPAIR_ESTIMATE_RESET_KEYWORDS = ["重填", "重填品項", "清空", "重新輸入"];
const STAFF_REPAIR_ESTIMATE_CONFIRM_KEYWORDS = ["確認送出", "確認", "送出"];
const REPAIR_RESERVATION_TIME_SLOTS = [
  { label: "14:00-15:00", value: "14:00" },
  { label: "15:00-16:00", value: "15:00" },
  { label: "16:00-17:00", value: "16:00" },
  { label: "18:00-19:00", value: "18:00" },
  { label: "19:00-20:00", value: "19:00" }
];
const REPAIR_COMMON_BIKE_MODELS = ["黑武士", "城市車", "折疊車", "其他車款"];

function matchesKeyword(messageText, keywords) {
  return keywords.includes(messageText);
}

function normalizePhoneForMatch(value) {
  let phone = String(value || "").replace(/[\s\-.()]/g, "");
  if (phone.startsWith("+886")) {
    phone = `0${phone.slice(4)}`;
  } else if (phone.startsWith("886")) {
    phone = `0${phone.slice(3)}`;
  }
  return phone || null;
}

function sqlNormalizedPhone(columnName) {
  const withoutFormatting = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${columnName}, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '')`;
  return `
    CASE
      WHEN ${withoutFormatting} LIKE '+886%' THEN CONCAT('0', SUBSTRING(${withoutFormatting}, 5))
      WHEN ${withoutFormatting} LIKE '886%' THEN CONCAT('0', SUBSTRING(${withoutFormatting}, 4))
      ELSE ${withoutFormatting}
    END
  `;
}

function normalizeAmountText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value)
    .trim()
    .replace(/NT\$?/gi, "")
    .replace(/,/g, "");

  if (!cleaned) {
    return null;
  }

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `NT$${amount.toLocaleString("zh-Hant-TW")}`;
}

async function getRepairOrdersTableColumns(connection = pool) {
  return getTableColumns(connection, "repair_orders");
}

async function getOrdersTableColumns(connection = pool) {
  return getTableColumns(connection, "orders");
}

async function getColumnType(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );
  return rows[0]?.COLUMN_TYPE || "";
}

async function normalizeRepairLinkedOrderStatus(connection, repairStatus) {
  const columnType = String(await getColumnType(connection, "orders", "status") || "");
  const wantsRepairing = repairStatus === "repairing";
  if (wantsRepairing && columnType.includes("'REPAIRING'")) {
    return "REPAIRING";
  }
  if (!wantsRepairing && columnType.includes("'PENDING_PAYMENT'")) {
    return "PENDING_PAYMENT";
  }
  return "PENDING";
}

function parseRepairEstimateItems(messageText) {
  const lines = String(messageText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  const invalidLines = [];

  for (const line of lines) {
    if (line === "完成" || STAFF_REPAIR_ESTIMATE_RESET_KEYWORDS.includes(line)) {
      continue;
    }

    const match = line.match(/^(.+?)[|｜]\s*(\d+(?:\.\d+)?)\s*[|｜]\s*(NT\$?\s*)?(\d+(?:\.\d+)?)$/i);
    if (!match) {
      invalidLines.push(line);
      continue;
    }

    const quantity = Number(match[2]);
    const unitPrice = Number(match[4]);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      invalidLines.push(line);
      continue;
    }

    items.push({
      name: match[1].trim(),
      quantity,
      unitPrice,
      total: quantity * unitPrice
    });
  }

  return { items, invalidLines };
}

function calculateRepairEstimateSubtotal(items = [], inspectionFee = 0, laborFee = 0) {
  const partsTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return Number(partsTotal) + Number(inspectionFee || 0) + Number(laborFee || 0);
}

function formatRepairEstimateDetailText(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const inspectionFee = Number(payload.inspectionFee || 0);
  const laborFee = Number(payload.laborFee || 0);
  const notes = payload.notes ? String(payload.notes).trim() : "";
  const totalAmount = Number(payload.totalAmount || 0);

  const lines = ["維修估價明細"];
  if (items.length > 0) {
    lines.push("品項：");
    items.forEach((item, index) => {
      const productLabel = item.sku ? `${item.name} (${item.sku})` : item.name;
      lines.push(
        `${index + 1}. ${productLabel} × ${Number(item.quantity || 0)} = ${formatCurrency(Number(item.total || 0))}`
      );
    });
  } else {
    lines.push(notes ? `報價內容：${notes}` : "品項：無");
  }

  if (inspectionFee > 0) {
    lines.push(`檢查費：${formatCurrency(inspectionFee)}`);
  }
  if (items.length > 0 || laborFee > 0) {
    lines.push(`工資：${formatCurrency(laborFee)}`);
  }
  lines.push(`總額：${formatCurrency(totalAmount)}`);
  if (items.length > 0 && notes) {
    lines.push(`備註：${notes}`);
  }

  return lines.join("\n");
}

function buildRepairEstimatePreviewText(payload, repairInfo = null) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const totalAmount = Number(payload.totalAmount || 0);
  const inspectionFee = Number(payload.inspectionFee || 0);
  const laborFee = Number(payload.laborFee || 0);
  const notes = payload.notes ? String(payload.notes).trim() : "";
  const partsTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  const lines = [
    "維修估價預覽",
    repairInfo?.id ? `工單：#${repairInfo.id}` : null,
    repairInfo?.customerName ? `客戶：${repairInfo.customerName}` : null,
    repairInfo?.customerPhone ? `電話：${repairInfo.customerPhone}` : null,
    "品項："
  ].filter(Boolean);

  if (items.length === 0) {
    lines.push("  - 尚未輸入品項");
  } else {
    items.forEach((item, index) => {
      const productLabel = item.sku ? `${item.name} (${item.sku})` : item.name;
      lines.push(
        `  ${index + 1}. ${productLabel} x${Number(item.quantity || 0)} ${formatCurrency(Number(item.unitPrice || 0))} = ${formatCurrency(Number(item.total || 0))}`
      );
    });
  }

  lines.push(`檢查費：${formatCurrency(inspectionFee)}`);
  lines.push(`工資：${formatCurrency(laborFee)}`);
  lines.push(`小計：${formatCurrency(partsTotal + inspectionFee + laborFee)}`);
  lines.push(`總額：${formatCurrency(totalAmount)}`);
  if (notes) {
    lines.push(`備註：${notes}`);
  }
  lines.push("回覆「確認送出」可發送給客戶，或直接輸入新總額。");

  return lines.join("\n");
}

function buildRepairEstimateDraftPromptMessages(payload, repairInfo = null, errorText = null) {
  const preview = buildRepairEstimatePreviewText(payload, repairInfo);
  return withCustomerQuickReply([
    {
      type: "text",
      text: [errorText, preview].filter(Boolean).join("\n")
    }
  ]);
}

function buildRepairEstimateCustomerMessages(repairInfo, payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const inspectionFee = Number(payload.inspectionFee || 0);
  const quoteUrl = payload.quoteUrl || buildRepairQuoteConfirmationUrl(repairInfo?.id);
  const lines = [
    "您好，您的車輛維修報價已完成。",
    repairInfo?.id ? `維修單號：#${repairInfo.id}` : null,
    repairInfo?.bikeModel ? `車款：${repairInfo.bikeModel}` : null,
    items.length > 0 ? "品項：" : null,
    ...items.map((item, index) =>
      `${index + 1}. ${item.sku ? `${item.name} (${item.sku})` : item.name} x${Number(item.quantity || 0)} ${formatCurrency(Number(item.unitPrice || 0))} = ${formatCurrency(Number(item.total || 0))}`
    ),
    `檢查費：${formatCurrency(inspectionFee)}`,
    `工資：${formatCurrency(payload.laborFee || 0)}`,
    `報價金額：${formatCurrency(payload.totalAmount || 0)}`,
    payload.notes ? `備註：${payload.notes}` : null,
    "請點選下方連結確認報價內容，並選擇是否同意維修。"
  ].filter(Boolean);

  return withCustomerQuickReply([
    {
      type: "text",
      text: lines.join("\n")
    },
    createButtonMessage(
      "維修報價確認",
      `總額 ${formatCurrency(payload.totalAmount || 0)}\n請確認本次維修報價。`,
      [
        createUriAction("確認維修報價", quoteUrl),
        createPostbackAction("同意報價", "repair_estimate_approve", repairInfo.id),
        createPostbackAction("拒絕報價", "repair_estimate_reject", repairInfo.id)
      ]
    )
  ]);
}

async function getStaffUserByLineUserId(lineUserId, connection = pool) {
  console.log("[line:slash] getStaffUserByLineUserId:start", {
    lineUserId: lineUserId || null
  });
  const [rows] = await connection.query(
    `
      SELECT id, display_name AS name, role, COALESCE(store_id, 0) AS storeId
      FROM staff_users
      WHERE line_user_id = ?
      LIMIT 1
    `,
    [lineUserId]
  );

  console.log("[line:slash] getStaffUserByLineUserId:done", {
    lineUserId: lineUserId || null,
    found: Boolean(rows[0]),
    staffUserId: rows[0]?.id || null
  });
  return rows[0] || null;
}

async function getRepairOrderForQuotation(repairId, connection = pool, storeId = null) {
  const scopedStoreId = requireScopedStoreId(storeId, "維修報價門市範圍");
  const repairColumns = await getRepairOrdersTableColumns(connection);
  const [rows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.status,
        ro.reservation_status AS reservationStatus,
        ro.estimate_sent_at AS estimateSentAt,
        ro.completed_at AS completedAt,
        ro.picked_up_at AS pickedUpAt,
        ro.bike_model AS bikeModel,
        ro.issue_description AS issueDescription,
        ro.estimate_amount AS estimateAmount,
        ro.estimate_details AS estimateDetails,
        ${hasColumn(repairColumns, "inspection_fee") ? "ro.inspection_fee" : "0"} AS inspectionFee,
        ${hasColumn(repairColumns, "parts_fee") ? "ro.parts_fee" : "0"} AS partsFee,
        ${hasColumn(repairColumns, "labor_fee") ? "ro.labor_fee" : "0"} AS laborFee,
        ${hasColumn(repairColumns, "quote_status") ? "ro.quote_status" : "'pending'"} AS quoteStatus,
        ${hasColumn(repairColumns, "quote_notes") ? "ro.quote_notes" : "NULL"} AS quoteNotes,
        ${hasColumn(repairColumns, "quote_items_json") ? "ro.quote_items_json" : "NULL"} AS quoteItemsJson,
        ${hasColumn(repairColumns, "customer_confirmed_at") ? "ro.customer_confirmed_at" : "NULL"} AS customerConfirmedAt,
        ro.customer_estimate_response AS customerEstimateResponse,
        ro.customer_estimate_responded_at AS customerEstimateRespondedAt,
        ro.store_id AS storeId,
        c.name AS customerName,
        c.phone AS customerPhone,
        c.line_user_id AS lineUserId
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
      LIMIT 1
    `,
    [repairId, scopedStoreId]
  );

  return rows[0] || null;
}

async function getAuthorizedStaffGroupBySource(event, connection = pool) {
  const sourceType = event.source?.type;
  const sourceId = sourceType === "group" ? event.source?.groupId : sourceType === "room" ? event.source?.roomId : null;
  console.log("[line:slash] getAuthorizedStaffGroupBySource:start", {
    sourceType,
    sourceId: sourceId || null
  });

  if (!sourceId || (sourceType !== "group" && sourceType !== "room")) {
    console.log("[line:slash] getAuthorizedStaffGroupBySource:skip", {
      sourceType,
      sourceId: sourceId || null
    });
    return null;
  }

  const [rows] = await connection.query(
    `
      SELECT id, line_group_id AS lineGroupId, registration_type AS registrationType
      FROM line_group_registrations
      WHERE line_group_id = ?
        AND is_active = 1
        AND registration_type IN ('admin', 'staff', 'repair', 'inventory', 'daily')
      ORDER BY id DESC
      LIMIT 1
    `,
    [sourceId]
  );

  console.log("[line:slash] getAuthorizedStaffGroupBySource:done", {
    sourceId,
    found: Boolean(rows[0]),
    staffGroupId: rows[0]?.id || null,
    registrationType: rows[0]?.registrationType || null
  });
  return rows[0] || null;
}

function buildPublicUrl(pathname) {
  return `${config.frontendBaseUrl}${pathname}`;
}

function buildRepairQuoteConfirmationUrl(repairId) {
  const params = new URLSearchParams({
    tab: "repair",
    repairId: String(repairId)
  });
  return buildPublicUrl(`/line-progress?${params.toString()}`);
}

function buildStaffPageUrl(pathname, query = "") {
  const normalizedQuery = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return buildPublicUrl(`${pathname}${normalizedQuery}`);
}

function buildMapNavigationUrl() {
  return "https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8D%97%E5%B8%82%E6%9D%B1%E5%8D%80%E6%9D%B1%E9%96%80%E8%B7%AF%E4%BA%8C%E6%AE%B5245%E8%99%9F";
}

function buildCustomerMenuActions() {
  return [
    createMessageAction("維修預約", "維修預約"),
    createMessageAction("Google 評論", "Google 評論"),
    createMessageAction("購買確認書", "購買確認書"),
    createMessageAction("滿意度調查", "滿意度調查"),
    createMessageAction("查詢進度", "查詢進度"),
    createMessageAction("門市資訊", "門市資訊"),
    createMessageAction("客服協助", "客服協助")
  ];
}

function buildStaffLauncherActions() {
  return [
    createUriAction("訂單", buildStaffPageUrl("/pos")),
    createUriAction("維修估價", buildStaffPageUrl("/repairs")),
    createUriAction("新增商品", buildStaffPageUrl("/products", "section=CREATE")),
    createUriAction("庫存管理", buildStaffPageUrl("/inventory", "section=OVERVIEW")),
    createUriAction("發注", buildStaffPageUrl("/inventory", "section=PO")),
    createUriAction("退貨", buildStaffPageUrl("/inventory", "section=RETURN")),
    createUriAction("客戶管理", buildStaffPageUrl("/customers")),
    createUriAction("今日待確認", buildStaffPageUrl("/dashboard"))
  ];
}

function withStaffQuickReply(messages, actions = buildStaffLauncherActions()) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const nextMessages = messages.slice();
  const lastIndex = nextMessages.length - 1;
  if (nextMessages[lastIndex]?.type === "text") {
    nextMessages[lastIndex] = attachQuickReply(nextMessages[lastIndex], actions);
  } else {
    nextMessages.push({
      type: "text",
      text: "請直接點選下方工作台。",
      quickReply: buildQuickReply(actions)
    });
  }
  return nextMessages;
}

function buildStaffLauncherMessages() {
  return withStaffQuickReply([
    createFlexMessage(
      "staff launcher 1",
      "快速工作台",
      [
        "請直接點選常用功能，會開啟手機版後台頁面。",
        "這是 staff 群組的主要快速啟動入口。"
      ],
      [
        createUriAction("訂單", buildStaffPageUrl("/pos")),
        createUriAction("維修估價", buildStaffPageUrl("/repairs")),
        createUriAction("客戶管理", buildStaffPageUrl("/customers")),
        createUriAction("今日待確認", buildStaffPageUrl("/dashboard"))
      ]
    ),
    createFlexMessage(
      "staff launcher 2",
      "營運操作",
      ["商品、庫存與供應商流程。"],
      [
        createUriAction("新增商品", buildStaffPageUrl("/products", "section=CREATE")),
        createUriAction("庫存管理", buildStaffPageUrl("/inventory", "section=OVERVIEW")),
        createUriAction("發注", buildStaffPageUrl("/inventory", "section=PO")),
        createUriAction("退貨", buildStaffPageUrl("/inventory", "section=RETURN"))
      ]
    )
  ]);
}

function buildStaffPageLauncherMessage(title, bodyLines, primaryLabel, pathname, query = "", secondaryActions = []) {
  return withStaffQuickReply([
    createFlexMessage(title, title, bodyLines, [
      createUriAction(primaryLabel, buildStaffPageUrl(pathname, query)),
      ...secondaryActions.slice(0, 3)
    ])
  ]);
}

function buildSlashHelpMessages(scope = "staff") {
  const isStaffScope = scope === "staff";
  const title = isStaffScope ? "指令速查" : "LINE 指令說明";
  const bodyLines = isStaffScope
    ? [
        "可用指令：",
        "/pos 訂單 / POS（開啟手機版 web）",
        "/quote /estimate 維修估價（開啟手機版 web）",
        "/product 新增商品（開啟手機版 web）",
        "/customer 客戶管理（開啟手機版 web）",
        "/pending 今日待確認（LINE 內直接顯示）",
        "/stock SKU（LINE 內直接查詢）",
        "/in SKU 數量（LINE 內直接入庫）",
        "/out SKU 數量（LINE 內直接出庫）",
        "/set SKU 數量（LINE 內直接設庫存）",
        "/po SKU 數量（LINE 內直接發注）",
        "/return SKU 數量 原因（LINE 內直接退貨）",
        "也可以直接點選下方快速工作台。"
      ]
    : [
        "顧客可用功能：",
        "維修預約、Google 評論、購買確認書、滿意度調查、查詢進度、門市資訊、客服協助。",
        "門市 staff 快速指令僅限門市群組使用：",
        "/pos /quote /product /customer /pending",
        "/stock SKU /in SKU 數量 /out SKU 數量 /set SKU 數量",
        "/po SKU 數量 /return SKU 數量 原因",
        "如需這些 staff 指令，請在門市群組中使用。",
        "也可以直接回覆您的需求，我們會盡快協助。"
      ];

  const wrap = isStaffScope ? withStaffQuickReply : withCustomerQuickReply;

  return wrap([
    createFlexMessage(
      title,
      title,
      bodyLines,
      isStaffScope
        ? [
            createUriAction("前往訂單", buildStaffPageUrl("/pos")),
            createUriAction("前往維修估價", buildStaffPageUrl("/repairs")),
            createUriAction("前往商品管理", buildStaffPageUrl("/products", "section=CREATE")),
            createUriAction("前往今日待確認", buildStaffPageUrl("/dashboard"))
          ]
        : [
            createMessageAction("維修預約", "維修預約"),
            createMessageAction("查詢進度", "查詢進度"),
            createMessageAction("門市資訊", "門市資訊"),
            createMessageAction("客服協助", "客服協助")
          ]
    )
  ]);
}

function buildStaffCommandHelpMessages() {
  return buildSlashHelpMessages("staff");
}

function buildSlashPermissionMessages(commandText) {
  return withCustomerQuickReply([
    createFlexMessage(
      "指令說明",
      "指令說明",
      [
        `您輸入的是 ${commandText}。`,
        "這是門市 staff 群組快速指令，請在 staff 群組中使用。",
        "如果您是客戶，請改用維修預約、查詢進度、購買確認書或客服協助。"
      ],
      [
        createMessageAction("查詢進度", "查詢進度"),
        createMessageAction("客服協助", "客服協助"),
        createMessageAction("門市資訊", "門市資訊"),
        createMessageAction("維修預約", "維修預約")
      ]
    )
  ]);
}

async function handleLineSlashCommand(event) {
  const messageText = event.message?.type === "text" ? event.message.text.trim() : "";
  const sourceType = event.source?.type;
  console.log("[line:slash] entry", {
    sourceType,
    userId: event.source?.userId || null,
    groupId: event.source?.groupId || null,
    roomId: event.source?.roomId || null,
    messageText
  });

  try {
    if (!messageText) {
      console.log("[line:slash] skip empty");
      return false;
    }

    const command = parseStaffCommand(messageText);
    console.log("[line:slash] parse result", {
      messageText,
      commandType: command?.type || null,
      commandKey: command?.key || null,
      repairId: command?.repairId || null
    });
    if (!command) {
      console.log("[line:slash] skip no-command-match", { messageText });
      return false;
    }

    const isGroupContext = sourceType === "group" || sourceType === "room";
    const isCustomerContext = sourceType === "user";

    console.log("[line:slash] lookup staffUser:start", {
      userId: event.source?.userId || null
    });
    const staffUser = event.source?.userId ? await getStaffUserByLineUserId(event.source.userId) : null;
    console.log("[line:slash] lookup staffUser:done", {
      staffUserId: staffUser?.id || null
    });

    console.log("[line:slash] lookup staffGroup:start", {
      isGroupContext,
      groupId: event.source?.groupId || null,
      roomId: event.source?.roomId || null
    });
    const staffGroup = isGroupContext ? await getAuthorizedStaffGroupBySource(event) : null;
    console.log("[line:slash] lookup staffGroup:done", {
      staffGroupId: staffGroup?.id || null,
      staffGroupType: staffGroup?.registrationType || null
    });

    const hasStaffAccess = Boolean(staffUser || staffGroup);
    console.log("[line:slash] command", {
      messageText,
      commandType: command.type,
      commandKey: command.key || null,
      repairId: command.repairId || null,
      isGroupContext,
      isCustomerContext,
      hasStaffAccess,
      staffUserId: staffUser?.id || null,
      staffGroupId: staffGroup?.id || null,
      staffGroupType: staffGroup?.registrationType || null
    });

    if (command.type === "help") {
      if (event.replyToken) {
        console.log("[line:slash] before reply help", {
          scope: isGroupContext && hasStaffAccess ? "staff" : "customer"
        });
        await replyToLine(
          event.replyToken,
          isGroupContext && hasStaffAccess ? buildSlashHelpMessages("staff") : buildSlashHelpMessages("customer")
        );
      }
      console.log("[line:slash] handled help");
      return true;
    }

    if (isCustomerContext) {
      if (event.replyToken) {
        console.log("[line:slash] before reply permission:customer", { messageText });
        await replyToLine(event.replyToken, buildSlashPermissionMessages(messageText));
      }
      console.log("[line:slash] handled customer-permission");
      return true;
    }

    if (!hasStaffAccess) {
      if (event.replyToken) {
        console.log("[line:slash] before reply permission:no-staff-access", { messageText });
        await replyToLine(event.replyToken, buildSlashPermissionMessages(messageText));
      }
      console.log("[line:slash] handled no-staff-access");
      return true;
    }

    const handledByStaffCommand = await handleStaffOperationalCommand(event);
    console.log("[line:slash] delegated staff-command", {
      messageText,
      handled: handledByStaffCommand
    });
    return handledByStaffCommand;
  } catch (error) {
    console.log("[line:slash] error", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function parseStaffCommand(messageText) {
  const text = String(messageText || "").trim();
  console.log("[line:slash] parseStaffCommand:start", {
    raw: messageText || null,
    text
  });
  if (!text) {
    console.log("[line:slash] parseStaffCommand:empty");
    return null;
  }

  const normalized = text.replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();

  if (normalized === "訂單" || lower === "/order" || lower === "/order new" || lower === "/pos") {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "order-launcher"
    });
    return { type: "launcher", key: "order" };
  }

  const repairQuoteMatch = normalized.match(/^(維修估價|\/quote|\/estimate)(?:\s+(\d+))?$/i);
  if (repairQuoteMatch) {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "repair-launcher",
      repairId: repairQuoteMatch[2] ? Number(repairQuoteMatch[2]) : null
    });
    return {
      type: "launcher",
      key: "repair",
      repairId: repairQuoteMatch[2] ? Number(repairQuoteMatch[2]) : null
    };
  }

  if (normalized === "新增商品" || lower === "/product" || lower === "/product new" || lower === "/newproduct") {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "product-launcher"
    });
    return { type: "launcher", key: "product" };
  }

  const inventoryStockMatch = normalized.match(/^\/stock\s+([^\s]+)$/i);
  if (normalized === "庫存管理" || inventoryStockMatch) {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "inventory-stock",
      sku: inventoryStockMatch ? inventoryStockMatch[1] : null
    });
    return {
      type: "inventory_stock",
      sku: inventoryStockMatch ? inventoryStockMatch[1] : null
    };
  }

  const movementMatch = normalized.match(/^\/(in|out|set)\s+([^\s]+)\s+(\d+)$/i);
  if (movementMatch) {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "inventory-movement",
      movementType: movementMatch[1].toUpperCase(),
      sku: movementMatch[2],
      qty: Number(movementMatch[3])
    });
    return {
      type: "inventory_movement",
      movementType: movementMatch[1].toUpperCase(),
      sku: movementMatch[2],
      qty: Number(movementMatch[3])
    };
  }

  const poMatch = normalized.match(/^\/po\s+([^\s]+)\s+(\d+)$/i);
  if (normalized === "發注" || poMatch) {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "supplier-po",
      sku: poMatch ? poMatch[1] : null,
      qty: poMatch ? Number(poMatch[2]) : null
    });
    return {
      type: "supplier_request",
      requestType: "PURCHASE_ORDER",
      sku: poMatch ? poMatch[1] : null,
      qty: poMatch ? Number(poMatch[2]) : null,
      reason: null
    };
  }

  const returnMatch = normalized.match(/^\/return\s+([^\s]+)\s+(\d+)(?:\s+(.+))?$/i);
  if (normalized === "退貨" || returnMatch) {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "supplier-return",
      sku: returnMatch ? returnMatch[1] : null,
      qty: returnMatch ? Number(returnMatch[2]) : null
    });
    return {
      type: "supplier_request",
      requestType: "RETURN",
      sku: returnMatch ? returnMatch[1] : null,
      qty: returnMatch ? Number(returnMatch[2]) : null,
      reason: returnMatch ? (returnMatch[3] || "") : ""
    };
  }

  if (normalized === "客戶管理" || lower === "/customer" || /^\/customer\s+/.test(lower)) {
    const phoneMatch = normalized.match(/^\/customer\s+([0-9+\-\s]+)$/i);
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: "customer-launcher",
      phone: phoneMatch ? phoneMatch[1].trim() : null
    });
    return {
      type: "launcher",
      key: "customer",
      phone: phoneMatch ? phoneMatch[1].trim() : null
    };
  }

  if (normalized === "今日待確認" || lower === "/pending" || lower === "/help") {
    console.log("[line:slash] parseStaffCommand:match", {
      normalized,
      branch: lower === "/help" ? "help" : "pending"
    });
    return {
      type: lower === "/help" ? "help" : "pending"
    };
  }

  console.log("[line:slash] parseStaffCommand:no-match", {
    normalized
  });
  return null;
}

function normalizeStoreId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function requireScopedStoreId(value, label = "line workflow store scope") {
  const scopedStoreId = normalizeStoreId(value);
  if (!scopedStoreId) {
    throw createError(`缺少${label}`, 403);
  }
  return scopedStoreId;
}

async function logLegacyLineWorkflowStoreFallback(reason, payload = {}, connection = pool) {
  const logPayload = { reason, fallbackStoreId: 1, ...payload };
  console.warn("[line:store-scope] legacy fallback", logPayload);
  try {
    await logWorkflowEvent("line_workflow_legacy_store_fallback", "STORE", 1, logPayload, null, connection);
  } catch (error) {
    console.warn("[line:store-scope] fallback log failed", { reason, error: error?.message || String(error) });
  }
}

async function resolveLineWorkflowStoreContext({ storeId = null, lineUserId = null, staffId = null, connection = pool, reason = "line_workflow" } = {}) {
  const explicitStoreId = normalizeStoreId(storeId) || normalizeStoreId(lineAccessTokenOptionsStorage.getStore()?.storeId);
  if (explicitStoreId) {
    return { storeId: explicitStoreId, source: "explicit", legacyFallback: false };
  }

  if (staffId) {
    const [[staff]] = await connection.query("SELECT store_id AS storeId FROM staff_users WHERE id = ? LIMIT 1", [staffId]);
    const staffStoreId = normalizeStoreId(staff?.storeId);
    if (staffStoreId) {
      return { storeId: staffStoreId, source: "staff", legacyFallback: false };
    }
  }

  if (lineUserId) {
    const [stores] = await connection.query(
      "SELECT DISTINCT store_id AS storeId FROM customers WHERE line_user_id = ? AND store_id IS NOT NULL ORDER BY store_id ASC",
      [lineUserId]
    );
    const storeIds = stores.map((row) => normalizeStoreId(row.storeId)).filter(Boolean);
    if (storeIds.length === 1) {
      return { storeId: storeIds[0], source: "line_customer", legacyFallback: false };
    }
    if (storeIds.length > 1) {
      await logLegacyLineWorkflowStoreFallback(reason, { lineUserId, matchedStoreIds: storeIds }, connection);
      return { storeId: 1, source: "legacy_fallback_ambiguous_line_user", legacyFallback: true };
    }
  }

  await logLegacyLineWorkflowStoreFallback(reason, { lineUserId: lineUserId || null, staffId: staffId || null }, connection);
  return { storeId: 1, source: "legacy_fallback", legacyFallback: true };
}

async function findProductBySku(sku, connection = pool, storeId = null) {
  const resolvedStoreId = normalizeStoreId(storeId);
  const conditions = ["sku = ?"];
  const params = [sku];
  if (resolvedStoreId) {
    conditions.push("store_id = ?");
    params.push(resolvedStoreId);
  }

  const [rows] = await connection.query(
    `
      SELECT id, name, sku, stock, reorder_level AS reorderLevel, category
      FROM products
      WHERE ${conditions.join(" AND ")}
      LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

async function applyInventoryCommandMovement({ sku, movementType, qty, staffId, note = null, storeId = null }) {
  return withTransaction(async (connection) => {
    const resolvedStoreId = normalizeStoreId(storeId);
    if (!resolvedStoreId) {
      return { error: "無法判斷操作員店別，請先設定店別後再操作" };
    }

    const product = await findProductBySku(sku, connection, resolvedStoreId);
    if (!product) {
      return { error: "找不到 SKU 對應的商品" };
    }

    const normalizedQty = Number(qty);
    if (!Number.isInteger(normalizedQty) || normalizedQty <= 0) {
      return { error: "數量必須為正整數" };
    }

    const currentStock = Number(product.stock || 0);
    let nextStock = currentStock;
    let movementQty = normalizedQty;

    if (movementType === "IN") {
      nextStock = currentStock + normalizedQty;
      movementQty = normalizedQty;
    } else if (movementType === "OUT") {
      nextStock = currentStock - normalizedQty;
      movementQty = -normalizedQty;
    } else if (movementType === "SET") {
      nextStock = normalizedQty;
      movementQty = normalizedQty - currentStock;
    } else {
      return { error: "不支援的庫存異動類型" };
    }

    if (nextStock < 0) {
      return { error: "庫存不可小於 0" };
    }

    await connection.query(
      `
        UPDATE products
        SET stock = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [nextStock, product.id, resolvedStoreId]
    );

    await connection.query(
      `
        INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        product.id,
        movementType === "SET" ? "ADJUST" : movementType,
        movementQty,
        note || `LINE 指令 ${movementType}`,
        staffId
      ]
    );

    await logWorkflowEvent(
      "inventory_command_executed",
      "PRODUCT",
      product.id,
      { sku, movementType, qty: normalizedQty, nextStock },
      staffId,
      connection
    );

    return {
      product,
      currentStock,
      nextStock,
      movementQty
    };
  });
}

async function createSupplierRequestFromCommand({ requestType, sku, qty, reason, staffId, storeId = null }) {
  return withTransaction(async (connection) => {
    const resolvedStoreId = normalizeStoreId(storeId);
    if (!resolvedStoreId) {
      return { error: "無法判斷操作員店別，請先設定店別後再操作" };
    }

    const product = await findProductBySku(sku, connection, resolvedStoreId);
    if (!product) {
      return { error: "找不到 SKU 對應的商品" };
    }

    const normalizedQty = Number(qty);
    if (!Number.isInteger(normalizedQty) || normalizedQty <= 0) {
      return { error: "數量必須為正整數" };
    }

    const [requestResult] = await connection.query(
      `
        INSERT INTO supplier_requests (request_type, status, supplier_name, note, requested_by_staff_id)
        VALUES (?, 'PENDING_SUPPLIER', NULL, ?, ?)
      `,
      [requestType, reason || null, staffId]
    );

    await connection.query(
      `
        INSERT INTO supplier_request_items (supplier_request_id, product_id, quantity, reason, note)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        requestResult.insertId,
        product.id,
        normalizedQty,
        requestType === "RETURN" ? reason || null : null,
        reason || null
      ]
    );

    await logWorkflowEvent(
      "supplier_request_created",
      "SUPPLIER_REQUEST",
      requestResult.insertId,
      { requestType, sku, qty: normalizedQty, source: "line_command" },
      staffId,
      connection
    );

    return {
      id: requestResult.insertId,
      product,
      qty: normalizedQty
    };
  });
}

async function getPendingSummaryCounts(connection = pool) {
  const [[summary]] = await connection.query(
    `
      SELECT
        (SELECT COUNT(*) FROM purchase_confirmation_tokens WHERE used_at IS NULL AND expires_at >= NOW()) AS purchaseConfirmationsPending,
        (SELECT COUNT(*) FROM repair_orders WHERE status IN ('checking', 'reserved', 'estimate_pending_approval', 'estimate_approved', 'completed_waiting_pickup')) AS repairsPending,
        (SELECT COUNT(*) FROM coupons WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL) AS reviewPending
    `
  );

  return summary || {
    purchaseConfirmationsPending: 0,
    repairsPending: 0,
    reviewPending: 0
  };
}

function buildStockCommandMessages(product, movementType = null, qty = null, nextStock = null, errorText = null) {
  if (!product) {
    return withStaffQuickReply([
      createFlexMessage(
        "庫存查詢",
        "庫存查詢",
        [errorText || "請輸入 /stock {sku} 查詢庫存。"],
        [createUriAction("前往庫存管理", buildStaffPageUrl("/inventory", "section=OVERVIEW"))]
      )
    ]);
  }

  const lines = [
    errorText,
    `商品：${product.name}`,
    `SKU：${product.sku}`,
    `目前庫存：${nextStock !== null && nextStock !== undefined ? nextStock : product.stock}`,
    product.reorderLevel !== null && product.reorderLevel !== undefined ? `警戒值：${product.reorderLevel}` : null
  ].filter(Boolean);

  return withStaffQuickReply([
    createFlexMessage(
      movementType ? "庫存異動完成" : "庫存查詢完成",
      movementType ? "庫存異動完成" : "庫存查詢完成",
      lines,
      [
        createUriAction("前往庫存管理", buildStaffPageUrl("/inventory", "section=OVERVIEW")),
        createUriAction("前往商品管理", buildStaffPageUrl("/products"))
      ]
    )
  ]);
}

function buildSupplierRequestMessages(result, requestType, reason = null) {
  const requestLabel = requestType === "RETURN" ? "退貨" : "發注";
  return withStaffQuickReply([
    createFlexMessage(
      `${requestLabel}已建立`,
      `${requestLabel}已建立`,
      [
        `單號：#${result.id}`,
        `商品：${result.product.name}`,
        `SKU：${result.product.sku}`,
        `數量：${result.qty}`,
        reason ? `原因：${reason}` : null
      ].filter(Boolean),
      [
        createUriAction("前往庫存管理", buildStaffPageUrl("/inventory", requestType === "RETURN" ? "section=RETURN" : "section=PO")),
        createUriAction("前往今日待確認", buildStaffPageUrl("/dashboard"))
      ]
    )
  ]);
}

function buildPendingSummaryMessages(summary) {
  return withStaffQuickReply([
    createFlexMessage(
      "今日待確認",
      "今日待確認",
      [
        `購買確認待處理：${summary.purchaseConfirmationsPending}`,
        `維修待處理：${summary.repairsPending}`,
        `Google 評論待確認：${summary.reviewPending}`
      ],
      [
        createUriAction("前往今日待確認", buildStaffPageUrl("/dashboard")),
        createUriAction("前往維修管理", buildStaffPageUrl("/repairs")),
        createUriAction("前往訂單", buildStaffPageUrl(payload.orderId ? `/orders/${payload.orderId}/edit` : "/customers"))
      ]
    )
  ]);
}

async function handleStaffOperationalCommand(event) {
  const lineUserId = event.source?.userId;
  const messageText = event.message?.type === "text" ? event.message.text.trim() : "";
  const sourceType = event.source?.type;
  console.log("[line:staff] entry", {
    sourceType,
    lineUserId: lineUserId || null,
    messageText
  });
  if (!messageText || (sourceType !== "group" && sourceType !== "room")) {
    console.log("[line:staff] skip invalid-context", {
      sourceType,
      messageText
    });
    return false;
  }

  const staffUser = await getStaffUserByLineUserId(lineUserId);
  const staffGroup = await getAuthorizedStaffGroupBySource(event);
  if (!staffUser && !staffGroup) {
    console.log("[line:staff] skip no-staff-access", {
      lineUserId: lineUserId || null,
      messageText
    });
    return false;
  }

  const command = parseStaffCommand(messageText);
  if (!command) {
    console.log("[line:staff] skip no-command", {
      messageText
    });
    return false;
  }
  console.log("[line:staff] command", {
    messageText,
    commandType: command.type,
    commandKey: command.key || null
  });

  const reply = async (messages) => {
    if (event.replyToken) {
      console.log("[line:staff] before replyToLine", {
        messageText,
        messageCount: Array.isArray(messages) ? messages.length : 0,
        messageTypes: Array.isArray(messages) ? messages.map((message) => message?.type || "unknown") : []
      });
      await replyToLine(event.replyToken, messages);
      console.log("[line:staff] after replyToLine success", {
        messageText
      });
    }
  };

  if (command.type === "launcher") {
    if (command.key === "order") {
      console.log("[line:staff] branch order-launcher");
      await reply(
        buildStaffPageLauncherMessage(
          "訂單 / POS",
          ["請使用手機版 POS 建立或處理訂單。"],
          "前往訂單",
          "/pos"
        )
      );
      return true;
    }

    if (command.key === "repair") {
      console.log("[line:staff] branch repair-launcher", {
        repairId: command.repairId || null
      });
      const query = command.repairId ? `/repairs/${command.repairId}` : "/repairs";
      await reply(
        buildStaffPageLauncherMessage(
          "維修估價",
          [
            command.repairId ? `維修單 #${command.repairId}` : "請先打開維修管理，再選擇工單進行估價。",
            "估價、送出與客戶回覆都在 web 管理頁處理。"
          ],
          "前往維修估價",
          query
        )
      );
      return true;
    }

    if (command.key === "product") {
      console.log("[line:staff] branch product-launcher");
      await reply(
        buildStaffPageLauncherMessage(
          "新增商品",
          ["請使用手機版商品管理頁新增或編輯商品。"],
          "前往新增商品",
          "/products",
          "section=CREATE"
        )
      );
      return true;
    }

    if (command.key === "customer") {
      console.log("[line:staff] branch customer-launcher", {
        phone: command.phone || null
      });
      const query = command.phone ? `section=LIST&search=${encodeURIComponent(command.phone)}` : "section=LIST";
      await reply(
        buildStaffPageLauncherMessage(
          "客戶管理",
          [
            command.phone ? `關鍵字：${command.phone}` : "請打開客戶管理頁搜尋或編輯客戶資料。",
            "客戶 CRM、歷程與手動更新都在 web 進行。"
          ],
          "前往客戶管理",
          "/customers",
          query
        )
      );
      return true;
    }

    return false;
  }

  if (command.type === "inventory_stock") {
    console.log("[line:staff] branch inventory-stock", {
      sku: command.sku || null
    });
    if (!staffUser?.storeId) {
      await reply(
        buildStockCommandMessages(
          null,
          null,
          null,
          null,
          "無法判斷操作員店別，請先綁定店員帳號。"
        )
      );
      return true;
    }
    if (!command.sku) {
      await reply(buildStockCommandMessages(null, null, null, null, "請輸入 /stock {sku}"));
      return true;
    }

    const product = await findProductBySku(command.sku, pool, staffUser.storeId);
    if (!product) {
      await reply(buildStockCommandMessages(null, null, null, null, `找不到 SKU：${command.sku}`));
      return true;
    }

    await reply(buildStockCommandMessages(product));
    return true;
  }

  if (command.type === "inventory_movement") {
    console.log("[line:staff] branch inventory-movement", {
      sku: command.sku,
      movementType: command.movementType,
      qty: command.qty
    });
    if (!staffUser) {
      await reply(
        withStaffQuickReply([
          {
            type: "text",
            text: "目前這個群組可以使用庫存指令，但要寫入操作紀錄仍需要先綁定員工帳號。"
          }
        ])
      );
      return true;
    }

    const result = await applyInventoryCommandMovement({
      sku: command.sku,
      movementType: command.movementType,
      qty: command.qty,
      staffId: staffUser.id,
      note: `LINE 指令 ${messageText}`,
      storeId: staffUser.storeId
    });

    if (result.error) {
      await reply(withStaffQuickReply([{ type: "text", text: result.error }]));
      return true;
    }

    await reply(buildStockCommandMessages(result.product, command.movementType, command.qty, result.nextStock));
    return true;
  }

  if (command.type === "supplier_request") {
    console.log("[line:staff] branch supplier-request", {
      requestType: command.requestType,
      sku: command.sku || null,
      qty: command.qty || null
    });
    if (!command.sku || !command.qty) {
      await reply(
        withStaffQuickReply([
          {
            type: "text",
            text:
              command.requestType === "RETURN"
                ? "請輸入 /return {sku} {qty} {reason}"
                : "請輸入 /po {sku} {qty}"
          }
        ])
      );
      return true;
    }

    if (!staffUser) {
      await reply(
        withStaffQuickReply([
          {
            type: "text",
            text: "目前這個群組可以使用發注/退貨指令，但要建立單據仍需要先綁定員工帳號。"
          }
        ])
      );
      return true;
    }

    const result = await createSupplierRequestFromCommand({
      requestType: command.requestType,
      sku: command.sku,
      qty: command.qty,
      reason: command.reason,
      staffId: staffUser.id,
      storeId: staffUser.storeId
    });

    if (result.error) {
      await reply(withStaffQuickReply([{ type: "text", text: result.error }]));
      return true;
    }

    await sendToGroups(["inventory", "admin"], [
      buildGroupApprovalMessage("supplier_request", {
        id: result.id,
        requestTypeLabel: command.requestType === "RETURN" ? "退貨" : "發注",
        supplierName: "-",
        approveAction: command.requestType === "RETURN" ? "supplier_return_approve" : "supplier_po_approve",
        rejectAction: command.requestType === "RETURN" ? "supplier_return_reject" : "supplier_po_reject"
      })
    ]);

    await reply(buildSupplierRequestMessages(result, command.requestType, command.reason));
    return true;
  }

  if (command.type === "pending") {
    console.log("[line:staff] branch pending");
    const summary = await getPendingSummaryCounts();
    await reply(buildPendingSummaryMessages(summary));
    return true;
  }

  if (command.type === "help") {
    console.log("[line:staff] branch help");
    await reply(buildStaffCommandHelpMessages());
    return true;
  }

  console.log("[line:staff] exit unhandled", {
    messageText,
    commandType: command.type
  });
  return false;
}

function buildQuickReply(actions = buildCustomerMenuActions()) {
  return {
    items: actions.slice(0, 13).map((action) => ({
      type: "action",
      action
    }))
  };
}

function attachQuickReply(message, actions = buildCustomerMenuActions()) {
  return {
    ...message,
    quickReply: buildQuickReply(actions)
  };
}

function withCustomerQuickReply(messages, actions = buildCustomerMenuActions()) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const nextMessages = messages.slice();
  const lastIndex = nextMessages.length - 1;
  if (nextMessages[lastIndex]?.type === "text") {
    nextMessages[lastIndex] = attachQuickReply(nextMessages[lastIndex], actions);
  } else {
    nextMessages.push({
      type: "text",
      text: "請直接點選下方服務選單。",
      quickReply: buildQuickReply(actions)
    });
  }
  return nextMessages;
}

function buildCustomerMenuMessages(prompt = "請直接點選您要進行的服務。") {
  return [createQuickReplyText(prompt, buildCustomerMenuActions())];
}

function buildWelcomeMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "歡迎加入 KINGWAY 台南。",
        "請回覆您的手機號碼完成綁定，門市可更快協助您查詢訂單、維修與售後服務。",
        "也可以回覆預算、預計購買時間與用途，讓門市更快協助您。"
      ].join("\n")
    }
  ]);
}

function buildCustomerRepairEntryMessages() {
  const today = dayjs().format("YYYY-MM-DD");
  const nextMonth = dayjs().add(30, "day").format("YYYY-MM-DD");
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "您好，歡迎使用 KINGWAY 維修預約服務 🔧",
        "請先選擇預約日期。",
        "可直接點選下方「選擇日期」開啟日期選擇器。",
        "接著系統會依序詢問預約時間、車款與維修內容。",
        "送出摘要確認後，門市人員會審核並回覆您結果。"
      ].join("\n")
    }
  ], [
    createDatetimePickerAction("選擇日期", "action=repair_reservation_pick_date", "date", {
      initial: today,
      min: today,
      max: nextMonth
    }),
    createMessageAction("取消維修預約", "取消維修預約")
  ]);
}

function buildPhoneBindingMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: "請直接回覆您的手機號碼，例如：0912345678"
    }
  ]);
}

function buildPhoneBoundMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: "手機已綁定。您現在可以使用購買預約、維修預約、購買確認書與客服服務。"
    }
  ]);
}

function buildCouponBindingRequiredMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "您好 🎁",
        "使用會員服務前，請先完成手機綁定。",
        "完成綁定後，門市可提供訂單、維修與售後服務。",
        "",
        "如要綁定手機，請直接點下方「綁定手機」或回覆您的手機號碼。"
      ].join("\n")
    }
  ], [
    createMessageAction("綁定手機", "我要綁定手機"),
    ...buildCustomerMenuActions()
  ]);
}



async function findCustomerIdByLineUserId(lineUserId) {
  const [[customer]] = await pool.query(
    `SELECT id FROM customers WHERE line_user_id = ? LIMIT 1`,
    [lineUserId]
  );
  return customer?.id || null;
}


async function buildCustomerOrderStatusMessages(lineUserId) {
  const [rows] = await pool.query(
    `
      SELECT
        o.id,
        o.order_no AS orderNo,
        o.total_amount AS totalAmount,
        o.deposit_amount AS depositAmount,
        o.unpaid_balance AS unpaidBalance,
        o.final_payment_status AS finalPaymentStatus,
        o.status,
        o.created_at AS createdAt,
        GROUP_CONCAT(oi.product_name_snapshot ORDER BY oi.id SEPARATOR ' / ') AS productNames
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE c.line_user_id = ?
      GROUP BY o.id
      ORDER BY o.id DESC
      LIMIT 5
    `,
    [lineUserId]
  );

  if (!rows.length) {
    return [
      {
        type: "text",
        text: "目前查不到您的訂單紀錄。若您剛剛才下單，請稍後再查詢，或聯絡門市人員協助。"
      }
    ];
  }

  const statusLabel = (status) => {
    if (status === "PAID") return "已完款";
    if (status === "PARTIAL") return "部分付款";
    if (status === "UNPAID") return "未付款";
    return status || "-";
  };

  const lines = ["📋 您的最近訂單"];

  rows.forEach((row, index) => {
    lines.push("");
    lines.push(`【${index + 1}】${row.orderNo}`);
    if (row.productNames) lines.push(`商品：${row.productNames}`);
    lines.push(`總金額：NT$ ${Number(row.totalAmount || 0).toLocaleString()}`);
    lines.push(`已付：NT$ ${Number(row.depositAmount || 0).toLocaleString()}`);
    lines.push(`未付：NT$ ${Number(row.unpaidBalance || 0).toLocaleString()}`);
    lines.push(`付款狀態：${statusLabel(row.finalPaymentStatus)}`);
  });

  lines.push("");
  lines.push("※ 實際金額請以門市最終確認為準。");

  return [
    withCustomerQuickReply(
      {
        type: "text",
        text: lines.join("\n")
      },
      [
        createMessageAction("尾款查詢", "尾款查詢"),
        createMessageAction("購買確認書", "購買確認書"),
        createMessageAction("客服協助", "客服協助"),
        createMessageAction("維修預約", "維修預約")
      ]
    )
  ];
}






async function notifyStaffCustomerSupport(lineUserId, messageText = "客服協助") {
  const [[customer]] = await pool.query(
    `
      SELECT id, name, phone, line_user_id AS lineUserId
      FROM customers
      WHERE line_user_id = ?
      LIMIT 1
    `,
    [lineUserId]
  );

  const [orders] = await pool.query(
    `
      SELECT order_no AS orderNo, total_amount AS totalAmount, unpaid_balance AS unpaidBalance, final_payment_status AS finalPaymentStatus
      FROM orders
      WHERE customer_id = ?
      ORDER BY id DESC
      LIMIT 3
    `,
    [customer?.id || 0]
  );

  const lines = [
    "📩 LINE 客戶需要客服協助",
    "",
    `姓名：${customer?.name || "LINE 客戶"}`,
    `電話：${customer?.phone || "-"}`,
    `LINE UID：${lineUserId}`,
    "",
    "最近訂單："
  ];

  if (orders.length) {
    orders.forEach((o, index) => {
      lines.push(`${index + 1}. ${o.orderNo} / 未付 NT$ ${Number(o.unpaidBalance || 0).toLocaleString()} / ${o.finalPaymentStatus}`);
    });
  } else {
    lines.push("目前查無訂單");
  }

  lines.push("");
  lines.push(`觸發內容：${messageText}`);

  await sendToGroupsWithResult(["admin", "staff"], [
    {
      type: "text",
      text: lines.join("\n"),
      actions: [
        { type: "postback", label: "已聯絡客戶", data: `action=support_contacted&id=${customer?.id || 0}` },
        { type: "postback", label: "處理完成", data: `action=support_done&id=${customer?.id || 0}` }
      ]
    }
  ]);
}


async function buildCustomerBalanceMessages(lineUserId) {
  const [rows] = await pool.query(
    `
      SELECT
        o.order_no AS orderNo,
        o.total_amount AS totalAmount,
        o.deposit_amount AS depositAmount,
        o.unpaid_balance AS unpaidBalance,
        o.final_payment_status AS finalPaymentStatus,
        GROUP_CONCAT(oi.product_name_snapshot ORDER BY oi.id SEPARATOR ' / ') AS productNames
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE c.line_user_id = ?
        AND o.unpaid_balance > 0
      GROUP BY o.id
      ORDER BY o.id DESC
      LIMIT 5
    `,
    [lineUserId]
  );

  if (!rows.length) {
    return withCustomerQuickReply([
      {
        type: "text",
        text: "✅ 您目前沒有待付款訂單。"
      }
    ]);
  }

  const lines = ["💰 您目前的待付款訂單"];

  rows.forEach((row, index) => {
    lines.push("");
    lines.push(`【${index + 1}】${row.orderNo}`);
    if (row.productNames) {
      lines.push(`商品：${row.productNames}`);
    }
    lines.push(`未付金額：NT$ ${Number(row.unpaidBalance || 0).toLocaleString()}`);
  });

  lines.push("");
  lines.push("※ 實際金額請以門市最終確認為準。");

  return withCustomerQuickReply([
    {
      type: "text",
      text: lines.join("\n")
    }
  ]);
}


function buildCustomerServiceMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "會員服務：",
        "- 訂單查詢",
        "- 維修預約與進度",
        "- 購買確認書與客服協助",
        "如需協助，請直接留言給門市。"
      ].join("\n")
    }
  ]);
}

function buildGoogleReviewEntryMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "感謝您支持 KINGWAY ⭐",
        "如果您願意幫我們留下 Google 評論，請在 Google 地圖搜尋 KINGWAY 台南門市並完成評論。",
        "完成後，請再點下方「我已完成評論」，門市將確認您的回饋。"
      ].join("\n")
    }
  ], [
    createMessageAction("我已完成評論", "我已完成評論"),
    ...buildCustomerMenuActions().filter((action) => action.label !== "Google 評論")
  ]);
}

function buildGoogleReviewSubmittedMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "已收到您的通知 ✅",
        "我們會由門市人員確認 Google 評論內容。",
        "感謝您的回饋。"
      ].join("\n")
    }
  ]);
}

function buildPurchaseConfirmationMessages(token) {
  if (!token) {
    return withCustomerQuickReply([
      {
        type: "text",
        text: [
          "您目前沒有新的待填寫購買確認書。",
          "若您已完成簽名，系統已保存您的確認紀錄。",
          "如有新購車訂單，完成付款後會再次收到確認連結。"
        ].join("\n")
      }
    ]);
  }

  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "請點擊下方連結完成購買確認書：",
        buildPublicUrl(`/purchase-confirm/${token}`)
      ].join("\n")
    }
  ]);
}

async function findPendingPurchaseConfirmationTokenForLineUser(lineUserId) {
  if (!lineUserId) {
    return null;
  }

  const storeContext = await resolveLineWorkflowStoreContext({
    lineUserId,
    reason: "purchase_confirmation_line_user"
  });
  const storeId = storeContext.storeId;

  const [customers] = await pool.query(
    `
      SELECT id, phone, store_id AS storeId
      FROM customers
      WHERE line_user_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [lineUserId, storeId]
  );

  const customer = customers[0];
  if (!customer) {
    return null;
  }

  const normalizedPhone = normalizePhoneForMatch(customer.phone);

  const normalizedOrderPhone = sqlNormalizedPhone("o.customer_phone");
  const normalizedOrderCustomerPhone = sqlNormalizedPhone("oc.phone");
  const [orders] = await pool.query(
    `
      SELECT o.id AS orderId
      FROM orders o
      LEFT JOIN customers oc ON oc.id = o.customer_id
        AND oc.store_id = o.store_id
      WHERE o.store_id = ?
        AND o.status = 'COMPLETED'
        AND o.final_payment_status = 'PAID'
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          INNER JOIN products p ON p.id = oi.product_id
            AND p.store_id = o.store_id
          WHERE oi.order_id = o.id
            AND oi.store_id = o.store_id
            AND p.requires_purchase_confirmation = 1
        )
        AND (
          o.customer_id = ?
          OR (${normalizedOrderPhone}) = ?
          OR (${normalizedOrderCustomerPhone}) = ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM purchase_confirmations pc
          WHERE pc.order_id = o.id
            AND pc.store_id = o.store_id
            AND (
              pc.status = 'COMPLETED'
              OR pc.submitted_at IS NOT NULL
              OR pc.final_confirmation_accepted = 1
              OR (pc.signature_data IS NOT NULL AND pc.signature_data <> '')
            )
        )
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 1
    `,
    [storeId, customer.id, normalizedPhone, normalizedPhone]
  );

  const order = orders[0];
  if (!order) {
    return null;
  }

  return withTransaction(async (connection) => {
    const [existingTokens] = await connection.query(
      `
        SELECT pct.token
        FROM purchase_confirmation_tokens pct
        INNER JOIN orders o ON o.id = pct.order_id
        WHERE pct.order_id = ?
          AND pct.customer_id = ?
          AND o.store_id = ?
          AND pct.used_at IS NULL
          AND pct.expires_at >= NOW()
        ORDER BY pct.id DESC
        LIMIT 1
      `,
       [order.orderId, customer.id, storeId]
    );

    if (existingTokens[0]) {
      return existingTokens[0].token;
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [pendingConfirmations] = await connection.query(
      `
        SELECT id
        FROM purchase_confirmations
        WHERE order_id = ?
          AND customer_id = ?
          AND store_id = ?
          AND status = 'PENDING'
        ORDER BY id DESC
        LIMIT 1
      `,
       [order.orderId, customer.id, storeId]
    );

    await connection.query(
      `
        INSERT INTO purchase_confirmation_tokens (token, order_id, customer_id, expires_at)
        VALUES (?, ?, ?, ?)
      `,
      [token, order.orderId, customer.id, expiresAt]
    );

    if (pendingConfirmations[0]) {
      await connection.query(
        `
          UPDATE purchase_confirmations
          SET token = ?,
              status = 'PENDING'
          WHERE id = ?
            AND store_id = ?
        `,
        [token, pendingConfirmations[0].id, storeId]
      );
    } else {
      await connection.query(
        `
          INSERT INTO purchase_confirmations (store_id, token, customer_id, order_id, status, created_at)
          VALUES (?, ?, ?, ?, 'PENDING', NOW())
        `,
        [storeId, token, customer.id, order.orderId]
      );
    }

    return token;
  });
}

function buildSurveyMessages(token) {
  if (!token) {
    return withCustomerQuickReply([
      {
        type: "text",
        text: "您好 🙌\n目前沒有可填寫的問卷，若您近期剛完成維修或服務，請稍候再試。"
      }
    ]);
  }

  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "您好 🙌",
        "如果您近期有完成維修或服務，歡迎填寫滿意度調查。",
        `填寫連結：${buildPublicUrl(`/surveys/${token}`)}`
      ].join("\n")
    }
  ]);
}

function buildProgressMessages(latestRepair, latestOrder) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "查詢進度：門市人員會在此回覆您目前狀態。",
        "可查詢內容包含：訂單狀態、維修進度、待確認項目。",
        latestRepair ? `最新維修：#${latestRepair.id} / ${latestRepair.status}` : "最新維修：目前沒有維修工單",
        latestOrder ? `最新訂單：${latestOrder.orderNo} / 完款狀態 ${latestOrder.finalPaymentStatus}` : "最新訂單：目前沒有訂單紀錄",
        latestOrder?.purchaseConfirmationSentAt ? "購買確認書：已送出" : "購買確認書：目前沒有待確認項目"
      ].join("\n")
    }
  ]);
}

async function buildStoreInfoMessages() {
  let store = {
    storeName: "KINGWAY 台南門市",
    address: "台南市東區東門路二段245號",
    businessHours: "每日 13:00 - 21:00",
    googleMapUrl: buildMapNavigationUrl(),
    mapUrl: buildMapNavigationUrl(),
    contactPhone: "",
    lineOaDisplayInfo: "歡迎透過 KINGWAY LINE 官方帳號聯絡門市。",
    storeDescription: "歡迎透過 LINE 與門市聯繫，確認庫存、維修與交車流程。"
  };

  try {
    store = { ...store, ...(await getPublicStoreSettings()) };
  } catch (error) {
    // Fall back to the built-in defaults so the customer flow keeps working.
  }

  const lines = [
    store.storeName || "KINGWAY 台南門市",
    `地址：${store.address || "-"}`,
    `營業時間：${store.businessHours || "-"}`,
    store.contactPhone ? `聯絡電話：${store.contactPhone}` : null,
    store.lineOaDisplayInfo ? store.lineOaDisplayInfo : null,
    `地圖導航：${store.googleMapUrl || store.mapUrl || buildMapNavigationUrl()}`,
    store.storeDescription ? store.storeDescription : null
  ].filter(Boolean);
  return withCustomerQuickReply([
    {
      type: "text",
      text: lines.join("\n")
    }
  ]);
}

function buildSupportMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "客服協助：請直接在此留言，門市人員會協助您。",
        "可協助內容：購車建議、維修問題、訂單查詢、交車確認。",
        "請直接留言您的需求，我們會盡快回覆您。"
      ].join("\n")
    }
  ]);
}

function buildRepairReservationWizardActions(actions = []) {
  return [...actions, createMessageAction("取消維修預約", "取消維修預約")];
}

function buildRepairReservationDatePromptMessages(errorText = null) {
  const today = dayjs().format("YYYY-MM-DD");
  const nextMonth = dayjs().add(30, "day").format("YYYY-MM-DD");
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        errorText,
        "請先選擇預約日期。",
        "可直接點選下方「選擇日期」開啟日期選擇器。"
      ].filter(Boolean).join("\n")
    }
  ], buildRepairReservationWizardActions([
    createDatetimePickerAction("選擇日期", "action=repair_reservation_pick_date", "date", {
      initial: today,
      min: today,
      max: nextMonth
    })
  ]));
}

function buildRepairReservationTimePromptMessages(reservationDate, errorText = null) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        errorText,
        `預約日期：${reservationDate}`,
        "請選擇預約時段。"
      ].filter(Boolean).join("\n")
    }
  ], buildRepairReservationWizardActions(
    REPAIR_RESERVATION_TIME_SLOTS.map((slot) => createMessageAction(slot.label, slot.value))
  ));
}

function buildRepairReservationBikeModelPromptMessages(payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        `預約日期：${payload.reservationDate}`,
        `預約時間：${payload.reservationTime}`,
        "請輸入車款。"
      ].join("\n")
    }
  ], buildRepairReservationWizardActions(REPAIR_COMMON_BIKE_MODELS.map((label) => createMessageAction(label, label))));
}

function buildRepairReservationIssuePromptMessages(payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        `預約日期：${payload.reservationDate}`,
        `預約時間：${payload.reservationTime}`,
        `車款：${payload.bikeModel}`,
        "請輸入維修內容。"
      ].join("\n")
    }
  ], buildRepairReservationWizardActions());
}

function buildRepairReservationSummaryMessages(payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        "請確認以下維修預約資料：",
        `預約日期：${payload.reservationDate}`,
        `預約時間：${payload.reservationTime}`,
        `車款：${payload.bikeModel}`,
        `維修內容：${payload.issueDescription}`,
        "",
        "若資料正確，請點選「確認送出」。"
      ].join("\n")
    }
  ], buildRepairReservationWizardActions([
    createMessageAction("確認送出", "確認送出維修預約")
  ]));
}

function buildRepairReservationCanceledMessages() {
  return withCustomerQuickReply([
    {
      type: "text",
      text: "已取消本次維修預約流程。如需重新預約，請再輸入「維修預約」。"
    }
  ]);
}

function normalizeLineChatPayload(payload) {
  if (!payload) {
    return {};
  }

  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (_error) {
      return {};
    }
  }

  return payload;
}

async function getLineChatSession(lineUserId, flowType, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, line_user_id AS lineUserId, flow_type AS flowType, step_key AS stepKey, payload, updated_at AS updatedAt
      FROM line_chat_sessions
      WHERE line_user_id = ?
        AND flow_type = ?
      LIMIT 1
    `,
    [lineUserId, flowType]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    payload: normalizeLineChatPayload(rows[0].payload)
  };
}

async function upsertLineChatSession(lineUserId, flowType, stepKey, payload = {}, connection = pool) {
  await connection.query(
    `
      INSERT INTO line_chat_sessions (line_user_id, flow_type, step_key, payload)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        step_key = VALUES(step_key),
        payload = VALUES(payload),
        updated_at = CURRENT_TIMESTAMP
    `,
    [lineUserId, flowType, stepKey, JSON.stringify(payload)]
  );
}

async function clearLineChatSession(lineUserId, flowType, connection = pool) {
  await connection.query(
    `
      DELETE FROM line_chat_sessions
      WHERE line_user_id = ?
        AND flow_type = ?
    `,
    [lineUserId, flowType]
  );
}

function validateRepairReservationTime(value) {
  if (!REPAIR_RESERVATION_TIME_SLOTS.some((slot) => slot.value === value)) {
    return null;
  }

  return value;
}

async function createRepairReservationFromSession(lineUserId, options = {}) {
  return withTransaction(async (connection) => {
    const session = await getLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, connection);
    if (!session || session.stepKey !== REPAIR_RESERVATION_STEPS.confirm) {
      return null;
    }

    const payload = normalizeLineChatPayload(session.payload);
    const storeContext = await resolveLineWorkflowStoreContext({
      storeId: options.storeId || payload.storeId || null,
      lineUserId,
      connection,
      reason: "repair_reservation_create"
    });
    const resolvedStoreId = storeContext.storeId;
    const customer = await findOrCreateLineCustomer(
      lineUserId,
      normalizeText(options.displayName) || "LINE 客戶",
      resolvedStoreId
    );
    if (!customer.phone) {
      return { phoneRequired: true };
    }

    const reservationDay = validateRepairReservationDate(payload.reservationDate);

    const [[duplicateReservation]] = await connection.query(
      `
        SELECT id
        FROM repair_orders
        WHERE store_id = ?
          AND customer_id = ?
          AND reservation_date = ?
          AND COALESCE(reservation_time, '') = COALESCE(?, '')
          AND status IN (
            'reserved',
            'checking',
            'estimate_pending_approval',
            'quoted',
            'waiting_customer_confirm',
            'customer_confirmed',
            'repairing',
            'completed_waiting_pickup'
          )
        ORDER BY id DESC
        LIMIT 1
      `,
      [
        resolvedStoreId,
        customer.id,
        payload.reservationDate,
        payload.reservationTime || ""
      ]
    );

    if (duplicateReservation) {
      await clearLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, connection);

      return {
        duplicate: true,
        repairId: duplicateReservation.id,
        customer,
        payload: {
          ...payload,
          reservationDay
        }
      };
    }

    const [repairResult] = await connection.query(
      `
        INSERT INTO repair_orders (
          store_id, customer_id, customer_type, source, bike_model, issue_description, reservation_date, reservation_day, reservation_time, base_fee, reservation_status, status
        )
        VALUES (?, ?, 'LINE', 'LINE', ?, ?, ?, ?, ?, 400, 'pending_approval', 'checking')
      `,
      [
        resolvedStoreId,
        customer.id,
        payload.bikeModel,
        payload.issueDescription,
        payload.reservationDate,
        reservationDay,
        payload.reservationTime
      ]
    );

    await connection.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'reserved', '已建立 LINE 維修預約，待員工確認')
      `,
      [repairResult.insertId]
    );

    await clearLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, connection);

    return {
      repairId: repairResult.insertId,
      customer,
      payload: {
        ...payload,
        reservationDay
      }
    };
  });
}

async function handleRepairReservationWizard(event) {
  const messageText = event.message?.text?.trim() || "";
  const lineUserId = event.source?.userId;
  if (!lineUserId || !messageText) {
    return false;
  }

  const session = await getLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW);
  if (!session) {
    return false;
  }

  if (REPAIR_RESERVATION_CANCEL_KEYWORDS.includes(messageText)) {
    await clearLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildRepairReservationCanceledMessages());
    }
    return true;
  }

  const payload = normalizeLineChatPayload(session.payload);

  if (session.stepKey === REPAIR_RESERVATION_STEPS.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(messageText) || !dayjs(messageText).isValid()) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationDatePromptMessages("預約日期格式不正確，請重新輸入。"));
      }
      return true;
    }

    try {
      validateRepairReservationDate(messageText);
    } catch (error) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationDatePromptMessages(error.message));
      }
      return true;
    }

    await upsertLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.time, {
      reservationDate: messageText
    });

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildRepairReservationTimePromptMessages(messageText));
    }
    return true;
  }

  if (session.stepKey === REPAIR_RESERVATION_STEPS.time) {
    const reservationTime = validateRepairReservationTime(messageText);
    if (!reservationTime) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          buildRepairReservationTimePromptMessages(payload.reservationDate, "預約時間格式不正確，請重新輸入。")
        );
      }
      return true;
    }

    const nextPayload = {
      ...payload,
      reservationTime
    };
    await upsertLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.bikeModel, nextPayload);

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildRepairReservationBikeModelPromptMessages(nextPayload));
    }
    return true;
  }

  if (session.stepKey === REPAIR_RESERVATION_STEPS.bikeModel) {
    if (!messageText) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationBikeModelPromptMessages(payload));
      }
      return true;
    }

    const nextPayload = {
      ...payload,
      bikeModel: messageText
    };
    await upsertLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.issueDescription, nextPayload);

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildRepairReservationIssuePromptMessages(nextPayload));
    }
    return true;
  }

  if (session.stepKey === REPAIR_RESERVATION_STEPS.issueDescription) {
    if (!messageText) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationIssuePromptMessages(payload));
      }
      return true;
    }

    const nextPayload = {
      ...payload,
      issueDescription: messageText
    };
    await upsertLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.confirm, nextPayload);

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildRepairReservationSummaryMessages(nextPayload));
    }
    return true;
  }

  if (session.stepKey === REPAIR_RESERVATION_STEPS.confirm) {
    if (!REPAIR_RESERVATION_CONFIRM_KEYWORDS.includes(messageText)) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationSummaryMessages(payload));
      }
      return true;
    }

    const result = await createRepairReservationFromSession(lineUserId);
    if (result?.phoneRequired) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          withCustomerQuickReply([{ type: "text", text: "請先回覆手機號碼完成綁定，才可建立維修預約。" }])
        );
      }
      return true;
    }

    if (!result) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildCustomerRepairEntryMessages());
      }
      return true;
    }

    const deliveryResult = await sendToGroupsWithResult(["repair", "admin"], [
      buildGroupApprovalMessage("repair_reservation", {
        id: result.repairId,
        customerName: result.customer.name || "LINE 客戶",
        customerPhone: result.customer.phone || null,
        reservationDate: result.payload.reservationDate,
        reservationTime: result.payload.reservationTime,
        bikeModel: result.payload.bikeModel,
        issueDescription: result.payload.issueDescription
      })
    ]);

    await logWorkflowEvent("repair_reservation_group_notified", "REPAIR_ORDER", result.repairId, {
      delivered: deliveryResult.delivered,
      targetGroupIds: deliveryResult.targetGroupIds,
      fromLine: true
    }, null);

    try {
      await notifyRepairReservationCreated({
        repairId: result.repairId,
        storeId: result.payload.storeId || result.customer.storeId || null,
        customerName: result.customer.name || "LINE 客戶",
        customerPhone: result.customer.phone || null,
        reservationDate: result.payload.reservationDate,
        reservationTime: result.payload.reservationTime,
        bikeModel: result.payload.bikeModel,
        issueDescription: result.payload.issueDescription,
        sourceLabel: "LINE 對話維修預約",
        adminUrl: `${config.frontendBaseUrl}/repairs/${result.repairId}`
      });
    } catch (staffLineError) {
      console.warn("[staff-line] line repair wizard notification failed after creation", {
        repairId: result.repairId,
        message: staffLineError.message
      });
    }

    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withCustomerQuickReply([
          {
            type: "text",
            text: `維修預約已送出，工單編號 #${result.repairId}。門市確認後會再通知您。`
          }
        ])
      );
    }
    return true;
  }

  return false;
}

function buildGroupApprovalMessage(type, payload) {
  if (type === "repair_reservation") {
    return createFlexMessage(
      "維修預約待確認",
      "維修預約待確認",
      [
        `工單 #${payload.id}`,
        `客戶：${payload.customerName}`,
        payload.customerPhone ? `電話：${payload.customerPhone}` : null,
        `日期：${payload.reservationDate}${payload.reservationTime ? ` ${payload.reservationTime}` : ""}`,
        payload.sourceLabel ? `來源：${payload.sourceLabel}` : null,
        payload.bikeModel ? `車款：${payload.bikeModel}` : null,
        payload.issueDescription ? `維修內容：${payload.issueDescription}` : null
      ].filter(Boolean),
      [
        createPostbackAction("確認", "repair_reservation_approve", payload.id),
        createPostbackAction("拒絕", "repair_reservation_reject", payload.id),
        createUriAction("前往維修估價", buildStaffPageUrl(`/repairs/${payload.id}`))
      ]
    );
  }

  if (type === "google_review") {
    return createFlexMessage(
      "Google 評論待確認",
      "Google 評論待確認",
      [
        `客戶：${payload.customerName}`,
        payload.id ? `紀錄 ID：${payload.id}` : null,
        "請確認客戶回饋。"
      ].filter(Boolean),
      [
        payload.id ? createPostbackAction("確認評論", "google_review_approve", payload.id) : null,
        payload.id ? createPostbackAction("拒絕", "google_review_reject", payload.id) : null,
        createUriAction("前往客戶", buildStaffPageUrl(payload.orderId ? `/orders/${payload.orderId}/edit` : "/customers"))
      ].filter(Boolean)
    );
  }

  if (type === "purchase_handover") {
    return createFlexMessage(
      "購買確認書已完成",
      "購買確認書已完成",
      [
        `訂單：${payload.orderNo}`,
        `客戶：${payload.customerName}`,
        "請確認交車或查看 PDF。"
      ],
      [
        createPostbackAction("確認交車", "purchase_handover_confirm", payload.orderId, { storeId: payload.storeId }),
        createUriAction("查看 PDF", payload.pdfUrl),
        createUriAction("前往訂單", buildStaffPageUrl("/orders"))
      ]
    );
  }

  if (type === "supplier_request") {
    return createFlexMessage(
      `${payload.requestTypeLabel}待確認`,
      `${payload.requestTypeLabel}待確認`,
      [
        `單號 #${payload.id}`,
        `供應商：${payload.supplierName || "-"}`
      ],
      [
        createPostbackAction("確認", payload.approveAction, payload.id),
        createPostbackAction("拒絕", payload.rejectAction, payload.id),
        createUriAction("前往庫存管理", buildStaffPageUrl("/inventory"))
      ]
    );
  }

  return null;
}

function buildStaffRepairEstimateEntryMessages(repairInfo, payload = null, errorText = null) {
  const lines = [
    errorText,
    repairInfo?.id ? `維修單：#${repairInfo.id}` : null,
    repairInfo?.customerName ? `客戶：${repairInfo.customerName}` : null,
    repairInfo?.customerPhone ? `電話：${repairInfo.customerPhone}` : null,
    repairInfo?.status ? `目前狀態：${repairInfo.status}` : null,
    "請逐行輸入報價品項，格式：品項名稱｜數量｜單價",
    "可一次輸入多行。",
    "輸入「完成」後進入工資設定。",
    "輸入「取消」可結束。"
  ].filter(Boolean);

  if (payload?.items?.length) {
    lines.push("");
    lines.push("目前品項：");
    payload.items.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.name} x${Number(item.quantity || 0)} ${formatCurrency(Number(item.unitPrice || 0))}`
      );
    });
  }

  return withCustomerQuickReply([
    {
      type: "text",
      text: lines.join("\n")
    }
  ]);
}

function buildStaffRepairEstimateLaborPromptMessages(repairInfo, payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        repairInfo?.id ? `維修單：#${repairInfo.id}` : null,
        repairInfo?.customerName ? `客戶：${repairInfo.customerName}` : null,
        "請輸入工資金額，僅輸入數字即可。",
        `目前品項小計：${formatCurrency(calculateRepairEstimateSubtotal(payload.items || [], 0))}`
      ].filter(Boolean).join("\n")
    }
  ]);
}

function buildStaffRepairEstimateNotesPromptMessages(repairInfo, payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: [
        repairInfo?.id ? `維修單：#${repairInfo.id}` : null,
        repairInfo?.customerName ? `客戶：${repairInfo.customerName}` : null,
        `工資：${formatCurrency(payload.laborFee || 0)}`,
        "請輸入備註，或回覆「略」跳過。"
      ].filter(Boolean).join("\n")
    }
  ]);
}

function buildStaffRepairEstimateTotalPromptMessages(repairInfo, payload) {
  return withCustomerQuickReply([
    {
      type: "text",
      text: buildRepairEstimatePreviewText(payload, repairInfo)
    }
  ]);
}

async function handleStaffRepairEstimateWizard(event) {
  const lineUserId = event.source?.userId;
  const messageText = event.message?.type === "text" ? event.message.text.trim() : "";
  if (!lineUserId || !messageText) {
    return false;
  }

  const staffUser = await getStaffUserByLineUserId(lineUserId);
  if (!staffUser) {
    return false;
  }
  const scopedStoreId = requireScopedStoreId(staffUser.storeId, "LINE staff 維修估價門市範圍");

  const session = await getLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW);
  const isStartCommand =
    /^\/(?:quote|estimate)(?:\s+\d+)?$/i.test(messageText) ||
    /^\/(?:quote|estimate)\s+\d+$/i.test(messageText) ||
    /^建立維修估價(?:\s+\d+)?$/.test(messageText) ||
    /^維修估價(?:\s+\d+)?$/.test(messageText);

  if (!session && !isStartCommand) {
    return false;
  }

  if (STAFF_REPAIR_ESTIMATE_CANCEL_KEYWORDS.includes(messageText)) {
    await clearLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW);
    if (event.replyToken) {
      await replyToLine(event.replyToken, withCustomerQuickReply([{ type: "text", text: "已取消維修估價流程。" }]));
    }
    return true;
  }

  if (!session) {
    const repairIdMatch = messageText.match(/(?:\/(?:quote|estimate)|建立維修估價|維修估價)\s+(\d+)/i);
    if (repairIdMatch) {
      const repairInfo = await getRepairOrderForQuotation(Number(repairIdMatch[1]), pool, scopedStoreId);
      if (!repairInfo) {
        if (event.replyToken) {
          await replyToLine(
            event.replyToken,
            withCustomerQuickReply([{ type: "text", text: "找不到這筆維修單，請確認編號後再試一次。" }])
          );
        }
        return true;
      }

      await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.items, {
        repairId: repairInfo.id,
        items: [],
        laborFee: 0,
        notes: "",
        totalAmount: 0
      });

      if (event.replyToken) {
        await replyToLine(event.replyToken, buildStaffRepairEstimateEntryMessages(repairInfo, { items: [] }));
      }
      return true;
    }

    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withCustomerQuickReply([
          {
            type: "text",
            text: [
              "請輸入維修估價指令。",
              "格式：/quote 123 或 /estimate 123",
              "也可輸入：建立維修估價 123"
            ].join("\n")
          }
        ])
      );
    }
    return true;
  }

  const repairId = Number(session.payload?.repairId || 0);
  const repairInfo = await getRepairOrderForQuotation(repairId, pool, scopedStoreId);
  if (!repairInfo) {
    await clearLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW);
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withCustomerQuickReply([{ type: "text", text: "這筆維修單已不存在，估價流程已結束。" }])
      );
    }
    return true;
  }

  const payload = {
    repairId,
    items: Array.isArray(session.payload?.items) ? session.payload.items : [],
    laborFee: Number(session.payload?.laborFee || 0),
    notes: session.payload?.notes || "",
    totalAmount: Number(session.payload?.totalAmount || 0)
  };

  if (session.stepKey === STAFF_REPAIR_ESTIMATE_STEPS.items) {
    const parsed = parseRepairEstimateItems(messageText);
    if (STAFF_REPAIR_ESTIMATE_RESET_KEYWORDS.includes(messageText)) {
      payload.items = [];
      await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.items, payload);
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildStaffRepairEstimateEntryMessages(repairInfo, payload));
      }
      return true;
    }

    if (messageText === "完成") {
      if (payload.items.length === 0) {
        if (event.replyToken) {
          await replyToLine(
            event.replyToken,
            buildStaffRepairEstimateEntryMessages(
              repairInfo,
              payload,
              "目前還沒有任何品項，請先輸入至少一筆報價項目。"
            )
          );
        }
        return true;
      }

      await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.laborFee, payload);
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildStaffRepairEstimateLaborPromptMessages(repairInfo, payload));
      }
      return true;
    }

    if (parsed.items.length === 0) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          buildStaffRepairEstimateEntryMessages(
            repairInfo,
            payload,
            `未能解析品項格式，請使用「品項名稱｜數量｜單價」。\n${parsed.invalidLines.join("\n")}`
          )
        );
      }
      return true;
    }

    payload.items = payload.items.concat(parsed.items);
    await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.items, payload);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildStaffRepairEstimateEntryMessages(repairInfo, payload));
    }
    return true;
  }

  if (session.stepKey === STAFF_REPAIR_ESTIMATE_STEPS.laborFee) {
    const laborFee = normalizeAmountText(messageText);
    if (laborFee === null) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          buildStaffRepairEstimateLaborPromptMessages(repairInfo, payload)
        );
      }
      return true;
    }

    payload.laborFee = laborFee;
    payload.totalAmount = calculateRepairEstimateSubtotal(payload.items, laborFee);
    await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.notes, payload);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildStaffRepairEstimateNotesPromptMessages(repairInfo, payload));
    }
    return true;
  }

  if (session.stepKey === STAFF_REPAIR_ESTIMATE_STEPS.notes) {
    payload.notes = messageText === "略" ? "" : messageText;
    payload.totalAmount = calculateRepairEstimateSubtotal(payload.items, payload.laborFee);
    await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.totalAmount, payload);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildStaffRepairEstimateTotalPromptMessages(repairInfo, payload));
    }
    return true;
  }

  if (session.stepKey === STAFF_REPAIR_ESTIMATE_STEPS.totalAmount) {
    if (STAFF_REPAIR_ESTIMATE_CONFIRM_KEYWORDS.includes(messageText)) {
      if (!repairInfo.lineUserId) {
        await clearLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW);
        if (event.replyToken) {
          await replyToLine(
            event.replyToken,
            withCustomerQuickReply([
              {
                type: "text",
                text: "這筆客戶尚未綁定 LINE，無法直接從 LINE 發送報價。請先完成綁定或改用 web 送出。"
              }
            ])
          );
        }
        return true;
      }

      const totalAmount = Number(payload.totalAmount || calculateRepairEstimateSubtotal(payload.items, payload.laborFee));
      const result = await sendRepairEstimateQuotation(repairInfo.id, {
        items: payload.items,
        laborFee: payload.laborFee,
        notes: payload.notes,
        totalAmount
      }, staffUser.id, "line_staff", pool, { storeId: scopedStoreId });

      await clearLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW);

      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          withCustomerQuickReply([
            {
              type: "text",
              text: `已送出維修報價，工單 #${repairInfo.id}，總額 ${formatCurrency(result?.totalAmount || totalAmount)}。`
            }
          ])
        );
      }
      return true;
    }

    const overrideTotal = normalizeAmountText(messageText);
    if (overrideTotal === null) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildStaffRepairEstimateTotalPromptMessages(repairInfo, payload));
      }
      return true;
    }

    payload.totalAmount = overrideTotal;
    await upsertLineChatSession(lineUserId, STAFF_REPAIR_ESTIMATE_FLOW, STAFF_REPAIR_ESTIMATE_STEPS.totalAmount, payload);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildStaffRepairEstimateTotalPromptMessages(repairInfo, payload));
    }
    return true;
  }

  return false;
}

async function replyToLine(replyToken, messages, options = {}) {
  try {
    const resolvedOptions = getScopedLineAccessTokenOptions(options);
    const channelAccessToken = resolveLineAccessToken(config, resolvedOptions);

    if (!channelAccessToken) {
      console.log("[line:reply] skip no-channel-access-token");
      return;
    }

    console.log("[line:reply] before send", {
      replyTokenPreview: replyToken ? String(replyToken).slice(0, 12) : null,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      messageTypes: Array.isArray(messages) ? messages.map((message) => message?.type || "unknown") : [],
      payloadPreview: Array.isArray(messages)
        ? messages.map((message) => ({
            type: message?.type || "unknown",
            text: message?.text || null,
            altText: message?.altText || null,
            hasQuickReply: Boolean(message?.quickReply)
          }))
        : [],
      context: resolvedOptions.context
    });

    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages
      })
    });

    const responseBody = await response.text();
    console.log("[line:reply] response", {
      status: response.status,
      ok: response.ok,
      body: responseBody
    });

    if (!response.ok) {
      const error = new Error(`LINE reply failed: ${response.status} ${responseBody}`);
      error.statusCode = 502;
      throw error;
    }

    console.log("[line:reply] success", {
      replyTokenPreview: replyToken ? String(replyToken).slice(0, 12) : null
    });
  } catch (error) {
    console.log("[line:reply] caught error", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function findPendingRepairEstimateByLineUserId(lineUserId, storeId = null) {
  const storeContext = await resolveLineWorkflowStoreContext({
    storeId,
    lineUserId,
    connection: pool,
    reason: "find_pending_repair_estimate"
  });
  const resolvedStoreId = storeContext.storeId;

  const [rows] = await pool.query(
    `
      SELECT ro.id, ro.store_id AS storeId
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      WHERE c.line_user_id = ?
        AND c.store_id = ?
        AND ro.store_id = ?
        AND ro.status = 'estimate_pending_approval'
        AND ro.customer_estimate_response = 'pending'
      ORDER BY ro.id DESC
      LIMIT 1
    `,
    [lineUserId, resolvedStoreId, resolvedStoreId]
  );

  return rows[0] || null;
}

async function findLinkedRepairJobOrder(repairId, connection = pool, storeId = null) {
  const scopedStoreId = requireScopedStoreId(storeId, "維修訂單連結門市範圍");
  const [rows] = await connection.query(
    `
      SELECT
        ro.order_id AS repairOrderLinkedOrderId,
        o.id AS orderId,
        o.order_no AS orderNo
      FROM repair_orders ro
      LEFT JOIN orders o
        ON (o.id = ro.order_id OR o.repair_order_id = ro.id)
       AND o.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
      ORDER BY o.id DESC
      LIMIT 1
    `,
     [repairId, scopedStoreId]
  );

  return rows[0] || null;
}

async function resolveRepairOrderCreatorStaffId(preferredStaffId, connection = pool) {
  if (preferredStaffId) {
    return preferredStaffId;
  }

  const [rows] = await connection.query(
    `
      SELECT id
      FROM staff_users
      WHERE is_active = 1
      ORDER BY id ASC
      LIMIT 1
    `
  );

  return rows[0]?.id || null;
}

async function ensureRepairJobOrder(repairId, staffId = null, connection = pool, options = {}) {
  const scopedStoreId = requireScopedStoreId(options.storeId, "維修訂單建立門市範圍");
  const linkedOrder = await findLinkedRepairJobOrder(repairId, connection, scopedStoreId);
  if (linkedOrder?.orderId) {
    if (Number(linkedOrder.repairOrderLinkedOrderId || 0) !== Number(linkedOrder.orderId)) {
      await connection.query(
        "UPDATE repair_orders SET order_id = ? WHERE id = ? AND store_id = ?",
        [linkedOrder.orderId, repairId, scopedStoreId]
      );
    }
    const [repairAmountRows] = await connection.query(
      `
        SELECT estimate_amount AS estimateAmount
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [repairId, scopedStoreId]
    );
    console.log("[repair:quote-confirm]", {
      repair_id: Number(repairId),
      existing_order_id: Number(linkedOrder.orderId),
      created_order_id: null,
      total: Number(repairAmountRows[0]?.estimateAmount || 0)
    });
    return {
      orderId: linkedOrder.orderId,
      orderNo: linkedOrder.orderNo,
      created: false
    };
  }

  const [repairRows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.store_id AS storeId,
        ro.customer_id AS customerId,
        ro.estimate_amount AS estimateAmount,
        ro.issue_description AS issueDescription,
        ro.bike_model AS bikeModel,
        ro.approved_by_staff_id AS approvedByStaffId,
        ro.status,
        c.name AS customerName,
        c.phone AS customerPhone,
        COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
      LIMIT 1
      FOR UPDATE
    `,
     [repairId, scopedStoreId]
  );

  const repair = repairRows[0];
  if (!repair) {
    return null;
  }

  const createdByStaffId = await resolveRepairOrderCreatorStaffId(staffId || repair.approvedByStaffId || null, connection);
  if (!createdByStaffId) {
    throw new Error("找不到可用的員工帳號來建立維修訂單");
  }

  const orderNo = `REP-${dayjs().format("YYYYMMDD-HHmmss-SSS")}`;
  const totalAmount = Number(repair.estimateAmount || 0);
  const orderColumns = await getOrdersTableColumns(connection);
  const orderStatus = await normalizeRepairLinkedOrderStatus(connection, repair.status);
  const orderNotes = [
    `維修工單 #${repair.id}`,
    repair.bikeModel ? `車款：${repair.bikeModel}` : null,
    repair.issueDescription ? `問題：${repair.issueDescription}` : null,
    hasColumn(orderColumns, "source") ? "來源：repair_quote" : null
  ].filter(Boolean).join("\n");

  const insertColumns = [
    ...(hasColumn(orderColumns, "store_id") ? ["store_id"] : []),
    "order_no",
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_type",
    ...(hasColumn(orderColumns, "order_type") ? ["order_type"] : []),
    "total_amount",
    "payment_method",
    "status",
    "is_reservation_order",
    "deposit_amount",
    "unpaid_balance",
    "final_payment_status",
    "final_paid_at",
    "notes",
    "created_by",
    "business_date",
    ...(hasColumn(orderColumns, "repair_order_id") ? ["repair_order_id"] : []),
    ...(hasColumn(orderColumns, "source") ? ["source"] : [])
  ];
  const insertValues = [
    ...(hasColumn(orderColumns, "store_id") ? [repair.storeId] : []),
    orderNo,
    repair.customerId,
    repair.customerName || null,
    repair.customerType === "OFFLINE_NO_PHONE" ? null : repair.customerPhone || null,
    repair.customerType || "LINE",
    ...(hasColumn(orderColumns, "order_type") ? ["REPAIR"] : []),
    totalAmount,
    "OTHER",
    orderStatus,
    0,
    0,
    totalAmount,
    "UNPAID",
    null,
    orderNotes,
    createdByStaffId,
    dayjs().format("YYYY-MM-DD"),
    ...(hasColumn(orderColumns, "repair_order_id") ? [repair.id] : []),
    ...(hasColumn(orderColumns, "source") ? ["repair_quote"] : [])
  ];
  const placeholders = insertColumns.map(() => "?").join(", ");
  const [orderResult] = await connection.query(
    `INSERT INTO orders (${insertColumns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
    insertValues
  );

  await connection.query(
    "UPDATE repair_orders SET order_id = ? WHERE id = ? AND store_id = ?",
    [orderResult.insertId, repairId, scopedStoreId]
  );
  console.log("[repair:quote-confirm]", {
    repair_id: Number(repairId),
    existing_order_id: null,
    created_order_id: Number(orderResult.insertId),
    total: totalAmount
  });

  return {
    orderId: orderResult.insertId,
    orderNo,
    created: true
  };
}

async function backfillApprovedRepairOrders(limit = 50, connection = pool) {
  const run = async (tx) => {
    const [rows] = await tx.query(
      `
      SELECT ro.id, ro.store_id
      FROM repair_orders ro
        LEFT JOIN orders o
          ON o.id = ro.order_id
          OR o.repair_order_id = ro.id
        WHERE ro.customer_estimate_response = 'approved'
          AND (ro.order_id IS NULL OR ro.order_id = 0)
          AND o.id IS NULL
        ORDER BY ro.id ASC
        LIMIT ?
        FOR UPDATE
      `,
      [limit]
    );

    const results = [];
    for (const row of rows) {
      const linkedOrder = await ensureRepairJobOrder(row.id, null, tx, { storeId: row.store_id });
      results.push({
        repairId: Number(row.id),
        orderId: linkedOrder?.orderId || null,
        created: Boolean(linkedOrder?.created)
      });
    }

    return results;
  };

  return connection === pool
    ? withTransaction(async (tx) => run(tx))
    : run(connection);
}

async function applyRepairEstimateCustomerResponse(repairId, approved, staffId = null, connection = pool, source = "line_postback", options = {}) {
  const scopedStoreId = requireScopedStoreId(options.storeId, "維修報價回覆門市範圍");
  const run = async (tx) => {
    const repairColumns = await getRepairOrdersTableColumns(tx);
    const [repairRows] = await tx.query(
      `
        SELECT
          id,
          store_id AS storeId,
          status,
        ${hasColumn(repairColumns, "quote_status") ? "quote_status" : "'pending'"} AS quoteStatus,
        customer_estimate_response AS customerEstimateResponse
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [repairId, scopedStoreId]
    );

    const repair = repairRows[0];
    if (!repair) {
      throw createError("找不到維修工單", 404);
    }

    const alreadyAccepted =
      approved &&
      (repair.quoteStatus === "approved" || repair.customerEstimateResponse === "approved" || repair.status === "customer_confirmed");
    const alreadyRejected =
      !approved &&
      (repair.quoteStatus === "rejected" || repair.customerEstimateResponse === "rejected" || repair.status === "estimate_rejected");

    if (!alreadyAccepted && !alreadyRejected) {
      const nextStatus = approved ? "customer_confirmed" : "estimate_rejected";
      const statusColumnType = String(await getColumnType(tx, "repair_orders", "status") || "");
      const compatibleStatus = statusColumnType.includes(`'${nextStatus}'`)
        ? nextStatus
        : approved
          ? statusColumnType.includes("'estimate_approved'") ? "estimate_approved" : "reserved"
          : "estimate_rejected";
      const updateSql = [
        "customer_estimate_response = ?",
        "customer_estimate_responded_at = NOW()",
        "status = ?"
      ];
      const updateParams = [approved ? "approved" : "rejected", compatibleStatus];
      if (hasColumn(repairColumns, "quote_status")) {
        updateSql.unshift("quote_status = ?");
        updateParams.unshift(approved ? "approved" : "rejected");
      }
      if (approved && hasColumn(repairColumns, "customer_confirmed_at")) {
        updateSql.push("customer_confirmed_at = COALESCE(customer_confirmed_at, NOW())");
      }
      updateParams.push(repairId, scopedStoreId);
      await tx.query(
        "UPDATE repair_orders SET " + updateSql.join(", ") + " WHERE id = ? AND store_id = ?",
        updateParams
      );
    }

    const linkedOrder = approved ? await ensureRepairJobOrder(repairId, staffId, tx, {
      storeId: scopedStoreId
    }) : null;
    if (approved && linkedOrder?.orderId) {
      const orderColumns = await getOrdersTableColumns(tx);
      const orderStatus = await normalizeRepairLinkedOrderStatus(tx, repair.status);
      const updates = ["status = ?"];
      const params = [orderStatus];
      if (hasColumn(orderColumns, "order_type")) {
        updates.push("order_type = 'REPAIR'");
      }
      if (hasColumn(orderColumns, "source")) {
        updates.push("source = 'repair_quote'");
      }
      params.push(linkedOrder.orderId, scopedStoreId);
      await tx.query("UPDATE orders SET " + updates.join(", ") + " WHERE id = ? AND store_id = ?", params);
    }

    await tx.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, ?, ?)
      `,
      [
        repairId,
        approved ? "customer_estimate_approved" : "customer_estimate_rejected",
        approved
          ? alreadyAccepted
            ? linkedOrder?.orderId
              ? `客戶再次確認報價，沿用維修訂單 #${linkedOrder.orderNo || linkedOrder.orderId}`
              : "客戶再次確認報價"
            : linkedOrder?.created
            ? `客戶同意報價，已建立維修訂單 #${linkedOrder.orderNo || linkedOrder.orderId}`
            : linkedOrder?.orderId
              ? `客戶同意報價，沿用維修訂單 #${linkedOrder.orderNo || linkedOrder.orderId}`
              : "客戶同意報價"
          : alreadyRejected
            ? "客戶再次拒絕報價"
            : "客戶拒絕報價"
      ]
    );

    await logWorkflowEvent(
      "repair_estimate_customer_response",
      "REPAIR_ORDER",
      repairId,
      {
        approved,
        source,
        orderId: linkedOrder?.orderId || null,
        orderCreated: Boolean(linkedOrder?.created),
        idempotentReuse: approved ? alreadyAccepted : alreadyRejected
      },
      staffId,
      tx
    );

    return {
      linkedOrder,
      alreadyProcessed: approved ? alreadyAccepted : alreadyRejected
    };
  };

  const result =
    connection === pool
      ? await withTransaction(async (tx) => run(tx))
      : await run(connection);

  await sendToGroups(["repair", "admin"], [
    {
      type: "text",
      text: approved
        ? `維修單 #${repairId} 客戶已同意報價。${result.linkedOrder?.orderId ? ` 已連結訂單 #${result.linkedOrder.orderId}。` : ""}${result.alreadyProcessed ? " 已略過重複建立。" : ""}`
        : `維修單 #${repairId} 客戶已拒絕報價。${result.alreadyProcessed ? " 已略過重複處理。" : ""}`
    }
  ]);

  return result;
}

function buildRepairQuoteSignature(repairInfo) {
  return crypto
    .createHash("sha256")
    .update([
      Number(repairInfo?.estimateAmount || 0).toFixed(2),
      String(repairInfo?.estimateDetails || "").trim(),
      String(repairInfo?.quoteNotes || "").trim()
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function buildRepairQuoteNotificationLogPayload(repairInfo, options = {}) {
  const link = options.link || buildRepairQuoteConfirmationUrl(repairInfo.id);
  return {
    estimateAmount: Number(repairInfo.estimateAmount || 0),
    status: repairInfo.status || null,
    quoteStatus: repairInfo.quoteStatus || null,
    customerEstimateResponse: repairInfo.customerEstimateResponse || null,
    quoteSignature: buildRepairQuoteSignature(repairInfo),
    lineUserStatus: repairInfo.lineUserId ? "HAS_LINE_USER" : "NO_LINE_USER",
    link,
    source: options.source || null
  };
}

function parseRepairQuoteNotificationLog(note) {
  try {
    const parsed = JSON.parse(String(note || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function parseRepairQuoteItemsJson(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function findLatestRepairQuoteSentLog(repairId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, note, created_at AS createdAt
      FROM repair_logs
      WHERE repair_order_id = ?
        AND action = 'quote_confirmation_sent'
      ORDER BY id DESC
      LIMIT 1
    `,
    [repairId]
  );
  return rows[0] || null;
}

async function insertRepairQuoteNotificationLog(connection, repairId, action, payload) {
  await connection.query(
    `
      INSERT INTO repair_logs (repair_order_id, action, note)
      VALUES (?, ?, ?)
    `,
    [repairId, action, JSON.stringify(payload)]
  );
}

async function sendRepairQuoteConfirmationIfNeeded(repairId, storeId, staffId = null, options = {}) {
  const scopedStoreId = requireScopedStoreId(storeId, "維修報價確認通知門市範圍");
  const repairInfo = await getRepairOrderForQuotation(repairId, options.connection || pool, scopedStoreId);
  if (!repairInfo) {
    throw createError("找不到維修工單", 404);
  }

  const link = buildRepairQuoteConfirmationUrl(repairInfo.id);
  const payload = buildRepairQuoteNotificationLogPayload(repairInfo, {
    link,
    source: options.source || "web_admin"
  });
  const latestSentLog = await findLatestRepairQuoteSentLog(repairInfo.id, options.connection || pool);
  const latestSentPayload = parseRepairQuoteNotificationLog(latestSentLog?.note);
  const isSameQuoteAlreadySent =
    latestSentPayload?.quoteSignature &&
    latestSentPayload.quoteSignature === payload.quoteSignature;

  if (isSameQuoteAlreadySent && !options.forceSend) {
    await insertRepairQuoteNotificationLog(options.connection || pool, repairInfo.id, "quote_confirmation_reused", {
      ...payload,
      reusedSentLogId: latestSentLog.id
    });
    return {
      ok: true,
      reused: true,
      sent: false,
      link,
      message: "已發送過相同報價確認通知，沿用既有連結"
    };
  }

  if (!repairInfo.lineUserId) {
    const warning = "顧客未綁定 LINE，請複製連結提供給顧客確認報價";
    await insertRepairQuoteNotificationLog(options.connection || pool, repairInfo.id, "quote_confirmation_send_failed", {
      ...payload,
      reason: "NO_LINE_USER"
    });
    return {
      ok: false,
      sent: false,
      link,
      warning
    };
  }

  if (!config.line.channelAccessToken) {
    const warning = "LINE channel token 未設定，請複製連結提供給顧客確認報價";
    await insertRepairQuoteNotificationLog(options.connection || pool, repairInfo.id, "quote_confirmation_send_failed", {
      ...payload,
      reason: "NO_LINE_TOKEN"
    });
    return {
      ok: false,
      sent: false,
      link,
      warning
    };
  }

  try {
    await sendLineMessage(config, repairInfo.lineUserId, buildRepairEstimateCustomerMessages(repairInfo, {
      items: parseRepairQuoteItemsJson(repairInfo.quoteItemsJson),
      inspectionFee: repairInfo.inspectionFee || 0,
      laborFee: repairInfo.laborFee || 0,
      totalAmount: repairInfo.estimateAmount || 0,
      notes: repairInfo.quoteNotes || "",
      quoteUrl: link
    }));
    await insertRepairQuoteNotificationLog(options.connection || pool, repairInfo.id, "quote_confirmation_sent", payload);
    return {
      ok: true,
      sent: true,
      link,
      message: "已發送報價確認通知"
    };
  } catch (error) {
    const warning = "LINE 報價確認通知發送失敗，請複製連結提供給顧客確認報價";
    await insertRepairQuoteNotificationLog(options.connection || pool, repairInfo.id, "quote_confirmation_send_failed", {
      ...payload,
      reason: "LINE_PUSH_FAILED",
      error: error.message || "LINE_PUSH_FAILED"
    });
    return {
      ok: false,
      sent: false,
      link,
      warning,
      lineError: error.message || "LINE_PUSH_FAILED"
    };
  }
}

async function sendRepairEstimateQuotation(repairId, estimatePayload, staffId = null, source = "web_admin", connection = pool, options = {}) {
  const storeContext = await resolveLineWorkflowStoreContext({
    storeId: options.storeId,
    staffId,
    connection,
    reason: "repair_estimate_send"
  });
  const scopedStoreId = requireScopedStoreId(storeContext.storeId, "維修報價送出門市範圍");
  const repairInfo = await getRepairOrderForQuotation(repairId, connection, scopedStoreId);
  if (!repairInfo) {
    return null;
  }
  const currentStatus = String(repairInfo.status || "").trim();
  const quoteStatus = String(repairInfo.quoteStatus || "").trim();
  const isFinalizedRepair =
    ["completed", "completed_waiting_pickup", "picked_up"].includes(currentStatus) ||
    Boolean(repairInfo.completedAt) ||
    Boolean(repairInfo.pickedUpAt);
  const isQuoteAlreadySent =
    Boolean(repairInfo.estimateSentAt) ||
    quoteStatus === "sent" ||
    quoteStatus === "approved" ||
    quoteStatus === "accepted" ||
    repairInfo.customerEstimateResponse === "approved";

  if (isFinalizedRepair) {
    throw createError("已完成或已取車的維修單無法再次送出報價", 400);
  }
  if (String(repairInfo.reservationStatus || "").trim() !== "approved") {
    throw createError("需先確認預約後才能送出報價", 400);
  }
  if (currentStatus !== "reserved" || isQuoteAlreadySent) {
    throw createError("此維修單已進入後續流程，無法再次送出報價", 400);
  }
  const repairColumns = await getRepairOrdersTableColumns(connection);

  const itemsInput = Array.isArray(estimatePayload.items) ? estimatePayload.items : [];
  const items = itemsInput.map((item) => ({
    productId: item.productId !== undefined ? Number(item.productId) : item.product_id !== undefined ? Number(item.product_id) : null,
    sku: String(item.sku || item.productSku || item.product_sku || "").trim() || null,
    name: String(item.name || "").trim(),
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unitPrice !== undefined ? item.unitPrice : item.price || 0),
    total: Number(item.total || Number(item.quantity || 0) * Number(item.unitPrice !== undefined ? item.unitPrice : item.price || 0))
  })).filter((item) => item.name && Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice));

  const inspectionFee = Number(estimatePayload.inspectionFee || 0);
  const laborFee = Number(estimatePayload.laborFee || 0);
  const derivedPartsFee = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const partsFee = Number.isFinite(Number(estimatePayload.partsFee))
    ? Number(estimatePayload.partsFee)
    : derivedPartsFee;
  const totalAmount = Number.isFinite(Number(estimatePayload.totalAmount))
    ? Number(estimatePayload.totalAmount)
    : Number(partsFee) + Number(inspectionFee) + Number(laborFee);
  const notes = estimatePayload.notes ? String(estimatePayload.notes).trim() : "";
  const details = formatRepairEstimateDetailText({
    items,
    inspectionFee,
    laborFee,
    notes,
    totalAmount
  });

  const statusColumnType = String(await getColumnType(connection, "repair_orders", "status") || "");
  const estimatePendingStatus = statusColumnType.includes("'estimate_pending_approval'") ? "estimate_pending_approval" : "reserved";
  const updates = [
    "status = ?",
    "estimate_amount = ?",
    "estimate_details = ?",
    "estimate_sent_at = NOW()",
    "customer_estimate_response = 'pending'",
    "customer_estimate_responded_at = NULL"
  ];
  const params = [estimatePendingStatus, totalAmount, details];
  if (hasColumn(repairColumns, "inspection_fee")) {
    updates.push("inspection_fee = ?");
    params.push(inspectionFee);
  }
  if (hasColumn(repairColumns, "parts_fee")) {
    updates.push("parts_fee = ?");
    params.push(partsFee);
  }
  if (hasColumn(repairColumns, "labor_fee")) {
    updates.push("labor_fee = ?");
    params.push(laborFee);
  }
  if (hasColumn(repairColumns, "quote_status")) {
    updates.push("quote_status = 'sent'");
  }
  if (hasColumn(repairColumns, "quote_notes")) {
    updates.push("quote_notes = ?");
    params.push(notes || null);
  }
  if (hasColumn(repairColumns, "quote_items_json")) {
    updates.push("quote_items_json = ?");
    params.push(JSON.stringify(items));
  }
  if (hasColumn(repairColumns, "customer_confirmed_at")) {
    updates.push("customer_confirmed_at = NULL");
  }
  params.push(repairId, scopedStoreId);
  await connection.query(`UPDATE repair_orders SET ${updates.join(", ")} WHERE id = ? AND store_id = ?`, params);

  await connection.query(
    `
      INSERT INTO repair_logs (repair_order_id, action, note)
      VALUES (?, 'estimate_pending_approval', ?)
    `,
    [repairId, `報價已送出，待客戶確認（${source}）`]
  );

  const quoteConfirmation = await sendRepairQuoteConfirmationIfNeeded(repairId, scopedStoreId, staffId, {
    source,
    connection
  });

  await sendToGroups(["repair", "admin"], [
    {
      type: "text",
      text: [
        `維修單 #${repairId} 已送出報價。`,
        `客戶：${repairInfo.customerName || "-"}`,
        `總額：${formatCurrency(totalAmount)}`,
        source ? `來源：${source === "line_staff" ? "LINE Staff" : source === "web_admin" ? "Web Admin" : source}` : null
      ].filter(Boolean).join("\n")
    }
  ]);

  await logWorkflowEvent(
    "repair_estimate_sent",
    "REPAIR_ORDER",
    repairId,
    {
      totalAmount,
      inspectionFee,
      partsFee,
      laborFee,
      items,
      notes,
      source
    },
    staffId,
    connection
  );

  return {
    repairInfo,
    items,
    inspectionFee,
    partsFee,
    laborFee,
    totalAmount,
    details,
    quoteConfirmation
  };
}

async function handleCustomerMessageEvent(event) {
  const messageText = event.message?.type === "text" ? event.message.text.trim() : "";
  const lineUserId = event.source?.userId;
  if (!lineUserId || !messageText) {
    return false;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.support)) {
    const customerId = await findCustomerIdByLineUserId(lineUserId);
    if (customerId) {
      await logWorkflowEvent("line_support_requested", "CUSTOMER", customerId, { source: "line", keyword: messageText });
    }
    await notifyStaffCustomerSupport(lineUserId, messageText);
    await replyToLine(event.replyToken, withCustomerQuickReply([
      {
        type: "text",
        text: "已通知門市人員，請直接在此留下您想詢問的內容，我們會盡快協助您。"
      }
    ]));
    return true;
  }

  if (["尾款查詢", "查詢尾款", "尾款"].includes(messageText)) {
    await replyToLine(
      event.replyToken,
      (async () => {
        const customerId = await findCustomerIdByLineUserId(lineUserId);
        if (customerId) {
          await logWorkflowEvent("line_balance_checked", "CUSTOMER", customerId, { source: "line", keyword: messageText });
        }
        return buildCustomerBalanceMessages(lineUserId);
      })()
    );
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.orderStatus)) {
    await replyToLine(
      event.replyToken,
      (async () => {
        const customerId = await findCustomerIdByLineUserId(lineUserId);
        if (customerId) {
          await logWorkflowEvent("line_order_status_checked", "CUSTOMER", customerId, { source: "line", keyword: messageText });
        }
        return buildCustomerOrderStatusMessages(lineUserId);
      })()
    );
    return true;
  }

  const phoneMatch = messageText.match(/09\d{8}/);
  if (phoneMatch) {
    const result = await bindPhoneAndIssueNewFriendCoupon(lineUserId, phoneMatch[0]);
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildPhoneBoundMessages(result.couponCode));
    }
    return true;
  }

  if (["同意", "同意報價"].includes(messageText) || ["拒絕", "拒絕報價"].includes(messageText)) {
    const pendingRepair = await findPendingRepairEstimateByLineUserId(lineUserId);
    if (pendingRepair) {
      const approved = ["同意", "同意報價"].includes(messageText);
      await applyRepairEstimateCustomerResponse(pendingRepair.id, approved, null, pool, "line_text", {
        storeId: pendingRepair.storeId
      });
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          withCustomerQuickReply([
            {
              type: "text",
              text: approved
                ? "已收到您的同意，門市將接續安排維修。"
                : "已收到您的拒絕，門市人員會再與您聯繫。"
            }
          ])
        );
      }
      return true;
    }
  }

  const customer = await findOrCreateLineCustomer(lineUserId);
  const customerStoreId = normalizeStoreId(customer?.storeId || customer?.store_id);

  const needsPhoneBinding =
    matchesKeyword(messageText, LINE_KEYWORDS.menu) ||
    matchesKeyword(messageText, LINE_KEYWORDS.repair) ||
    matchesKeyword(messageText, LINE_KEYWORDS.googleReview) ||
    messageText === "我已完成評論" ||
    matchesKeyword(messageText, LINE_KEYWORDS.purchaseConfirmation) ||
    matchesKeyword(messageText, LINE_KEYWORDS.survey) ||
    matchesKeyword(messageText, LINE_KEYWORDS.progress) ||
    matchesKeyword(messageText, LINE_KEYWORDS.storeInfo) ||
    matchesKeyword(messageText, LINE_KEYWORDS.support) ||
    messageText.startsWith("預算") ||
    messageText.startsWith("購買時間") ||
    messageText.startsWith("用途");

  if (needsPhoneBinding && !customer.phone) {
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withCustomerQuickReply([
          {
            type: "text",
            text: "歡迎來到 KINGWAY！\n\n您可以在 LINE 選擇車款後進行購買預約，也可以建立維修預約。\n\n請先輸入手機號碼完成綁定，完成後即可使用購買預約、維修預約、購買確認書與客服服務。\n\n例：0912345678"
          }
        ])
      );
    }
    return true;
  }

  if (!matchesKeyword(messageText, LINE_KEYWORDS.repair) && await handleRepairReservationWizard(event)) {
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.menu)) {
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildCustomerMenuMessages());
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.repair)) {
    if (!customer.phone) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          withCustomerQuickReply([{ type: "text", text: "請先回覆手機號碼完成綁定，才可建立維修預約。" }])
        );
      }
      return true;
    }

    await upsertLineChatSession(lineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.date, {});
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildCustomerRepairEntryMessages());
    }
    return true;
  }

  if (messageText === "我要綁定手機") {
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildPhoneBindingMessages());
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.googleReview)) {
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildGoogleReviewEntryMessages());
    }
    return true;
  }

  if (messageText === "我已完成評論") {
    const [existingCoupons] = await pool.query(
      `
        SELECT id, code, status
        FROM coupons
        WHERE customer_id = ?
          AND coupon_type = 'google_review'
          AND store_id = ?
          AND status IN ('pending_approval', 'issued')
        ORDER BY id DESC
        LIMIT 1
      `,
      [customer.id, customerStoreId]
    );

    if (existingCoupons[0]) {
      if (event.replyToken) {
        await replyToLine(
          event.replyToken,
          withCustomerQuickReply([
            {
              type: "text",
              text: "您已有 Google 評論紀錄，門市會協助確認。"
            }
          ])
        );
      }
      return true;
    }

    await sendToGroups(["admin", "staff"], [
      buildGroupApprovalMessage("google_review", {
        customerName: customer.name || "LINE 客戶"
      })
    ]);
    await logWorkflowEvent("google_review_submitted", "CUSTOMER", customer.id, { source: "line_message" }, null);

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildGoogleReviewSubmittedMessages());
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.purchaseConfirmation)) {
    const token = await findPendingPurchaseConfirmationTokenForLineUser(lineUserId);

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildPurchaseConfirmationMessages(token));
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.survey)) {
    const [surveyRows] = await pool.query(
      `
        SELECT token
        FROM surveys
        WHERE customer_id = ?
          AND submitted_at IS NULL
          AND token IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `,
      [customer.id]
    );

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildSurveyMessages(surveyRows[0]?.token || null));
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.progress)) {
    const [[latestRepair]] = await pool.query(
      `
        SELECT id, status, reservation_date AS reservationDate
        FROM repair_orders
        WHERE customer_id = ?
          AND (? IS NULL OR store_id = ?)
        ORDER BY id DESC
        LIMIT 1
      `,
      [customer.id, customerStoreId, customerStoreId]
    );
    const [[latestOrder]] = await pool.query(
      `
        SELECT order_no AS orderNo, final_payment_status AS finalPaymentStatus, purchase_confirmation_sent_at AS purchaseConfirmationSentAt
        FROM orders
        WHERE customer_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [customer.id]
    );

    if (event.replyToken) {
      await replyToLine(event.replyToken, buildProgressMessages(latestRepair, latestOrder));
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.storeInfo)) {
    if (event.replyToken) {
      await replyToLine(event.replyToken, await buildStoreInfoMessages());
    }
    return true;
  }

  if (matchesKeyword(messageText, LINE_KEYWORDS.support)) {
    if (event.replyToken) {
      await replyToLine(event.replyToken, buildSupportMessages());
    }
    return true;
  }

  if (messageText.startsWith("預算") || messageText.startsWith("購買時間") || messageText.startsWith("用途")) {
    await pool.query(
      `
        INSERT INTO customer_crm_events (customer_id, event_type, stage, note)
        VALUES (?, 'crm_reply', 'crm_collecting', ?)
      `,
      [customer.id, messageText]
    );
    await pool.query(
      `
        UPDATE customers
        SET crm_stage = 'crm_collecting',
            last_contact_at = NOW()
        WHERE id = ?
      `,
      [customer.id]
    );
    if (event.replyToken) {
      await replyToLine(event.replyToken, withCustomerQuickReply([{ type: "text", text: "已收到您的資訊，門市人員會接續協助。" }]));
    }
    return true;
  }

  return false;
}

async function handleLinePostback(event) {
  const params = new URLSearchParams(event.postback.data || "");
  const action = params.get("action");
  const id = Number(params.get("id"));
  const postbackStoreId = normalizeStoreId(params.get("storeId") || params.get("store_id"));
  const sourceLineUserId = event.source?.userId || null;

  if (!action) {
    return false;
  }

  if (action === "repair_reservation_pick_date" && sourceLineUserId) {
    const selectedDate = event.postback?.params?.date || null;
    const session = await getLineChatSession(sourceLineUserId, REPAIR_RESERVATION_FLOW);
    if (!session || session.stepKey !== REPAIR_RESERVATION_STEPS.date || !selectedDate) {
      return true;
    }

    try {
      validateRepairReservationDate(selectedDate);
      await upsertLineChatSession(sourceLineUserId, REPAIR_RESERVATION_FLOW, REPAIR_RESERVATION_STEPS.time, {
        reservationDate: selectedDate
      });
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationTimePromptMessages(selectedDate));
      }
    } catch (error) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, buildRepairReservationDatePromptMessages(error.message));
      }
    }

    return true;
  }

  if (!id) {
    return false;
  }

  let staffId = null;
  let staffStoreId = null;
  if (sourceLineUserId) {
    const [staffRows] = await pool.query(
      `
        SELECT id, store_id AS storeId
        FROM staff_users
        WHERE line_user_id = ?
        LIMIT 1
      `,
      [sourceLineUserId]
    );
    staffId = staffRows[0]?.id || null;
    staffStoreId = normalizeStoreId(staffRows[0]?.storeId);
  }

  if (action === "repair_reservation_approve" || action === "repair_reservation_reject") {
    const approved = action === "repair_reservation_approve";
    const reservationPostbackStoreContext = await resolveLineWorkflowStoreContext({
      storeId: postbackStoreId || staffStoreId,
      lineUserId: sourceLineUserId,
      staffId,
      connection: pool,
      reason: "line_repair_reservation_postback"
    });
    const result = await applyRepairReservationDecision(id, approved, staffId, "line_postback", pool, {
      logWorkflowEvent,
      storeId: reservationPostbackStoreContext.storeId
    });
    if (!result) {
      return true;
    }
    if (!result.alreadyProcessed) {
      await notifyRepairCustomer(id, result.customerMessage, reservationPostbackStoreContext.storeId);
    }
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withStaffQuickReply([
          {
            type: "text",
            text: result.alreadyProcessed
              ? `這筆維修預約已是${approved ? "已確認" : "已拒絕"}狀態。`
              : approved ? "已確認維修預約。" : "已拒絕維修預約。"
          }
        ])
      );
    }
    return true;
  }

  if (action === "repair_estimate_approve" || action === "repair_estimate_reject") {
    const approved = action === "repair_estimate_approve";
    const estimatePostbackStoreContext = await resolveLineWorkflowStoreContext({
      storeId: postbackStoreId || staffStoreId,
      lineUserId: sourceLineUserId,
      staffId,
      connection: pool,
      reason: "line_repair_estimate_postback"
    });
    await applyRepairEstimateCustomerResponse(id, approved, staffId, pool, "line_postback", {
      storeId: estimatePostbackStoreContext.storeId
    });
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withCustomerQuickReply([
          {
            type: "text",
            text: approved
              ? "已收到您的同意，門市將接續安排維修。"
              : "已收到您的拒絕，門市人員會再與您聯繫。"
          }
        ])
      );
    }
    return true;
  }

  if (action === "supplier_po_approve" || action === "supplier_po_reject" || action === "supplier_return_approve" || action === "supplier_return_reject") {
    const approved = action === "supplier_po_approve" || action === "supplier_return_approve";
    const requestType = action.startsWith("supplier_return_") ? "RETURN" : "PURCHASE_ORDER";
    await pool.query(
      `
        UPDATE supplier_requests
        SET status = ?,
            supplier_responded_at = NOW()
        WHERE id = ?
      `,
      [approved ? "APPROVED" : "REJECTED", id]
    );
    await sendToGroups(["inventory", "admin"], [{ type: "text", text: `${requestType === "RETURN" ? "供應商退貨" : "供應商發注"}已${approved ? "確認" : "拒絕"}單號 #${id}。` }]);
    await logWorkflowEvent("supplier_line_response", "SUPPLIER_REQUEST", id, { approved, requestType }, staffId);
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withStaffQuickReply([
          {
            type: "text",
            text: `${requestType === "RETURN" ? "退貨" : "發注"}單已${approved ? "確認" : "拒絕"}。`
          }
        ])
      );
    }
    return true;
  }

  if (action === "google_review_approve" || action === "google_review_reject") {
    const approved = action === "google_review_approve";
    const googleReviewStoreContext = await resolveLineWorkflowStoreContext({
      storeId: staffStoreId || postbackStoreId,
      staffId,
      connection: pool,
      reason: "google_review_postback"
    });
    const googleReviewStoreId = googleReviewStoreContext.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, cp.amount, cp.order_id AS orderId, cp.customer_id AS customerId, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ?
          AND cp.coupon_type = 'google_review'
          AND cp.store_id = ?
        LIMIT 1
      `,
      [googleReviewStoreId, id, googleReviewStoreId]
    );

    if (!rows[0]) {
      return true;
    }

    await pool.query(
      `
        UPDATE coupons
        SET status = ?,
            approved_by_staff_id = ?,
            approved_at = ?,
            rejected_at = ?,
            rejection_reason = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [
        approved ? "approved" : "rejected",
        staffId,
        approved ? new Date() : null,
        approved ? null : new Date(),
        approved ? null : "內部群組審核拒絕",
        id,
        googleReviewStoreId
      ]
    );

    if (rows[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, rows[0].lineUserId, [
        {
          type: "text",
          text: approved
            ? "Google 評論已確認，感謝您的回饋。"
            : "Google 評論這次未通過審核，如有疑問請洽門市人員。"
        }
      ]);
    }


    await sendToGroups(["admin", "staff", "daily"], [{ type: "text", text: `Google 評論 #${id} 已${approved ? "核准" : "拒絕"}。` }]);
    await logWorkflowEvent(approved ? "google_review_confirmed" : "google_review_rejected", "COUPON", id, { source: "line_postback", couponIssued: false }, staffId);
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withStaffQuickReply([
          {
            type: "text",
            text: approved ? "已核准 Google 評論。" : "已拒絕 Google 評論。"
          }
        ])
      );
    }
    return true;
  }

  if (action === "purchase_handover_confirm") {
    const handoverStoreContext = await resolveLineWorkflowStoreContext({
      storeId: postbackStoreId || staffStoreId,
      staffId,
      connection: pool,
      reason: "purchase_handover_postback"
    });
    const handoverStoreId = handoverStoreContext.storeId;
    const result = await withTransaction(async (connection) => {
      const [orderUpdate] = await connection.query(
        `
          UPDATE orders
          SET handover_confirmed_at = NOW(),
              handover_confirmed_by_staff_id = ?
          WHERE id = ?
            AND store_id = ?
        `,
        [staffId, id, handoverStoreId]
      );

      if (!orderUpdate.affectedRows) {
        await logWorkflowEvent("order_handover_confirm_blocked", "ORDER", id, {
          source: "line_postback",
          storeId: handoverStoreId,
          reason: "order_not_in_store_scope"
        }, staffId, connection);
        return { updated: false };
      }

      await connection.query(
        `
          UPDATE purchase_confirmations
          SET handover_confirmed_at = NOW(),
              handover_confirmed_by_staff_id = ?
          WHERE order_id = ?
            AND store_id = ?
        `,
        [staffId, id, handoverStoreId]
      );

      await logWorkflowEvent("order_handover_confirmed", "ORDER", id, { source: "line_postback", storeId: handoverStoreId }, staffId, connection);
      return { updated: true };
    });

    if (!result.updated) {
      if (event.replyToken) {
        await replyToLine(event.replyToken, withStaffQuickReply([{ type: "text", text: "找不到此店別可確認交車的訂單。" }]));
      }
      return true;
    }

    await sendToGroups(["admin", "staff"], [{ type: "text", text: `訂單 #${id} 已於內部群組確認交車。` }]);
    if (event.replyToken) {
      await replyToLine(
        event.replyToken,
        withStaffQuickReply([
          {
            type: "text",
            text: "已完成交車確認。"
          }
        ])
      );
    }
    return true;
  }

  return false;
}

function mapRegistrationTypeLabel(type) {
  const labels = {
    admin: "管理者通知群組",
    staff: "員工通知群組",
    repair: "維修通知群組",
    inventory: "庫存通知群組",
    daily: "每日結算群組"
  };
  return labels[type] || "通知群組";
}

module.exports = {
  applyRepairEstimateCustomerResponse,
  backfillApprovedRepairOrders,
  bindPhoneAndIssueNewFriendCoupon,
  claimLineWebhookEvent,
  buildCustomerMenuMessages,
  buildStaffLauncherMessages,
  withStaffQuickReply,
  buildPhoneBoundMessages,
  buildGroupApprovalMessage,
  buildMapNavigationUrl,
  buildPublicUrl,
  buildRepairQuoteConfirmationUrl,
  buildWelcomeMessages,
  createButtonMessage,
  createConfirmTemplate,
  createFlexMessage,
  createMessageAction,
  createPostbackAction,
  createQuickReplyText,
  createPurchaseConfirmationForOrder,
  createRepairReservationFromSession,
  applyRepairEstimateCustomerResponse,
  createUriAction,
  getPurchaseConfirmationEligibility,
  resolveLineWorkflowStoreContext,
  findOrCreateLineCustomer,
  handleCustomerMessageEvent,
  handleLineSlashCommand,
  handleStaffRepairEstimateWizard,
  handleLinePostback,
  getRegisteredGroupsByTypes,
  logWorkflowEvent,
  mapRegistrationTypeLabel,
  makeCode,
  replyToLine,
  runWithLineAccessTokenOptions,
  resolveGroupTargets,
  sendRepairQuoteConfirmationIfNeeded,
  sendRepairEstimateQuotation,
  sendToGroups,
  sendToGroupsWithResult
};
