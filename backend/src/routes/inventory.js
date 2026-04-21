const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { createError } = require("../utils/errors");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "INVENTORY"]));

router.get("/movements", async (req, res, next) => {
  try {
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
        INNER JOIN products p ON p.id = im.product_id
        ORDER BY im.id DESC
        LIMIT 200
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/low-stock", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT id, name, sku, category, stock, reorder_level AS reorderLevel
        FROM products
        WHERE stock <= reorder_level
        ORDER BY stock ASC, name ASC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/movements", async (req, res, next) => {
  try {
    const { productId, type, qty, note } = req.body;
    const normalizedQty = Number(qty);

    if (!productId || !type || !Number.isInteger(normalizedQty) || normalizedQty <= 0) {
      throw createError("productId, type, and positive integer qty are required", 400);
    }

    const movementType = String(type).toUpperCase();
    if (!["IN", "OUT", "ADJUST"].includes(movementType)) {
      throw createError("type must be IN, OUT, or ADJUST", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [products] = await connection.query(
        `
          SELECT id, stock
          FROM products
          WHERE id = ?
          FOR UPDATE
        `,
        [productId]
      );

      const product = products[0];
      if (!product) {
        throw createError("Product not found", 404);
      }

      const signedQty = movementType === "OUT" ? -normalizedQty : normalizedQty;
      const nextStock = movementType === "ADJUST" ? normalizedQty : product.stock + signedQty;

      if (nextStock < 0) {
        throw createError("Stock cannot be negative", 409);
      }

      await connection.query(
        `
          UPDATE products
          SET stock = ?
          WHERE id = ?
        `,
        [nextStock, productId]
      );

      await connection.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
          VALUES (?, ?, ?, ?, ?)
        `,
        [productId, movementType, movementType === "ADJUST" ? nextStock : signedQty, note || null, req.user.id]
      );

      return {
        productId: Number(productId),
        stock: nextStock
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
