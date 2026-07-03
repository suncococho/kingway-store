const { pool } = require("../db");
const { createError } = require("../utils/errors");

const ACCESSORY_INSTALL_BLOCK_MESSAGE = "配件安裝確認尚未完成，請先完成安裝、測試、照片確認與交叉確認。";
const ACCESSORY_INSTALL_TABLE_MISSING_MESSAGE = "配件安裝確認資料表尚未建立，請先執行 staging migration。";
let tableExistsCache = null;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeCategory(value) {
  return String(value || "").trim().toUpperCase();
}

function isEbikeCategory(value) {
  const normalized = normalizeCategory(value);
  return normalized === "EB" || normalized === "EBIKE";
}

function isAccessoryCategory(value) {
  return normalizeCategory(value) === "ACCESSORY";
}

function isRepairQuoteOrder(order = {}) {
  return normalizeText(order.source).toLowerCase() === "repair_quote" || Number(order.repairOrderId || 0) > 0;
}

function mapConfirmationRow(row) {
  return {
    id: Number(row.id),
    orderId: Number(row.orderId),
    orderItemId: Number(row.orderItemId),
    productId: row.productId ? Number(row.productId) : null,
    sourceKey: row.sourceKey,
    sku: row.sku || "",
    itemName: row.itemName,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unitPrice || 0),
    lineTotal: Number(row.lineTotal || 0),
    note: row.note || "",
    isInstalled: Boolean(row.isInstalled),
    isTested: Boolean(row.isTested),
    isPhotoConfirmed: Boolean(row.isPhotoConfirmed),
    checkedByStaffId: row.checkedByStaffId ? Number(row.checkedByStaffId) : null,
    checkedByStaffName: row.checkedByStaffName || "",
    checkedAt: row.checkedAt || null,
    crossCheckedByStaffId: row.crossCheckedByStaffId ? Number(row.crossCheckedByStaffId) : null,
    crossCheckedByStaffName: row.crossCheckedByStaffName || "",
    crossCheckedAt: row.crossCheckedAt || null,
    completed: Boolean(row.isInstalled && row.isTested && row.isPhotoConfirmed && row.crossCheckedAt)
  };
}

async function orderAccessoryInstallTableExists(connection = pool) {
  if (tableExistsCache === true) {
    return true;
  }

  const [rows] = await connection.query(
    `
      SELECT 1 AS existsFlag
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'order_accessory_install_confirmations'
      LIMIT 1
    `
  );

  if (rows[0]) {
    tableExistsCache = true;
    return true;
  }

  return false;
}

async function getStaffSnapshot(staffUserId, staffUserName = "", connection = pool) {
  const fallbackName = normalizeText(staffUserName);
  if (!staffUserId) {
    return {
      staffId: null,
      staffName: fallbackName || null
    };
  }

  const [rows] = await connection.query(
    "SELECT id, username, display_name AS displayName FROM staff_users WHERE id = ? LIMIT 1",
    [staffUserId]
  );
  const row = rows[0] || {};
  return {
    staffId: row.id || staffUserId,
    staffName: normalizeText(row.displayName || row.username || fallbackName || staffUserId)
  };
}

