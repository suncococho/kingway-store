const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { mapCategoryLabel } = require("../utils/displayLabels");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");
const {
  PRODUCT_CATEGORY_LABELS,
  deriveProductCategoryFromSku,
  normalizeProductCategory,
  normalizeProductSku
} = require("../utils/productCategories");

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
});

module.exports = router;
