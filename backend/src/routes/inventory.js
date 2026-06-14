const express = require("express");
const ExcelJS = require("exceljs");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { createError } = require("../utils/errors");
const { getTableColumns, selectColumn } = require("../utils/schema");
const {
  createButtonMessage,
  createConfirmTemplate,
  createPostbackAction,
  buildGroupApprovalMessage,
  logWorkflowEvent,
  sendToGroups
} = require("../services/lineWorkflowService");
const {
  mapCategoryLabel,
  mapSupplierRequestStatusLabel,
  mapSupplierRequestTypeLabel
} = require("../utils/displayLabels");

const router = express.Router();

async function notifySupplierRequestTelegram({ requestId, requestType, supplierName, note, items = [] }) {
  const token = process.env.TELEGRAM_STOCK_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_SUPPLIER_CHAT_ID ||
    process.env.TELEGRAM_STOCK_GROUP_ID ||
    process.env.TELEGRAM_STOCK_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[supplier:telegram] skipped missing env", {
      hasToken: Boolean(token),
      chatId: chatId || null
    });
    return;
  }

  const typeLabel = requestType === "RETURN" ? "退貨 / 換貨" : "發注";
  const itemLines = items.length
    ? items.map((item, index) => {
        const name =
          item.productName ||
          item.product_name ||
          item.product_name_snapshot ||
          item.name ||
          item.note ||
          `商品ID ${item.productId || item.product_id || "-"}`;

        const sku =
          item.sku ||
          item.productSku ||
          item.product_sku ||
          item.product_sku_snapshot ||
          "";

        const qty = Number(item.quantity || item.qty || 0);

        return [
          `${index + 1}. ${name}`,
          sku ? `   SKU：${sku}` : null,
          `   數量：${qty}`
        ].filter(Boolean).join("\n");
      }).join("\n")
    : "- 無商品明細";

  const text = [
    `📦 KINGWAY ${typeLabel}申請`,
    "",
    `單號：PO-${requestId}`,
    `供應商：${supplierName || "-"}`,
    "狀態：待供應商確認",
    "",
    "商品明細",
    itemLines,
    "",
    note ? `備註：${note}` : null,
    "",
    "請供應商確認或拒絕。"
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const body = await response.text();

    if (!response.ok) {
      console.error("[supplier:telegram] send failed", {
        status: response.status,
        body
      });
      return;
    }

    console.log("[supplier:telegram] sent", {
      requestId,
      chatId,
      status: response.status
    });
  } catch (error) {
    console.error("[supplier:telegram] send error", error);
  }
}



router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "INVENTORY"]), requireStoreFeature("inventory_enabled"));
const requireStoreAdminRole = requireStoreRole(["owner", "admin"]);

function requireStoreAdminForAdjustment(req, res, next) {
  const movementType = String(req.body?.type || "").toUpperCase();
  if (movementType === "ADJUST") {
    return requireStoreAdminRole(req, res, next);
  }
  return next();
}

async function hasProductCategorySchema(connection = pool) {
  const [tables] = await connection.query("SHOW TABLES LIKE 'product_categories'");
  if (!tables.length) {
    return false;
  }
  const [columns] = await connection.query("SHOW COLUMNS FROM `products` LIKE 'category_id'");
  return columns.length > 0;
}

function sanitizeWorksheetValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

function normalizeExportBoolean(value) {
  return Number(value) ? 1 : 0;
}

function normalizeImportString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    if (value.text !== undefined) {
      return String(value.text || "").trim();
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("").trim();
    }
    if (value.result !== undefined) {
      return normalizeImportString(value.result);
    }
    if (value.formula !== undefined) {
      return "";
    }
  }
  return String(value).trim();
}

function normalizeImportHeader(value) {
  return normalizeImportString(value).replace(/\s+/g, "").toLowerCase();
}

