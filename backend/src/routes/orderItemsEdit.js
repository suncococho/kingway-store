const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { createError } = require("../utils/errors");

const router = express.Router();
router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]));

function mapCategory(category) {
  if (category === "EB") return "EBIKE";
  if (category === "RP") return "REPAIR";
  if (["AC", "PT", "TR", "LT", "LK", "SE", "HB", "CR"].includes(category)) return "ACCESSORY";
  return "OTHER";
}

router.put("/:id/items", async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const storeId = req.storeId;

    if (!orderId) throw createError("訂單 ID 錯誤", 400);
    if (!items.length) throw createError("商品不可為空", 400);

    const result = await withTransaction(async (tx) => {
      const [orders] = await tx.query(
        `SELECT id, final_payment_status AS finalPaymentStatus, deposit_amount AS depositAmount, total_amount AS totalAmount
         FROM orders WHERE id = ? AND store_id = ? FOR UPDATE`,
        [orderId, storeId]
      );

      const order = orders[0];
      if (!order) throw createError("找不到訂單", 404);
      const [oldSumRows] = await tx.query(
        `SELECT COALESCE(SUM(line_total), 0) AS subtotal FROM order_items WHERE order_id = ? AND store_id = ?`,
        [orderId, storeId]
      );

      const oldSubtotal = Number(oldSumRows[0]?.subtotal || 0);
      const oldTotal = Number(order.totalAmount || 0);
      const keepDiscount = Math.max(oldSubtotal - oldTotal, 0);

      const normalized = [];
      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Math.max(Number(item.quantity || 1), 1);
        if (!productId) throw createError("商品資料錯誤", 400);

        const [products] = await tx.query(
          `SELECT id, sku, name, category, price FROM products WHERE id = ? AND store_id = ? LIMIT 1`,
          [productId, storeId]
        );

        const product = products[0];
        if (!product) throw createError(`找不到商品 ID ${productId}`, 404);

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice || 0) : Number(product.price || 0);
        const lineTotal = quantity * unitPrice;

        normalized.push({
          productId,
          sku: product.sku,
          name: product.name,
          category: mapCategory(product.category),
          quantity,
          unitPrice,
          lineTotal
        });
      }

      await tx.query(`DELETE FROM order_items WHERE order_id = ? AND store_id = ?`, [orderId, storeId]);

      for (const item of normalized) {
        await tx.query(
          `INSERT INTO order_items
           (store_id, order_id, product_id, sku_snapshot, product_name_snapshot, product_category_snapshot, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [storeId, orderId, item.productId, item.sku, item.name, item.category, item.quantity, item.unitPrice, item.lineTotal]
        );
      }

      const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
      const totalAmount = Math.max(subtotal - keepDiscount, 0);
      const unpaidBalance = Math.max(totalAmount - Number(order.depositAmount || 0), 0);
      const finalPaymentStatus = unpaidBalance > 0 ? (Number(order.depositAmount || 0) > 0 ? "PARTIAL" : "UNPAID") : "PAID";

      await tx.query(
        `UPDATE orders
         SET total_amount = ?,
             unpaid_balance = ?,
             final_payment_status = ?,
             final_paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(final_paid_at, NOW()) ELSE NULL END
         WHERE id = ? AND store_id = ?`,
        [totalAmount, unpaidBalance, finalPaymentStatus, finalPaymentStatus, orderId, storeId]
      );

      return { ok: true, orderId, subtotal, discount: keepDiscount, totalAmount, unpaidBalance, finalPaymentStatus, items: normalized };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
