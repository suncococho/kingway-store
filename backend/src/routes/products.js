const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../db");
const ExcelJS = require("exceljs");
const config = require("../config");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { mapCategoryLabel } = require("../utils/displayLabels");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");
const {
  PRODUCT_CATEGORY_LABELS,
  deriveProductCategoryFromSku,
  normalizeProductCategoryCode,
  normalizeProductCategory,
  normalizeProductSku
} = require("../utils/productCategories");
const { recordPlatformAudit } = require("../services/platformAuditService");

const PRODUCT_IMPORT_COLUMNS = [
  "sku",
  "name",
  "categoryCode",
  "categoryName",
  "price",
  "costPrice",
  "stock",
  "reorderLevel",
  "isActive",
  "description",
  "location",
  "inputterName",
  "source"
];

const router = express.Router();
const productsStorageDir = path.join(__dirname, "..", "..", "storage", "products");
const localProductImagePrefixes = [
  "/files/products/",
  "files/products/",
  "storage/products/",
  "products/"
];

function getRequestStoreId(req) {
  const rawStoreId = req.storeId || req.user?.store_id || req.user?.storeId || 1;
  const storeId = Number(rawStoreId);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 1;
}

function isProductionEnvironment() {
  const nodeEnv = String(config.nodeEnv || "").trim().toLowerCase();
  const appEnv = String(config.appEnv || "").trim().toLowerCase();
  return nodeEnv === "production" || appEnv === "production" || nodeEnv.includes("production") || appEnv.includes("production");
}

function parseOverrideFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function getRequestActorEmail(req) {
  const candidates = [
    req?.platformAdmin?.email,
    req?.user?.username,
    req?.user?.displayName,
    req?.user?.email
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }
  if (req?.user?.id) {
    return `user:${req.user.id}`;
  }
  return "unknown-user";
}

async function recordProductImportApplyAudit(req, payload = {}) {
  const actorEmail = getRequestActorEmail(req);
  if (!actorEmail) {
    return { recorded: false, skipped: true };
  }

  const auditContext = {
    platformAdmin: {
      id: req?.platformAdmin?.id || req?.user?.id || null,
      email: actorEmail,
      role: req?.platformAdmin?.role || req?.user?.role || req?.user?.storeRole || "ADMIN",
      displayName: req?.platformAdmin?.displayName || req?.user?.displayName || actorEmail
    },
    get: (headerName) => (typeof req.get === "function" ? req.get(headerName) : ""),
    ip: req?.ip || null,
    socket: req?.socket || null
  };

  return recordPlatformAudit(auditContext, {
    action: "PRODUCT_IMPORT_APPLY",
    targetType: "product_import",
    targetId: Number(payload.storeId || 0) > 0 ? Number(payload.storeId) : null,
    before: payload.before || null,
    after: payload.after || null
  });
}

async function hasProductsStoreIdColumn(connection = pool) {
  const [rows] = await connection.query("SHOW COLUMNS FROM `products` LIKE 'store_id'");
  return rows.length > 0;
}

async function hasProductCategorySchema(connection = pool) {
  const [tables] = await connection.query("SHOW TABLES LIKE 'product_categories'");
  if (!tables.length) {
    return false;
  }
  const [columns] = await connection.query("SHOW COLUMNS FROM `products` LIKE 'category_id'");
  return columns.length > 0;
}

const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

router.use(authenticate, requireStoreScope(), authorize());
const requireStoreAdminRole = requireStoreRole(["owner", "admin"]);

function extractProductImageFileName(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return null;
  }
  for (const prefix of localProductImagePrefixes) {
    if (value.startsWith(prefix)) {
      const fileName = decodeURIComponent(value.slice(prefix.length));
      if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0") || fileName.includes("..")) {
        return null;
      }
      return fileName;
    }
  }
  return null;
}

function buildProductImageApiUrl(productId) {
  const normalizedProductId = Number(productId);
  if (!Number.isSafeInteger(normalizedProductId) || normalizedProductId <= 0) {
    return null;
  }
  return `/api/products/${normalizedProductId}/image`;
}

function normalizeEditableImagePath(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return null;
  }
  const localFileName = extractProductImageFileName(value);
  if (localFileName) {
    return `/files/products/${localFileName}`;
  }
  return value;
}

function normalizeImageUrl(imageUrl, productId = null) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return null;
  }
  const localFileName = extractProductImageFileName(value);
  if (localFileName) {
    return buildProductImageApiUrl(productId) || `/files/products/${localFileName}`;
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/") || value.startsWith("/files/")) {
    return value;
  }
  if (value.startsWith("files/")) {
    return `/${value}`;
  }
  if (value.startsWith("storage/products/")) {
    return `/files/products/${value.slice("storage/products/".length)}`;
  }
  if (value.startsWith("products/")) {
    return `/files/${value}`;
  }
  if (value.startsWith("wp-content/uploads/")) {
    return `https://kingway.tw/tainan/${value}`;
  }
  if (value.startsWith("/wp-content/uploads/")) {
    return `https://kingway.tw/tainan${value}`;
  }
  return value;
}

function mapProductRow(row) {
  const derivedCategory = deriveProductCategoryFromSku(row.sku || "");
  const storedCategory = normalizeProductCategory(row.category);
  const category = row.categoryCode || (PRODUCT_CATEGORY_LABELS[storedCategory] ? storedCategory : derivedCategory);
  return {
    ...row,
    categoryId: row.categoryId === undefined || row.categoryId === null ? null : Number(row.categoryId),
    categoryName: row.categoryName || null,
    categoryIsActive: row.categoryIsActive === undefined || row.categoryIsActive === null ? null : Boolean(row.categoryIsActive),
    imagePath: normalizeEditableImagePath(row.imageUrl),
    imageUrl: normalizeImageUrl(row.imageUrl, row.id),
    category,
    categoryLabel: row.categoryName || mapCategoryLabel(category)
  };
}

