const https = require("https");
const dayjs = require("dayjs");
const config = require("../config");
const { pool, withTransaction } = require("../db");
const { logKpi } = require("./kpiService");
const { sendLineMessage } = require("../utils/line");
const { getTableColumns, hasColumn } = require("../utils/schema");
const { applyRepairReservationDecision, notifyRepairCustomer } = require("./repairReservationService");

const BOT_NOTIFY = "notify";
const BOT_STOCK = "stock";
const TELEGRAM_SESSION_TIMEOUT_MINUTES = 30;

const TELEGRAM_UP_CATEGORIES = [
  { code: "EB", label: "電動自行車", aliases: ["ebike", "電動自行車", "電動車", "電動腳踏車"], areaCode: "C" },
  { code: "FK", label: "前叉避震器煞車", aliases: ["前叉", "避震器", "煞車", "前叉避震器", "煞車系統"], areaCode: "A" },
  { code: "BG", label: "包包水壺架", aliases: ["包包", "水壺架"], areaCode: "C" },
  { code: "CL", label: "夾具類", aliases: ["夾具", "夾具類"], areaCode: "A" },
  { code: "FP", label: "工廠零件", aliases: ["工廠零件", "工廠", "零件"], areaCode: "A" },
  { code: "EX", label: "換貨品", aliases: ["換貨", "換貨品", "交換品"], areaCode: "C" },
  { code: "TN", label: "改裝套件", aliases: ["改裝", "改裝套件"], areaCode: "A" },
  { code: "ST", label: "椅子", aliases: ["椅子", "坐墊", "座椅"], areaCode: "C" },
  { code: "LT", label: "燈具", aliases: ["燈具", "燈"], areaCode: "C" },
  { code: "TY", label: "玩具", aliases: ["玩具"], areaCode: "C" },
  { code: "HG", label: "車把握把腳踏", aliases: ["車把", "握把", "腳踏"], areaCode: "A" },
  { code: "CR", label: "載具", aliases: ["載具", "車台", "車架"], areaCode: "C" },
  { code: "TR", label: "輪胎", aliases: ["輪胎", "外胎", "內胎"], areaCode: "C" },
  { code: "LC", label: "鎖具快充", aliases: ["鎖具", "快充", "鎖具快充"], areaCode: "C" },
  { code: "PT", label: "零件", aliases: ["零件"], areaCode: "A" }
];

const TELEGRAM_UP_AREAS = {
  A: { code: "A", label: "維修區" },
  B: { code: "B", label: "展示區" },
  C: { code: "C", label: "倉庫 / 車輛區" }
};

const TELEGRAM_UP_STEPS = {
  inputterName: "awaiting_inputter_name",
  productName: "awaiting_product_name",
  category: "awaiting_category",
  categorySelection: "awaiting_category_selection",
  quantity: "awaiting_quantity",
  price: "awaiting_price",
  description: "awaiting_description",
  confirm: "awaiting_confirm",
  completed: "completed"
};

const TELEGRAM_ORDER_STEPS = {
  inputterName: "awaiting_inputter_name",
  phone: "awaiting_phone",
  product: "product",
  productSelect: "product_select",
  quantity: "quantity",
  paidAmount: "awaiting_paid_amount",
  confirm: "awaiting_confirm",
  completed: "completed"
};

function getTelegramBotToken(bot = BOT_NOTIFY) {
  return bot === BOT_STOCK ? config.telegram.stockBotToken : config.telegram.notifyBotToken;
}

function validateTelegramConfig() {
  const required = [
    ["TELEGRAM_NOTIFY_BOT_TOKEN", config.telegram.notifyBotToken],
    ["TELEGRAM_STOCK_BOT_TOKEN", config.telegram.stockBotToken],
    ["TELEGRAM_ORDER_GROUP_ID", config.telegram.orderGroupId],
    ["TELEGRAM_HQ_GROUP_ID", config.telegram.hqGroupId],
    ["TELEGRAM_STOCK_GROUP_ID", config.telegram.stockGroupId],
    ["TELEGRAM_REPAIR_CONFIRM_GROUP_ID", config.telegram.repairConfirmGroupId]
  ];

  for (const [name, value] of required) {
    if (!value) {
      console.warn(`[telegram] missing env ${name}; related Telegram delivery will be skipped.`);
    }
  }
}