async function getOrderItems(orderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        product_id AS productId,
        sku_snapshot AS sku,
        product_name_snapshot AS productName,
        product_category_snapshot AS productCategory,
        quantity,
        unit_price AS unitPrice,
        line_total AS lineTotal
      FROM order_items
      WHERE order_id = ?
        AND store_id = ?
      ORDER BY id ASC
    `,
    [orderId, storeId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    productId: row.productId ? Number(row.productId) : null,
    sku: row.sku || "",
    productName: row.productName || "商品",
    productCategory: row.productCategory || "",
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unitPrice || 0),
    lineTotal: Number(row.lineTotal || 0)
  }));
}

async function getOrderAccessoryContext(orderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, source, repair_order_id AS repairOrderId
      FROM orders
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [orderId, storeId]
  );

  const order = rows[0];
  if (!order) {
    throw createError("找不到訂單", 404);
  }

  const items = await getOrderItems(orderId, storeId, connection);
  const hasEbike = items.some((item) => isEbikeCategory(item.productCategory));
  const accessoryItems = items.filter((item) => isAccessoryCategory(item.productCategory));
  const repairQuote = isRepairQuoteOrder(order);
  const applicable = !repairQuote && hasEbike;
  return {
    orderId: Number(order.id),
    source: order.source || "",
    repairOrderId: order.repairOrderId ? Number(order.repairOrderId) : null,
    hasEbike,
    repairQuote,
    applicable,
    items,
    accessoryItems,
    hasAccessoryItems: accessoryItems.length > 0
  };
}

async function syncOrderAccessoryInstallConfirmationsFromOrderItems(orderId, storeId, connection = pool) {
  const tableExists = await orderAccessoryInstallTableExists(connection);
  const context = await getOrderAccessoryContext(orderId, storeId, connection);

  if (!tableExists) {
    return {
      tableExists: false,
      ...context,
      syncedCount: 0
    };
  }

  if (!context.applicable || !context.hasAccessoryItems) {
    const [updateResult] = await connection.query(
      `
        DELETE FROM order_accessory_install_confirmations
        WHERE order_id = ?
          AND store_id = ?
      `,
      [orderId, storeId]
    );

    return {
      tableExists: true,
      ...context,
      syncedCount: 0
    };
  }

  for (const item of context.accessoryItems) {
    await connection.query(
      `
        INSERT INTO order_accessory_install_confirmations (
          store_id,
          order_id,
          order_item_id,
          product_id,
          source_key,
          sku,
          item_name,
          quantity,
          unit_price,
          line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_id = VALUES(product_id),
          source_key = VALUES(source_key),
          sku = VALUES(sku),
          item_name = VALUES(item_name),
          quantity = VALUES(quantity),
          unit_price = VALUES(unit_price),
          line_total = VALUES(line_total),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        storeId,
        orderId,
        item.id,
        item.productId,
        `order_item:${item.id}`,
        item.sku || null,
        item.productName,
        item.quantity,
        item.unitPrice,
        item.lineTotal
      ]
    );
  }

  const keepIds = context.accessoryItems.map((item) => item.id);
  if (keepIds.length > 0) {
    await connection.query(
      `
        DELETE FROM order_accessory_install_confirmations
        WHERE order_id = ?
          AND store_id = ?
          AND order_item_id NOT IN (${keepIds.map(() => "?").join(", ")})
      `,
      [orderId, storeId, ...keepIds]
    );
  }

  return {
    tableExists: true,
    ...context,
    syncedCount: context.accessoryItems.length
  };
}

async function listOrderAccessoryInstallConfirmations(orderId, storeId, connection = pool, options = {}) {
  const tableExists = await orderAccessoryInstallTableExists(connection);
  const context = options.sync === false
    ? await getOrderAccessoryContext(orderId, storeId, connection)
    : await syncOrderAccessoryInstallConfirmationsFromOrderItems(orderId, storeId, connection);

  if (!tableExists) {
    return {
      tableExists: false,
      orderId: Number(orderId),
      hasEbike: Boolean(context.hasEbike),
      hasAccessoryItems: Boolean(context.hasAccessoryItems),
      applicable: Boolean(context.applicable),
      repairQuote: Boolean(context.repairQuote),
      items: [],
      readyForHandoverChecklist: !context.applicable || !context.hasAccessoryItems,
      blockReason: context.applicable && context.hasAccessoryItems ? ACCESSORY_INSTALL_TABLE_MISSING_MESSAGE : ""
    };
  }

  const [rows] = await connection.query(
    `
      SELECT
        id,
        order_id AS orderId,
        order_item_id AS orderItemId,
        product_id AS productId,
        source_key AS sourceKey,
        sku,
        item_name AS itemName,
        quantity,
        unit_price AS unitPrice,
        line_total AS lineTotal,
        note,
        is_installed AS isInstalled,
        is_tested AS isTested,
        is_photo_confirmed AS isPhotoConfirmed,
        checked_by_staff_id AS checkedByStaffId,
        checked_by_staff_name AS checkedByStaffName,
        checked_at AS checkedAt,
        cross_checked_by_staff_id AS crossCheckedByStaffId,
        cross_checked_by_staff_name AS crossCheckedByStaffName,
        cross_checked_at AS crossCheckedAt
      FROM order_accessory_install_confirmations
      WHERE order_id = ?
        AND store_id = ?
      ORDER BY id ASC
    `,
    [orderId, storeId]
  );

  const items = rows.map(mapConfirmationRow);
  const readyForHandoverChecklist = !context.applicable || !context.hasAccessoryItems || items.every((item) => item.completed);
  return {
    tableExists: true,
    orderId: Number(orderId),
    hasEbike: Boolean(context.hasEbike),
    hasAccessoryItems: Boolean(context.hasAccessoryItems),
    applicable: Boolean(context.applicable),
    repairQuote: Boolean(context.repairQuote),
    items,
    readyForHandoverChecklist,
    blockReason: readyForHandoverChecklist ? "" : ACCESSORY_INSTALL_BLOCK_MESSAGE
  };
}

