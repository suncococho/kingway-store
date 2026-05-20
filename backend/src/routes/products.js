const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../db");
const {  authorize } = require("../middleware/auth");
const { mapCategoryLabel } = require("../utils/displayLabels");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");
const {
  PRODUCT_CATEGORY_LABELS,
  buildProductSku,
  deriveProductCategoryFromSku,
  normalizeProductCategory,
  normalizeProductSku,
  parseProductSku
} = require("../utils/productCategories");

const router = express.Router();
const productsStorageDir = path.join(__dirname, "..", "..", "storage", "products");
const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

router.use((req, res, next) => next());

function normalizeImageUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return null;
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
  const category = PRODUCT_CATEGORY_LABELS[storedCategory] ? storedCategory : derivedCategory;
  return {
    ...row,
    imageUrl: normalizeImageUrl(row.imageUrl),
    category,
    categoryLabel: mapCategoryLabel(category)
  };
}

function getCategoryFromSku(sku, fallbackCategory = "OT") {
  const parsedCategory = deriveProductCategoryFromSku(sku);
  return PRODUCT_CATEGORY_LABELS[parsedCategory] ? parsedCategory : normalizeProductCategory(fallbackCategory);
}

async function getNextProductSku(connection, category, region = "C", shelf = "S1") {
  const normalizedCategory = PRODUCT_CATEGORY_LABELS[normalizeProductCategory(category)] ? normalizeProductCategory(category) : "OT";
  const normalizedRegion = normalizeProductSku(region) || "C";
  const normalizedShelf = normalizeProductSku(shelf) || "S1";
  const [rows] = await connection.query(
    `
      SELECT sku
      FROM products
      WHERE sku LIKE ?
    `,
    [`${normalizedRegion}-${normalizedCategory}-%`]
  );

  let maxSequence = 0;
  for (const row of rows) {
    const parsed = parseProductSku(row.sku);
    if (!parsed || parsed.region !== normalizedRegion || parsed.category !== normalizedCategory) {
      continue;
    }
    maxSequence = Math.max(maxSequence, Number(parsed.sequence || 0));
  }

  return buildProductSku({
    region: normalizedRegion,
    category: normalizedCategory,
    sequence: maxSequence + 1,
    shelf: normalizedShelf
  });
}

router.get("/", async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const productColumns = await getTableColumns(pool, "products");
    let sql = `
      SELECT
        ${selectColumn(productColumns, "products", "id", "id")},
        ${selectColumn(productColumns, "products", "sku", "sku")},
        ${selectColumn(productColumns, "products", "name", "name")},
        ${selectColumn(productColumns, "products", "category", "category", "'OTHER'")},
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
    `;
    const params = [];

    if (search) {
      const searchFields = ["sku", "name"].filter((column) => hasColumn(productColumns, column));
      if (searchFields.length) {
        sql += ` WHERE ${searchFields.map((column) => `${column} LIKE ?`).join(" OR ")} `;
        params.push(...searchFields.map(() => search));
      }
    }

    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows.map(mapProductRow));
  } catch (error) {
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
    const sku = await getNextProductSku(
      pool,
      req.query.category,
      req.query.region || "C",
      req.query.shelf || "S1"
    );
    return res.json({
      sku,
      category: deriveProductCategoryFromSku(sku),
      categoryLabel: mapCategoryLabel(deriveProductCategoryFromSku(sku))
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { sku, name, category, price, stock, reorderLevel, isActive, description, imageUrl, costPrice, location, inputterName, source } = req.body;

    if (!sku || !name || price === undefined || stock === undefined) {
      return res.status(400).json({ message: "SKU、商品名稱、售價與庫存為必填欄位" });
    }

    const normalizedSku = normalizeProductSku(sku);
    const resolvedCategory = getCategoryFromSku(normalizedSku, category);

    const [result] = await pool.query(
      `
        INSERT INTO products (sku, name, category, price, stock, reorder_level, is_active, description, image_url, cost_price, location, inputter_name, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        normalizedSku,
        name,
        resolvedCategory,
        price,
        stock,
        reorderLevel || 0,
        isActive === undefined ? 1 : Number(Boolean(isActive)),
        description || null,
        imageUrl || null,
        costPrice === undefined ? 0 : Number(costPrice || 0),
        location || null,
        inputterName || null,
        source || null
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      sku: normalizedSku,
      name,
      category: resolvedCategory,
      categoryLabel: mapCategoryLabel(resolvedCategory),
      price,
      stock,
      reorderLevel: reorderLevel || 0,
      isActive: isActive === undefined ? true : Boolean(isActive),
      description: description || null,
      imageUrl: normalizeImageUrl(imageUrl),
      costPrice: costPrice === undefined ? 0 : Number(costPrice || 0),
      location: location || null,
      inputterName: inputterName || null,
      source: source || null
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "SKU 已存在";
    }
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { sku, name, category, price, stock, reorderLevel, isActive, description, imageUrl, costPrice, location, inputterName, source } = req.body;
    const normalizedSku = sku !== undefined && sku !== null && sku !== "" ? normalizeProductSku(sku) : null;
    const categoryFromSku = normalizedSku ? getCategoryFromSku(normalizedSku, category) : null;
    const resolvedCategory = categoryFromSku || (category ? normalizeProductCategory(category) : null);

    await pool.query(
      `
        UPDATE products
        SET
          sku = COALESCE(?, sku),
          name = COALESCE(?, name),
          category = COALESCE(?, category),
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
      `,
      [
        normalizedSku,
        name || null,
        resolvedCategory,
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
        id
      ]
    );

    const [rows] = await pool.query(
      `
        SELECT
          id,
          sku,
          name,
          category,
          description,
          image_url AS imageUrl,
          cost_price AS costPrice,
          location,
          price,
          stock,
          reorder_level AS reorderLevel,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM products
        WHERE id = ?
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "找不到商品" });
    }

    return res.json(mapProductRow(rows[0]));
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "SKU 已存在";
    }
    return next(error);
  }
});

module.exports = router;