function telegramRequest(bot, method, payload) {
  const token = getTelegramBotToken(bot);
  if (!token) {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_bot_token" });
  }

  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let responseText = "";
        res.on("data", (chunk) => {
          responseText += chunk;
        });
        res.on("end", () => {
          let data = {};
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch {
            data = { description: responseText };
          }
          if (res.statusCode >= 400 || data.ok === false) {
            const error = new Error(data.description || `Telegram API error ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.telegram = data;
            reject(error);
            return;
          }
          resolve(data);
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function actionToTelegramButton(action) {
  if (!action) {
    return null;
  }
  if (action.type === "uri") {
    return { text: action.label, url: action.uri };
  }
  if (action.type === "postback") {
    return { text: action.label, callback_data: action.data };
  }
  if (action.type === "message") {
    return { text: action.label, callback_data: `action=telegram_message&text=${encodeURIComponent(action.text || action.label)}` };
  }
  return null;
}

function extractTelegramPayload(message) {
  if (!message) {
    return { text: "", actions: [] };
  }

  if (message.type === "text") {
    return { text: message.text || "", actions: Array.isArray(message.actions) ? message.actions : [] };
  }

  if (message.type === "template") {
    const template = message.template || {};
    const title = template.title || message.altText || "";
    const text = template.text || "";
    return {
      text: [title, text].filter(Boolean).join("\n"),
      actions: Array.isArray(template.actions) ? template.actions : []
    };
  }

  if (message.type === "flex") {
    const bubble = message.contents || {};
    const bodyTexts = Array.isArray(bubble.body?.contents)
      ? bubble.body.contents.map((item) => item.text).filter(Boolean)
      : [];
    const footerActions = Array.isArray(bubble.footer?.contents)
      ? bubble.footer.contents.map((item) => item.action).filter(Boolean)
      : [];
    return {
      text: bodyTexts.length ? bodyTexts.join("\n") : message.altText || "",
      actions: footerActions
    };
  }

  return { text: message.altText || "KINGWAY 通知", actions: [] };
}

function buildReplyMarkup(actions) {
  const buttons = actions.map(actionToTelegramButton).filter(Boolean);
  if (buttons.length === 0) {
    return undefined;
  }
  return {
    inline_keyboard: buttons.map((button) => [button])
  };
}

function getMessageText(messages) {
  return messages.map((message) => extractTelegramPayload(message).text).join("\n").toLowerCase();
}

function hasPostbackAction(messages, prefix) {
  return messages.some((message) =>
    extractTelegramPayload(message).actions.some((action) => action.type === "postback" && String(action.data || "").includes(prefix))
  );
}

function resolveInternalRoute(registrationTypes, messages) {
  const types = new Set(registrationTypes);
  const text = getMessageText(messages);

  if (types.has("daily")) {
    return { bot: BOT_NOTIFY, chatId: config.telegram.orderGroupId, route: "order" };
  }
  if (hasPostbackAction(messages, "supplier_") || /供應商|發注|退貨|換貨|po/.test(text)) {
    return { bot: BOT_NOTIFY, chatId: config.telegram.hqGroupId, route: "hq" };
  }
  if (types.has("inventory")) {
    return { bot: BOT_STOCK, chatId: config.telegram.stockGroupId, route: "stock" };
  }
  if (/維修|購買確認|google|評論|優惠券|交車|報價/.test(text)) {
    return { bot: BOT_NOTIFY, chatId: config.telegram.repairConfirmGroupId, route: "repair_confirm" };
  }
  return { bot: BOT_NOTIFY, chatId: config.telegram.orderGroupId, route: "order" };
}

async function sendTelegramMessage(bot, chatId, text, actions = [], options = {}) {
  if (!chatId) {
    return { ok: false, skipped: true, reason: "missing_chat_id" };
  }

  const payload = {
    chat_id: chatId,
    text,
    reply_markup: buildReplyMarkup(actions)
  };

  if (options.replyToMessageId) {
    payload.reply_to_message_id = options.replyToMessageId;
  }

  return telegramRequest(bot, "sendMessage", payload);
}

async function sendOrderCreationNotification(order) {
  const chatId = config.telegram.orderGroupId;
  if (!chatId) {
    return { delivered: 0, targetGroupIds: [], route: "order", skipped: true };
  }

  try {
    await sendTelegramMessage(
      BOT_NOTIFY,
      chatId,
      [
        "POS 新訂單待確認",
        `訂單：${order.orderNo}`,
        order.customerName ? `客戶：${order.customerName}` : "客戶：未提供",
        `金額：NT$${Number(order.totalAmount || 0).toFixed(0)}`
      ].join("\n"),
      [
        { type: "postback", label: "Approve", data: `approve_order_${order.id}` },
        { type: "postback", label: "Reject", data: `reject_order_${order.id}` }
      ]
    );
  } catch (error) {
    console.warn("[telegram] order creation delivery failed", {
      route: "order",
      bot: BOT_NOTIFY,
      chatId,
      orderId: order.id,
      message: error.message
    });
    return {
      delivered: 0,
      targetGroupIds: [],
      route: "order",
      error: error.message
    };
  }

  return {
    delivered: 1,
    targetGroupIds: [chatId],
    route: "order"
  };
}

async function sendInternalTelegram(registrationTypes, messages) {
  const route = resolveInternalRoute(registrationTypes, messages);
  if (!route.chatId) {
    return { delivered: 0, targetGroupIds: [], route: route.route };
  }

  for (const message of messages.filter(Boolean)) {
    const payload = extractTelegramPayload(message);
    try {
      await sendTelegramMessage(route.bot, route.chatId, payload.text || "KINGWAY 通知", payload.actions);
    } catch (error) {
      console.warn("[telegram] delivery failed", {
        route: route.route,
        bot: route.bot,
        chatId: route.chatId,
        message: error.message
      });
      return {
        delivered: 0,
        targetGroupIds: [],
        route: route.route,
        error: error.message
      };
    }
  }

  return {
    delivered: 1,
    targetGroupIds: [route.chatId],
    route: route.route
  };
}

async function answerCallbackQuery(bot, callbackQueryId, text) {
  if (!callbackQueryId) {
    return;
  }
  await telegramRequest(bot, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

function getTelegramUser(callbackQuery) {
  const from = callbackQuery?.from || {};
  return {
    id: from.id || null,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null
  };
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

async function handleOrderApprovalCallback(bot, callbackQuery, action, id) {
  const approved = action === "order_approval_confirm" || action === "approve_order";
  const nextStatus = approved ? "PENDING_PAYMENT" : "CANCELED";
  const telegramUser = getTelegramUser(callbackQuery);
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error(`Invalid order id: ${id}`);
  }

  await withTransaction(async (connection) => {
    const [result] = await connection.query(
      `
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `,
      [nextStatus, orderId]
    );

    if (result.affectedRows === 0) {
      throw new Error(`Order not found: ${id}`);
    }

    await logWorkflowEvent(
      approved ? "telegram_order_approval_confirmed" : "telegram_order_approval_rejected",
      "ORDER",
      orderId,
      { approved, status: nextStatus, telegramUser },
      null,
      connection
    );
  });

  await answerCallbackQuery(bot, callbackQuery.id, approved ? "已確認訂單" : "已拒絕訂單");
  const chatId = callbackQuery.message?.chat?.id;
  const actor = telegramUser.username ? `@${telegramUser.username}` : telegramUser.firstName || "Telegram 使用者";
  await sendTelegramMessage(bot, chatId, `訂單 #${orderId} 已由 ${actor} ${approved ? "確認" : "拒絕"}。`);
  return true;
}

function buildTelegramActorLabel(telegramUser) {
  if (!telegramUser) {
    return "Telegram";
  }

  const name = [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" ").trim();
  if (telegramUser.username) {
    return name ? `Telegram @${telegramUser.username} (${name})` : `Telegram @${telegramUser.username}`;
  }
  if (name) {
    return `Telegram ${name}`;
  }
  return telegramUser.id ? `Telegram user ${telegramUser.id}` : "Telegram";
}

function formatTelegramTimestamp(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

async function handleRepairApprovalCallback(bot, callbackQuery, action, id) {
  const approved = action === "repair_reservation_approve";
  const repairId = Number(id);
  if (!Number.isInteger(repairId) || repairId <= 0) {
    throw new Error(`Invalid repair id: ${id}`);
  }

  const telegramUser = getTelegramUser(callbackQuery);
  const actorLabel = buildTelegramActorLabel(telegramUser);
  const result = await applyRepairReservationDecision(repairId, approved, null, "telegram_callback", pool, {
    logWorkflowEvent,
    telegramUser,
    actorLabel
  });

  if (!result) {
    await answerCallbackQuery(bot, callbackQuery.id, "找不到維修單");
    return false;
  }

  if (!result.alreadyProcessed) {
    console.log("Telegram confirm → updated repair:", repairId);
    await notifyRepairCustomer(repairId, result.customerMessage);
  }

  await answerCallbackQuery(
    bot,
    callbackQuery.id,
    result.alreadyProcessed
      ? `維修單 #${repairId} 已是${approved ? "已確認" : "已拒絕"}`
      : approved ? "已確認維修預約" : "已拒絕維修預約"
  );

  const chatId = callbackQuery.message?.chat?.id;
  const confirmedTime = formatTelegramTimestamp(new Date());
  if (chatId) {
    await sendTelegramMessage(
      bot,
      chatId,
      [
        approved ? "已確認" : "已拒絕",
        `工單 #${repairId}`,
        `處理人：${actorLabel}`,
        `時間：${confirmedTime}`,
        result.alreadyProcessed ? "狀態：重複點擊，未重送客戶通知" : "狀態：已同步更新到 POS"
      ].join("\n"),
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
  }

  return true;
}

function buildTelegramUserFromMessage(message) {
  const from = message?.from || {};
  return {
    id: from.id || null,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null
  };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "").trim();
}

function parsePositiveInteger(value) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeAmount(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function isSkipText(value) {
  return /^(略過|跳過|skip|無|沒有|none|n\/a|na|0)$/i.test(String(value || "").trim());
}

function normalizeTelegramText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isTelegramUserAllowed(message) {
  const allowList = new Set((config.telegram.allowedStaffUserIds || []).map((value) => String(value)));
  if (allowList.size === 0) {
    return true;
  }
  return allowList.has(String(message?.from?.id || ""));
}

function isManagedTelegramChat(chatId, groupIds) {
  const normalizedChatId = String(chatId || "").trim();
  return Boolean(normalizedChatId && new Set(groupIds.map((value) => String(value || "").trim()).filter(Boolean)).has(normalizedChatId));
}

function getManagedTelegramGroupIds() {
  return [
    config.telegram.orderGroupId,
    config.telegram.hqGroupId,
    config.telegram.stockGroupId,
    config.telegram.repairConfirmGroupId
  ];
}

function getAllowedTelegramChatIds() {
  const configured = (config.telegram.allowedChatIds || []).map((value) => String(value).trim()).filter(Boolean);
  if (configured.length > 0) {
    return new Set(configured);
  }
  return new Set(getManagedTelegramGroupIds().map((value) => String(value).trim()).filter(Boolean));
}

function isTelegramChatAllowed(message) {
  const chatId = String(message?.chat?.id || "").trim();
  const chatType = String(message?.chat?.type || "").trim().toLowerCase();
  const allowedChats = getAllowedTelegramChatIds();
  if (!chatId) {
    return false;
  }
  if (chatType === "group" || chatType === "supergroup" || chatType === "channel") {
    return allowedChats.has(chatId);
  }
  return isTelegramUserAllowed(message);
}

function isTelegramGroupAllowed(message, groupIds = getManagedTelegramGroupIds()) {
  const chatId = String(message?.chat?.id || "").trim();
  return isManagedTelegramChat(chatId, groupIds) && isTelegramChatAllowed(message);
}

async function rejectTelegramUnauthorized(bot, chatId) {
  await sendTelegramMessage(bot, chatId, "此群組未授權");
}

function getTelegramUpCategoryMatches(text) {
  const normalized = normalizeTelegramText(text);
  if (!normalized) {
    return [];
  }

  const exact = TELEGRAM_UP_CATEGORIES.filter((item) =>
    [item.code, item.label, ...(item.aliases || [])].some((value) => normalizeTelegramText(value) === normalized)
  );
  if (exact.length) {
    return exact;
  }

  return TELEGRAM_UP_CATEGORIES.filter((item) =>
    [item.code, item.label, ...(item.aliases || [])].some((value) => normalizeTelegramText(value).includes(normalized))
  );
}

function getTelegramUpCategoryLabel(code) {
  return TELEGRAM_UP_CATEGORIES.find((item) => item.code === code)?.label || code || "-";
}

function getTelegramUpAreaLabel(code) {
  return TELEGRAM_UP_AREAS[code]?.label || code || "-";
}

function getTelegramUpAreaCode(categoryCode) {
  return TELEGRAM_UP_CATEGORIES.find((item) => item.code === categoryCode)?.areaCode || "C";
}

function getTelegramUpCategoryOptionsText(matches) {
  return [
    "請回覆分類編號：",
    ...matches.map((item, index) => `${index + 1}. ${item.code} / ${item.label}`)
  ].join("\n");
}

function getTelegramUpPreview(payload) {
  return [
    "商品新增預覽",
    `處理人員：${payload.inputterName || "未填寫"}`,
    `商品名：${payload.productName || "未提供"}`,
    `分類：${payload.categoryCode || "-"} / ${payload.categoryLabel || "-"}`,
    `區域：${payload.areaCode || "-"} / ${payload.areaLabel || "-"}`,
    `SKU：${payload.sku || "-"}`,
    `數量：${payload.quantity ?? "-"}`,
    `價格：${formatCurrency(payload.price)}`,
    `說明：${payload.description || "無"}`
  ].join("\n");
}

function mapPaymentKindLabel(kind) {
  const map = {
    DEPOSIT: "訂金",
    FULL: "全額",
    REPAIR: "維修費",
    PARTIAL: "部分付款",
    BALANCE: "尾款"
  };
  return map[kind] || kind;
}

function mapOrderStatusLabel(status) {
  const map = {
    PENDING: "待處理",
    PENDING_PAYMENT: "待付款",
    REPAIRING: "維修中",
    COMPLETED: "已完成",
    CANCELED: "已取消"
  };
  return map[status] || status;
}

function mapFinalPaymentStatusLabel(status) {
  const map = {
    UNPAID: "未付款",
    PARTIAL: "部分付款",
    PAID: "已付款"
  };
  return map[status] || status;
}

function formatCurrency(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function getNotifyGroupIds() {
  return new Set(
    [
      config.telegram.orderGroupId,
      config.telegram.hqGroupId,
      config.telegram.repairConfirmGroupId
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function isNotifyGroupAllowed(message) {
  const chatId = String(message?.chat?.id || "").trim();
  const allowedGroups = getNotifyGroupIds();
  if (!chatId || !allowedGroups.has(chatId)) {
    return false;
  }

  const allowList = new Set((config.telegram.allowedStaffUserIds || []).map((value) => String(value)));
  if (allowList.size === 0) {
    return true;
  }

  return allowList.has(String(message?.from?.id || ""));
}

async function getTelegramSession(bot, chatId, telegramUserId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, flow_type AS flowType, step_key AS stepKey, payload, updated_at AS updatedAt
      FROM telegram_chat_sessions
      WHERE bot_name = ?
        AND chat_id = ?
        AND telegram_user_id = ?
      LIMIT 1
    `,
    [bot, chatId, telegramUserId]
  );

  const session = rows[0];
  if (!session) {
    return null;
  }

  const updatedAt = session.updatedAt ? new Date(session.updatedAt) : null;
  const timeoutMs = TELEGRAM_SESSION_TIMEOUT_MINUTES * 60 * 1000;
  if (updatedAt && Date.now() - updatedAt.getTime() > timeoutMs) {
    await clearTelegramSession(bot, chatId, telegramUserId, connection);
    return { expired: true };
  }

  let payload = {};
  if (session.payload && typeof session.payload === "object") {
    payload = session.payload;
  } else {
    try {
      payload = session.payload ? JSON.parse(session.payload) : {};
    } catch {
      payload = {};
    }
  }

  return {
    id: session.id,
    flowType: session.flowType,
    stepKey: session.stepKey,
    payload
  };
}

async function saveTelegramSession(bot, chatId, telegramUserId, flowType, stepKey, payload = {}, connection = pool) {
  await connection.query(
    `
      INSERT INTO telegram_chat_sessions (bot_name, chat_id, telegram_user_id, flow_type, step_key, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        flow_type = VALUES(flow_type),
        step_key = VALUES(step_key),
        payload = VALUES(payload),
        updated_at = CURRENT_TIMESTAMP
    `,
    [bot, chatId, telegramUserId, flowType, stepKey, JSON.stringify(payload || {})]
  );
}

async function clearTelegramSession(bot, chatId, telegramUserId, connection = pool) {
  await connection.query(
    `
      DELETE FROM telegram_chat_sessions
      WHERE bot_name = ?
        AND chat_id = ?
        AND telegram_user_id = ?
    `,
    [bot, chatId, telegramUserId]
  );
}

async function resolveTelegramStaffUserId(connection, telegramUser, targetStoreId = null) {
  const telegramUserId = telegramUser?.id ? String(telegramUser.id) : "";
  const telegramUsername = telegramUser?.username ? String(telegramUser.username).trim() : "";
  const hasIdentity = Boolean(telegramUserId) || Boolean(telegramUsername);
  if (!hasIdentity) {
    throw new Error("找不到可用 Telegram 操作員資料");
  }

  const whereParts = [
    "is_active = 1",
    "(telegram_user_id = ? OR telegram_username = ? OR username = ?)"
  ];
  const queryParams = [telegramUserId || null, telegramUsername || null, telegramUsername || null];

  const explicitStoreId = Number(targetStoreId || telegramUser?.storeId || telegramUser?.store_id || 0);
  if (Number.isSafeInteger(explicitStoreId) && explicitStoreId > 0) {
    whereParts.push("store_id = ?");
    queryParams.push(explicitStoreId);
  }

  const [rows] = await connection.query(
    `
      SELECT id, COALESCE(store_id, 0) AS storeId
      FROM staff_users
      WHERE ${whereParts.join(" AND ")}
      ORDER BY
        CASE
          WHEN telegram_user_id = ? THEN 1
          WHEN telegram_username = ? THEN 2
          ELSE 3
        END,
        CASE role
          WHEN 'ADMIN' THEN 1
          WHEN 'MANAGER' THEN 2
          WHEN 'CASHIER' THEN 3
          ELSE 9
        END,
        id ASC
      LIMIT 1
    `,
    [...queryParams, telegramUserId || null, telegramUsername || null]
  );
  if (!rows[0]) {
    throw new Error("找不到可用員工帳號，無法建立 Telegram 作業");
  }
  const resolvedStoreId = Number(rows[0].storeId || 0);
  return {
    id: rows[0].id,
    storeId: Number.isSafeInteger(resolvedStoreId) && resolvedStoreId > 0 ? resolvedStoreId : null
  };
}

async function findCustomerByPhone(phone, connection = pool, storeId = null) {
  const normalizedStoreId = Number(storeId || 0);
  const hasStoreFilter = Number.isSafeInteger(normalizedStoreId) && normalizedStoreId > 0;

  const [rows] = await connection.query(
    `
      SELECT id, name, phone, line_user_id AS lineUserId, customer_type AS customerType
      FROM customers
      WHERE phone = ?
      ${hasStoreFilter ? " AND store_id = ?" : ""}
      ORDER BY
        CASE WHEN line_user_id IS NOT NULL AND line_user_id <> '' THEN 0 ELSE 1 END,
        id DESC
      LIMIT 1
    `,
    hasStoreFilter ? [phone, normalizedStoreId] : [phone]
  );
  return rows[0] || null;
}

function normalizeTelegramOrderProductRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    sku: String(row.sku || "").trim(),
    name: String(row.name || "").trim(),
    category: String(row.category || "").trim(),
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    isActive: Number(row.isActive ?? 1) === 1
  };
}

function normalizeStoreId(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

async function findTelegramOrderProducts(keyword, connection = pool, storeId = null) {
  const searchText = String(keyword || "").trim();
  if (!searchText) {
    return { exact: null, exactMatches: [], matches: [] };
  }

  const normalizedStoreId = normalizeStoreId(storeId);
  const storeClause = normalizedStoreId ? " AND store_id = ?" : "";
  const queryParams = normalizedStoreId ? [searchText, searchText, searchText, normalizedStoreId] : [searchText, searchText, searchText];
  const [exactRows] = await connection.query(
    `
      SELECT id, sku, name, category, price, stock, is_active AS isActive
      FROM products
      WHERE is_active = 1
        AND (sku = ? OR name = ?)
        ${storeClause}
      ORDER BY
        CASE WHEN sku = ? THEN 0 ELSE 1 END,
        id DESC
    `,
    queryParams
  );

  const exactMatches = exactRows.map(normalizeTelegramOrderProductRow).filter(Boolean);
  if (exactMatches.length === 1) {
    return { exact: exactMatches[0], exactMatches, matches: [] };
  }

  if (exactMatches.length > 1) {
    return { exact: null, exactMatches, matches: exactMatches };
  }

  const like = `%${searchText}%`;
  const listParams = normalizedStoreId
    ? [like, like, `${searchText}%`, `${searchText}%`, normalizedStoreId]
    : [like, like, `${searchText}%`, `${searchText}%`];
  const [matches] = await connection.query(
    `
      SELECT id, sku, name, category, price, stock, is_active AS isActive
      FROM products
      WHERE is_active = 1
        AND (sku LIKE ? OR name LIKE ?)
        ${storeClause}
      ORDER BY
        CASE WHEN sku LIKE ? THEN 0 ELSE 1 END,
        CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
        stock DESC,
        id DESC
      LIMIT 8
    `,
    listParams
  );

  return {
    exact: null,
    exactMatches: [],
    matches: matches.map(normalizeTelegramOrderProductRow).filter(Boolean)
  };
}

const findProductExactOrSimilar = findTelegramOrderProducts;

function summarizeProductChoice(product, quantity = 1, unitPrice = null) {
  const price = unitPrice === null || unitPrice === undefined ? Number(product.price || 0) : Number(unitPrice);
  return [
    `商品：${product.sku} / ${product.name}`,
    `數量：${quantity}`,
    `單價：${formatCurrency(price)}`,
    `庫存：${product.stock}`,
    `小計：${formatCurrency(price * quantity)}`
  ].join("\n");
}

function buildTelegramOrderPreview(payload) {
  const product = payload.product || {};
  const quantity = Number(payload.quantity || 0);
  const unitPrice = Number(payload.unitPrice || product.price || 0);
  const subtotal = Number(payload.totalAmount || unitPrice * quantity);
  const lines = [
    "訂單預覽",
    `電話：${payload.customer?.phone || "-"}`,
    `商品：${product.name || "-"}`,
    `SKU：${product.sku || "-"}`,
    `數量：${quantity || "-"}`,
    `單價：${formatCurrency(unitPrice)}`,
    `小計：${formatCurrency(subtotal)}`
  ];
  return lines.join("\n");
}

function buildOrderConfirmActions() {
  return [
    { type: "postback", label: "確認建立", data: "action=tg_order_confirm" },
    { type: "postback", label: "取消流程", data: "action=tg_order_cancel" }
  ];
}

function buildBaojiaAddMoreActions() {
  return [
    { type: "postback", label: "新增其他維修項目", data: "action=tg_baojia_add_more&value=yes" },
    { type: "postback", label: "沒有了", data: "action=tg_baojia_add_more&value=no" }
  ];
}

function buildBaojiaConfirmActions() {
  return [
    { type: "postback", label: "發送報價", data: "action=tg_baojia_confirm_send" },
    { type: "postback", label: "取消", data: "action=tg_baojia_cancel" }
  ];
}

function buildPaymentKindActions() {
  return [
    { type: "postback", label: "訂金", data: "action=tg_order_payment_kind&kind=DEPOSIT" },
    { type: "postback", label: "全額", data: "action=tg_order_payment_kind&kind=FULL" },
    { type: "postback", label: "維修費", data: "action=tg_order_payment_kind&kind=REPAIR" },
    { type: "postback", label: "部分付款", data: "action=tg_order_payment_kind&kind=PARTIAL" }
  ];
}

function isYesText(value) {
  return /^(y|yes|是|好|要|新增)$/i.test(String(value || "").trim());
}

function isNoText(value) {
  return /^(n|no|否|不用|不要|沒有了|完成)$/i.test(String(value || "").trim());
}

function deriveOrderPaymentState(totalAmount, paidAmount, paymentKind, isRepairOrder) {
  const normalizedTotal = Number(totalAmount || 0);
  const normalizedPaid = Math.min(Math.max(Number(paidAmount || 0), 0), normalizedTotal);
  const unpaidBalance = Math.max(normalizedTotal - normalizedPaid, 0);
  const depositAmount = paymentKind === "DEPOSIT" ? normalizedPaid : 0;
  const finalPaymentStatus = unpaidBalance <= 0 ? "PAID" : normalizedPaid > 0 ? "PARTIAL" : "UNPAID";
  let status = "PENDING";
  if (isRepairOrder) {
    status = unpaidBalance > 0 ? "PENDING_PAYMENT" : "REPAIRING";
  } else if (paymentKind === "DEPOSIT" || paymentKind === "PARTIAL") {
    status = "PENDING_PAYMENT";
  }
  return {
    unpaidBalance,
    depositAmount,
    finalPaymentStatus,
    status,
    isReservationOrder: unpaidBalance > 0 || depositAmount > 0
  };
}

function buildOrderSummary(payload) {
  const product = payload.product || {};
  const unitPrice = Number(payload.unitPrice || product.price || 0);
  const quantity = Number(payload.quantity || 0);
  const subtotal = Number(payload.totalAmount || unitPrice * quantity);
  const paidAmount = Number(payload.paidAmount || 0);
  const unpaidBalance = Math.max(subtotal - paidAmount, 0);
  return [
    "請確認 Telegram 訂單",
    `處理人員：${payload.inputterName || "未填寫"}`,
    `電話：${payload.customer?.phone || "未提供"}`,
    `商品：${product.name || "未提供"}`,
    `SKU：${product.sku || "未提供"}`,
    `數量：${quantity || 0}`,
    `單價：${formatCurrency(unitPrice)}`,
    `小計：${formatCurrency(subtotal)}`,
    `已收金額：${formatCurrency(paidAmount)}`,
    `未收餘額：${formatCurrency(unpaidBalance)}`
  ].join("\n");
}

async function createTelegramCustomerIfNeeded(phone, telegramUser, connection, options = {}) {
  const existing = await findCustomerByPhone(phone, connection, options.storeId || null);
  if (existing) {
    return existing;
  }

  const customerColumns = await getTableColumns(connection, "customers");
  const hasStoreId = hasColumn(customerColumns, "store_id");
  const actorLabel = buildTelegramActorLabel(telegramUser);
  const fallbackName = `Telegram客戶-${phone}`;
  const insertColumns = ["name", "phone", "customer_type", "notes", "last_contact_at"];
  const insertValues = [fallbackName, phone, "OFFLINE_WITH_PHONE", `由 ${actorLabel} 透過 Telegram 建立`, new Date()];

  if (hasStoreId) {
    insertColumns.push("store_id");
    insertValues.push(options.storeId || null);
  }

  const placeholders = insertColumns.map(() => "?").join(", ");
  const [result] = await connection.query(
    `INSERT INTO customers (${insertColumns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
    insertValues
  );

  return {
    id: result.insertId,
    name: fallbackName,
    phone,
    lineUserId: null,
    customerType: "OFFLINE_WITH_PHONE"
  };
}

async function generateTelegramUpSku(connection, areaCode, categoryCode) {
  const prefix = `${areaCode}-${categoryCode}`;
  const [rows] = await connection.query(
    `
      SELECT sku
      FROM products
      WHERE sku LIKE ?
      ORDER BY sku DESC
      LIMIT 1
      FOR UPDATE
    `,
    [`${prefix}-%`]
  );
  const lastSku = rows[0]?.sku ? String(rows[0].sku) : null;
  const lastNumber = lastSku ? Number(lastSku.split("-").pop()) || 0 : 0;
  return `${prefix}-${String(lastNumber + 1).padStart(3, "0")}`;
}

async function createTelegramProductFromPayload(payload, telegramUser) {
  return withTransaction(async (connection) => {
    const productColumns = await getTableColumns(connection, "products");
    const inputterName = String(payload.inputterName || "").trim() || buildTelegramActorLabel(telegramUser);
    const quantity = Number(payload.quantity || 0);
    const price = Number(payload.price || 0);
    const description = String(payload.description || "").trim();
    const areaCode = String(payload.areaCode || "C").trim().toUpperCase();
    const categoryCode = String(payload.categoryCode || "PT").trim().toUpperCase();
    const staff = await resolveTelegramStaffUserId(connection, telegramUser, payload.storeId);
    const staffId = staff.id;
    const staffStoreId = staff.storeId;
    if (!staffStoreId) {
      throw new Error("無法判斷員工店別，無法新增 Telegram 商品");
    }
    const location = `${areaCode} - ${getTelegramUpAreaLabel(areaCode)}`;
    const hasStoreId = hasColumn(productColumns, "store_id");
    const insertColumns = [
      "sku",
      "name",
      "category",
      "price",
      "stock",
      "reorder_level",
      "is_active",
      "description",
      "location",
      ...(hasColumn(productColumns, "inputter_name") ? ["inputter_name"] : []),
      ...(hasColumn(productColumns, "source") ? ["source"] : []),
      ...(hasStoreId ? ["store_id"] : [])
    ];
    const insertSql = `INSERT INTO products (${insertColumns.map((column) => `\`${column}\``).join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sku = attempt === 0 && payload.sku
        ? payload.sku
        : await generateTelegramUpSku(connection, areaCode, categoryCode);
      const insertValues = [
        sku,
        String(payload.productName || "").trim(),
        categoryCode,
        price,
        quantity,
        0,
        1,
        description || null,
        location,
        ...(hasColumn(productColumns, "inputter_name") ? [inputterName] : []),
        ...(hasColumn(productColumns, "source") ? ["TELEGRAM_UP"] : []),
        ...(hasStoreId ? [staffStoreId] : [])
      ];

      try {
        const [result] = await connection.query(insertSql, insertValues);

        await connection.query(
          `
            INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
            VALUES (?, 'IN', ?, ?, ?)
          `,
          [
            result.insertId,
            quantity,
            `Telegram 新增商品：${sku} / ${inputterName} / ${buildTelegramActorLabel(telegramUser)}`,
            staffId
          ]
        );

        await logWorkflowEvent(
          "telegram_up_created",
          "PRODUCT",
          result.insertId,
          {
            sku,
            productName: String(payload.productName || "").trim(),
            categoryCode,
            categoryLabel: getTelegramUpCategoryLabel(categoryCode),
            areaCode,
            areaLabel: getTelegramUpAreaLabel(areaCode),
            quantity,
            price,
            description: description || null,
            inputterName,
            telegramUser
          },
          staffId,
          connection
        );

        return {
          id: result.insertId,
          sku,
          productName: String(payload.productName || "").trim(),
          categoryCode,
          categoryLabel: getTelegramUpCategoryLabel(categoryCode),
          areaCode,
          areaLabel: getTelegramUpAreaLabel(areaCode),
          quantity,
          price,
          description: description || null,
          inputterName,
          source: "TELEGRAM_UP"
        };
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") {
          throw error;
        }
      }
    }

    throw new Error("SKU 產生失敗，請再試一次");
  });
}

function summarizeBaojiaItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const subtotal = Number(item.subtotal || quantity * unitPrice);
    return `${index + 1}. ${item.sku} / ${item.name} x${quantity} / ${formatCurrency(unitPrice)} / 小計 ${formatCurrency(subtotal)}`;
  });
}

function buildBaojiaPreview(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  return [
    "維修報價預覽",
    `處理人員：${payload.inputterName || "未填寫"}`,
    `客戶：${payload.customer?.name || "未提供"} / ${payload.customer?.phone || "未提供"}`,
    payload.customer?.lineUserId ? "LINE 綁定：已綁定" : "LINE 綁定：未綁定，LINE 報價通知可能無法送出",
    "品項：",
    ...(items.length ? summarizeBaojiaItems(items) : ["無"]),
    `總額：${formatCurrency(total)}`,
    `備註：${payload.note || "無"}`
  ].join("\n");
}

async function createRepairQuoteDraftFromTelegram(payload, telegramUser) {
  return withTransaction(async (connection) => {
    const { sendRepairEstimateQuotation } = require("./lineWorkflowService");
    const staff = await resolveTelegramStaffUserId(connection, telegramUser);
    const staffStoreId = staff.storeId;
    if (!staffStoreId) {
      throw new Error("無法判斷員工店別，無法建立 Telegram 維修報價");
    }

    const repairOrderColumns = await getTableColumns(connection, "repair_orders");
    const hasStoreId = hasColumn(repairOrderColumns, "store_id");
    const repairOrderWhere = hasStoreId ? "id = ? AND store_id = ?" : "id = ?";
    const repairOrderParams = hasStoreId ? [payload.createdRepairId, staffStoreId] : [payload.createdRepairId];

    if (payload.createdRepairId) {
      const [existingRows] = await connection.query(
        `
          SELECT id, customer_id AS customerId, estimate_amount AS estimateAmount, quote_status AS quoteStatus
          FROM repair_orders
          WHERE ${repairOrderWhere}
          LIMIT 1
        `,
        repairOrderParams
      );
      if (existingRows[0]) {
        return {
          repairId: existingRows[0].id,
          existing: true,
          totalAmount: Number(existingRows[0].estimateAmount || 0),
          lineBound: Boolean(payload.customer?.lineUserId)
        };
      }
    }

    const customer = await createTelegramCustomerIfNeeded(payload.customer.phone, telegramUser, connection, { storeId: staffStoreId });
    const staffId = staff.id;
    const items = (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
      productId: Number(item.productId),
      sku: String(item.sku || "").trim(),
      name: String(item.name || "").trim(),
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal || Number(item.quantity || 0) * Number(item.unitPrice || 0))
    })).filter((item) => item.productId && item.name && item.quantity > 0);

    if (!items.length) {
      throw new Error("至少需要一筆維修報價品項");
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const inputterName = String(payload.inputterName || "").trim() || buildTelegramActorLabel(telegramUser);
    const issueDescription = [
      payload.note || null,
      `Telegram 報價處理人員：${inputterName}`
    ].filter(Boolean).join("\n");
    const bikeModel = items.map((item) => item.name).slice(0, 2).join(" / ").slice(0, 150) || "Telegram 維修報價";
    const reservationDate = dayjs().format("YYYY-MM-DD");
    const reservationDay = dayjs().format("dddd");

    const [repairResult] = await connection.query(
      `
        INSERT INTO repair_orders (
          customer_id,
          customer_type,
          source,
          bike_model,
          issue_description,
          reservation_date,
          reservation_day,
          reservation_time,
          base_fee,
          reservation_status,
          status,
          approved_by_staff_id
          ${hasStoreId ? ", store_id" : ""}
        )
        VALUES (?, ?, 'WEB', ?, ?, ?, ?, NULL, 0, 'approved', 'checking', ?, ${hasStoreId ? "?" : ""})
      `,
      [
        customer.id,
        customer.customerType || (customer.lineUserId ? "LINE" : "OFFLINE_WITH_PHONE"),
        bikeModel,
        issueDescription || "Telegram 維修報價",
        reservationDate,
        reservationDay,
        staffId,
        ...(hasStoreId ? [staffStoreId] : [])
      ]
    );

    await connection.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'checking', ?)
      `,
      [repairResult.insertId, `Telegram 建立維修報價草稿，處理人員：${inputterName}`]
    );

    const quoteResult = await sendRepairEstimateQuotation(
      repairResult.insertId,
      {
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.subtotal
        })),
        inspectionFee: 0,
        partsFee: totalAmount,
        laborFee: 0,
        notes: [
          payload.note || null,
          `Telegram 報價處理人員：${inputterName}`
        ].filter(Boolean).join("\n"),
        totalAmount
      },
      staffId,
      "telegram_baojia",
      connection
    );

    await logWorkflowEvent("telegram_repair_quote_sent", "REPAIR_ORDER", repairResult.insertId, {
      inputterName,
      totalAmount,
      itemCount: items.length,
      customerId: customer.id,
      telegramUser
    }, staffId, connection);

    return {
      repairId: repairResult.insertId,
      existing: false,
      totalAmount: Number(quoteResult?.totalAmount || totalAmount),
      lineBound: Boolean(customer.lineUserId),
      customer
    };
  });
}

async function createTelegramOrderFromPayload(payload, telegramUser) {
  return withTransaction(async (connection) => {
    const staff = await resolveTelegramStaffUserId(connection, telegramUser, payload.storeId || null);
    const staffId = staff.id;
    const staffStoreId = staff.storeId;
    if (!staffStoreId) {
      throw new Error("無法判斷員工店別，無法建立 Telegram 訂單");
    }

    const orderColumns = await getTableColumns(connection, "orders");
    const orderItemColumns = await getTableColumns(connection, "order_items");
    const hasOrderStoreId = hasColumn(orderColumns, "store_id");
    const hasOrderItemStoreId = hasColumn(orderItemColumns, "store_id");
    const hasProductStoreId = hasColumn(await getTableColumns(connection, "products"), "store_id");

    const [existingOrderRows] = payload.createdOrderId
      ? await connection.query(
          `
            SELECT id, order_no AS orderNo
            FROM orders
            WHERE id = ?
            ${hasOrderStoreId ? "AND store_id = ?" : ""}
            LIMIT 1
          `,
          hasOrderStoreId ? [payload.createdOrderId, staffStoreId] : [payload.createdOrderId]
        )
      : [[]];
    if (existingOrderRows[0]) {
      return {
        id: existingOrderRows[0].id,
        orderNo: existingOrderRows[0].orderNo,
        existing: true
      };
    }

    const customer = await createTelegramCustomerIfNeeded(payload.customer.phone, telegramUser, connection, { storeId: staffStoreId });
    const [productRows] = await connection.query(
      `
        SELECT id, sku, name, category, price, stock, is_active AS isActive
        FROM products
        WHERE id = ?
          AND store_id = ?
        FOR UPDATE
      `,
      [payload.product.id, staffStoreId]
    );
    const product = productRows[0];
    if (!product || !product.isActive) {
      throw new Error("商品不存在或已停用");
    }
    if (Number(product.stock || 0) < Number(payload.quantity || 0)) {
      throw new Error(`${product.sku} 庫存不足`);
    }

    const quantity = Number(payload.quantity || 0);
    const unitPrice = Number(payload.unitPrice || product.price || 0);
    const totalAmount = unitPrice * quantity;
    const isRepairOrder = payload.orderType === "REPAIR" || ["REPAIR", "RP"].includes(product.category);
    const paymentState = deriveOrderPaymentState(totalAmount, payload.paidAmount, payload.paymentKind, isRepairOrder);
    const orderNoPrefix = isRepairOrder ? "TEL-REP" : "TEL";
    const orderNo = `${orderNoPrefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)}-${String(customer.id).padStart(4, "0")}`;
    const actorLabel = buildTelegramActorLabel(telegramUser);
    const inputterName = String(payload.inputterName || "").trim() || actorLabel;
    const noteLines = [
      payload.note || null,
      `Telegram 建單：${actorLabel}`,
      `Telegram 建單處理人員：${inputterName}`,
      `付款類型：${mapPaymentKindLabel(payload.paymentKind)}`
    ].filter(Boolean);
    const businessDate = formatTelegramTimestamp(new Date()).slice(0, 10).replace(/\//g, "-");
    const insertColumns = [
      "order_no",
      "customer_id",
      "customer_name",
      "customer_phone",
      "customer_type",
      "order_type",
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
      ...(hasOrderStoreId ? ["store_id"] : []),
      ...(hasColumn(orderColumns, "source") ? ["source"] : [])
    ];
    const [orderResult] = await connection.query(
      `
        INSERT INTO orders (${insertColumns.map((column) => `\`${column}\``).join(", ")})
        VALUES (${insertColumns.map(() => "?").join(", ")})
      `,
      [
        orderNo,
        customer.id,
        customer.name,
        customer.phone,
        customer.customerType || (customer.lineUserId ? "LINE" : "OFFLINE_WITH_PHONE"),
        isRepairOrder ? "REPAIR" : "GENERAL",
        totalAmount,
        "OTHER",
        paymentState.status,
        paymentState.isReservationOrder ? 1 : 0,
        paymentState.depositAmount,
        paymentState.unpaidBalance,
        paymentState.finalPaymentStatus,
        paymentState.finalPaymentStatus === "PAID" ? new Date() : null,
        noteLines.join("\n"),
        staffId,
        businessDate,
        ...(hasOrderStoreId ? [staffStoreId] : []),
        ...(hasColumn(orderColumns, "source") ? ["TELEGRAM_ORDER"] : [])
      ]
    );

    await connection.query(
      `
        INSERT INTO order_items (
          order_id,
          ${hasOrderItemStoreId ? "store_id," : ""}
          product_id,
          sku_snapshot,
          product_name_snapshot,
          product_category_snapshot,
          quantity,
          unit_price,
          line_total
        )
        VALUES (?, ${hasOrderItemStoreId ? "?, " : ""}?, ?, ?, ?, ?, ?, ?)
      `,
      [orderResult.insertId, ...(hasOrderItemStoreId ? [staffStoreId] : []), product.id, product.sku, product.name, product.category, quantity, unitPrice, totalAmount]
    );

    if (hasProductStoreId) {
      await connection.query("UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?", [quantity, product.id, staffStoreId]);
    } else {
      await connection.query("UPDATE products SET stock = stock - ? WHERE id = ?", [quantity, product.id]);
    }
    const inventoryColumns = await getTableColumns(connection, "inventory_movements");
    if (hasColumn(inventoryColumns, "reference_type") && hasColumn(inventoryColumns, "reference_id")) {
      await connection.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
          VALUES (?, 'SALE', ?, 'ORDER', ?, ?, ?)
        `,
        [product.id, -quantity, orderResult.insertId, staffId, `Telegram 建單 ${orderNo}`]
      );
    } else {
      await connection.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
          VALUES (?, 'SALE', ?, ?, ?)
        `,
        [product.id, -quantity, `Telegram 建單 ${orderNo}`, staffId]
      );
    }

    if (Number(payload.paidAmount || 0) > 0) {
      await connection.query(
        `
          INSERT INTO order_payment_events (
            order_id, customer_id, payment_kind, amount, unpaid_balance_after, note, source, created_by_staff_id, created_by_label, meta_json
          )
          VALUES (?, ?, ?, ?, ?, ?, 'TELEGRAM_ORDER', ?, ?, ?)
        `,
        [
          orderResult.insertId,
          customer.id,
          payload.paymentKind,
          Number(payload.paidAmount || 0),
          paymentState.unpaidBalance,
          payload.note || null,
          staffId,
          actorLabel,
          JSON.stringify({ telegramUser, productId: product.id, inputterName })
        ]
      );
    }

    await logWorkflowEvent("telegram_order_created", "ORDER", orderResult.insertId, {
      orderNo,
      customerId: customer.id,
      productId: product.id,
      quantity,
      unitPrice,
      totalAmount,
      paidAmount: Number(payload.paidAmount || 0),
      paymentKind: payload.paymentKind,
      inputterName,
      telegramUser
    }, staffId, connection);

    await connection.query(
      `
        INSERT INTO customer_crm_events (customer_id, event_type, stage, note, created_by_staff_id)
        VALUES (?, 'telegram_order_created', NULL, ?, ?)
      `,
      [customer.id, `訂單 ${orderNo} 已由 Telegram 建立，處理人員：${inputterName}`, staffId]
    );

    return {
      id: orderResult.insertId,
      orderNo,
      existing: false,
      customer,
      totalAmount,
      unpaidBalance: paymentState.unpaidBalance,
      finalPaymentStatus: paymentState.finalPaymentStatus,
      status: paymentState.status,
      inputterName
    };
  });
}

async function fetchCustomerCrmSummaryByPhone(phone, connection = pool) {
  const [customerRows] = await connection.query(
    `
      SELECT id, name, phone, line_user_id AS lineUserId, customer_type AS customerType
      FROM customers
      WHERE phone = ?
      ORDER BY
        CASE WHEN line_user_id IS NOT NULL AND line_user_id <> '' THEN 0 ELSE 1 END,
        id DESC
      LIMIT 1
    `,
    [phone]
  );
  const customer = customerRows[0];
  if (!customer) {
    return null;
  }

  const [orders] = await connection.query(
    `
      SELECT
        id,
        order_no AS orderNo,
        order_type AS orderType,
        customer_name AS customerName,
        customer_phone AS customerPhone,
        total_amount AS totalAmount,
        status,
        final_payment_status AS finalPaymentStatus,
        deposit_amount AS depositAmount,
        unpaid_balance AS unpaidBalance,
        source,
        created_at AS createdAt
      FROM orders
      WHERE customer_id = ?
      ORDER BY id DESC
      LIMIT 5
    `,
    [customer.id]
  );

  return { customer, orders };
}

function buildCrmCustomerSummary(summary) {
  const { customer, orders } = summary;
  return [
    "CRM 客戶摘要",
    `姓名：${customer.name || "未提供"}`,
    `電話：${customer.phone || "未提供"}`,
    `LINE 綁定：${customer.lineUserId ? "已綁定" : "未綁定"}`,
    `最近訂單數：${orders.length}`
  ].join("\n");
}

function buildCrmOrderCard(order) {
  const paidAmount = Math.max(Number(order.totalAmount || 0) - Number(order.unpaidBalance || 0), 0);
  return [
    `訂單：${order.orderNo || `#${order.id}`}`,
    `客戶：${order.customerName || "未提供"} / ${order.customerPhone || "未提供"}`,
    `類型：${order.orderType === "REPAIR" ? "維修" : "一般"}`,
    `狀態：${mapOrderStatusLabel(order.status)}`,
    `付款：${mapFinalPaymentStatusLabel(order.finalPaymentStatus)}`,
    `總額：${formatCurrency(order.totalAmount)}`,
    `已收：${formatCurrency(paidAmount)}`,
    `未收：${formatCurrency(order.unpaidBalance)}`
  ].join("\n");
}

function buildCrmOrderActions(orderId) {
  return [
    { type: "postback", label: "修改狀態", data: `action=tg_crm_status_menu&id=${orderId}` },
    { type: "postback", label: "收訂金", data: `action=tg_crm_pay&id=${orderId}&kind=DEPOSIT` },
    { type: "postback", label: "收尾款", data: `action=tg_crm_pay&id=${orderId}&kind=BALANCE` },
    { type: "postback", label: "收維修費", data: `action=tg_crm_pay&id=${orderId}&kind=REPAIR` },
    { type: "postback", label: "完成付款", data: `action=tg_crm_pay&id=${orderId}&kind=FULL` },
    { type: "postback", label: "確認交車", data: `action=tg_crm_handover&id=${orderId}` },
    { type: "postback", label: "查看明細", data: `action=tg_crm_detail&id=${orderId}` }
  ];
}

function buildCrmStatusActions(orderId) {
  return [
    { type: "postback", label: "待處理", data: `action=tg_crm_status&id=${orderId}&status=PENDING` },
    { type: "postback", label: "待付款", data: `action=tg_crm_status&id=${orderId}&status=PENDING_PAYMENT` },
    { type: "postback", label: "維修中", data: `action=tg_crm_status&id=${orderId}&status=REPAIRING` },
    { type: "postback", label: "已完成", data: `action=tg_crm_status&id=${orderId}&status=COMPLETED` },
    { type: "postback", label: "已取消", data: `action=tg_crm_status&id=${orderId}&status=CANCELED` }
  ];
}

async function sendCrmSummary(bot, chatId, phone, connection = pool) {
  const summary = await fetchCustomerCrmSummaryByPhone(phone, connection);
  if (!summary) {
    await sendTelegramMessage(bot, chatId, `找不到電話 ${phone} 的客戶資料`);
    return false;
  }

  await sendTelegramMessage(bot, chatId, buildCrmCustomerSummary(summary));
  for (const order of summary.orders) {
    await sendTelegramMessage(bot, chatId, buildCrmOrderCard(order), buildCrmOrderActions(order.id));
  }
  if (summary.orders.length === 0) {
    await sendTelegramMessage(bot, chatId, "此客戶目前沒有訂單紀錄。");
  }
  return true;
}

async function fetchOrderForCrm(orderId, connection = pool, options = {}) {
  const orderStoreId = Number(options.storeId || 0);
  const hasStoreFilter = Number.isSafeInteger(orderStoreId) && orderStoreId > 0;
  const [rows] = await connection.query(
    `
      SELECT
        o.id,
        o.order_no AS orderNo,
        o.customer_id AS customerId,
        o.customer_name AS customerName,
        o.customer_phone AS customerPhone,
        o.order_type AS orderType,
        o.total_amount AS totalAmount,
        o.status,
        o.deposit_amount AS depositAmount,
        o.unpaid_balance AS unpaidBalance,
        o.final_payment_status AS finalPaymentStatus,
        o.source,
        c.line_user_id AS lineUserId
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
        ${hasStoreFilter ? "AND o.store_id = ?" : ""}
      LIMIT 1
      ${options.forUpdate ? "FOR UPDATE" : ""}
    `,
    hasStoreFilter ? [orderId, orderStoreId] : [orderId]
  );
  return rows[0] || null;
}

async function appendPaymentEvent(connection, order, amount, paymentKind, note, telegramUser, staffId, unpaidBalanceAfter) {
  await connection.query(
    `
      INSERT INTO order_payment_events (
        order_id, customer_id, payment_kind, amount, unpaid_balance_after, note, source, created_by_staff_id, created_by_label, meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, 'TELEGRAM_CRM', ?, ?, ?)
    `,
    [
      order.id,
      order.customerId,
      paymentKind,
      amount,
      unpaidBalanceAfter,
      note || null,
      staffId,
      buildTelegramActorLabel(telegramUser),
      JSON.stringify({ telegramUser })
    ]
  );
}

async function applyTelegramCrmPayment(orderId, paymentKind, amount, telegramUser) {
  return withTransaction(async (connection) => {
    const staff = await resolveTelegramStaffUserId(connection, telegramUser);
    const staffStoreId = staff.storeId;
    if (!staffStoreId) {
      throw new Error("無法判斷員工店別，無法操作 CRM 付款");
    }

    const order = await fetchOrderForCrm(orderId, connection, { forUpdate: true, storeId: staffStoreId });
    if (!order) {
      throw new Error("找不到訂單");
    }

    const staffId = staff.id;
    const totalAmount = Number(order.totalAmount || 0);
    const currentUnpaid = Number(order.unpaidBalance || 0);
    const currentDeposit = Number(order.depositAmount || 0);
    const normalizedAmount = Math.min(Math.max(Number(amount || 0), 0), currentUnpaid);
    const nextUnpaidBalance = Math.max(currentUnpaid - normalizedAmount, 0);
    const nextDepositAmount = paymentKind === "DEPOSIT" ? currentDeposit + normalizedAmount : currentDeposit;
    const nextFinalPaymentStatus = nextUnpaidBalance <= 0 ? "PAID" : totalAmount === nextUnpaidBalance ? "UNPAID" : "PARTIAL";
    const nextStatus =
      order.orderType === "REPAIR"
        ? nextUnpaidBalance <= 0
          ? "REPAIRING"
          : "PENDING_PAYMENT"
        : nextUnpaidBalance <= 0 && order.status === "PENDING_PAYMENT"
          ? "PENDING"
          : order.status;

    await connection.query(
      `
        UPDATE orders
        SET
          deposit_amount = ?,
          unpaid_balance = ?,
          final_payment_status = ?,
          final_paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(final_paid_at, NOW()) ELSE NULL END,
          status = ?
        WHERE id = ?
      `,
      [nextDepositAmount, nextUnpaidBalance, nextFinalPaymentStatus, nextFinalPaymentStatus, nextStatus, order.id]
    );

    await appendPaymentEvent(connection, order, normalizedAmount, paymentKind, null, telegramUser, staffId, nextUnpaidBalance);
    await logWorkflowEvent("telegram_crm_payment_updated", "ORDER", order.id, {
      paymentKind,
      amount: normalizedAmount,
      nextUnpaidBalance,
      nextFinalPaymentStatus,
      telegramUser
    }, staffId, connection);

    if (order.customerId) {
      await connection.query(
        `
          INSERT INTO customer_crm_events (customer_id, event_type, stage, note, created_by_staff_id)
          VALUES (?, 'telegram_payment_update', NULL, ?, ?)
        `,
        [order.customerId, `${order.orderNo} ${mapPaymentKindLabel(paymentKind)} ${formatCurrency(normalizedAmount)}`, staffId]
      );
    }

    return {
      ...order,
      depositAmount: nextDepositAmount,
      unpaidBalance: nextUnpaidBalance,
      finalPaymentStatus: nextFinalPaymentStatus,
      status: nextStatus,
      amount: normalizedAmount
    };
  });
}

async function sendLineOrderStatusUpdate(order, message) {
  if (!order?.lineUserId || !config.line.channelAccessToken) {
    return false;
  }
  await sendLineMessage(config, order.lineUserId, [{ type: "text", text: message }]);
  return true;
}

async function updateTelegramCrmOrderStatus(orderId, status, telegramUser, options = {}) {
  return withTransaction(async (connection) => {
    const staff = await resolveTelegramStaffUserId(connection, telegramUser);
    const staffStoreId = staff.storeId;
    if (!staffStoreId) {
      throw new Error("無法判斷員工店別，無法更新 CRM 狀態");
    }

    const order = await fetchOrderForCrm(orderId, connection, { forUpdate: true, storeId: staffStoreId });
    if (!order) {
      throw new Error("找不到訂單");
    }
    const staffId = staff.id;
    await connection.query(
      `
        UPDATE orders
        SET
          status = ?,
          handover_confirmed_at = CASE WHEN ? THEN NOW() ELSE handover_confirmed_at END,
          handover_confirmed_by_staff_id = CASE WHEN ? THEN ? ELSE handover_confirmed_by_staff_id END
        WHERE id = ?
      `,
      [status, options.handover === true ? 1 : 0, options.handover === true ? 1 : 0, staffId, order.id]
    );
    await logWorkflowEvent("telegram_crm_status_updated", "ORDER", order.id, {
      status,
      handover: options.handover === true,
      telegramUser
    }, staffId, connection);
    if (order.customerId) {
      await connection.query(
        `
          INSERT INTO customer_crm_events (customer_id, event_type, stage, note, created_by_staff_id)
          VALUES (?, 'telegram_status_update', NULL, ?, ?)
        `,
        [order.customerId, `${order.orderNo} 狀態更新為 ${mapOrderStatusLabel(status)}`, staffId]
      );
    }
    return { ...order, status };
  });
}

async function sendOrderDetail(bot, chatId, orderId, connection = pool, storeId = null) {
  const order = await fetchOrderForCrm(orderId, connection, { storeId });
  if (!order) {
    await sendTelegramMessage(bot, chatId, "找不到訂單");
    return false;
  }
  const [items] = await connection.query(
    `
      SELECT sku_snapshot AS sku, product_name_snapshot AS productName, quantity, unit_price AS unitPrice, line_total AS lineTotal
      FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `,
    [orderId]
  );
  const itemLines = items.map((item) => `${item.sku} / ${item.productName} x${item.quantity} / ${formatCurrency(item.lineTotal)}`);
  await sendTelegramMessage(
    bot,
    chatId,
    [
      `訂單：${order.orderNo}`,
      `客戶：${order.customerName || "未提供"} / ${order.customerPhone || "未提供"}`,
      `狀態：${mapOrderStatusLabel(order.status)}`,
      `付款：${mapFinalPaymentStatusLabel(order.finalPaymentStatus)}`,
      `總額：${formatCurrency(order.totalAmount)}`,
      `未收：${formatCurrency(order.unpaidBalance)}`,
      "品項：",
      ...(itemLines.length ? itemLines : ["無"])
    ].join("\n")
  );
  return true;
}

async function promptForPaymentAmount(bot, callbackQuery, orderId, paymentKind) {
  const chatId = callbackQuery.message?.chat?.id;
  const telegramUser = getTelegramUser(callbackQuery);
  await saveTelegramSession(
    bot,
    chatId,
    telegramUser.id,
    "telegram_crm",
    "awaiting_payment_amount",
    { orderId: Number(orderId), paymentKind }
  );
  await sendTelegramMessage(
    bot,
    chatId,
    `請輸入 ${mapPaymentKindLabel(paymentKind)} 金額（訂單 #${orderId}）。\n輸入 /cancel 可取消。`,
    [],
    { replyToMessageId: callbackQuery.message?.message_id }
  );
}

async function handleTelegramUpFlowText(bot, message, session) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  const telegramUser = buildTelegramUserFromMessage(message);
  const payload = session?.payload || {};

  if (session?.expired) {
    await sendTelegramMessage(bot, chatId, "上一個 /up 流程已逾時，請重新輸入 /up。");
    return true;
  }

  if (!session || session.flowType !== "telegram_up") {
    return false;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.inputterName) {
    if (!text) {
      await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.productName, {
      ...payload,
      inputterName: text
    });
    await sendTelegramMessage(bot, chatId, "請輸入商品名稱。");
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.productName) {
    if (!text) {
      await sendTelegramMessage(bot, chatId, "請輸入商品名稱。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.category, {
      ...payload,
      productName: text
    });
    await sendTelegramMessage(
      bot,
      chatId,
      [
        "請輸入分類代碼或分類名稱。",
        ...TELEGRAM_UP_CATEGORIES.map((item) => `${item.code} = ${item.label}`)
      ].join("\n")
    );
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.category) {
    const matches = getTelegramUpCategoryMatches(text);
    if (!matches.length) {
      await sendTelegramMessage(bot, chatId, "找不到相符分類，請重新輸入分類代碼或分類名稱。");
      return true;
    }
    if (matches.length > 1) {
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.categorySelection, {
        ...payload,
        categoryOptions: matches.map((item) => ({
          code: item.code,
          label: item.label
        }))
      });
      await sendTelegramMessage(bot, chatId, getTelegramUpCategoryOptionsText(matches));
      return true;
    }
    const category = matches[0];
    const areaCode = getTelegramUpAreaCode(category.code);
    const sku = await generateTelegramUpSku(pool, areaCode, category.code);
    const nextPayload = {
      ...payload,
      categoryCode: category.code,
      categoryLabel: category.label,
      areaCode,
      areaLabel: getTelegramUpAreaLabel(areaCode),
      sku
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.quantity, nextPayload);
    await sendTelegramMessage(bot, chatId, `已自動判定區域：${areaCode} / ${getTelegramUpAreaLabel(areaCode)}\n請輸入數量。`);
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.categorySelection) {
    const options = Array.isArray(payload.categoryOptions) ? payload.categoryOptions : [];
    const selectedIndex = parsePositiveInteger(text);
    if (!selectedIndex || selectedIndex > options.length) {
      await sendTelegramMessage(bot, chatId, "請輸入正確的分類編號。");
      return true;
    }
    const category = options[selectedIndex - 1];
    const areaCode = getTelegramUpAreaCode(category.code);
    const sku = await generateTelegramUpSku(pool, areaCode, category.code);
    const nextPayload = {
      ...payload,
      categoryCode: category.code,
      categoryLabel: category.label,
      areaCode,
      areaLabel: getTelegramUpAreaLabel(areaCode),
      sku
    };
    delete nextPayload.categoryOptions;
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.quantity, nextPayload);
    await sendTelegramMessage(bot, chatId, `已自動判定區域：${areaCode} / ${getTelegramUpAreaLabel(areaCode)}\n請輸入數量。`);
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.quantity) {
    const quantity = parsePositiveInteger(text);
    if (!quantity) {
      await sendTelegramMessage(bot, chatId, "數量必須是正整數。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.price, {
      ...payload,
      quantity
    });
    await sendTelegramMessage(bot, chatId, "請輸入價格。");
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.price) {
    const price = parseNonNegativeAmount(text);
    if (price === null) {
      await sendTelegramMessage(bot, chatId, "請輸入有效金額。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.description, {
      ...payload,
      price
    });
    await sendTelegramMessage(bot, chatId, "請輸入商品說明，若無請輸入 略過。");
    return true;
  }

  if (session.stepKey === TELEGRAM_UP_STEPS.description) {
    const nextPayload = {
      ...payload,
      description: isSkipText(text) ? "" : text
    };
    const previewed = {
      ...nextPayload,
      sku: await generateTelegramUpSku(pool, nextPayload.areaCode, nextPayload.categoryCode)
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.confirm, previewed);
    await sendTelegramMessage(bot, chatId, getTelegramUpPreview(previewed), [
      { type: "postback", label: "確認新增", data: "action=tg_up_confirm" },
      { type: "postback", label: "取消", data: "action=tg_up_cancel" }
    ]);
    return true;
  }

  return false;
}