function parseImportNumber(value) {
  const normalized = normalizeImportString(value).replace(/,/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function readInventoryImportRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("商品庫存匯入範本") || workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headerMap = new Map();
  worksheet.getRow(1).eachCell((cell, column) => {
    const normalized = normalizeImportHeader(cell.value);
    if (["sku", "name", "currentstock", "newstock", "adjustmentqty", "reason", "note"].includes(normalized)) {
      headerMap.set(column, normalized);
    }
  });

  const fieldByHeader = {
    sku: "sku",
    name: "name",
    currentstock: "currentStock",
    newstock: "newStock",
    adjustmentqty: "adjustmentQty",
    reason: "reason",
    note: "note"
  };

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const data = {};
    for (const [column, header] of headerMap.entries()) {
      data[fieldByHeader[header]] = normalizeImportString(row.getCell(column).value);
    }
    const hasAnyValue = Object.values(data).some((value) => String(value || "").trim() !== "");
    if (!hasAnyValue) {
      continue;
    }
    rows.push({ rowNumber, data });
  }

  return rows;
}

function getInventoryImportAction(adjustmentQty) {
  if (adjustmentQty > 0) {
    return "increase";
  }
  if (adjustmentQty < 0) {
    return "decrease";
  }
  return "no_change";
}

function addInventoryImportError(result, row, sku, message, payload = {}) {
  result.errorCount += 1;
  result.errors.push({ row, sku, message });
  result.preview.push({
    row,
    sku,
    name: payload.name || "",
    currentStock: payload.currentStock ?? "",
    newStock: payload.newStock ?? "",
    adjustmentQty: payload.adjustmentQty ?? "",
    action: "error",
    reason: payload.reason || "庫存匯入檢查",
    note: payload.note || "",
    message
  });
}

