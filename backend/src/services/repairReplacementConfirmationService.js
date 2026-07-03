const { pool } = require("../db");
const { createError } = require("../utils/errors");

const REPLACEMENT_BLOCK_MESSAGE = "尚有配件/零件更換項目未確認，請先完成更換確認後再結案。";
let tableExistsCache = null;

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseQuoteItemsJson(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item, index) => {
        const productId = item?.productId !== undefined ? Number(item.productId) : item?.product_id !== undefined ? Number(item.product_id) : null;
        const sku = normalizeText(item?.sku || item?.productSku || item?.product_sku);
        const name = normalizeText(item?.name || item?.productName || item?.product_name);
        const quantity = Number(item?.quantity || 0);
        const unitPrice = Number(item?.unitPrice !== undefined ? item.unitPrice : item?.price || 0);
        if (!name || !Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }
        return {
          sourceKey: normalizeText(item?.itemKey) || (productId ? `product:${productId}` : sku ? `sku:${sku}` : `quote:${index + 1}:${name}`),
          productId: Number.isFinite(productId) ? productId : null,
          sku,
          itemName: name,
          quantity,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          note: normalizeText(item?.note || item?.notes)
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function repairReplacementTableExists(connection = pool) {
  if (tableExistsCache === true) {
    return true;
  }
  const [rows] = await connection.query(
    `
      SELECT 1 AS existsFlag
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'repair_replacement_confirmations'
      LIMIT 1
    `
  );
  if (rows[0]) {
    tableExistsCache = true;
    return true;
  }
  return false;
}

async function getStaffSnapshot(staffUserId, connection = pool) {
  if (!staffUserId) {
    return { staffId: null, staffName: null, role: "" };
  }
  const [rows] = await connection.query(
    "SELECT id, username, display_name AS displayName, role FROM staff_users WHERE id = ? LIMIT 1",
    [staffUserId]
  );
  const row = rows[0] || {};
  return {
    staffId: row.id || staffUserId,
    staffName: normalizeText(row.displayName || row.username || staffUserId),
    role: normalizeText(row.role).toUpperCase()
  };
}

function isManagerOrAbove(user = {}, staffSnapshot = {}) {
  const role = normalizeText(user.role || staffSnapshot.role).toUpperCase();
  const storeRole = normalizeText(user.storeRole || user.store_role).toLowerCase();
  return ["ADMIN", "MANAGER"].includes(role) || ["owner", "admin", "manager"].includes(storeRole);
}

async function fetchRepairQuoteItems(repairOrderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT quote_items_json AS quoteItemsJson
      FROM repair_orders
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [repairOrderId, storeId]
  );
  if (!rows[0]) {
    throw createError("找不到維修工單", 404);
  }
  return parseQuoteItemsJson(rows[0].quoteItemsJson);
}

async function syncReplacementConfirmationsFromQuote(repairOrderId, storeId, connection = pool) {
  if (!(await repairReplacementTableExists(connection))) {
    return [];
  }
  const quoteItems = await fetchRepairQuoteItems(repairOrderId, storeId, connection);
  for (const item of quoteItems) {
    await connection.query(
      `
        INSERT INTO repair_replacement_confirmations (
          store_id,
          repair_order_id,
          source_key,
          product_id,
          sku,
          item_name,
          quantity,
          unit_price,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_id = VALUES(product_id),
          sku = VALUES(sku),
          item_name = VALUES(item_name),
          quantity = VALUES(quantity),
          unit_price = VALUES(unit_price),
          note = VALUES(note),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        storeId,
        repairOrderId,
        item.sourceKey,
        item.productId,
        item.sku || null,
        item.itemName,
        item.quantity,
        item.unitPrice,
        item.note || null
      ]
    );
  }
  return quoteItems;
}

function mapReplacementRow(row) {
  return {
    id: row.id,
    repairOrderId: row.repairOrderId,
    sourceKey: row.sourceKey,
    productId: row.productId,
    sku: row.sku,
    itemName: row.itemName,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unitPrice || 0),
    note: row.note || "",
    isReplaced: Boolean(row.isReplaced),
    isTested: Boolean(row.isTested),
    isStockHandled: Boolean(row.isStockHandled),
    isPhotoConfirmed: Boolean(row.isPhotoConfirmed),
    checkedByStaffId: row.checkedByStaffId,
    checkedByStaffName: row.checkedByStaffName,
    checkedAt: row.checkedAt,
    crossCheckedByStaffId: row.crossCheckedByStaffId,
    crossCheckedByStaffName: row.crossCheckedByStaffName,
    crossCheckedAt: row.crossCheckedAt,
    completed: Boolean(row.isReplaced && row.isTested && row.isStockHandled && row.crossCheckedAt)
  };
}

async function listReplacementConfirmations(repairOrderId, storeId, connection = pool, options = {}) {
  const tableExists = await repairReplacementTableExists(connection);
  if (!tableExists) {
    const quoteItems = await fetchRepairQuoteItems(repairOrderId, storeId, connection);
    return {
      tableExists: false,
      items: quoteItems.map((item, index) => ({
        id: null,
        repairOrderId: Number(repairOrderId),
        sourceKey: item.sourceKey || `quote:${index + 1}`,
        productId: item.productId,
        sku: item.sku,
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        note: item.note || "",
        isReplaced: false,
        isTested: false,
        isStockHandled: false,
        isPhotoConfirmed: false,
        checkedByStaffId: null,
        checkedByStaffName: null,
        checkedAt: null,
        crossCheckedByStaffId: null,
        crossCheckedByStaffName: null,
        crossCheckedAt: null,
        completed: false
      }))
    };
  }

  if (options.sync !== false) {
    await syncReplacementConfirmationsFromQuote(repairOrderId, storeId, connection);
  }

  const [rows] = await connection.query(
    `
      SELECT
        id,
        repair_order_id AS repairOrderId,
        source_key AS sourceKey,
        product_id AS productId,
        sku,
        item_name AS itemName,
        quantity,
        unit_price AS unitPrice,
        note,
        is_replaced AS isReplaced,
        is_tested AS isTested,
        is_stock_handled AS isStockHandled,
        is_photo_confirmed AS isPhotoConfirmed,
        checked_by_staff_id AS checkedByStaffId,
        checked_by_staff_name AS checkedByStaffName,
        checked_at AS checkedAt,
        cross_checked_by_staff_id AS crossCheckedByStaffId,
        cross_checked_by_staff_name AS crossCheckedByStaffName,
        cross_checked_at AS crossCheckedAt
      FROM repair_replacement_confirmations
      WHERE repair_order_id = ?
        AND store_id = ?
      ORDER BY id ASC
    `,
    [repairOrderId, storeId]
  );

  return { tableExists: true, items: rows.map(mapReplacementRow) };
}

async function updateReplacementConfirmation(repairOrderId, replacementId, storeId, payload = {}, staffUserId, connection = pool) {
  if (!(await repairReplacementTableExists(connection))) {
    throw createError("更換確認資料表尚未建立，請先執行資料庫 migration", 500);
  }
  await syncReplacementConfirmationsFromQuote(repairOrderId, storeId, connection);
  const staff = await getStaffSnapshot(staffUserId, connection);
  const isReplaced = normalizeBoolean(payload.isReplaced);
  const isTested = normalizeBoolean(payload.isTested);
  const isStockHandled = normalizeBoolean(payload.isStockHandled);
  const isPhotoConfirmed = normalizeBoolean(payload.isPhotoConfirmed);
  await connection.query(
    `
      UPDATE repair_replacement_confirmations
      SET is_replaced = ?,
          is_tested = ?,
          is_stock_handled = ?,
          is_photo_confirmed = ?,
          checked_by_staff_id = ?,
          checked_by_staff_name = ?,
          checked_at = NOW(),
          cross_checked_by_staff_id = NULL,
          cross_checked_by_staff_name = NULL,
          cross_checked_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND repair_order_id = ?
        AND store_id = ?
    `,
    [
      isReplaced ? 1 : 0,
      isTested ? 1 : 0,
      isStockHandled ? 1 : 0,
      isPhotoConfirmed ? 1 : 0,
      staff.staffId,
      staff.staffName,
      replacementId,
      repairOrderId,
      storeId
    ]
  );
  return listReplacementConfirmations(repairOrderId, storeId, connection, { sync: false });
}

async function crossCheckReplacementConfirmation(repairOrderId, replacementId, storeId, staffUserId, user = {}, connection = pool) {
  if (!(await repairReplacementTableExists(connection))) {
    throw createError("更換確認資料表尚未建立，請先執行資料庫 migration", 500);
  }
  await syncReplacementConfirmationsFromQuote(repairOrderId, storeId, connection);
  const [rows] = await connection.query(
    `
      SELECT id, is_replaced AS isReplaced, is_tested AS isTested, is_stock_handled AS isStockHandled, checked_by_staff_id AS checkedByStaffId
      FROM repair_replacement_confirmations
      WHERE id = ?
        AND repair_order_id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [replacementId, repairOrderId, storeId]
  );
  const item = rows[0];
  if (!item) {
    throw createError("找不到更換確認項目", 404);
  }
  if (!item.isReplaced || !item.isTested || !item.isStockHandled) {
    throw createError("請先完成已更換、已測試與庫存已處理確認", 400);
  }
  const staff = await getStaffSnapshot(staffUserId, connection);
  const sameStaff = staff.staffId && item.checkedByStaffId && Number(staff.staffId) === Number(item.checkedByStaffId);
  if (sameStaff && !isManagerOrAbove(user, staff)) {
    throw createError("交叉確認需由店長或另一位員工執行", 403);
  }
  await connection.query(
    `
      UPDATE repair_replacement_confirmations
      SET cross_checked_by_staff_id = ?,
          cross_checked_by_staff_name = ?,
          cross_checked_at = NOW(),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND repair_order_id = ?
        AND store_id = ?
    `,
    [staff.staffId, staff.staffName, replacementId, repairOrderId, storeId]
  );
  return listReplacementConfirmations(repairOrderId, storeId, connection, { sync: false });
}

function hasIncompleteReplacement(items = []) {
  return items.some((item) => !item.isReplaced || !item.isTested || !item.isStockHandled || !item.crossCheckedAt);
}

async function getReplacementConfirmationBlockReason(repairOrderId, storeId, connection = pool) {
  const { tableExists, items } = await listReplacementConfirmations(repairOrderId, storeId, connection);
  if (!items.length) {
    return "";
  }
  if (!tableExists || hasIncompleteReplacement(items)) {
    return REPLACEMENT_BLOCK_MESSAGE;
  }
  return "";
}

async function assertReplacementConfirmationsComplete(repairOrderId, storeId, connection = pool) {
  const blockReason = await getReplacementConfirmationBlockReason(repairOrderId, storeId, connection);
  if (blockReason) {
    throw createError(blockReason, 400);
  }
}

module.exports = {
  REPLACEMENT_BLOCK_MESSAGE,
  assertReplacementConfirmationsComplete,
  crossCheckReplacementConfirmation,
  getReplacementConfirmationBlockReason,
  listReplacementConfirmations,
  syncReplacementConfirmationsFromQuote,
  updateReplacementConfirmation
};
