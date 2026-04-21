const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER", "INVENTORY"]));

router.get("/", async (req, res, next) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    let sql = `
      SELECT
        id,
        sku,
        name,
        category,
        price,
        stock,
        reorder_level AS reorderLevel,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM products
    `;
    const params = [];

    if (search) {
      sql += " WHERE sku LIKE ? OR name LIKE ? ";
      params.push(search, search);
    }

    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const { sku, name, category, price, stock, reorderLevel, isActive } = req.body;

    if (!sku || !name || price === undefined || stock === undefined) {
      return res.status(400).json({ message: "sku, name, price, and stock are required" });
    }

    const [result] = await pool.query(
      `
        INSERT INTO products (sku, name, category, price, stock, reorder_level, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sku,
        name,
        category || "OTHER",
        price,
        stock,
        reorderLevel || 0,
        isActive === undefined ? 1 : Number(Boolean(isActive))
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      sku,
      name,
      category: category || "OTHER",
      price,
      stock,
      reorderLevel: reorderLevel || 0,
      isActive: isActive === undefined ? true : Boolean(isActive)
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "sku already exists";
    }
    return next(error);
  }
});

router.patch("/:id", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { sku, name, category, price, stock, reorderLevel, isActive } = req.body;

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
          is_active = COALESCE(?, is_active)
        WHERE id = ?
      `,
      [
        sku || null,
        name || null,
        category || null,
        price === undefined ? null : price,
        stock === undefined ? null : stock,
        reorderLevel === undefined ? null : reorderLevel,
        isActive === undefined ? null : Number(Boolean(isActive)),
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
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "sku already exists";
    }
    return next(error);
  }
});

module.exports = router;