async function runInventoryImportDryRun(storeId, buffer) {
  const importRows = await readInventoryImportRows(buffer);
  const [products] = await pool.query(
    `
      SELECT sku, name, stock
      FROM products
      WHERE store_id = ?
    `,
    [storeId]
  );
  const productBySku = new Map(
    products.map((product) => [String(product.sku || "").trim().toUpperCase(), {
      sku: String(product.sku || "").trim(),
      name: product.name || "",
      stock: Number(product.stock || 0)
    }])
  );

  const result = {
    ok: true,
    dryRun: true,
    totalRows: 0,
    increaseCount: 0,
    decreaseCount: 0,
    noChangeCount: 0,
    errorCount: 0,
    errors: [],
    preview: []
  };
  const seenSkuSet = new Set();

  for (const { rowNumber, data } of importRows) {
    result.totalRows += 1;

    const rawSku = String(data.sku || "").trim();
    const skuKey = rawSku.toUpperCase();
    const rowReason = String(data.reason || "").trim() || "庫存匯入檢查";
    const rowNote = String(data.note || "").trim();
    const templateCurrentStock = parseImportNumber(data.currentStock);
    const inputNewStock = parseImportNumber(data.newStock);
    const inputAdjustmentQty = parseImportNumber(data.adjustmentQty);

    if (!rawSku) {
      addInventoryImportError(result, rowNumber, rawSku, "sku 欄位為必填", { reason: rowReason, note: rowNote });
      continue;
    }

    if (seenSkuSet.has(skuKey)) {
      addInventoryImportError(result, rowNumber, rawSku, "同一檔案內 SKU 重複", { reason: rowReason, note: rowNote });
      continue;
    }
    seenSkuSet.add(skuKey);

    const product = productBySku.get(skuKey);
    if (!product) {
      addInventoryImportError(result, rowNumber, rawSku, "SKU 不屬於目前門市商品", { reason: rowReason, note: rowNote });
      continue;
    }

    const hasNewStock = inputNewStock !== null;
    const hasAdjustmentQty = inputAdjustmentQty !== null;
    const basePayload = {
      name: product.name,
      currentStock: product.stock,
      reason: rowReason,
      note: rowNote
    };

    if (!hasNewStock && !hasAdjustmentQty) {
      addInventoryImportError(result, rowNumber, product.sku, "newStock 或 adjustmentQty 必須擇一填寫", basePayload);
      continue;
    }

    if ((hasNewStock && Number.isNaN(inputNewStock)) || (hasAdjustmentQty && Number.isNaN(inputAdjustmentQty))) {
      addInventoryImportError(result, rowNumber, product.sku, "newStock 與 adjustmentQty 必須是數字", basePayload);
      continue;
    }

    if (templateCurrentStock !== null && Number.isNaN(templateCurrentStock)) {
      addInventoryImportError(result, rowNumber, product.sku, "currentStock 必須是數字", basePayload);
      continue;
    }

    if (hasNewStock && inputNewStock < 0) {
      addInventoryImportError(result, rowNumber, product.sku, "newStock 不可小於 0", {
        ...basePayload,
        newStock: inputNewStock
      });
      continue;
    }

    const nextStock = hasNewStock ? inputNewStock : product.stock + inputAdjustmentQty;
    const adjustmentQty = hasAdjustmentQty ? inputAdjustmentQty : inputNewStock - product.stock;

    if (hasNewStock && hasAdjustmentQty && inputNewStock - product.stock !== inputAdjustmentQty) {
      addInventoryImportError(result, rowNumber, product.sku, "newStock 與 adjustmentQty 換算結果不一致", {
        ...basePayload,
        newStock: inputNewStock,
        adjustmentQty: inputAdjustmentQty
      });
      continue;
    }

    if (nextStock < 0) {
      addInventoryImportError(result, rowNumber, product.sku, "adjustmentQty 套用後庫存不可小於 0", {
        ...basePayload,
        newStock: nextStock,
        adjustmentQty
      });
      continue;
    }

    const action = getInventoryImportAction(adjustmentQty);
    if (action === "increase") {
      result.increaseCount += 1;
    } else if (action === "decrease") {
      result.decreaseCount += 1;
    } else {
      result.noChangeCount += 1;
    }

    result.preview.push({
      row: rowNumber,
      sku: product.sku,
      name: product.name,
      currentStock: product.stock,
      newStock: nextStock,
      adjustmentQty,
      action,
      reason: rowReason,
      note: rowNote
    });
  }

  result.ok = result.errorCount === 0;
  return result;
}

async function fetchInventoryRows(storeId) {
  const productColumns = await getTableColumns(pool, "products");
  const hasCategorySchema = await hasProductCategorySchema(pool);

  const [rows] = await pool.query(
    `
      SELECT
        ${selectColumn(productColumns, "products", "sku", "sku")},
        ${selectColumn(productColumns, "products", "name", "name")},
        ${hasCategorySchema ? "pc.code AS categoryCode," : `${selectColumn(productColumns, "products", "category", "categoryCode", "'OT'")},`}
        ${hasCategorySchema ? "pc.name AS categoryName," : "NULL AS categoryName,"}
        ${selectColumn(productColumns, "products", "stock", "currentStock", "0")},
        ${selectColumn(productColumns, "products", "reorder_level", "reorderLevel", "0")},
        ${selectColumn(productColumns, "products", "location", "location")},
        ${selectColumn(productColumns, "products", "is_active", "isActive", "1")},
        ${selectColumn(productColumns, "products", "updated_at", "updatedAt")}
      FROM products
      ${hasCategorySchema ? "LEFT JOIN product_categories pc ON pc.id = products.category_id AND pc.store_id = products.store_id" : ""}
      WHERE products.store_id = ?
      ORDER BY products.id DESC
    `,
    [storeId]
  );

  return rows.map((row) => {
    const categoryCode = String(row.categoryCode || "").trim();
    return {
      sku: sanitizeWorksheetValue(row.sku),
      name: sanitizeWorksheetValue(row.name),
      categoryCode: sanitizeWorksheetValue(categoryCode),
      categoryName: sanitizeWorksheetValue(row.categoryName || mapCategoryLabel(categoryCode) || ""),
      currentStock: Number(row.currentStock || 0),
      reorderLevel: Number(row.reorderLevel || 0),
      location: sanitizeWorksheetValue(row.location),
      isActive: normalizeExportBoolean(row.isActive),
      updatedAt: sanitizeWorksheetValue(row.updatedAt)
    };
  });
}

