const { pool } = require("../db");
const { createNotification } = require("./staffNotificationService");
const {
  dryRunStaffGroupNotification,
  dryRunSupplierGroupNotification
} = require("./lineGroupNotificationService");

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function maskTargetId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function logWarn(eventName, message, meta = {}) {
  console.warn(`[notification-event] ${eventName} ${message}`, meta);
}

async function safeCreateNotification(eventName, input) {
  try {
    const alreadyExists = await notificationExists(input);
    const notification = await createNotification(input);
    return { notification, created: !alreadyExists };
  } catch (error) {
    logWarn(eventName, "staff_notification_failed", {
      error: error.message,
      type: input.type,
      storeId: input.storeId || null,
      refType: input.refType || null,
      refId: input.refId || null
    });
    return { notification: null, created: false };
  }
}

async function notificationExists(input = {}) {
  const type = String(input.type || "").trim().toUpperCase();
  const refType = input.refType ? String(input.refType).trim().toUpperCase() : null;
  const refId = toPositiveInteger(input.refId);
  const storeId = toPositiveInteger(input.storeId);
  if (!type || !refType || !refId || !storeId) return false;
  const [[row]] = await pool.query(
    `
      SELECT id
      FROM staff_notifications
      WHERE type = ?
        AND ref_type = ?
        AND ref_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [type, refType, refId, storeId]
  );
  return Boolean(row);
}

async function loadStoreName(storeId) {
  const id = toPositiveInteger(storeId);
  if (!id) return "";
  const [[row]] = await pool.query("SELECT name FROM stores WHERE id = ? LIMIT 1", [id]);
  return row?.name || "";
}

async function loadSupplierName(supplierId) {
  const id = toPositiveInteger(supplierId);
  if (!id) return "";
  const [[row]] = await pool.query("SELECT name FROM suppliers WHERE id = ? LIMIT 1", [id]);
  return row?.name || "";
}

async function loadHqNotificationStoreIds(companyId) {
  const id = toPositiveInteger(companyId);
  if (!id) return [];
  const [rows] = await pool.query(
    `
      SELECT store_id AS storeId
      FROM company_stores
      WHERE company_id = ?
        AND status = 'ACTIVE'
        AND relationship_type IN ('HEADQUARTERS', 'WAREHOUSE')
      ORDER BY FIELD(relationship_type, 'HEADQUARTERS', 'WAREHOUSE'), store_id
    `,
    [id]
  );
  return [...new Set(rows.map((row) => toPositiveInteger(row.storeId)).filter(Boolean))];
}

async function dryRunStaffLine(eventName, input = {}) {
  const storeId = toPositiveInteger(input.storeId);
  if (!storeId) return null;
  try {
    const [[setting]] = await pool.query(
      `
        SELECT
          target_id AS targetId,
          notify_order_reservation AS notifyOrderReservation,
          notify_repair_reservation AS notifyRepairReservation,
          notify_purchase_confirmation AS notifyPurchaseConfirmation,
          notify_repair_confirmation AS notifyRepairConfirmation,
          notify_replenishment AS notifyReplenishment,
          notify_transfer AS notifyTransfer,
          notify_inbound AS notifyInbound,
          notify_daily_tasks AS notifyDailyTasks,
          notify_internal_messages AS notifyInternalMessages
        FROM store_notification_settings
        WHERE store_id = ?
          AND channel_type = 'LINE'
          AND purpose = 'STAFF_GROUP'
          AND enabled = 1
        LIMIT 1
      `,
      [storeId]
    );
    if (!setting?.targetId) return null;
    if (!isStaffLineEventEnabled(setting, eventName)) return null;
    const result = await dryRunStaffGroupNotification({
      ...input,
      targetId: setting.targetId,
      storeName: input.storeName || await loadStoreName(storeId)
    });
    console.info("[notification-event] staff_line_dry_run", {
      eventName,
      storeId,
      targetPreview: result.targetPreview || maskTargetId(setting.targetId)
    });
    return result;
  } catch (error) {
    logWarn(eventName, "staff_line_dry_run_failed", { error: error.message, storeId });
    return null;
  }
}

async function dryRunSupplierLine(eventName, input = {}) {
  const storeId = toPositiveInteger(input.storeId);
  const supplierId = toPositiveInteger(input.supplierId);
  if (!storeId || !supplierId) return null;
  try {
    const [[setting]] = await pool.query(
      `
        SELECT
          line_group_id AS lineGroupId,
          notify_purchase_order AS notifyPurchaseOrder,
          notify_return AS notifyReturn,
          notify_settlement AS notifySettlement
        FROM supplier_notification_settings
        WHERE store_id = ?
          AND supplier_id = ?
          AND enabled = 1
        LIMIT 1
      `,
      [storeId, supplierId]
    );
    if (!setting?.lineGroupId) return null;
    if (!isSupplierLineEventEnabled(setting, eventName)) return null;
    const result = await dryRunSupplierGroupNotification({
      ...input,
      lineGroupId: setting.lineGroupId,
      storeName: input.storeName || await loadStoreName(storeId),
      supplierName: input.supplierName || await loadSupplierName(supplierId)
    });
    console.info("[notification-event] supplier_line_dry_run", {
      eventName,
      storeId,
      supplierId,
      targetPreview: result.targetPreview || maskTargetId(setting.lineGroupId)
    });
    return result;
  } catch (error) {
    logWarn(eventName, "supplier_line_dry_run_failed", { error: error.message, storeId, supplierId });
    return null;
  }
}

function isEnabled(value) {
  return Number(value || 0) === 1 || value === true;
}

function isStaffLineEventEnabled(setting, eventName) {
  const flagByEvent = {
    LINE_ORDER_CREATED: "notifyOrderReservation",
    LINE_REPAIR_CREATED: "notifyRepairReservation",
    PURCHASE_CONFIRMATION_SUBMITTED: "notifyPurchaseConfirmation",
    REPAIR_CONFIRMATION_SUBMITTED: "notifyRepairConfirmation",
    STORE_REPLENISHMENT_SUBMITTED: "notifyReplenishment",
    STORE_TRANSFER_SHIPPED: "notifyTransfer",
    STORE_TRANSFER_RECEIVED: "notifyInbound",
    DAILY_TASK_DUE: "notifyDailyTasks",
    DAILY_TASK_OVERDUE: "notifyDailyTasks",
    INTERNAL_MESSAGE_CREATED: "notifyInternalMessages"
  };
  const flag = flagByEvent[eventName];
  return flag ? isEnabled(setting[flag]) : true;
}

function isSupplierLineEventEnabled(setting, eventName) {
  if (eventName === "SUPPLIER_PURCHASE_ORDER_CREATED") return isEnabled(setting.notifyPurchaseOrder);
  if (eventName === "SUPPLIER_RETURN_CREATED" || eventName === "SUPPLIER_RETURN_SHIPPED") return isEnabled(setting.notifyReturn);
  return true;
}

function summarizeItems(items = []) {
  const first = Array.isArray(items) ? items[0] : null;
  return {
    sku: pick(first, "sku", "requestedSku"),
    productName: pick(first, "productName", "requestedProductName", "name"),
    quantity: pick(first, "quantity", "quantityOrdered", "quantityShipped", "quantityRequested")
  };
}

async function notifyLineRepairCreated(repair = {}) {
  const eventName = "LINE_REPAIR_CREATED";
  const storeId = toPositiveInteger(pick(repair, "storeId", "store_id"));
  const repairId = toPositiveInteger(pick(repair, "repairId", "id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(repair.companyId),
    storeId,
    type: eventName,
    title: "新的 LINE 維修預約",
    message: "客戶已送出維修預約，請確認車款、問題描述與到店時間。",
    targetUrl: "/repairs",
    refType: "REPAIR",
    refId: repairId,
    priority: "IMPORTANT"
  });
  if (result.created) await dryRunStaffLine(eventName, {
    storeId,
    eventType: eventName,
    eventLabel: "LINE 維修預約",
    title: "新的 LINE 維修預約",
    message: "客戶已送出維修預約，請至 POS 確認。",
    targetUrl: "/repairs"
  });
  return result.notification;
}

async function notifyRepairQuoteAcceptedWorkOrder(repair = {}) {
  const eventName = "REPAIR_WORK_ORDER_PRINT_REQUIRED";
  const storeId = toPositiveInteger(pick(repair, "storeId", "store_id"));
  const repairId = toPositiveInteger(pick(repair, "repairId", "id"));
  const customerName = pick(repair, "customerName", "customer_name") || "客戶";
  const customerPhone = pick(repair, "customerPhone", "customer_phone") || "";
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(repair.companyId),
    storeId,
    type: eventName,
    title: "客戶已同意維修報價",
    message: `客戶已同意維修報價，請列印維修工作單並交由技師確認。維修單 #${repairId} / ${customerName}${customerPhone ? ` / ${customerPhone}` : ""}`,
    targetUrl: `/repairs/${repairId}/work-order-print`,
    refType: "REPAIR",
    refId: repairId,
    priority: "IMPORTANT"
  });
  if (result.created) await dryRunStaffLine(eventName, {
    storeId,
    eventType: eventName,
    eventLabel: "維修工作單",
    title: "客戶已同意維修報價",
    message: "客戶已同意維修報價，請列印維修工作單。",
    targetUrl: `/repairs/${repairId}/work-order-print`
  });
  return result.notification;
}

