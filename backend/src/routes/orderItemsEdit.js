const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { createError } = require("../utils/errors");
const { getTableColumns, hasColumn } = require("../utils/schema");
const { reconcileOrderSaleIncentivesSafely } = require("../services/staffIncentiveEarningService");

const router = express.Router();
router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]));

function normalizeOrderItemColor(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().slice(0, 80);
  return text || null;
}

function mapCategory(category) {
  if (category === "EB") return "EBIKE";
  if (category === "RP") return "REPAIR";
  if (["AC", "PT", "TR", "LT", "LK", "SE", "HB", "CR"].includes(category)) return "ACCESSORY";
  return "OTHER";
}

const ORDER_PRICE_DISCOUNT_FIELDS = [
  "otherDiscount", "other_discount", "unitPrice", "unit_price", "price",
  "salePrice", "sale_price", "lineTotal", "line_total", "totalAmount",
  "total_amount", "discount", "manualDiscount", "manual_discount"
];

function hasOwnPropertyValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function assertAdminCanEditOrderPriceDiscount(req) {
  const requesterRole = String(req.user?.role || "").trim().toUpperCase();
  const hasPriceDiscountField = ORDER_PRICE_DISCOUNT_FIELDS.some((field) =>
    hasOwnPropertyValue(req.body, field)
  ) || (Array.isArray(req.body?.items) && req.body.items.some((item) =>
    ORDER_PRICE_DISCOUNT_FIELDS.some((field) => hasOwnPropertyValue(item, field))
  ));
  if (requesterRole !== "ADMIN" && hasPriceDiscountField) {
    throw createError("\u53ea\u6709\u7ba1\u7406\u54e1\u53ef\u4ee5\u4fee\u6539\u50f9\u683c\u6216\u6298\u6263", 403);
  }
}

router.put("/:id/items", requireStoreFeature("orders_enabled"), async (req, res, next) => {
  try {
    assertAdminCanEditOrderPriceDiscount(req);
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
      const hasItemColor = hasColumn(await getTableColumns(tx, "order_items"), "color");
      const [oldItemRows] = await tx.query(
        `SELECT product_id AS productId, unit_price AS unitPrice,
                sku_snapshot AS sku, product_name_snapshot AS name,
                product_category_snapshot AS category${hasItemColor ? ", color" : ""}
         FROM order_items
         WHERE order_id = ? AND store_id = ?`,
        [orderId, storeId]
      );
      const oldItemsByProduct = new Map(
        oldItemRows.map((item) => [Number(item.productId), item])
      );
      const oldUnitPrices = new Map(
        oldItemRows.map((item) => [Number(item.productId), Number(item.unitPrice || 0)])
      );

      const normalized = [];
      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Math.max(Number(item.quantity || 1), 1);
        if (!productId) throw createError("商品資料錯誤", 400);

        const [products] = await tx.query(
          `SELECT id, sku, name, category, price, is_active AS isActive FROM products WHERE id = ? AND store_id = ? LIMIT 1`,
          [productId, storeId]
        );

        // 新加入的商品必須是上架中；訂單原本就有的商品即使已下架也可保留
        const oldItem = oldItemsByProduct.get(productId) || null;
        let product = products[0] || null;
        if (product && Number(product.isActive) !== 1 && !oldItem) {
          throw createError(`商品「${product.name || productId}」已下架，無法新增到訂單`, 400);
        }
        if (!product && oldItem) {
          product = { id: productId, sku: oldItem.sku, name: oldItem.name, category: null, price: oldItem.unitPrice, snapshotCategory: oldItem.category };
        }
        if (!product) throw createError(`找不到商品 ID ${productId}`, 404);

        const unitPrice = item.unitPrice !== undefined
          ? Number(item.unitPrice || 0)
          : (oldUnitPrices.has(productId) ? oldUnitPrices.get(productId) : Number(product.price || 0));
        const lineTotal = quantity * unitPrice;

        normalized.push({
          productId,
          sku: product.sku,
          name: product.name,
          category: product.category ? mapCategory(product.category) : product.snapshotCategory,
          quantity,
          unitPrice,
          lineTotal,
          // 未傳入顏色時沿用原品項顏色，避免重存品項時遺失車身顏色
          color: item.color !== undefined ? normalizeOrderItemColor(item.color) : normalizeOrderItemColor(oldItem?.color)
        });
      }

      await tx.query(`DELETE FROM order_items WHERE order_id = ? AND store_id = ?`, [orderId, storeId]);

      for (const item of normalized) {
        await tx.query(
          `INSERT INTO order_items
           (store_id, order_id, product_id, sku_snapshot, product_name_snapshot, product_category_snapshot, quantity, unit_price, line_total${hasItemColor ? ", color" : ""})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${hasItemColor ? ", ?" : ""})`,
          [storeId, orderId, item.productId, item.sku, item.name, item.category, item.quantity, item.unitPrice, item.lineTotal, ...(hasItemColor ? [item.color] : [])]
        );
      }

      const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
      const totalAmount = Math.max(subtotal - keepDiscount, 0);
      const currentFinalPaymentStatus = String(order.finalPaymentStatus || "").trim().toUpperCase();
      const recalculatedUnpaidBalance = Math.max(totalAmount - Number(order.depositAmount || 0), 0);
      const unpaidBalance = currentFinalPaymentStatus === "PAID" ? 0 : recalculatedUnpaidBalance;
      const finalPaymentStatus = currentFinalPaymentStatus === "PAID"
        ? "PAID"
        : unpaidBalance > 0
          ? (Number(order.depositAmount || 0) > 0 ? "PARTIAL" : "UNPAID")
          : "PAID";

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

    await reconcileOrderSaleIncentivesSafely({
      connection: pool,
      storeId,
      orderId,
      triggerSource: "ORDER_ITEMS_UPDATED"
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