async function handleTelegramBaojiaFlowText(bot, message, session) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  const telegramUser = buildTelegramUserFromMessage(message);
  const payload = session?.payload || {};

  if (session?.expired) {
    await sendTelegramMessage(bot, chatId, "上一個 /baojia 流程已逾時，請重新輸入 /baojia。");
    return true;
  }

  if (!session || session.flowType !== "telegram_baojia") {
    return false;
  }

  if (session.stepKey === "awaiting_inputter_name") {
    if (!text) {
      await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_phone", {
      ...payload,
      inputterName: text
    });
    await sendTelegramMessage(bot, chatId, "請輸入客戶手機號碼。");
    return true;
  }

  if (session.stepKey === "awaiting_phone") {
    const phone = normalizePhone(text);
    if (!/^0\d{8,10}$/.test(phone)) {
      await sendTelegramMessage(bot, chatId, "請輸入正確手機號碼，例如 09xxxxxxxx。");
      return true;
    }
    const customer = await findCustomerByPhone(phone);
    const nextPayload = {
      ...payload,
      customer: customer || { phone, name: `Telegram客戶-${phone}`, customerType: "OFFLINE_WITH_PHONE" },
      items: []
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_query", nextPayload);
    if (customer?.lineUserId) {
      await sendTelegramMessage(bot, chatId, `已找到 LINE 綁定客戶：${customer.name || "未提供"} / ${customer.phone}\n請輸入維修項目 SKU 或商品名稱關鍵字。`);
    } else if (customer) {
      await sendTelegramMessage(bot, chatId, `已找到客戶：${customer.name || "未提供"} / ${customer.phone}\n此客戶尚未綁定 LINE，報價通知可能無法送出。\n請輸入維修項目 SKU 或商品名稱關鍵字。`);
    } else {
      await sendTelegramMessage(bot, chatId, `查無既有客戶，送出時會先建立客戶：${phone}\n請輸入維修項目 SKU 或商品名稱關鍵字。`);
    }
    return true;
  }

  if (session.stepKey === "awaiting_item_query") {
    const search = await findProductExactOrSimilar(text);
    if (search.exact) {
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_quantity", {
        ...payload,
        pendingProduct: search.exact
      });
      await sendTelegramMessage(bot, chatId, `${search.exact.sku} / ${search.exact.name} / ${formatCurrency(search.exact.price)}\n請輸入數量。`);
      return true;
    }
    if (!search.matches.length) {
      await sendTelegramMessage(bot, chatId, "找不到維修項目，請重新輸入 SKU 或商品名稱關鍵字。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_selection", {
      ...payload,
      productOptions: search.matches.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: Number(item.price || 0),
        stock: Number(item.stock || 0)
      }))
    });
    await sendTelegramMessage(
      bot,
      chatId,
      [
        "請回覆要選的維修項目編號：",
        ...search.matches.map((item, index) => `${index + 1}. ${item.sku} / ${item.name} / ${formatCurrency(item.price)}`)
      ].join("\n")
    );
    return true;
  }

  if (session.stepKey === "awaiting_item_selection") {
    const selectedIndex = parsePositiveInteger(text);
    const options = Array.isArray(payload.productOptions) ? payload.productOptions : [];
    if (!selectedIndex || selectedIndex > options.length) {
      await sendTelegramMessage(bot, chatId, "請輸入正確的維修項目編號。");
      return true;
    }
    const pendingProduct = options[selectedIndex - 1];
    const nextPayload = { ...payload, pendingProduct };
    delete nextPayload.productOptions;
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_quantity", nextPayload);
    await sendTelegramMessage(bot, chatId, `${pendingProduct.sku} / ${pendingProduct.name} / ${formatCurrency(pendingProduct.price)}\n請輸入數量。`);
    return true;
  }

  if (session.stepKey === "awaiting_item_quantity") {
    const quantity = parsePositiveInteger(text);
    const pendingProduct = payload.pendingProduct;
    if (!quantity || !pendingProduct) {
      await sendTelegramMessage(bot, chatId, "請輸入正確數量。");
      return true;
    }
    const nextItems = (Array.isArray(payload.items) ? payload.items : []).concat([
      {
        productId: pendingProduct.id,
        sku: pendingProduct.sku,
        name: pendingProduct.name,
        quantity,
        unitPrice: Number(pendingProduct.price || 0),
        subtotal: Number(pendingProduct.price || 0) * quantity
      }
    ]);
    const nextPayload = { ...payload, items: nextItems };
    delete nextPayload.pendingProduct;
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_add_more", nextPayload);
    await sendTelegramMessage(
      bot,
      chatId,
      ["目前維修項目：", ...summarizeBaojiaItems(nextItems), "新增其他維修項目？"].join("\n"),
      buildBaojiaAddMoreActions()
    );
    return true;
  }

  if (session.stepKey === "awaiting_add_more") {
    if (isYesText(text)) {
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_query", payload);
      await sendTelegramMessage(bot, chatId, "請輸入下一個維修項目 SKU 或商品名稱關鍵字。");
      return true;
    }
    if (isNoText(text)) {
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_note", payload);
      await sendTelegramMessage(bot, chatId, "請輸入維修說明 / 客戶狀況 / 備註，若無請輸入 略過。");
      return true;
    }
    await sendTelegramMessage(bot, chatId, "請回覆 yes / no，或直接使用按鈕。", buildBaojiaAddMoreActions());
    return true;
  }

  if (session.stepKey === "awaiting_note") {
    const nextPayload = { ...payload, note: isSkipText(text) ? "" : text };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_confirm", nextPayload);
    await sendTelegramMessage(bot, chatId, buildBaojiaPreview(nextPayload), buildBaojiaConfirmActions());
    return true;
  }

  return false;
}