async function notifyLineOrderCreated(order = {}) {
  const eventName = "LINE_ORDER_CREATED";
  const storeId = toPositiveInteger(pick(order, "storeId", "store_id"));
  const orderId = toPositiveInteger(pick(order, "orderId", "id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(order.companyId),
    storeId,
    type: eventName,
    title: "新的 LINE 訂單預約",
    message: "客戶已送出訂單預約，請確認車款、庫存與付款方式。",
    targetUrl: "/orders",
    refType: "ORDER",
    refId: orderId,
    priority: "IMPORTANT"
  });
  if (result.created) await dryRunStaffLine(eventName, {
    storeId,
    eventType: eventName,
    eventLabel: "LINE 訂單預約",
    title: "新的 LINE 訂單預約",
    message: "客戶已送出訂單預約，請至 POS 確認。",
    targetUrl: "/orders"
  });
  return result.notification;
}

async function notifyPurchaseConfirmationSubmitted(confirmation = {}) {
  const eventName = "PURCHASE_CONFIRMATION_SUBMITTED";
  const storeId = toPositiveInteger(pick(confirmation, "storeId", "store_id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(confirmation.companyId),
    storeId,
    type: eventName,
    title: "購買確認書已提交",
    message: "客戶已完成購買確認書，請確認訂單與交車資料。",
    targetUrl: "/purchase-confirmations",
    refType: "PURCHASE_CONFIRMATION",
    refId: toPositiveInteger(pick(confirmation, "confirmationId", "id")),
    priority: "NORMAL"
  });
  return result.notification;
}

