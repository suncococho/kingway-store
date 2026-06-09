const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");

const router = express.Router();

function getRequestStoreId(req) {
  const rawStoreId = req.storeId || req.user?.store_id || req.user?.storeId || 1;
  const storeId = Number(rawStoreId);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 1;
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,38}[A-Z0-9]$/.test(code)) {
    const error = new Error("分類代碼需為 2-40 字元，可使用英數、底線或連字號");
    error.statusCode = 400;
    throw error;
  }
  return code;
}

function normalizeName(value) {
  const name = String(value || "").trim();
  if (!name) {
    const error = new Error("請輸入分類名稱");
    error.statusCode = 400;
    throw error;
  }
  if (name.length > 120) {
    const error = new Error("分類名稱過長");
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function mapCategoryRow(row) {
  return {
    id: Number(row.id),
    storeId: Number(row.store_id),
    code: row.code,
    name: row.name,
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
    productCount: Number(row.product_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getCategory(storeId, id) {
  const [rows] = await pool.query(
    `
      SELECT
        pc.*,
        COUNT(p.id) AS product_count
      FROM product_categories pc
      LEFT JOIN products p
        ON p.store_id = pc.store_id
       AND p.category_id = pc.id
      WHERE pc.store_id = ?
        AND pc.id = ?
      GROUP BY pc.id
      LIMIT 1
    `,
    [storeId, id]
  );
  return rows[0] || null;
}

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "INVENTORY"]));

router.get("/", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const onlyActive = String(req.query.active || "").trim() === "1";
    const where = ["pc.store_id = ?"];
    const params = [storeId];
    if (onlyActive) {
      where.push("pc.is_active = 1");
    }

    const [rows] = await pool.query(
      `
        SELECT
          pc.*,
          COUNT(p.id) AS product_count
        FROM product_categories pc
        LEFT JOIN products p
          ON p.store_id = pc.store_id
         AND p.category_id = pc.id
        WHERE ${where.join(" AND ")}
        GROUP BY pc.id
        ORDER BY pc.is_active DESC, pc.sort_order ASC, pc.id ASC
      `,
      params
    );

    return res.json(rows.map(mapCategoryRow));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const code = normalizeCode(req.body?.code);
    const name = normalizeName(req.body?.name);
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0;

    const [result] = await pool.query(
      `
        INSERT INTO product_categories (store_id, code, name, sort_order, is_active)
        VALUES (?, ?, ?, ?, 1)
      `,
      [storeId, code, name, sortOrder]
    );

    const category = await getCategory(storeId, result.insertId);
    return res.status(201).json(mapCategoryRow(category));
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內分類代碼或名稱已存在";
    }
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const id = Number(req.params.id);
    const current = await getCategory(storeId, id);
    if (!current) {
      return res.status(404).json({ message: "找不到分類" });
    }

    const updates = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "code")) {
      if (Number(current.product_count || 0) > 0) {
        return res.status(409).json({ message: "已有商品使用此分類，不能變更分類代碼" });
      }
      updates.push("code = ?");
      values.push(normalizeCode(req.body.code));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      updates.push("name = ?");
      values.push(normalizeName(req.body.name));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "sortOrder")) {
      updates.push("sort_order = ?");
      values.push(Number(req.body.sortOrder || 0));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
      updates.push("is_active = ?");
      values.push(req.body.isActive ? 1 : 0);
    }

    if (!updates.length) {
      return res.json(mapCategoryRow(current));
    }

    values.push(storeId, id);
    await pool.query(
      `
        UPDATE product_categories
        SET ${updates.join(", ")}
        WHERE store_id = ?
          AND id = ?
      `,
      values
    );

    const category = await getCategory(storeId, id);
    return res.json(mapCategoryRow(category));
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內分類代碼或名稱已存在";
    }
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const id = Number(req.params.id);
    const current = await getCategory(storeId, id);
    if (!current) {
      return res.status(404).json({ message: "找不到分類" });
    }

    await pool.query(
      `
        UPDATE product_categories
        SET is_active = 0
        WHERE store_id = ?
          AND id = ?
      `,
      [storeId, id]
    );

    const category = await getCategory(storeId, id);
    return res.json({
      ...mapCategoryRow(category),
      message: Number(current.product_count || 0) > 0 ? "分類已有商品使用，已停用但保留歷史資料" : "分類已停用"
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
