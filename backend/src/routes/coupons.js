const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { createError } = require("../utils/errors");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");
const { logKpi } = require("../services/kpiService");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          cp.id,
          cp.code,
          cp.coupon_type AS couponType,
          cp.amount,
          cp.customer_id AS customerId,
          cp.order_id AS orderId,
          cp.is_used AS isUsed,
          cp.issued_at AS issuedAt,
          cp.used_at AS usedAt,
          cp.approved_by_staff_id AS approvedByStaffId,
          c.name AS customerName
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id
        ORDER BY cp.id DESC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

async function ensureCouponEligibility(customerId, orderId, couponType) {
  const [duplicate] = await pool.query(
    `
      SELECT id
      FROM coupons
      WHERE customer_id = ? AND coupon_type = ?
      LIMIT 1
    `,
    [customerId, couponType]
  );

  if (duplicate[0]) {
    throw createError("This customer already has this coupon type", 409);
  }

  const [orders] = await pool.query(
    `
      SELECT o.id, c.line_user_id AS lineUserId
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
        AND o.customer_id = ?
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          WHERE oi.order_id = o.id
            AND oi.product_category_snapshot = 'EBIKE'
        )
    `,
    [orderId, customerId]
  );

  if (!orders[0]) {
    throw createError("Coupon is only available for EBIKE orders", 400);
  }

  return orders[0];
}

router.post("/issue", async (req, res, next) => {
  try {
    const { customerId, orderId, couponType } = req.body;
    if (!customerId || !orderId || !couponType) {
      throw createError("customerId, orderId, and couponType are required", 400);
    }

    if (couponType !== "new_friend") {
      throw createError("Use google review request endpoint for review coupons", 400);
    }

    const order = await ensureCouponEligibility(customerId, orderId, couponType);
    const code = `NF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    await pool.query(
      `
        INSERT INTO coupons (code, coupon_type, amount, customer_id, approved_by_staff_id, order_id)
        VALUES (?, 'new_friend', 500, ?, ?, ?)
      `,
      [code, customerId, req.user.id, orderId]
    );

    if (order.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, order.lineUserId, [
        {
          type: "text",
          text: `恭喜獲得新朋友優惠券 NT$500，券碼：${code}`
        }
      ]);
    }

    return res.status(201).json({ code, amount: 500 });
  } catch (error) {
    return next(error);
  }
});

router.post("/request-google-review", async (req, res, next) => {
  try {
    const { customerId, orderId } = req.body;
    if (!customerId || !orderId) {
      throw createError("customerId and orderId are required", 400);
    }

    await ensureCouponEligibility(customerId, orderId, "google_review");
    const code = `GR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const [result] = await pool.query(
      `
        INSERT INTO coupons (code, coupon_type, amount, customer_id, order_id)
        VALUES (?, 'google_review', 1500, ?, ?)
      `,
      [code, customerId, orderId]
    );

    return res.status(201).json({ id: result.insertId, code, status: "pending_approval" });
  } catch (error) {
    return next(error);
  }
});

router.post("/approve-google-review/:id", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, cp.customer_id AS customerId, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id
        WHERE cp.id = ? AND cp.coupon_type = 'google_review'
      `,
      [req.params.id]
    );

    if (!rows[0]) {
      throw createError("Google review coupon request not found", 404);
    }

    await pool.query(
      `
        UPDATE coupons
        SET approved_by_staff_id = ?
        WHERE id = ?
      `,
      [req.user.id, req.params.id]
    );

    await logKpi(req.user.id, "GOOGLE_REVIEW_APPROVED", "COUPON", req.params.id, 2);

    if (rows[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, rows[0].lineUserId, [
        {
          type: "text",
          text: `Google 評論優惠券已核准，金額 NT$1500，券碼：${rows[0].code}`
        }
      ]);
    }

    return res.json({ message: "Google review coupon approved" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