async function notifyRepairConfirmationSubmitted(confirmation = {}) {
  const eventName = "REPAIR_CONFIRMATION_SUBMITTED";
  const storeId = toPositiveInteger(pick(confirmation, "storeId", "store_id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(confirmation.companyId),
    storeId,
    type: eventName,
    title: "維修完成確認書已提交",
    message: "客戶已完成維修完成確認書，請確認維修紀錄。",
    targetUrl: "/repairs",
    refType: "REPAIR_CONFIRMATION",
    refId: toPositiveInteger(pick(confirmation, "confirmationId", "id")),
    priority: "NORMAL"
  });
  return result.notification;
}

async function notifyStoreReplenishmentSubmitted(request = {}) {
  const eventName = "STORE_REPLENISHMENT_SUBMITTED";
  const companyId = toPositiveInteger(pick(request, "companyId", "company_id"));
  const requestId = toPositiveInteger(pick(request, "requestId", "id"));
  const targetStoreIds = await loadHqNotificationStoreIds(companyId);
  const targets = targetStoreIds.length ? targetStoreIds : [null];
  const notifications = [];
  for (const targetStoreId of targets) {
    const result = await safeCreateNotification(eventName, {
      companyId,
      storeId: targetStoreId,
      type: eventName,
      title: "新的門市請貨",
      message: "門市已送出補貨申請，請本部確認是否建立出貨單。",
      targetUrl: "/hq-replenishment-requests",
      refType: "STORE_REPLENISHMENT_REQUEST",
      refId: requestId,
      priority: "IMPORTANT"
    });
    if (result.notification) notifications.push(result.notification);
    if (targetStoreId && result.created) {
      await dryRunStaffLine(eventName, {
        storeId: targetStoreId,
        eventType: eventName,
        eventLabel: "門市請貨",
        title: "新的門市請貨",
        message: `${request.storeName || request.requestingStoreName || "門市"} 已送出補貨申請。`,
        targetUrl: "/hq-replenishment-requests"
      });
    }
  }
  return notifications.filter(Boolean);
}

async function notifyStoreTransferShipped(transfer = {}) {
  const eventName = "STORE_TRANSFER_SHIPPED";
  const storeId = toPositiveInteger(pick(transfer, "toStoreId", "to_store_id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(pick(transfer, "companyId", "company_id")),
    storeId,
    type: eventName,
    title: "本部已出貨",
    message: "本部已確認出貨，請門市收到商品後至門市入庫確認。",
    targetUrl: "/inbound-transfers",
    refType: "STORE_TRANSFER",
    refId: toPositiveInteger(pick(transfer, "transferId", "id")),
    priority: "IMPORTANT"
  });
  if (result.created) await dryRunStaffLine(eventName, {
    storeId,
    eventType: eventName,
    eventLabel: "本部出貨",
    title: "本部已出貨",
    message: `出貨單 ${transfer.transferNo || transfer.transfer_no || ""} 已確認出貨。`,
    targetUrl: "/inbound-transfers"
  });
  return result.notification;
}