function normalizeExportBoolean(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" ? 1 : 0;
}

function resolveExportCategoryCode(row) {
  if (row.categoryCode) {
    return String(row.categoryCode).trim();
  }
  if (row.category) {
    return String(row.category).trim();
  }
  return deriveProductCategoryFromSku(row.sku || "");
}

function buildProductExportRows(rawRows) {
  return rawRows.map((row) => {
    const categoryCode = resolveExportCategoryCode(row);
    return {
      sku: row.sku || "",
      name: row.name || "",
      categoryCode: categoryCode || "",
      categoryName: row.categoryName || mapCategoryLabel(categoryCode) || "",
      price: Number(row.price || 0),
      costPrice: Number(row.costPrice || 0),
      stock: Number(row.stock || 0),
      reorderLevel: Number(row.reorderLevel || 0),
      isActive: normalizeExportBoolean(row.isActive),
      description: row.description || "",
      location: row.location || "",
      inputterName: row.inputterName || "",
      source: row.source || ""
    };
  });
}

function sanitizeWorksheetValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

function normalizeImportHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "");
}

function normalizeImportCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object") {
    if (value.text !== undefined) {
      return String(value.text).trim();
    }
    if (value.result !== undefined) {
      return value.result;
    }
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((segment) => normalizeImportCellValue(segment.text))
        .join("");
    }
    if (value.hyperlink) {
      return String(value.hyperlink);
    }
  }

  return String(value).trim();
}

function normalizeImportString(value) {
  const normalized = normalizeImportCellValue(value);
  return typeof normalized === "number" ? String(normalized) : normalized;
}

function parseImportNumber(value) {
  const normalized = normalizeImportString(value);
  if (!normalized) {
    return NaN;
  }
  const cleaned = normalized.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseImportBooleanAsNumber(value) {
  const normalized = normalizeImportString(value).trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  if (["1", "true", "yes", "是", "啟用", "on"].includes(normalized)) {
    return 1;
  }
  if (["0", "false", "no", "否", "停用", "off"].includes(normalized)) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readProductImportRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headerMap = new Map();
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, column) => {
    const normalized = normalizeImportHeader(normalizeImportString(cell.value));
    if (!normalized) {
      return;
    }

    if (["sku"].includes(normalized)) {
      headerMap.set(column, "sku");
    } else if (["name"].includes(normalized)) {
      headerMap.set(column, "name");
    } else if (["categorycode"].includes(normalized)) {
      headerMap.set(column, "categoryCode");
    } else if (["categoryname"].includes(normalized)) {
      headerMap.set(column, "categoryName");
    } else if (["price"].includes(normalized)) {
      headerMap.set(column, "price");
    } else if (["costprice"].includes(normalized)) {
      headerMap.set(column, "costPrice");
    } else if (["stock"].includes(normalized)) {
      headerMap.set(column, "stock");
    } else if (["reorderlevel"].includes(normalized)) {
      headerMap.set(column, "reorderLevel");
    } else if (["isactive", "active"].includes(normalized)) {
      headerMap.set(column, "isActive");
    } else if (["description"].includes(normalized)) {
      headerMap.set(column, "description");
    } else if (["location"].includes(normalized)) {
      headerMap.set(column, "location");
    } else if (["inputtername"].includes(normalized)) {
      headerMap.set(column, "inputterName");
    } else if (["source"].includes(normalized)) {
      headerMap.set(column, "source");
    }
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rowData = {};
    for (const [column, field] of headerMap.entries()) {
      rowData[field] = normalizeImportString(row.getCell(column).value);
    }

    const hasAnyValue = Object.values(rowData).some((value) => String(value || "").trim() !== "");
    if (!hasAnyValue) {
      continue;
    }

    rows.push({
      rowNumber,
      data: rowData
    });
  }

  return rows;
}

function normalizeImportError(result, row, sku, message, name = "") {
  result.skipCount += 1;
  result.errors.push({ row, sku, message });
  const payload = {
    row,
    sku,
    name,
    action: "skip",
    message
  };
  result.preview.push(payload);
}