async function updateOrderAccessoryInstallConfirmation(orderId, confirmationId, storeId, payload = {}, staffUserId, staffUserName, connection = pool) {
  if (!(await orderAccessoryInstallTableExists(connection))) {
    throw createError(ACCESSORY_INSTALL_TABLE_MISSING_MESSAGE, 500);
  }

  await syncOrderAccessoryInstallConfirmationsFromOrderItems(orderId, storeId, connection);
  const staff = await getStaffSnapshot(staffUserId, staffUserName, connection);
  const [updateResult] = await connection.query(
    `
      UPDATE order_accessory_install_confirmations
      SET is_installed = ?,
          is_tested = ?,
          is_photo_confirmed = ?,
          note = ?,
          checked_by_staff_id = ?,
          checked_by_staff_name = ?,
          checked_at = NOW(),
          cross_checked_by_staff_id = NULL,
          cross_checked_by_staff_name = NULL,
          cross_checked_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND order_id = ?
        AND store_id = ?
    `,
    [
      normalizeBoolean(payload.isInstalled) ? 1 : 0,
      normalizeBoolean(payload.isTested) ? 1 : 0,
      normalizeBoolean(payload.isPhotoConfirmed) ? 1 : 0,
      normalizeText(payload.note) || null,
      staff.staffId,
      staff.staffName,
      confirmationId,
      orderId,
      storeId
    ]
  );

  if (!updateResult.affectedRows) {
    throw createError("找不到配件安裝確認項目", 404);
  }

  return listOrderAccessoryInstallConfirmations(orderId, storeId, connection, { sync: false });
}

async function crossCheckOrderAccessoryInstallConfirmation(orderId, confirmationId, storeId, staffUserId, staffUserName, connection = pool) {
  if (!(await orderAccessoryInstallTableExists(connection))) {
    throw createError(ACCESSORY_INSTALL_TABLE_MISSING_MESSAGE, 500);
  }

  await syncOrderAccessoryInstallConfirmationsFromOrderItems(orderId, storeId, connection);
  const [rows] = await connection.query(
    `
      SELECT id,
             is_installed AS isInstalled,
             is_tested AS isTested,
             is_photo_confirmed AS isPhotoConfirmed,
             checked_by_staff_id AS checkedByStaffId
      FROM order_accessory_install_confirmations
      WHERE id = ?
        AND order_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [confirmationId, orderId, storeId]
  );

  const item = rows[0];
  if (!item) {
    throw createError("找不到配件安裝確認項目", 404);
  }
  if (!item.isInstalled || !item.isTested || !item.isPhotoConfirmed) {
    throw createError("請先完成已安裝、已測試與照片已確認", 400);
  }

  const staff = await getStaffSnapshot(staffUserId, staffUserName, connection);
  // MVP: allow the same staff to perform cross-check. Keep the data model separate so policy can tighten later.
  await connection.query(
    `
      UPDATE order_accessory_install_confirmations
      SET cross_checked_by_staff_id = ?,
          cross_checked_by_staff_name = ?,
          cross_checked_at = NOW(),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND order_id = ?
        AND store_id = ?
    `,
    [staff.staffId, staff.staffName, confirmationId, orderId, storeId]
  );

  return listOrderAccessoryInstallConfirmations(orderId, storeId, connection, { sync: false });
}

async function getOrderAccessoryInstallBlockReason(orderId, storeId, connection = pool) {
  const result = await listOrderAccessoryInstallConfirmations(orderId, storeId, connection);
  return result.blockReason || "";
}

async function assertOrderAccessoryInstallConfirmationsComplete(orderId, storeId, connection = pool) {
  const blockReason = await getOrderAccessoryInstallBlockReason(orderId, storeId, connection);
  if (blockReason) {
    throw createError(blockReason, 400);
  }
}

module.exports = {
  ACCESSORY_INSTALL_BLOCK_MESSAGE,
  ACCESSORY_INSTALL_TABLE_MISSING_MESSAGE,
  assertOrderAccessoryInstallConfirmationsComplete,
  crossCheckOrderAccessoryInstallConfirmation,
  getOrderAccessoryInstallBlockReason,
  listOrderAccessoryInstallConfirmations,
  syncOrderAccessoryInstallConfirmationsFromOrderItems,
  updateOrderAccessoryInstallConfirmation
};