async function notifyStoreTransferReceived(transfer = {}) {
  const eventName = "STORE_TRANSFER_RECEIVED";
  const storeId = toPositiveInteger(pick(transfer, "fromStoreId", "from_store_id"));
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(pick(transfer, "companyId", "company_id")),
    storeId,
    type: eventName,
    title: "門市已入庫",
    message: "門市已完成入庫確認，本部可於月結時確認。",
    targetUrl: "/company-store-settlements",
    refType: "STORE_TRANSFER",
    refId: toPositiveInteger(pick(transfer, "transferId", "id")),
    priority: "NORMAL"
  });
  return result.notification;
}

async function notifySupplierPurchaseOrderCreated(order = {}) {
  const eventName = "SUPPLIER_PURCHASE_ORDER_CREATED";
  const storeId = toPositiveInteger(pick(order, "storeId", "store_id"));
  const supplierId = toPositiveInteger(pick(order, "supplierId", "supplier_id"));
  const item = summarizeItems(order.items);
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(pick(order, "companyId", "company_id")),
    storeId,
    type: eventName,
    title: "供應商發注已建立",
    message: "已建立供應商發注單，請追蹤供應商出貨與入庫。",
    targetUrl: "/suppliers",
    refType: "SUPPLIER_PURCHASE_ORDER",
    refId: toPositiveInteger(pick(order, "purchaseOrderId", "id")),
    priority: "NORMAL"
  });
  if (result.created) await dryRunSupplierLine(eventName, {
    storeId,
    supplierId,
    eventType: "SUPPLIER_PURCHASE",
    documentNo: order.poNo || order.po_no,
    supplierName: order.supplierName,
    sku: item.sku,
    quantity: item.quantity,
    message: "供應商發注已建立"
  });
  return result.notification;
}

async function notifySupplierReturnCreated(supplierReturn = {}) {
  const eventName = "SUPPLIER_RETURN_CREATED";
  const storeId = toPositiveInteger(pick(supplierReturn, "ownerStoreId", "storeId", "store_id"));
  const supplierId = toPositiveInteger(pick(supplierReturn, "supplierId", "supplier_id"));
  const item = summarizeItems(supplierReturn.items);
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(pick(supplierReturn, "ownerCompanyId", "companyId")),
    storeId,
    type: eventName,
    title: "供應商退貨已建立",
    message: "已建立供應商退貨，請追蹤供應商收件與結算。",
    targetUrl: "/suppliers",
    refType: "SUPPLIER_RETURN",
    refId: toPositiveInteger(pick(supplierReturn, "returnId", "id")),
    priority: "NORMAL"
  });
  if (result.created) await dryRunSupplierLine(eventName, {
    storeId,
    supplierId,
    eventType: "SUPPLIER_RETURN",
    documentNo: supplierReturn.returnNo || supplierReturn.return_no,
    supplierName: supplierReturn.supplierName,
    sku: item.sku,
    quantity: item.quantity,
    reason: pick(supplierReturn.items?.[0], "reason"),
    message: "供應商退貨已建立"
  });
  return result.notification;
}

async function notifySupplierReturnShipped(supplierReturn = {}) {
  const eventName = "SUPPLIER_RETURN_SHIPPED";
  const storeId = toPositiveInteger(pick(supplierReturn, "ownerStoreId", "storeId", "store_id"));
  const supplierId = toPositiveInteger(pick(supplierReturn, "supplierId", "supplier_id"));
  const item = summarizeItems(supplierReturn.items);
  const result = await safeCreateNotification(eventName, {
    companyId: toPositiveInteger(pick(supplierReturn, "ownerCompanyId", "companyId")),
    storeId,
    type: eventName,
    title: "供應商退貨已出貨",
    message: "供應商退貨已確認出貨，請追蹤供應商收件與結算。",
    targetUrl: "/suppliers",
    refType: "SUPPLIER_RETURN",
    refId: toPositiveInteger(pick(supplierReturn, "returnId", "id")),
    priority: "NORMAL"
  });
  if (result.created) await dryRunSupplierLine(eventName, {
    storeId,
    supplierId,
    eventType: "SUPPLIER_RETURN",
    documentNo: supplierReturn.returnNo || supplierReturn.return_no,
    supplierName: supplierReturn.supplierName,
    sku: item.sku,
    quantity: item.quantity,
    reason: pick(supplierReturn.items?.[0], "reason"),
    message: "供應商退貨已出貨"
  });
  return result.notification;
}

module.exports = {
  notifyLineRepairCreated,
  notifyRepairQuoteAcceptedWorkOrder,
  notifyLineOrderCreated,
  notifyPurchaseConfirmationSubmitted,
  notifyRepairConfirmationSubmitted,
  notifyStoreReplenishmentSubmitted,
  notifyStoreTransferShipped,
  notifyStoreTransferReceived,
  notifySupplierPurchaseOrderCreated,
  notifySupplierReturnCreated,
  notifySupplierReturnShipped
};