async function handleTelegramOrderFlowText(bot, message, session) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  const telegramUser = buildTelegramUserFromMessage(message);
  const payload = session?.payload || {};

  if (session?.expired) {
    await sendTelegramMessage(bot, chatId, "上一個流程已逾時，請重新輸入 /order。");
    return true;
  }

  if (!session || session.flowType !== "telegram_order") {
    return false;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.inputterName) {
    if (!text) {
      await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.phone, {
      ...payload,
      inputterName: text
    });
    await sendTelegramMessage(bot, chatId, "請輸入客戶手機號碼。");
    return true;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.phone) {
    const phone = normalizePhone(text);
    if (!/^0\d{8,10}$/.test(phone)) {
      await sendTelegramMessage(bot, chatId, "請輸入正確手機號碼，例如 09xxxxxxxx。");
      return true;
    }
    const customer = await findCustomerByPhone(phone);
    const nextPayload = {
      ...payload,
      customer: customer || { phone, name: `Telegram客戶-${phone}`, customerType: "OFFLINE_WITH_PHONE" }
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.product, nextPayload);
    await sendTelegramMessage(
      bot,
      chatId,
      customer
        ? `已帶入客戶：${customer.name || "未提供"} / ${customer.phone}\n請輸入商品 SKU 或名稱關鍵字。`
        : `查無既有客戶，會先建立新客戶：${phone}\n請輸入商品 SKU 或名稱關鍵字。`
    );
    return true;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.product) {
    const search = await findTelegramOrderProducts(text);
    if (search.exact) {
      const nextPayload = { ...payload, product: search.exact };
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.quantity, nextPayload);
      await sendTelegramMessage(bot, chatId, `${summarizeProductChoice(search.exact)}\n請輸入數量。`);
      return true;
    }
    if (Array.isArray(search.exactMatches) && search.exactMatches.length > 1) {
      const nextPayload = {
        ...payload,
        matchedProducts: search.exactMatches
      };
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.productSelect, nextPayload);
      await sendTelegramMessage(
        bot,
        chatId,
        [
          "找到多筆符合的商品，請回覆編號：",
          ...search.exactMatches.map(
            (item, index) => `${index + 1}. ${item.sku} / ${item.name} / ${formatCurrency(item.price)} / 庫存 ${item.stock}`
          )
        ].join("\n")
      );
      return true;
    }
    if (!search.matches.length) {
      await sendTelegramMessage(bot, chatId, "找不到商品，請重新輸入 SKU 或名稱關鍵字。");
      return true;
    }
    const nextPayload = {
      ...payload,
      matchedProducts: search.matches
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.productSelect, nextPayload);
    await sendTelegramMessage(
      bot,
      chatId,
      [
        "請回覆商品編號：",
        ...search.matches.map(
          (item, index) => `${index + 1}. ${item.sku} / ${item.name} / ${formatCurrency(item.price)} / 庫存 ${item.stock}`
        )
      ].join("\n")
    );
    return true;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.productSelect) {
    const selectedIndex = parsePositiveInteger(text);
    const options = Array.isArray(payload.matchedProducts) ? payload.matchedProducts : [];
    if (!selectedIndex || selectedIndex > options.length) {
      await sendTelegramMessage(bot, chatId, "請輸入正確的商品編號。");
      return true;
    }
    const product = options[selectedIndex - 1];
    const nextPayload = { ...payload, product };
    delete nextPayload.matchedProducts;
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.quantity, nextPayload);
    await sendTelegramMessage(bot, chatId, `${summarizeProductChoice(product)}\n請輸入數量。`);
    return true;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.quantity) {
    const quantity = parsePositiveInteger(text);
    if (!quantity) {
      await sendTelegramMessage(bot, chatId, "數量必須是正整數。");
      return true;
    }
    const currentStock = Number(payload.product?.stock || 0);
    if (currentStock < quantity) {
      await sendTelegramMessage(bot, chatId, `庫存不足，目前庫存 ${currentStock}，請重新輸入數量。`);
      return true;
    }
    const unitPrice = Number(payload.product?.price || 0);
    const totalAmount = unitPrice * quantity;
    const nextPayload = {
      ...payload,
      quantity,
      unitPrice,
      totalAmount,
      paymentKind: payload.paymentKind || "FULL"
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.paidAmount, nextPayload);
    await sendTelegramMessage(
      bot,
      chatId,
      `${buildTelegramOrderPreview(nextPayload)}\n請輸入已收金額，未付款請輸入 0`
    );
    return true;
  }

  if (session.stepKey === TELEGRAM_ORDER_STEPS.paidAmount) {
    const paidAmount = parseNonNegativeAmount(text);
    if (paidAmount === null) {
      await sendTelegramMessage(bot, chatId, "請輸入有效金額。");
      return true;
    }
    const paymentKind = payload.paymentKind || "FULL";
    const orderType = ["REPAIR", "RP"].includes(payload.product?.category) || paymentKind === "REPAIR" ? "REPAIR" : "GENERAL";
    const paymentState = deriveOrderPaymentState(payload.totalAmount, paidAmount, paymentKind, orderType === "REPAIR");
    const nextPayload = {
      ...payload,
      paymentKind,
      paidAmount,
      orderType,
      unpaidBalance: paymentState.unpaidBalance
    };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.confirm, nextPayload);
    await sendTelegramMessage(bot, chatId, buildOrderSummary(nextPayload), buildOrderConfirmActions());
    return true;
  }

  return false;
}