function applyHeaderStyle(sheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
}

async function sendInventoryWorkbook(res, workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.get("/export", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const rows = await fetchInventoryRows(storeId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KINGWAY";

    const sheet = workbook.addWorksheet("庫存資料");
    sheet.columns = [
      { header: "sku", key: "sku", width: 20 },
      { header: "name", key: "name", width: 30 },
      { header: "categoryCode", key: "categoryCode", width: 16 },
      { header: "categoryName", key: "categoryName", width: 22 },
      { header: "currentStock", key: "currentStock", width: 14 },
      { header: "reorderLevel", key: "reorderLevel", width: 14 },
      { header: "location", key: "location", width: 16 },
      { header: "isActive", key: "isActive", width: 12 },
      { header: "updatedAt", key: "updatedAt", width: 22 }
    ];
    applyHeaderStyle(sheet);
    sheet.addRows(rows);
    for (const key of ["currentStock", "reorderLevel", "isActive"]) {
      sheet.getColumn(key).numFmt = "#,##0";
    }

    return sendInventoryWorkbook(res, workbook, `KINGWAY_inventory_export_store_${storeId}.xlsx`);
  } catch (error) {
    return next(error);
  }
});

router.get("/import-template", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const rows = await fetchInventoryRows(storeId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KINGWAY";

    const templateSheet = workbook.addWorksheet("商品庫存匯入範本");
    templateSheet.columns = [
      { header: "sku", key: "sku", width: 20 },
      { header: "name", key: "name", width: 30 },
      { header: "currentStock", key: "currentStock", width: 14 },
      { header: "newStock", key: "newStock", width: 14 },
      { header: "adjustmentQty", key: "adjustmentQty", width: 16 },
      { header: "reason", key: "reason", width: 24 },
      { header: "note", key: "note", width: 36 }
    ];
    applyHeaderStyle(templateSheet);
    templateSheet.addRows(rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      currentStock: row.currentStock,
      newStock: "",
      adjustmentQty: "",
      reason: "",
      note: ""
    })));
    for (const key of ["currentStock", "newStock", "adjustmentQty"]) {
      templateSheet.getColumn(key).numFmt = "#,##0";
    }

    const currentStockSheet = workbook.addWorksheet("目前庫存清單");
    currentStockSheet.columns = [
      { header: "sku", key: "sku", width: 20 },
      { header: "name", key: "name", width: 30 },
      { header: "categoryCode", key: "categoryCode", width: 16 },
      { header: "categoryName", key: "categoryName", width: 22 },
      { header: "currentStock", key: "currentStock", width: 14 },
      { header: "reorderLevel", key: "reorderLevel", width: 14 },
      { header: "location", key: "location", width: 16 },
      { header: "isActive", key: "isActive", width: 12 },
      { header: "updatedAt", key: "updatedAt", width: 22 }
    ];
    applyHeaderStyle(currentStockSheet);
    currentStockSheet.addRows(rows);
    for (const key of ["currentStock", "reorderLevel", "isActive"]) {
      currentStockSheet.getColumn(key).numFmt = "#,##0";
    }

    const helpSheet = workbook.addWorksheet("匯入說明");
    helpSheet.columns = [
      { header: "項目", key: "item", width: 28 },
      { header: "內容", key: "content", width: 90 }
    ];
    applyHeaderStyle(helpSheet);
    helpSheet.addRows([
      { item: "填寫方式", content: "newStock 或 adjustmentQty 中請擇一填寫。" },
      { item: "雙欄一致", content: "如果 newStock 與 adjustmentQty 都有填寫，兩者換算後必須一致。" },
      { item: "庫存限制", content: "newStock 不可為負數。" },
      { item: "SKU 範圍", content: "SKU 只允許目前門市商品，不可匯入其他門市或不存在的商品。" },
      { item: "檢查流程", content: "實際套用前會先以 dry-run 檢查資料，確認無誤後才可套用。" }
    ]);
    for (let rowNumber = 2; rowNumber <= helpSheet.rowCount; rowNumber += 1) {
      helpSheet.getRow(rowNumber).getCell("B").alignment = { wrapText: true, vertical: "top" };
      helpSheet.getRow(rowNumber).height = 34;
    }

    return sendInventoryWorkbook(res, workbook, `KINGWAY_inventory_import_template_store_${storeId}.xlsx`);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/import",
  express.raw({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ],
    limit: "16mb"
  }),
  requireStoreAdminRole,
  async (req, res, next) => {
    try {
      const rawDryRun = String(req.query.dryRun || "").trim().toLowerCase();
      if (rawDryRun !== "true") {
        return res.status(400).json({ message: "目前僅支援 dryRun=true 的庫存匯入檢查" });
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: "請上傳 XLSX 檔案內容" });
      }

      const result = await runInventoryImportDryRun(req.storeId, req.body);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/movements", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          im.id,
          im.product_id AS productId,
          p.name AS productName,
          p.sku,
          im.movement_type AS movementType,
          im.quantity,
          im.notes,
          im.reference_type AS referenceType,
          im.reference_id AS referenceId,
          im.created_at AS createdAt
        FROM inventory_movements im
        INNER JOIN products p ON p.id = im.product_id AND p.store_id = ?
        ORDER BY im.id DESC
        LIMIT 200
      `,
      [storeId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/low-stock", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT id, name, sku, category, stock, reorder_level AS reorderLevel
        FROM products
        WHERE store_id = ?
          AND stock <= reorder_level
        ORDER BY stock ASC, name ASC
      `,
      [storeId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/supplier-requests", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          sr.id,
          sr.request_type AS requestType,
          sr.status,
          sr.supplier_name AS supplierName,
          sr.note,
          sr.supplier_response_note AS supplierResponseNote,
          sr.supplier_responded_at AS supplierRespondedAt,
          sr.created_at AS createdAt,
          su.display_name AS requestedByName,
          GROUP_CONCAT(CONCAT(p.name, ' x', sri.quantity, IF(sri.received_quantity > 0, CONCAT(' / 已入庫 ', sri.received_quantity), '')) ORDER BY sri.id SEPARATOR '；') AS itemSummary
        FROM supplier_requests sr
        INNER JOIN staff_users su ON su.id = sr.requested_by_staff_id
        LEFT JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        LEFT JOIN products p ON p.id = sri.product_id
        WHERE p.store_id = ?
          AND (sr.store_id = ? OR sr.store_id IS NULL)
        GROUP BY sr.id, sr.request_type, sr.status, sr.supplier_name, sr.note, sr.supplier_response_note, sr.supplier_responded_at, sr.created_at, su.display_name
        ORDER BY sr.id DESC
      `,
      [storeId, storeId]
    );

    return res.json(rows.map((row) => ({
      ...row,
      requestTypeLabel: mapSupplierRequestTypeLabel(row.requestType),
      statusLabel: mapSupplierRequestStatusLabel(row.status)
    })));
  } catch (error) {
    return next(error);
  }
});

router.post("/movements", requireStoreAdminForAdjustment, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { productId, type, qty, note } = req.body;
    const normalizedQty = Number(qty);

    const movementType = String(type).toUpperCase();
    if (!["IN", "OUT", "ADJUST"].includes(movementType)) {
      throw createError("異動類型必須為入庫、出庫或調整", 400);
    }

    if (!productId || !type || !Number.isInteger(normalizedQty)) {
      throw createError("請提供商品、異動類型與有效數量", 400);
    }
    if (movementType === "ADJUST" && normalizedQty < 0) {
      throw createError("直接調整後的庫存不可小於 0", 400);
    }
    if (movementType !== "ADJUST" && normalizedQty <= 0) {
      throw createError("入庫與出庫數量必須為正整數", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [products] = await connection.query(
        `
          SELECT id, stock, name, sku
          FROM products
          WHERE id = ?
            AND store_id = ?
          FOR UPDATE
        `,
        [productId, storeId]
      );

      const product = products[0];
      if (!product) {
        throw createError("找不到商品", 404);
      }

      const signedQty = movementType === "OUT" ? -normalizedQty : normalizedQty;
      const nextStock = movementType === "ADJUST" ? normalizedQty : product.stock + signedQty;
      const movementQuantity = movementType === "ADJUST" ? nextStock - Number(product.stock || 0) : signedQty;

      if (nextStock < 0) {
        throw createError("庫存不可小於 0", 409);
      }

      await connection.query(
        `
          UPDATE products
          SET stock = ?
          WHERE id = ?
            AND store_id = ?
        `,
        [nextStock, productId, storeId]
      );

      await connection.query(
        `
          INSERT INTO inventory_movements (store_id, product_id, movement_type, quantity, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          storeId,
          productId,
          movementType,
          movementQuantity,
          note || (movementType === "ADJUST" ? `直接調整庫存為 ${nextStock}` : null),
          req.user.id
        ]
      );

      return {
        productId: Number(productId),
        productName: product.name,
        sku: product.sku,
        previousStock: Number(product.stock || 0),
        stock: nextStock,
        movementType,
        movementQuantity
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { requestType, supplierName, note, items } = req.body;
    if (!["PURCHASE_ORDER", "RETURN"].includes(requestType)) {
      throw createError("請選擇發注或退貨", 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw createError("請至少提供一個品項", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [requestResult] = await connection.query(
        `
          INSERT INTO supplier_requests (store_id, request_type, status, supplier_name, note, requested_by_staff_id)
          VALUES (?, ?, 'PENDING_SUPPLIER', ?, ?, ?)
        `,
        [storeId, requestType, supplierName || null, note || null, req.user.id]
      );

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
          throw createError("供應商流程品項需提供商品與正整數數量", 400);
        }

        const [[product]] = await connection.query(
          "SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1",
          [productId, storeId]
        );
        if (!product) {
          throw createError("找不到商品", 404);
        }

        await connection.query(
          `
            INSERT INTO supplier_request_items (supplier_request_id, product_id, quantity, reason, note)
            VALUES (?, ?, ?, ?, ?)
          `,
          [requestResult.insertId, productId, quantity, item.reason || null, item.note || null]
        );
      }

      await logWorkflowEvent("supplier_request_created", "SUPPLIER_REQUEST", requestResult.insertId, {
        requestType,
        itemCount: items.length
      }, req.user.id, connection);

      return { id: requestResult.insertId };
    });

    await sendToGroups(["inventory", "admin"], [
      buildGroupApprovalMessage("supplier_request", {
        id: result.id,
        requestTypeLabel: mapSupplierRequestTypeLabel(requestType),
        supplierName: supplierName || "-",
        approveAction: requestType === "RETURN" ? "supplier_return_approve" : "supplier_po_approve",
        rejectAction: requestType === "RETURN" ? "supplier_return_reject" : "supplier_po_reject"
      })
    ]);

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests/:id/respond", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const id = Number(req.params.id);
    const approved = Boolean(req.body.approved);
    const nextStatus = approved ? "APPROVED" : "REJECTED";
    const [[request]] = await pool.query(
      `
        SELECT sr.id
        FROM supplier_requests sr
        INNER JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sr.id = ?
          AND (sr.store_id = ? OR sr.store_id IS NULL)
        LIMIT 1
      `,
      [storeId, id, storeId]
    );
    if (!request) {
      throw createError("找不到供應商請求", 404);
    }

    await pool.query(
      `
        UPDATE supplier_requests
        SET status = ?,
            supplier_response_note = ?,
            supplier_responded_at = NOW()
        WHERE id = ?
          AND (store_id = ? OR store_id IS NULL)
      `,
      [nextStatus, req.body.note || null, id, storeId]
    );

    await logWorkflowEvent("supplier_request_responded", "SUPPLIER_REQUEST", id, { approved }, req.user.id);
    return res.json({ status: nextStatus, statusLabel: mapSupplierRequestStatusLabel(nextStatus) });
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests/:id/receive", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const id = Number(req.params.id);
    const receivedItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (receivedItems.length === 0) {
      throw createError("請提供入庫品項", 400);
    }

    const result = await withTransaction(async (connection) => {
      for (const item of receivedItems) {
        const itemId = Number(item.itemId);
        const receivedQuantity = Number(item.receivedQuantity);
        if (!itemId || !Number.isInteger(receivedQuantity) || receivedQuantity <= 0) {
          throw createError("入庫品項與數量不正確", 400);
        }

        const [rows] = await connection.query(
          `
            SELECT sri.product_id AS productId, sri.quantity, sri.received_quantity AS receivedQuantity
            FROM supplier_request_items sri
            INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
            WHERE sri.id = ? AND sri.supplier_request_id = ?
            FOR UPDATE
          `,
          [storeId, itemId, id]
        );
        const requestItem = rows[0];
        if (!requestItem) {
          throw createError("找不到入庫品項", 404);
        }
        const nextReceived = Math.min(Number(requestItem.receivedQuantity || 0) + receivedQuantity, Number(requestItem.quantity));
        const delta = nextReceived - Number(requestItem.receivedQuantity || 0);
        if (delta <= 0) {
          continue;
        }

        await connection.query("UPDATE supplier_request_items SET received_quantity = ? WHERE id = ?", [nextReceived, itemId]);
        await connection.query("UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?", [delta, requestItem.productId, storeId]);
        console.log('[INVENTORY_RECEIVE]', {
          requestId: id,
          itemId,
          productId: requestItem.productId,
          delta
        });

        await connection.query(
          `
            INSERT INTO inventory_movements (
              store_id,
              product_id,
              movement_type,
              quantity,
              reference_type,
              reference_id,
              created_by,
              notes
            )
            VALUES (?, ?, 'RESTOCK', ?, 'SUPPLIER_REQUEST', ?, ?, ?)
          `,
          [
            storeId,
            requestItem.productId,
            delta,
            id,
            req.user.id,
            `Supplier receive #${id}`
          ]
        );

        console.log('[INVENTORY_RECEIVE_DONE]', {
          requestId: id,
          productId: requestItem.productId
        });
      }

      const [[summary]] = await connection.query(
        `
          SELECT
            SUM(received_quantity >= quantity) AS completedItems,
            COUNT(*) AS totalItems
          FROM supplier_request_items
          WHERE supplier_request_id = ?
        `,
        [id]
      );
      const status = Number(summary.completedItems || 0) === Number(summary.totalItems || 0) ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await connection.query(
          "UPDATE supplier_requests SET status = ? WHERE id = ? AND (store_id = ? OR store_id IS NULL)",
          [status, id, storeId]
        );
      await logWorkflowEvent("supplier_request_received", "SUPPLIER_REQUEST", id, { status }, req.user.id, connection);
      return { status };
    });

    return res.json({ status: result.status, statusLabel: mapSupplierRequestStatusLabel(result.status) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
