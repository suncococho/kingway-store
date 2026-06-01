const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { BOT_NOTIFY, sendTelegramMessage, sendInternalTelegram } = require("../services/telegramService");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { createError } = require("../utils/errors");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");
const { logKpi } = require("../services/kpiService");
const {
  createButtonMessage,
  createConfirmTemplate,
  createPostbackAction,
  logWorkflowEvent,
  makeCode,
  sendToGroups
} = require("../services/lineWorkflowService");
const { mapCouponStatusLabel, mapCouponTypeLabel } = require("../utils/displayLabels");

const router = express.Router();

function isCouponCampaignEnabled(type) {
  if (process.env.COUPON_CAMPAIGN_ENABLED === "true") return true;
  if (type === "new_friend") return process.env.NEW_FRIEND_COUPON_ENABLED === "true";
  if (type === "google_review") return process.env.GOOGLE_REVIEW_COUPON_ENABLED === "true";
  return false;
}



router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]), requireStoreFeature("coupons_enabled"));

router.get("/", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          cp.id,
          cp.code,
          cp.coupon_type AS couponType,
          cp.status,
          cp.eligible_category AS eligibleCategory,
          cp.amount,
          cp.customer_id AS customerId,
          cp.order_id AS orderId,
          cp.is_used AS isUsed,
          cp.issued_at AS issuedAt,
          cp.used_at AS usedAt,
          cp.approved_at AS approvedAt,
          cp.rejected_at AS rejectedAt,
          cp.rejection_reason AS rejectionReason,
          cp.approved_by_staff_id AS approvedByStaffId,
          c.name AS customerName
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        ORDER BY cp.id DESC
      `,
      [storeId]
    );

    return res.json(rows.map((row) => ({
      ...row,
      couponTypeLabel: mapCouponTypeLabel(row.couponType),
      statusLabel: mapCouponStatusLabel(row.status || (row.isUsed ? "used" : "issued"))
    })));
  } catch (error) {
    return next(error);
  }
});

async function ensureCouponEligibility(customerId, orderId, couponType, requireOrder = true, storeId = null) {
  const [duplicate] = await pool.query(
    `
      SELECT id
      FROM coupons cp
      INNER JOIN customers c ON c.id = cp.customer_id
      WHERE cp.customer_id = ? AND cp.coupon_type = ?
        AND (? IS NULL OR c.store_id = ?)
      LIMIT 1
    `,
    [customerId, couponType, storeId, storeId]
  );

  if (duplicate[0]) {
    throw createError("此客戶已擁有同類型優惠券", 409);
  }

  if (!requireOrder) {
    return { lineUserId: null };
  }

  const [orders] = await pool.query(
    `
      SELECT o.id, c.line_user_id AS lineUserId
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id AND (? IS NULL OR c.store_id = ?)
      WHERE o.id = ?
        AND o.customer_id = ?
        AND (? IS NULL OR o.store_id = ?)
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          WHERE oi.order_id = o.id
            AND (? IS NULL OR oi.store_id = ?)
            AND oi.product_category_snapshot IN ('EB', 'EBIKE')
        )
    `,
    [storeId, storeId, orderId, customerId, storeId, storeId, storeId, storeId]
  );

  if (!orders[0]) {
    throw createError("優惠券僅限電動自行車訂單使用", 400);
  }

  return orders[0];
}

router.post("/issue", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { customerId, orderId, couponType } = req.body;
    if (!customerId || !orderId || !couponType) {
      throw createError("customerId、orderId 與 couponType 為必填欄位", 400);
    }

    if (couponType !== "new_friend") {
      throw createError("Google 評論請使用評論申請流程", 400);
    }

    const order = await ensureCouponEligibility(customerId, orderId, couponType, true, storeId);
    const code = makeCode("NF");

    await pool.query(
      `
        INSERT INTO coupons (code, coupon_type, amount, customer_id, approved_by_staff_id, order_id, status, eligible_category, approved_at)
        VALUES (?, 'new_friend', 500, ?, ?, ?, 'issued', 'EB', NOW())
      `,
      [code, customerId, req.user.id, orderId]
    );

    if (order.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, order.lineUserId, [
        {
          type: "text",
          text: `會員優惠券已建立，券碼：${code}`
        }
      ]);
    }

    return res.status(201).json({ code, amount: 500 });
  } catch (error) {
    return next(error);
  }
});

router.post("/request-google-review", async (req, res, next) => {
  if (
    process.env.COUPON_CAMPAIGN_ENABLED !== "true" &&
    process.env.GOOGLE_REVIEW_COUPON_ENABLED !== "true"
  ) {
    return res.status(403).json({
      message: "Google 評論優惠活動目前暫停"
    });
  }

  try {
    const storeId = req.storeId;
    const { customerId, orderId } = req.body;
    if (!customerId) {
      throw createError("customerId 為必填欄位", 400);
    }

    await ensureCouponEligibility(customerId, orderId || null, "google_review", Boolean(orderId), storeId);
    const code = makeCode("GR");

    const [result] = await pool.query(
      `
        INSERT INTO coupons (code, coupon_type, amount, customer_id, order_id, status, eligible_category)
        VALUES (?, 'google_review', 1500, ?, ?, 'pending_approval', 'EB')
      `,
      [code, customerId, orderId || null]
    );

    try {
      await sendInternalTelegram(
        `🟢 Google 評論待審核\n\n客戶 ID：${customerId}\n訂單 ID：${orderId || "-"}\n優惠券 ID：${result.insertId}\n折抵金額：活動暫停\n\n請確認客戶 Google 評論後核准或拒絕。`,
        {
          inline_keyboard: [
            [
              { text: "✅ 核准並套用折抵", callback_data: `action=google_review_approve&id=${result.insertId}` },
              { text: "❌ 拒絕", callback_data: `action=google_review_reject&id=${result.insertId}` }
            ]
          ]
        }
      );
    } catch (telegramError) {
      console.error("[google-review telegram notify failed]", telegramError.message);
    }
    await logWorkflowEvent("google_review_coupon_requested", "COUPON", result.insertId, { customerId, orderId: orderId || null }, req.user.id);

    return res.status(201).json({ id: result.insertId, code, status: "pending_approval" });
  } catch (error) {
    return next(error);
  }
});


router.post("/approve-google-review-for-order/:orderId", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const orderId = Number(req.params.orderId);

    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, cp.amount, cp.customer_id AS customerId, cp.order_id AS orderId,
               c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN orders o ON o.id = ? AND o.store_id = ?
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.coupon_type = 'google_review'
          AND cp.status = 'pending_approval'
          AND (cp.order_id = o.id OR cp.customer_id = o.customer_id OR c.phone = o.customer_phone)
        ORDER BY cp.id DESC
        LIMIT 1
      `,
      [orderId, storeId, storeId]
    );

    if (!rows[0]) {
      throw createError("尚未收到此訂單客戶的 Google 評論確認申請", 404);
    }

    const coupon = rows[0];
    const amount = Number(coupon.amount || 1500);

    await pool.query(
      `
        UPDATE coupons
        SET approved_by_staff_id = ?,
            approved_at = NOW(),
            status = 'used',
            is_used = 1,
            used_at = NOW(),
            order_id = ?
        WHERE id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.user.id, orderId, coupon.id, storeId]
    );

    await pool.query(
      `
        UPDATE orders
        SET other_discount = COALESCE(other_discount, 0) + ?,
            total_amount = GREATEST(total_amount - ?, 0),
            unpaid_balance = GREATEST(unpaid_balance - ?, 0)
        WHERE id = ?
          AND store_id = ?
      `,
      [amount, amount, amount, orderId, storeId]
    );

    await logWorkflowEvent("google_review_discount_applied", "ORDER", orderId, {
      couponId: coupon.id,
      amount,
      source: "order_edit"
    }, req.user.id);

    if (coupon.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, coupon.lineUserId, [
        {
          type: "text",
          text: `Google 評論優惠已核准並套用，折抵金額 NT$${amount}。`
        }
      ]);
    }

    return res.json({ message: "Google 評論優惠已核准並套用至訂單", couponId: coupon.id, amount });
  } catch (error) {
    return next(error);
  }
});


router.post("/approve-google-review/:id", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, cp.customer_id AS customerId, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ? AND cp.coupon_type = 'google_review'
      `,
      [storeId, req.params.id]
    );

    if (!rows[0]) {
      throw createError("找不到 Google 評論申請", 404);
    }

    await pool.query(
      `
        UPDATE coupons
        SET approved_by_staff_id = ?,
            approved_at = NOW(),
            status = 'issued'
        WHERE id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.user.id, req.params.id, storeId]
    );

    await logKpi(req.user.id, "GOOGLE_REVIEW_APPROVED", "COUPON", req.params.id, 2);

    if (rows[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, rows[0].lineUserId, [
        {
          type: "text",
          text: `Google 評論已確認，券碼：${rows[0].code}`
        }
      ]);
    }

    await sendToGroups(["admin", "staff"], [
      {
        type: "text",
        text: `Google 評論已確認：${rows[0].code}`
      }
    ]);

    await logWorkflowEvent("google_review_coupon_approved", "COUPON", req.params.id, null, req.user.id);
    return res.json({ message: "Google 評論已確認" });
  } catch (error) {
    return next(error);
  }
});

router.post("/reject-google-review/:id", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ? AND cp.coupon_type = 'google_review'
      `,
      [storeId, req.params.id]
    );

    if (!rows[0]) {
      throw createError("找不到 Google 評論申請", 404);
    }

    await pool.query(
      `
        UPDATE coupons
        SET status = 'rejected',
            rejected_at = NOW(),
            rejection_reason = ?
        WHERE id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.body.reason || "未通過人工審核", req.params.id, storeId]
    );

    if (rows[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, rows[0].lineUserId, [
        {
          type: "text",
          text: "Google 評論這次未通過審核，如有疑問請洽門市人員。"
        }
      ]);
    }

    await logWorkflowEvent("google_review_coupon_rejected", "COUPON", req.params.id, { reason: req.body.reason || null }, req.user.id);
    return res.json({ message: "已拒絕 Google 評論" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cancel", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT id, status, coupon_type AS couponType, code, is_used AS isUsed
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ?
        LIMIT 1
      `,
      [storeId, req.params.id]
    );

    if (!rows[0]) {
      throw createError("找不到優惠券", 404);
    }

    if (rows[0].isUsed || rows[0].status === "used") {
      throw createError("已使用的優惠券無法取消", 400);
    }

    await pool.query(
      `
        UPDATE coupons
        SET status = 'expired',
            rejected_at = NOW(),
            rejection_reason = ?
        WHERE id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.body.reason || "後台作廢", req.params.id, storeId]
    );

    return res.json({ message: "已取消優惠券" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