async function handleTelegramCrmFlowText(bot, message, session) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  const telegramUser = buildTelegramUserFromMessage(message);

  if (session?.expired) {
    await sendTelegramMessage(bot, chatId, "上一個 CRM 流程已逾時，請重新輸入 /crm 手機號碼。");
    return true;
  }

  if (!session || session.flowType !== "telegram_crm") {
    return false;
  }

  if (session.stepKey === "awaiting_payment_amount") {
    const amount = parseNonNegativeAmount(text);
    if (amount === null) {
      await sendTelegramMessage(bot, chatId, "請輸入有效金額。");
      return true;
    }
    const result = await applyTelegramCrmPayment(session.payload.orderId, session.payload.paymentKind, amount, telegramUser);
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await sendTelegramMessage(
      bot,
      chatId,
      [
        `付款已更新：${result.orderNo}`,
        `收款類型：${mapPaymentKindLabel(session.payload.paymentKind)}`,
        `本次收款：${formatCurrency(result.amount)}`,
        `未收餘額：${formatCurrency(result.unpaidBalance)}`,
        `付款狀態：${mapFinalPaymentStatusLabel(result.finalPaymentStatus)}`
      ].join("\n")
    );
    return true;
  }

  return false;
}

async function handleTelegramNotifyCommand(bot, message) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  const telegramUser = buildTelegramUserFromMessage(message);
  if (!text) {
    return false;
  }
  if (!isTelegramChatAllowed(message)) {
    if (String(chatId || "").trim()) {
      await rejectTelegramUnauthorized(bot, chatId);
      return true;
    }
    return false;
  }

  const session = await getTelegramSession(bot, chatId, telegramUser.id);
  if (/^\/cancel(?:@\w+)?$/i.test(text)) {
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await sendTelegramMessage(bot, chatId, "已取消目前流程。");
    return true;
  }

  if (await handleTelegramOrderFlowText(bot, message, session)) {
    return true;
  }
  if (await handleTelegramBaojiaFlowText(bot, message, session)) {
    return true;
  }
  if (await handleTelegramUpFlowText(bot, message, session)) {
    return true;
  }
  if (await handleTelegramCrmFlowText(bot, message, session)) {
    return true;
  }

  if (/^\/order(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", "awaiting_inputter_name", {});
    await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
    return true;
  }

  if (/^\/baojia(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_inputter_name", {});
    await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
    return true;
  }

  if (/^\/up(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", "awaiting_inputter_name", {});
    await sendTelegramMessage(bot, chatId, "請輸入處理人員姓名。");
    return true;
  }

  const crmMatch = text.match(/^\/crm(?:@\w+)?\s+(.+)$/i);
  if (crmMatch) {
    const phone = normalizePhone(crmMatch[1]);
    if (!/^0\d{8,10}$/.test(phone)) {
      await sendTelegramMessage(bot, chatId, "請輸入正確手機號碼，例如 /crm 09xxxxxxxx。");
      return true;
    }
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await sendCrmSummary(bot, chatId, phone);
    return true;
  }

  if (/^\/help(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
    await sendTelegramMessage(
      bot,
      chatId,
      [
        "Telegram 指令",
        "/up 新增商品",
        "/order 建立新訂單",
        "/baojia 建立維修報價",
        "/crm 09xxxxxxxx 查客戶與訂單",
        "/cancel 取消目前流程"
      ].join("\n")
    );
    return true;
  }

  return false;
}

function parseCallbackParams(rawData) {
  const params = new URLSearchParams(String(rawData || ""));
  return {
    action: params.get("action"),
    id: params.get("id"),
    kind: params.get("kind"),
    status: params.get("status"),
    value: params.get("value")
  };
}

async function handleTelegramConversationCallback(bot, callbackQuery) {
  if (callbackQuery?.data) {
    const lineOrderMatch = String(callbackQuery.data).match(/^line_order:(confirm|reject):(\\d+)$/);
    if (lineOrderMatch) {
      const approveAction = lineOrderMatch[1] === "confirm" ? "approve_order" : "reject_order";
      return await handleOrderApprovalCallback(bot, callbackQuery, approveAction, lineOrderMatch[2]);
    }
  }

  const rawCallbackData = String(callbackQuery?.data || "");
  const lineOrderMatch = rawCallbackData.match(/^line_order:(confirm|reject):(\d+)$/);
  if (lineOrderMatch) {
    const approveAction = lineOrderMatch[1] === "confirm" ? "approve_order" : "reject_order";
    console.log("[LINE_ORDER_CALLBACK_MATCH]", { rawCallbackData, approveAction, orderId: lineOrderMatch[2] });
    return await handleOrderApprovalCallback(bot, callbackQuery, approveAction, lineOrderMatch[2]);
  }

  const { action, id, kind, status, value } = parseCallbackParams(callbackQuery.data);
  const chatId = callbackQuery.message?.chat?.id;
  const telegramUser = getTelegramUser(callbackQuery);
  const pseudoMessage = {
    chat: callbackQuery.message?.chat,
    from: callbackQuery.from
  };

  if (!chatId || !telegramUser.id || !isTelegramChatAllowed(pseudoMessage)) {
    if (chatId && telegramUser.id) {
      await rejectTelegramUnauthorized(bot, chatId);
      return true;
    }
    return false;
  }

  if (action === "support_contacted" || action === "support_done") {
    const actor = buildTelegramActorLabel(telegramUser);
    const customerId = Number(id || 0);
    const eventType = action === "support_contacted" ? "customer_support_contacted" : "customer_support_done";
    const label = action === "support_contacted" ? "已聯絡客戶" : "處理完成";

    try {
      await pool.query(
        `
          INSERT INTO v2_workflow_events (event_type, ref_type, ref_id, payload, created_by_staff_id)
          VALUES (?, 'CUSTOMER', ?, ?, NULL)
        `,
        [
          eventType,
          customerId || null,
          JSON.stringify({
            source: "telegram",
            actor,
            telegramUserId: telegramUser.id,
            username: telegramUser.username || null
          })
        ]
      );
    } catch (error) {
      console.warn("[support] workflow log failed", error.message);
    }

    try {
      const [[staff]] = await pool.query(
        `
          SELECT id
          FROM staff_users
          WHERE telegram_user_id = ?
             OR telegram_username = ?
             OR username = ?
          LIMIT 1
        `,
        [
          telegramUser.id || null,
          telegramUser.username || null,
          telegramUser.username || null
        ]
      );

      if (staff?.id) {
        const actionType = action === "support_contacted" ? "CUSTOMER_SUPPORT_CONTACTED" : "CUSTOMER_SUPPORT_DONE";
        const [[existingKpi]] = await pool.query(
          `
            SELECT id
            FROM staff_kpi_logs
            WHERE staff_user_id = ?
              AND action_type = ?
              AND ref_type = 'CUSTOMER'
              AND ref_id = ?
            LIMIT 1
          `,
          [staff.id, actionType, customerId || null]
        );

        if (!existingKpi) {
          await logKpi(
            staff.id,
            actionType,
            "CUSTOMER",
            customerId || null,
            action === "support_contacted" ? 1 : 2
          );
        }
      }
    } catch (error) {
      console.warn("[support] KPI log failed", error.message);
    }

    await answerCallbackQuery(bot, callbackQuery.id, label);

    await sendTelegramMessage(
      bot,
      chatId,
      `${label}：${actor}\n客戶 ID：${customerId || "-"}`,
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );

    if (action === "support_done" && customerId) {
      try {
        const [[customer]] = await pool.query(
          `SELECT id, name, phone, line_user_id AS lineUserId FROM customers WHERE id = ? LIMIT 1`,
          [customerId]
        );

        if (customer?.lineUserId) {
          await sendLineOrderStatusUpdate(
            { lineUserId: customer.lineUserId, orderNo: "客服協助" },
            "您好，門市已收到並處理您的需求。\n若還有其他問題，歡迎直接回覆 LINE。"
          );
        }
      } catch (error) {
        console.warn("[support] line reply failed", error.message);
      }
    }

    return true;
  }

  if (action === "tg_order_cancel") {
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await answerCallbackQuery(bot, callbackQuery.id, "已取消");
    await sendTelegramMessage(bot, chatId, "已取消建立訂單流程。", [], {
      replyToMessageId: callbackQuery.message?.message_id
    });
    return true;
  }

  if (action === "tg_baojia_cancel") {
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await answerCallbackQuery(bot, callbackQuery.id, "已取消");
    await sendTelegramMessage(bot, chatId, "已取消維修報價流程。", [], {
      replyToMessageId: callbackQuery.message?.message_id
    });
    return true;
  }

  const session = await getTelegramSession(bot, chatId, telegramUser.id);

  if (action === "tg_order_payment_kind") {
    if (!session || session.flowType !== "telegram_order") {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    const nextPayload = { ...session.payload, paymentKind: kind || "FULL" };
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.paidAmount, nextPayload);
    await answerCallbackQuery(bot, callbackQuery.id, "已選擇付款類型");
    await sendTelegramMessage(
      bot,
      chatId,
      `已選擇：${mapPaymentKindLabel(nextPayload.paymentKind)}\n請輸入已收金額。`,
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    return true;
  }

  if (action === "tg_order_confirm") {
    if (!session || session.flowType !== "telegram_order") {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    if (session.stepKey !== TELEGRAM_ORDER_STEPS.confirm && !(session.stepKey === TELEGRAM_ORDER_STEPS.completed && session.payload?.createdOrderId)) {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    const result = await createTelegramOrderFromPayload(session.payload, telegramUser);
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_order", TELEGRAM_ORDER_STEPS.completed, {
      ...session.payload,
      createdOrderId: result.id
    });
    await answerCallbackQuery(bot, callbackQuery.id, result.existing ? "已返回既有訂單" : "訂單已建立");
    await sendTelegramMessage(
      bot,
      chatId,
      [
        result.existing ? "此流程已建立過訂單，已回傳既有訂單。" : "Telegram 訂單建立完成。",
        `訂單：${result.orderNo}`,
        `客戶：${result.customer?.name || session.payload.customer?.name || "未提供"}`,
        `總額：${formatCurrency(result.totalAmount || session.payload.totalAmount)}`,
        `未收餘額：${formatCurrency(result.unpaidBalance || session.payload.unpaidBalance)}`,
        `處理人員：${result.inputterName || session.payload.inputterName || buildTelegramActorLabel(telegramUser)}`
      ].join("\n"),
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    return true;
  }

  if (action === "tg_baojia_add_more") {
    if (!session || session.flowType !== "telegram_baojia" || session.stepKey !== "awaiting_add_more") {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    if (String(value || "").toLowerCase() === "yes") {
      await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_item_query", session.payload);
      await answerCallbackQuery(bot, callbackQuery.id, "請輸入下一個維修項目");
      await sendTelegramMessage(bot, chatId, "請輸入下一個維修項目 SKU 或商品名稱關鍵字。", [], {
        replyToMessageId: callbackQuery.message?.message_id
      });
      return true;
    }
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "awaiting_note", session.payload);
    await answerCallbackQuery(bot, callbackQuery.id, "請輸入備註");
    await sendTelegramMessage(bot, chatId, "請輸入維修說明 / 客戶狀況 / 備註，若無請輸入 略過。", [], {
      replyToMessageId: callbackQuery.message?.message_id
    });
    return true;
  }

  if (action === "tg_baojia_confirm_send") {
    if (!session || session.flowType !== "telegram_baojia") {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    if (session.stepKey !== "awaiting_confirm" && !(session.stepKey === "completed" && session.payload?.createdRepairId)) {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    const result = await createRepairQuoteDraftFromTelegram(session.payload, telegramUser);
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_baojia", "completed", {
      ...session.payload,
      createdRepairId: result.repairId
    });
    await answerCallbackQuery(bot, callbackQuery.id, result.existing ? "已返回既有報價" : "報價已送出");
    await sendTelegramMessage(
      bot,
      chatId,
      [
        result.existing ? "此流程已送出過報價，已回傳既有維修單。" : "報價已送出。",
        `維修單：#${result.repairId}`,
        `客戶：${result.customer?.name || session.payload.customer?.name || "未提供"} / ${result.customer?.phone || session.payload.customer?.phone || "未提供"}`,
        `總額：${formatCurrency(result.totalAmount)}`,
        `處理人員：${session.payload.inputterName || buildTelegramActorLabel(telegramUser)}`,
        result.lineBound ? "LINE 報價通知：已嘗試送出" : "LINE 報價通知：客戶未綁定 LINE，可能無法送出"
      ].join("\n"),
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    return true;
  }

  if (action === "tg_up_cancel") {
    await clearTelegramSession(bot, chatId, telegramUser.id);
    await answerCallbackQuery(bot, callbackQuery.id, "已取消");
    await sendTelegramMessage(bot, chatId, "已取消新增商品流程。", [], {
      replyToMessageId: callbackQuery.message?.message_id
    });
    return true;
  }

  if (action === "tg_up_confirm") {
    if (!session || session.flowType !== "telegram_up") {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    if (session.stepKey !== TELEGRAM_UP_STEPS.confirm && !(session.stepKey === TELEGRAM_UP_STEPS.completed && session.payload?.createdProductId)) {
      await answerCallbackQuery(bot, callbackQuery.id, "流程已失效");
      return true;
    }
    const result = await createTelegramProductFromPayload(session.payload, telegramUser);
    await saveTelegramSession(bot, chatId, telegramUser.id, "telegram_up", TELEGRAM_UP_STEPS.completed, {
      ...session.payload,
      createdProductId: result.id,
      sku: result.sku
    });
    await answerCallbackQuery(bot, callbackQuery.id, "商品已新增");
    await sendTelegramMessage(
      bot,
      chatId,
      [
        "商品已新增",
        `SKU：${result.sku}`,
        `商品名：${result.productName}`,
        `庫存：${result.quantity}`,
        `價格：${formatCurrency(result.price)}`,
        `處理人員：${result.inputterName}`
      ].join("\n"),
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    return true;
  }

  if (action === "tg_crm_pay") {
    await promptForPaymentAmount(bot, callbackQuery, id, kind || "PARTIAL");
    await answerCallbackQuery(bot, callbackQuery.id, "請輸入金額");
    return true;
  }

  if (action === "tg_crm_status_menu") {
    await answerCallbackQuery(bot, callbackQuery.id, "請選擇狀態");
    await sendTelegramMessage(
      bot,
      chatId,
      `請選擇訂單 #${id} 的新狀態。`,
      buildCrmStatusActions(id),
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    return true;
  }

  if (action === "tg_crm_status") {
    const result = await updateTelegramCrmOrderStatus(Number(id), status, telegramUser);
    await answerCallbackQuery(bot, callbackQuery.id, "狀態已更新");
    await sendTelegramMessage(
      bot,
      chatId,
      `${result.orderNo} 狀態已更新為 ${mapOrderStatusLabel(result.status)}。`,
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    if (result.lineUserId) {
      await sendLineOrderStatusUpdate(result, `您的訂單 ${result.orderNo} 狀態已更新為：${mapOrderStatusLabel(result.status)}`);
    }
    return true;
  }

  if (action === "tg_crm_handover") {
    const result = await updateTelegramCrmOrderStatus(Number(id), "COMPLETED", telegramUser, { handover: true });
    await answerCallbackQuery(bot, callbackQuery.id, "已確認交車");
    await sendTelegramMessage(
      bot,
      chatId,
      `${result.orderNo} 已確認交車。`,
      [],
      { replyToMessageId: callbackQuery.message?.message_id }
    );
    if (result.lineUserId) {
      await sendLineOrderStatusUpdate(result, `您的訂單 ${result.orderNo} 已確認交車，若有問題歡迎直接回覆 LINE。`);
    }
    return true;
  }

  if (action === "tg_crm_detail") {
    await answerCallbackQuery(bot, callbackQuery.id, "已顯示明細");
    await sendOrderDetail(bot, chatId, Number(id));
    return true;
  }

  return false;
}

async function findProductBySku(sku, connection = pool, options = {}) {
  const productColumns = await getTableColumns(connection, "products");
  const normalizedStoreId = hasColumn(productColumns, "store_id")
    ? normalizeStoreId(options?.storeId)
    : null;
  const hasStoreIdFilter = Number.isSafeInteger(normalizedStoreId) && normalizedStoreId > 0;
  const [rows] = await connection.query(
    `
      SELECT id, name, sku, stock, reorder_level AS reorderLevel
      FROM products
      WHERE sku = ?
        ${hasStoreIdFilter ? "AND store_id = ?" : ""}
      LIMIT 1
    `,
    hasStoreIdFilter ? [sku, normalizedStoreId] : [sku]
  );
  return rows[0] || null;
}

async function handleStockCommand(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || "").trim();
  if (!text || String(chatId) !== String(config.telegram.stockGroupId)) {
    return false;
  }

  if (!isTelegramChatAllowed(message)) {
    await rejectTelegramUnauthorized(BOT_STOCK, chatId);
    return true;
  }

  if (/^\/cancel(?:@\w+)?$/i.test(text)) {
    await clearTelegramSession(BOT_STOCK, chatId, message.from?.id || null);
    await sendTelegramMessage(BOT_STOCK, chatId, "已取消目前流程。");
    return true;
  }

  if (/^\/up(?:@\w+)?$/i.test(text)) {
    await saveTelegramSession(BOT_STOCK, chatId, message.from?.id || null, "telegram_up", "awaiting_inputter_name", {});
    await sendTelegramMessage(BOT_STOCK, chatId, "請輸入處理人員姓名。");
    return true;
  }

  const upSession = await getTelegramSession(BOT_STOCK, chatId, message.from?.id || null);
  if (await handleTelegramUpFlowText(BOT_STOCK, message, upSession)) {
    return true;
  }

  const stockMatch = text.match(/^\/stock\s+([^\s]+)$/i);
  const movementMatch = text.match(/^\/(in|out|set)\s+([^\s]+)\s+(\d+)$/i);
  if (!stockMatch && !movementMatch) {
    if (/^\/help/i.test(text)) {
      await sendTelegramMessage(BOT_STOCK, chatId, "庫存指令：\n/up 新增商品\n/stock SKU\n/in SKU 數量\n/out SKU 數量\n/set SKU 數量\n/cancel 取消目前流程");
      return true;
    }
    return false;
  }

  if (stockMatch) {
    const telegramUser = {
      id: message.from?.id || null,
      username: message.from?.username || null
    };
    let staffStoreId = null;
    try {
      const staff = await resolveTelegramStaffUserId(pool, telegramUser);
      staffStoreId = Number(staff?.storeId || 0) || null;
    } catch {
      staffStoreId = null;
    }

    if (!staffStoreId) {
      await sendTelegramMessage(
        BOT_STOCK,
        chatId,
        "找不到可用員工帳號，請先確認 Telegram 帳號已綁定且有對應店鋪。"
      );
      return true;
    }

    const product = await findProductBySku(stockMatch[1], pool, { storeId: staffStoreId });
    await sendTelegramMessage(
      BOT_STOCK,
      chatId,
      product
        ? [`庫存查詢`, `商品：${product.name}`, `SKU：${product.sku}`, `目前庫存：${product.stock}`, `警戒值：${product.reorderLevel}`].join("\n")
        : `找不到 SKU：${stockMatch[1]}`
    );
    return true;
  }

  const movementType = movementMatch[1].toUpperCase();
  const sku = movementMatch[2];
  const qty = Number(movementMatch[3]);
  const telegramUser = {
    id: message.from?.id || null,
    username: message.from?.username || null,
    firstName: message.from?.first_name || null
  };
  let staffStoreId = null;
  try {
    const staff = await resolveTelegramStaffUserId(pool, telegramUser);
    staffStoreId = Number(staff?.storeId || 0) || null;
  } catch {
    staffStoreId = null;
  }

  if (!staffStoreId) {
    await sendTelegramMessage(
      BOT_STOCK,
      chatId,
      "找不到可用員工帳號，請先確認 Telegram 帳號已綁定且有對應店鋪。"
    );
    return true;
  }

  const result = await withTransaction(async (connection) => {
    const product = await findProductBySku(sku, connection, { storeId: staffStoreId });
    if (!product) {
      return { error: `找不到 SKU：${sku}` };
    }
    const currentStock = Number(product.stock || 0);
    const nextStock =
      movementType === "IN"
        ? currentStock + qty
        : movementType === "OUT"
          ? currentStock - qty
          : qty;
    if (nextStock < 0) {
      return { error: "庫存不可小於 0" };
    }
    const movementQty = movementType === "SET" ? nextStock - currentStock : movementType === "OUT" ? -qty : qty;
    await connection.query(
      "UPDATE products SET stock = ? WHERE id = ? AND store_id = ?",
      [nextStock, product.id, staffStoreId]
    );
    await connection.query(
      `
        INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
        VALUES (?, ?, ?, ?, NULL)
      `,
      [product.id, movementType === "SET" ? "ADJUST" : movementType, movementQty, `Telegram 指令 ${text}`]
    );
    await logWorkflowEvent("telegram_inventory_command_executed", "PRODUCT", product.id, {
      sku,
      movementType,
      qty,
      currentStock,
      nextStock,
      telegramUser
    }, null, connection);
    return { product, nextStock };
  });

  await sendTelegramMessage(
    BOT_STOCK,
    chatId,
    result.error || [`庫存異動完成`, `商品：${result.product.name}`, `SKU：${result.product.sku}`, `目前庫存：${result.nextStock}`].join("\n")
  );
  return true;
}

async function sendDocumentToTelegramGroups(registrationTypes, filePath, caption = "") {
  const route = resolveInternalRoute(registrationTypes, []);
  if (!route.chatId) {
    return { ok: false, skipped: true, reason: "missing_chat_id" };
  }

  const fs = require("fs");
  const path = require("path");

  const token = process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
  if (!token) {
    return { ok: false, skipped: true, reason: "missing_token" };
  }

  const form = new FormData();
  form.append("chat_id", String(route.chatId));
  if (caption) form.append("caption", caption);

  const blob = new Blob([fs.readFileSync(filePath)]);
  form.append("document", blob, path.basename(filePath));

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form
  });

  return { ok: res.ok, status: res.status, chatId: route.chatId };
}


module.exports = {
  BOT_NOTIFY,
  BOT_STOCK,
  answerCallbackQuery,
  handleTelegramConversationCallback,
  handleTelegramNotifyCommand,
  handleRepairApprovalCallback,
  sendInternalTelegram,
  sendTelegramMessage,
  sendOrderCreationNotification,
  handleOrderApprovalCallback,
  handleStockCommand,
  validateTelegramConfig
};