async function analyzeProductImportRows(storeId, buffer) {
  const importRows = await readProductImportRows(buffer);

  const [categoryTableRows] = await pool.query("SHOW TABLES LIKE 'product_categories'");
  const [activeCategories] = categoryTableRows.length
    ? await pool.query(
        `
          SELECT id, code, name
          FROM product_categories
          WHERE store_id = ?
            AND is_active = 1
          ORDER BY sort_order ASC, id ASC
        `,
        [storeId]
      )
    : [[]];

  const categoryByCode = new Map();
  const categoryByName = new Map();
  for (const category of activeCategories) {
    const code = normalizeProductCategoryCode(category.code || "");
    if (code) {
      const payload = {
        id: Number(category.id),
        code,
        name: String(category.name || "")
      };
      categoryByCode.set(code, payload);
      if (payload.name) {
        categoryByName.set(payload.name.toLowerCase(), payload);
      }
    }
  }

  const [storeProducts] = await pool.query(
    "SELECT sku FROM products WHERE store_id = ?",
    [storeId]
  );
  const existingSkuSet = new Set((storeProducts || []).map((product) => String(product.sku || "").trim().toUpperCase()));

  const result = {
    ok: true,
    totalRows: 0,
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errors: [],
    rows: [],
    preview: []
  };

  const seenSkuSet = new Set();

  for (const { rowNumber, data } of importRows) {
    result.totalRows += 1;

    const sku = normalizeProductSku(data.sku || "");
    const name = String(data.name || "").trim();
    const categoryCode = normalizeProductCategoryCode(data.categoryCode || "");
    const categoryName = String(data.categoryName || "").trim();
    const price = parseImportNumber(data.price);
    const stock = parseImportNumber(data.stock);
    const reorderLevel = parseImportNumber(data.reorderLevel);
    const isActive = parseImportBooleanAsNumber(data.isActive);
    const costPrice = Number.isFinite(parseImportNumber(data.costPrice)) ? parseImportNumber(data.costPrice) : 0;
    const categoryByCodeMatch = categoryCode ? categoryByCode.get(categoryCode) : null;
    const categoryByNameMatch = categoryName ? categoryByName.get(categoryName.toLowerCase()) : null;

    if (!sku) {
      normalizeImportError(result, rowNumber, data.sku || "", "sku 欄位為必填", String(data.sku || "").trim());
      continue;
    }

    if (!name) {
      normalizeImportError(result, rowNumber, sku, "name 欄位為必填");
      continue;
    }

    if (Number.isNaN(price)) {
      normalizeImportError(result, rowNumber, sku, "price 欄位必須是數字", name);
      continue;
    }

    if (Number.isNaN(stock)) {
      normalizeImportError(result, rowNumber, sku, "stock 欄位必須是數字", name);
      continue;
    }

    if (Number.isNaN(reorderLevel)) {
      normalizeImportError(result, rowNumber, sku, "reorderLevel 欄位必須是數字", name);
      continue;
    }

    if (!categoryCode && !categoryName) {
      normalizeImportError(result, rowNumber, sku, "請填寫 categoryCode 或 categoryName", name);
      continue;
    }

    if (!categoryByCodeMatch && !categoryByNameMatch) {
      normalizeImportError(result, rowNumber, sku, "找不到門市商品分類", name);
      continue;
    }

    if (seenSkuSet.has(sku)) {
      normalizeImportError(result, rowNumber, sku, "同一檔案內 SKU 重複", name);
      continue;
    }
    seenSkuSet.add(sku);

    const resolvedCategory = categoryByCodeMatch || categoryByNameMatch;
    const rowPayload = {
      row: rowNumber,
      sku,
      name,
      action: existingSkuSet.has(sku) ? "update" : "create",
      message: existingSkuSet.has(sku) ? "更新予定" : "新增予定",
      price,
      stock,
      reorderLevel,
      isActive,
      costPrice,
      categoryId: Number.isFinite(Number(resolvedCategory?.id)) ? Number(resolvedCategory.id) : null,
      categoryCode: resolvedCategory?.code || categoryCode || "",
      categoryName: resolvedCategory?.name || categoryName || "",
      description: String(data.description || "").trim() || null,
      location: String(data.location || "").trim() || null,
      inputterName: String(data.inputterName || "").trim() || null,
      source: String(data.source || "").trim() || null
    };

    result.rows.push(rowPayload);

    if (rowPayload.action === "update") {
      result.updateCount += 1;
    } else {
      result.createCount += 1;
    }

    result.preview.push({
      row: rowPayload.row,
      sku: rowPayload.sku,
      name: rowPayload.name,
      action: rowPayload.action,
      message: rowPayload.message
    });
  }

  result.ok = result.errors.length === 0;
  result.preview = result.preview.slice(0, 20);
  return result;
}

async function runProductImportDryRun(storeId, buffer) {
  const result = await analyzeProductImportRows(storeId, buffer);
  return {
    ok: result.ok,
    dryRun: true,
    totalRows: result.totalRows,
    createCount: result.createCount,
    updateCount: result.updateCount,
    skipCount: result.skipCount,
    createdCount: result.createCount,
    updatedCount: result.updateCount,
    skippedCount: result.skipCount,
    errors: result.errors,
    rows: result.rows,
    preview: result.preview
  };
}

async function runProductImportApply(storeId, buffer, req) {
  const result = await analyzeProductImportRows(storeId, buffer);
  const base = {
    dryRun: false,
    totalRows: result.totalRows,
    createCount: result.createCount,
    updateCount: result.updateCount,
    skipCount: result.skipCount,
    createdCount: result.createCount,
    updatedCount: result.updateCount,
    skippedCount: result.skipCount,
    errors: result.errors,
    preview: result.preview,
    appliedRows: []
  };

  if (!result.ok) {
    return {
      ok: false,
      ...base
    };
  }

  const connection = await pool.getConnection();
  try {
    const hasCategorySchema = await hasProductCategorySchema(connection);
    await connection.beginTransaction();

    let createdCount = 0;
    let updatedCount = 0;
    const appliedRows = [];

    for (const row of result.rows) {
      const [currentRows] = await connection.query(
        `
          SELECT id
          FROM products
          WHERE sku = ?
            AND store_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [row.sku, storeId]
      );
      const current = currentRows[0];

      if (current?.id) {
        const categoryValue = row.categoryCode || getCategoryFromSku(row.sku, "OT");
        const sqlParts = [
          "sku = ?",
          "name = ?",
          "category = ?",
          "price = ?",
          "stock = ?",
          "reorder_level = ?",
          "is_active = ?",
          "description = ?",
          "cost_price = ?",
          "location = ?",
          "inputter_name = ?",
          "source = ?"
        ];
        const params = [
          row.sku,
          row.name,
          categoryValue,
          Number(row.price),
          Number(row.stock),
          Number(row.reorderLevel),
          row.isActive,
          row.description,
          row.costPrice,
          row.location,
          row.inputterName,
          row.source
        ];

        if (hasCategorySchema) {
          sqlParts.splice(3, 0, "category_id = ?");
          params.splice(3, 0, row.categoryId ?? null);
        }

        const [updateResult] = await connection.query(
          `
            UPDATE products
            SET ${sqlParts.join(", ")}
            WHERE id = ?
              AND store_id = ?
          `,
          [...params, current.id, storeId]
        );

        if (updateResult.affectedRows !== 1) {
          const error = new Error("套用時更新商品失敗");
          error.statusCode = 409;
          throw error;
        }

        updatedCount += 1;
        appliedRows.push({
          row: row.row,
          sku: row.sku,
          name: row.name,
          action: "update",
          status: "applied",
          productId: current.id
        });
        continue;
      }

      const insertColumns = ["sku", "name", "category", "price", "stock", "reorder_level", "is_active", "description", "image_url", "cost_price", "location", "inputter_name", "source", "store_id"];
      const insertValues = [
        row.sku,
        row.name,
        row.categoryCode || getCategoryFromSku(row.sku, "OT"),
        Number(row.price),
        Number(row.stock),
        Number(row.reorderLevel),
        row.isActive,
        row.description,
        null,
        row.costPrice,
        row.location,
        row.inputterName,
        row.source,
        storeId
      ];
      const columns = [...insertColumns];
      const values = [...insertValues];

      if (hasCategorySchema) {
        columns.splice(3, 0, "category_id");
        values.splice(3, 0, row.categoryId ?? null);
      }

      const [insertResult] = await connection.query(
        `
          INSERT INTO products (${columns.join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})
        `,
        values
      );

      createdCount += 1;
      appliedRows.push({
        row: row.row,
        sku: row.sku,
        name: row.name,
        action: "create",
        status: "applied",
        productId: insertResult.insertId
      });
    }

    await connection.commit();
    let auditRecorded = false;
    try {
      const auditResult = await recordProductImportApplyAudit(req, {
        storeId,
        before: {
          source: "dryRunSummary",
          totalRows: result.totalRows,
          createCount: result.createCount,
          updateCount: result.updateCount,
          skipCount: result.skipCount,
          errors: result.errors.length
        },
        after: {
          totalRows: result.totalRows,
          createCount: createdCount,
          updateCount: updatedCount,
          skipCount: result.skipCount,
          successCount: createdCount + updatedCount
        }
      });
      auditRecorded = !!auditResult.recorded;
    } catch (auditError) {
      console.warn("[products/import] audit record failed", { error: auditError.message, storeId });
    }

    return {
      ok: true,
      auditRecorded,
      ...base,
      createCount: createdCount,
      updateCount: updatedCount,
      createdCount,
      updatedCount,
      appliedRows
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // ignore rollback error
    }

    if (error?.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內 SKU 已存在";
    }

    return {
      ok: false,
      ...base,
      errors: [...base.errors, { row: "", sku: "", message: error.message || "套用失敗" }]
    };
  } finally {
    connection.release();
  }
}

function getCategoryFromSku(sku, fallbackCategory = "OT") {
  const parsedCategory = deriveProductCategoryFromSku(sku);
  return PRODUCT_CATEGORY_LABELS[parsedCategory] ? parsedCategory : normalizeProductCategory(fallbackCategory);
}

async function resolveProductCategory(connection, storeId, categoryId, fallbackCategory = "OT", requireActive = true) {
  if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
    const [rows] = await connection.query(
      `
        SELECT id, code, name, is_active AS isActive
        FROM product_categories
        WHERE store_id = ?
          AND id = ?
        LIMIT 1
      `,
      [storeId, Number(categoryId)]
    );
    const category = rows[0];
    if (!category || (requireActive && !category.isActive)) {
      const error = new Error("找不到可用分類");
      error.statusCode = 404;
      throw error;
    }
    return {
      categoryId: Number(category.id),
      categoryCode: String(category.code || "").trim().toUpperCase(),
      categoryName: category.name
    };
  }

  const categoryCode = normalizeProductCategory(fallbackCategory);
  const [rows] = await connection.query(
    `
      SELECT id, code, name, is_active AS isActive
      FROM product_categories
      WHERE store_id = ?
        AND code = ?
      LIMIT 1
    `,
    [storeId, categoryCode]
  );

  if (rows[0] && (!requireActive || rows[0].isActive)) {
    return {
      categoryId: Number(rows[0].id),
      categoryCode: rows[0].code,
      categoryName: rows[0].name
    };
  }

  return {
    categoryId: null,
    categoryCode,
    categoryName: mapCategoryLabel(categoryCode)
  };
}

async function getNextProductSku(connection, storeId, category, region = "C", shelf = "S1") {
  const normalizedCategory = normalizeProductSku(category || "OT").slice(0, 12) || "OT";
  const normalizedRegion = normalizeProductSku(region) || "C";
  const normalizedShelf = normalizeProductSku(shelf) || "S1";
  const hasStoreId = await hasProductsStoreIdColumn(connection);
  if (!hasStoreId) {
    throw new Error("products.store_id 欄位不存在，無法生成 SKU");
  }

  const [rows] = await connection.query(
    `
      SELECT sku
      FROM products
      WHERE sku LIKE ?
        AND store_id = ?
    `,
    [`${normalizedRegion}-${normalizedCategory}-%`, storeId]
  );

  let maxSequence = 0;
  for (const row of rows) {
    const parts = normalizeProductSku(row.sku).split("-");
    if (parts.length < 4 || parts[0] !== normalizedRegion || parts[1] !== normalizedCategory || !/^\d{3}$/.test(parts[2])) {
      continue;
    }
    maxSequence = Math.max(maxSequence, Number(parts[2] || 0));
  }

  const sequence = String(maxSequence + 1).padStart(3, "0").slice(-3);
  return `${normalizedRegion}-${normalizedCategory}-${sequence}-${normalizedShelf}`;
}

async function assertSkuAvailableInStore(connection, sku, storeId, excludeProductId = null) {
  const params = [normalizeProductSku(sku), storeId];
  let sql = `
    SELECT id
    FROM products
    WHERE sku = ?
      AND store_id = ?
  `;

  if (excludeProductId) {
    sql += " AND id <> ?";
    params.push(excludeProductId);
  }

  sql += " LIMIT 1";
  const [rows] = await connection.query(sql, params);
  if (rows[0]) {
    const error = new Error("同一門市內 SKU 已存在");
    error.statusCode = 409;
    throw error;
  }
}

router.get("/", async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const productColumns = await getTableColumns(pool, "products");
    const hasStoreId = await hasProductsStoreIdColumn(pool);
    const hasCategorySchema = await hasProductCategorySchema(pool);
    if (!hasStoreId) {
      return res.status(500).json({ message: "products.store_id 欄位不存在，請先更新資料表結構" });
    }

    // PRODUCTS_STORE_ID_FILTER_V1
    const storeId = getRequestStoreId(req);
    let sql = `
      SELECT
        ${selectColumn(productColumns, "products", "id", "id")},
        ${selectColumn(productColumns, "products", "sku", "sku")},
        ${selectColumn(productColumns, "products", "name", "name")},
        ${selectColumn(productColumns, "products", "category", "category", "'OTHER'")},
        ${hasCategorySchema ? "products.category_id AS categoryId," : "NULL AS categoryId,"}
        ${hasCategorySchema ? "pc.code AS categoryCode," : "NULL AS categoryCode,"}
        ${hasCategorySchema ? "pc.name AS categoryName," : "NULL AS categoryName,"}
        ${hasCategorySchema ? "pc.is_active AS categoryIsActive," : "NULL AS categoryIsActive,"}
        ${selectColumn(productColumns, "products", "description", "description")},
        ${selectColumn(productColumns, "products", "image_url", "imageUrl")},
        ${selectColumn(productColumns, "products", "cost_price", "costPrice", "0")},
        ${selectColumn(productColumns, "products", "location", "location")},
        ${selectColumn(productColumns, "products", "inputter_name", "inputterName")},
        ${selectColumn(productColumns, "products", "source", "source")},
        ${selectColumn(productColumns, "products", "price", "price", "0")},
        ${selectColumn(productColumns, "products", "stock", "stock", "0")},
        ${selectColumn(productColumns, "products", "reorder_level", "reorderLevel", "0")},
        ${selectColumn(productColumns, "products", "is_active", "isActive", "1")},
        ${selectColumn(productColumns, "products", "created_at", "createdAt")},
        ${selectColumn(productColumns, "products", "updated_at", "updatedAt")}
      FROM products
      ${hasCategorySchema ? "LEFT JOIN product_categories pc ON pc.id = products.category_id AND pc.store_id = products.store_id" : ""}
    `;
    const params = [];
    const whereClauses = [];

    whereClauses.push("products.store_id = ?");
    params.push(storeId);

    if (search) {
      const searchFields = ["sku", "name"].filter((column) => hasColumn(productColumns, column));
      if (searchFields.length) {
        whereClauses.push(`(${searchFields.map((column) => `products.${column} LIKE ?`).join(" OR ")})`);
        params.push(...searchFields.map(() => search));
      }
    }

    if (whereClauses.length) {
      sql += ` WHERE ${whereClauses.join(" AND ")} `;
    }

    sql += " ORDER BY products.id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows.map(mapProductRow));
  } catch (error) {
    return next(error);
  }
});

router.get("/export", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const productColumns = await getTableColumns(pool, "products");
    const hasCategorySchema = await hasProductCategorySchema(pool);

    const [rows] = await pool.query(
      `
        SELECT
          ${selectColumn(productColumns, "products", "sku", "sku")},
          ${selectColumn(productColumns, "products", "name", "name")},
          ${hasCategorySchema ? "pc.code AS categoryCode," : `${selectColumn(productColumns, "products", "category", "category", "'OT'")} AS categoryCode,`}
          ${hasCategorySchema ? "pc.name AS categoryName," : "NULL AS categoryName,"}
          ${selectColumn(productColumns, "products", "price", "price", "0")},
          ${selectColumn(productColumns, "products", "cost_price", "costPrice", "0")},
          ${selectColumn(productColumns, "products", "stock", "stock", "0")},
          ${selectColumn(productColumns, "products", "reorder_level", "reorderLevel", "0")},
          ${selectColumn(productColumns, "products", "is_active", "isActive", "1")},
          ${selectColumn(productColumns, "products", "description", "description")},
          ${selectColumn(productColumns, "products", "location", "location")},
          ${selectColumn(productColumns, "products", "inputter_name", "inputterName")},
          ${selectColumn(productColumns, "products", "source", "source")}
        FROM products
        ${hasCategorySchema ? "LEFT JOIN product_categories pc ON pc.id = products.category_id AND pc.store_id = products.store_id" : ""}
        WHERE products.store_id = ?
        ORDER BY products.id DESC
      `,
      [storeId]
    );

    const exportRows = buildProductExportRows(rows);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KINGWAY";
    const sheet = workbook.addWorksheet("商品資料");
    sheet.columns = [
      { header: "sku", key: "sku", width: 20 },
      { header: "name", key: "name", width: 30 },
      { header: "categoryCode", key: "categoryCode", width: 16 },
      { header: "categoryName", key: "categoryName", width: 22 },
      { header: "price", key: "price", width: 12 },
      { header: "costPrice", key: "costPrice", width: 14 },
      { header: "stock", key: "stock", width: 10 },
      { header: "reorderLevel", key: "reorderLevel", width: 14 },
      { header: "isActive", key: "isActive", width: 12 },
      { header: "description", key: "description", width: 36 },
      { header: "location", key: "location", width: 16 },
      { header: "inputterName", key: "inputterName", width: 18 },
      { header: "source", key: "source", width: 16 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(exportRows);

    const numberColumns = ["price", "costPrice", "stock", "reorderLevel", "isActive"];
    for (const key of numberColumns) {
      sheet.getColumn(key).numFmt = "#,##0";
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `KINGWAY_product_export_store_${storeId}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.get("/import-template", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const [categoryTableRows] = await pool.query("SHOW TABLES LIKE 'product_categories'");
    const [categoryRows] = categoryTableRows.length
      ? await pool.query(
          `
            SELECT code, name
            FROM product_categories
            WHERE store_id = ?
              AND is_active = 1
            ORDER BY sort_order ASC, id ASC
          `,
          [storeId]
        )
      : [[]];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KINGWAY";

    const resolveTemplateCategoryCode = (searchCode, fallbackCode = "OT") => {
      const normalizedSearchCode = String(searchCode || "").trim().toLowerCase();
      if (!normalizedSearchCode) {
        return fallbackCode;
      }
      const exactCodeMatch = categoryRows.find((row) => String(row.code || "").trim().toLowerCase() === normalizedSearchCode);
      if (exactCodeMatch?.code) {
        return String(exactCodeMatch.code).trim();
      }
      const nameMatch = categoryRows.find((row) => String(row.name || "")
        .trim()
        .toLowerCase()
        .includes(normalizedSearchCode)
      );
      return nameMatch?.code ? String(nameMatch.code).trim() : fallbackCode;
    };

    const templateCodeHint = String(categoryRows[0]?.code || "OT").trim() || "OT";
    const sheet = workbook.addWorksheet("商品匯入範本");
    sheet.columns = [
      { header: "sku", key: "sku", width: 20 },
      { header: "name", key: "name", width: 30 },
      { header: "categoryCode", key: "categoryCode", width: 16 },
      { header: "price", key: "price", width: 12 },
      { header: "stock", key: "stock", width: 10 },
      { header: "description", key: "description", width: 36 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(2).values = {
      sku: "商品編號（必填）",
      name: "商品名稱（必填）",
      categoryCode: "分類代碼（請參考分類表）",
      price: "售價（數字）",
      stock: "庫存數量（數字）",
      description: "備註（選填）"
    };
    sheet.getRow(2).font = { italic: true };
    sheet.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
    for (const column of ["A", "B", "C", "D", "E", "F"]) {
      sheet.getCell(`${column}2`).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    }
    sheet.addRows([
      {
        sku: "C-EB-001-S1",
        name: "CityRun 電動自行車",
        categoryCode: resolveTemplateCategoryCode("EB", templateCodeHint),
        price: 25800,
        stock: 12,
        description: "示例：電動自行車主款，可直接上架"
      },
      {
        sku: "A-AC-002-S1",
        name: "變速組件維修配件",
        categoryCode: resolveTemplateCategoryCode("配件", templateCodeHint),
        price: 1250,
        stock: 30,
        description: "示例：配件類商品，建議啟用快速補貨管理"
      },
      {
        sku: "T-TI-003-S1",
        name: "公路輪胎 700x32",
        categoryCode: resolveTemplateCategoryCode("輪胎", templateCodeHint),
        price: 980,
        stock: 18,
        description: "示例：耗材類，請維持庫存更新"
      }
    ]);

    const categorySheet = workbook.addWorksheet("門市分類清單");
    categorySheet.columns = [
      { header: "categoryCode", key: "categoryCode", width: 16 },
      { header: "categoryName", key: "categoryName", width: 24 }
    ];
    categorySheet.getRow(1).font = { bold: true };
    categorySheet.mergeCells("A2:B2");
    categorySheet.getCell("A2").value = "請勿自行新增分類";
    categorySheet.getCell("A2").font = { italic: true };
    categorySheet.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
    for (const category of categoryRows) {
      categorySheet.addRow({
        categoryCode: sanitizeWorksheetValue(category.code),
        categoryName: sanitizeWorksheetValue(category.name)
      });
    }

    const helpSheet = workbook.addWorksheet("匯入說明");
    helpSheet.columns = [
      { header: "項目", key: "item", width: 22 },
      { header: "內容", key: "content", width: 86 }
    ];
    helpSheet.getRow(1).font = { bold: true };
    helpSheet.addRows([
      { item: "使用步驟", content: "1. 下載範本後，請先依欄位格式填寫資料。\n2. 欄位順序請勿任意調整，請保留第 1 列是欄位名稱。\n3. 儲存為 .xlsx 再回到商品管理頁上傳。\n4. 上傳後先用預覽確認資料無誤再執行套用。" },
      { item: "必填欄位", content: "sku（商品編號）、name（商品名稱）、categoryCode（分類代碼）、price（售價）、stock（庫存數量）為必填。" },
      { item: "常見錯誤", content: "常見欄位錯誤包含：售價/庫存非數字、欄位名稱拼字錯誤、欄位位移或刪除。\n遇到錯誤會在預覽中顯示失敗列與原因。" },
      { item: "SKU 重複說明", content: "同一檔案內若有重複 SKU，第二筆會被視為錯誤並略過。\n請先修正後再重新預覽上傳。" },
      { item: "分類錯誤說明", content: "請使用「門市分類清單」中的 categoryCode，不可使用不存在的代碼。\n若分類代碼不在清單中，該列會被略過。分類名稱欄位不建議直接輸入到範本。" }
    ]);
    helpSheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    helpSheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
    for (let rowNumber = 2; rowNumber <= helpSheet.rowCount; rowNumber += 1) {
      helpSheet.getRow(rowNumber).getCell("B").alignment = { wrapText: true, vertical: "top" };
      helpSheet.getRow(rowNumber).height = 38;
    }

    for (const column of ["A", "B"]) {
      helpSheet.getColumn(column).alignment = { vertical: "middle", horizontal: "left" };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `KINGWAY_product_import_template_store_${storeId}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    sheet.getColumn("D").numFmt = "#,##0";
    sheet.getColumn("E").numFmt = "#,##0";
    res.send(buffer);
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
      const rawDryRun = String(req.query.dryRun || "").toLowerCase();
      const rawApply = String(req.query.apply || "").toLowerCase();
      const rawAdminOverride = String(req.query.adminOverride || "").toLowerCase();
      const adminOverride = parseOverrideFlag(rawAdminOverride);

      if (rawDryRun && !["true", "false"].includes(rawDryRun)) {
        return res.status(400).json({ message: "dryRun 參數僅支援 true 或 false" });
      }
      if (rawApply && rawApply !== "true") {
        return res.status(400).json({ message: "apply 參數僅支援 true" });
      }

      const isApply = rawApply === "true" || rawDryRun === "false";
      if (isApply && rawAdminOverride && adminOverride === null) {
        return res.status(400).json({ message: "adminOverride 參數僅支援 true 或 false" });
      }

      if (isApply && isProductionEnvironment() && !config.productImportApplyEnabled && !adminOverride) {
        return res.status(403).json({ message: "目前尚未開放正式匯入功能" });
      }

      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: "請上傳 XLSX 檔案內容" });
      }

      const storeId = getRequestStoreId(req);
      const result = isApply
        ? await runProductImportApply(storeId, req.body, req)
        : await runProductImportDryRun(storeId, req.body);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/:id/image", async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const storeId = getRequestStoreId(req);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(404).json({ message: "找不到商品圖片" });
    }

    const [rows] = await pool.query(
      `
        SELECT id, image_url AS imageUrl
        FROM products
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [productId, storeId]
    );

    const product = rows[0];
    if (!product) {
      return res.status(404).json({ message: "找不到商品" });
    }

    const fileName = extractProductImageFileName(product.imageUrl);
    if (!fileName) {
      return res.status(404).json({ message: "找不到商品圖片" });
    }

    const absolutePath = path.join(productsStorageDir, fileName);
    if (path.basename(absolutePath) !== fileName) {
      return res.status(404).json({ message: "找不到商品圖片" });
    }

    await fs.promises.access(absolutePath, fs.constants.R_OK);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.sendFile(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "找不到商品圖片" });
    }
    return next(error);
  }
});

router.post(
  "/images",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "8mb" }),
  async (req, res, next) => {
    try {
      const contentType = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
      const extension = allowedImageTypes.get(contentType);

      if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ message: "請上傳 JPG、PNG、WEBP 或 GIF 圖片" });
      }

      await fs.promises.mkdir(productsStorageDir, { recursive: true });

      const originalName = String(req.headers["x-file-name"] || "product")
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);

      const safeName = originalName || "product";
      const safeBaseName = safeName.toLowerCase().endsWith(extension)
        ? safeName.slice(0, -extension.length)
        : safeName;

      const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeBaseName}${extension}`;
      const filePath = path.join(productsStorageDir, fileName);

      await fs.promises.writeFile(filePath, req.body);

      return res.status(201).json({ imageUrl: `/files/products/${fileName}` });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/next-sku", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    let categoryCode = req.query.category;
    if (await hasProductCategorySchema(pool)) {
      const resolvedCategory = await resolveProductCategory(pool, storeId, req.query.categoryId, req.query.category || "OT", false);
      categoryCode = resolvedCategory.categoryCode;
    }
    const sku = await getNextProductSku(
      pool,
      storeId,
      categoryCode,
      req.query.region || "C",
      req.query.shelf || "S1"
    );
    return res.json({
      sku,
      category: categoryCode,
      categoryLabel: mapCategoryLabel(categoryCode)
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const hasStoreId = await hasProductsStoreIdColumn(pool);
    if (!hasStoreId) {
      return res.status(500).json({ message: "products.store_id 欄位不存在，請先更新資料表結構" });
    }

    const { sku, name, category, categoryId, price, stock, reorderLevel, isActive, description, imageUrl, costPrice, location, inputterName, source } = req.body;

    if (!sku || !name || price === undefined || stock === undefined) {
      return res.status(400).json({ message: "SKU、商品名稱、售價與庫存為必填欄位" });
    }

    const productColumns = await getTableColumns(pool, "products");
    const storeId = getRequestStoreId(req);
    const hasCategorySchema = await hasProductCategorySchema(pool);

    const normalizedSku = normalizeProductSku(sku);
    const resolvedProductCategory = hasCategorySchema
      ? await resolveProductCategory(pool, storeId, categoryId, category || getCategoryFromSku(normalizedSku, "OT"))
      : { categoryId: null, categoryCode: getCategoryFromSku(normalizedSku, category) };
    const resolvedCategory = normalizeProductCategory(resolvedProductCategory.categoryCode);
    await assertSkuAvailableInStore(pool, normalizedSku, storeId);

    const insertColumns = ["sku", "name", "category"];
    const insertValues = [normalizedSku, name, resolvedCategory];
    if (hasCategorySchema) {
      insertColumns.push("category_id");
      insertValues.push(resolvedProductCategory.categoryId);
    }
    insertColumns.push("price", "stock", "reorder_level", "is_active", "description", "image_url", "cost_price", "location", "inputter_name", "source", "store_id");
    insertValues.push(
      price,
      stock,
      reorderLevel || 0,
      isActive === undefined ? 1 : Number(Boolean(isActive)),
      description || null,
      imageUrl || null,
      costPrice === undefined ? 0 : Number(costPrice || 0),
      location || null,
      inputterName || null,
      source || null,
      hasColumn(productColumns, "store_id") ? storeId : null
    );

    const [result] = await pool.query(
      `
        INSERT INTO products (${insertColumns.join(", ")})
        VALUES (${insertColumns.map(() => "?").join(", ")})
      `,
      insertValues
    );

    return res.status(201).json({
      id: result.insertId,
      sku: normalizedSku,
      name,
      category: resolvedCategory,
      categoryId: resolvedProductCategory.categoryId,
      categoryName: resolvedProductCategory.categoryName || null,
      categoryLabel: resolvedProductCategory.categoryName || mapCategoryLabel(resolvedCategory),
      price,
      stock,
      reorderLevel: reorderLevel || 0,
      isActive: isActive === undefined ? true : Boolean(isActive),
      description: description || null,
      imagePath: normalizeEditableImagePath(imageUrl),
      imageUrl: normalizeImageUrl(imageUrl, result.insertId),
      costPrice: costPrice === undefined ? 0 : Number(costPrice || 0),
      location: location || null,
      inputterName: inputterName || null,
      source: source || null
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內 SKU 已存在";
    }
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive") && !req.body.isActive) {
      return requireStoreAdminRole(req, res, () => updateProduct(req, res, next));
    }
    return updateProduct(req, res, next);
  } catch (error) {
    return next(error);
  }
});

async function updateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { sku, name, category, categoryId, price, stock, reorderLevel, isActive, description, imageUrl, costPrice, location, inputterName, source } = req.body;
    const normalizedSku = sku !== undefined && sku !== null && sku !== "" ? normalizeProductSku(sku) : null;

    const storeId = getRequestStoreId(req);
    const hasCategorySchema = await hasProductCategorySchema(pool);
    let resolvedProductCategory = null;
    const hasCategoryInput =
      Object.prototype.hasOwnProperty.call(req.body || {}, "categoryId") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "category");

    if (hasCategorySchema && hasCategoryInput) {
      resolvedProductCategory = await resolveProductCategory(
        pool,
        storeId,
        categoryId,
        category || (normalizedSku ? getCategoryFromSku(normalizedSku, "OT") : "OT")
      );
    }

    const categoryFromSku = normalizedSku && !resolvedProductCategory ? getCategoryFromSku(normalizedSku, category) : null;
    const resolvedCategory = resolvedProductCategory
      ? normalizeProductCategory(resolvedProductCategory.categoryCode)
      : categoryFromSku || (category ? normalizeProductCategory(category) : null);
    if (normalizedSku) {
      await assertSkuAvailableInStore(pool, normalizedSku, storeId, id);
    }

    const categoryIdAssignment = hasCategorySchema ? "category_id = COALESCE(?, category_id)," : "";
    const categoryIdValue = hasCategorySchema && resolvedProductCategory ? resolvedProductCategory.categoryId : null;
    await pool.query(
      `
        UPDATE products
        SET
          sku = COALESCE(?, sku),
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          ${categoryIdAssignment}
          price = COALESCE(?, price),
          stock = COALESCE(?, stock),
          reorder_level = COALESCE(?, reorder_level),
          is_active = COALESCE(?, is_active),
          description = COALESCE(?, description),
          image_url = COALESCE(?, image_url),
          cost_price = COALESCE(?, cost_price),
          location = COALESCE(?, location),
          inputter_name = COALESCE(?, inputter_name),
          source = COALESCE(?, source)
        WHERE id = ?
          AND store_id = ?
      `,
      [
        normalizedSku,
        name || null,
        resolvedCategory,
        ...(hasCategorySchema ? [categoryIdValue] : []),
        price === undefined ? null : price,
        stock === undefined ? null : stock,
        reorderLevel === undefined ? null : reorderLevel,
        isActive === undefined ? null : Number(Boolean(isActive)),
        description === undefined ? null : description,
        imageUrl === undefined ? null : imageUrl,
        costPrice === undefined ? null : Number(costPrice || 0),
        location === undefined ? null : location,
        inputterName === undefined ? null : inputterName,
        source === undefined ? null : source,
        id,
        storeId
      ]
    );

    const categoryJoin = hasCategorySchema
      ? "LEFT JOIN product_categories pc ON pc.id = products.category_id AND pc.store_id = products.store_id"
      : "";
    const [rows] = await pool.query(
      `
        SELECT
          products.id,
          products.sku,
          products.name,
          products.category,
          ${hasCategorySchema ? "products.category_id AS categoryId," : "NULL AS categoryId,"}
          ${hasCategorySchema ? "pc.code AS categoryCode," : "NULL AS categoryCode,"}
          ${hasCategorySchema ? "pc.name AS categoryName," : "NULL AS categoryName,"}
          ${hasCategorySchema ? "pc.is_active AS categoryIsActive," : "NULL AS categoryIsActive,"}
          products.description,
          products.image_url AS imageUrl,
          products.cost_price AS costPrice,
          products.location,
          products.price,
          products.stock,
          products.reorder_level AS reorderLevel,
          products.is_active AS isActive,
          products.created_at AS createdAt,
          products.updated_at AS updatedAt
        FROM products
        ${categoryJoin}
        WHERE products.id = ?
          AND products.store_id = ?
      `,
      [id, storeId]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "找不到商品" });
    }

    return res.json(mapProductRow(rows[0]));
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內 SKU 已存在";
    }
    return next(error);
  }
}

module.exports = router;
