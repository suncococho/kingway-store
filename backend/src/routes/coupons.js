const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { BOT_NOTIFY, sendTelegramMessage, sendInternalTelegram } = require("../services/telegramService");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
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
  return false;
  if (process.env.COUPON_CAMPAIGN_ENABLED === "true") return true;
  if (type === "new_friend") return process.env.NEW_FRIEND_COUPON_ENABLED === "true";
  if (type === "google_review") return process.env.GOOGLE_REVIEW_COUPON_ENABLED === "true";
  return false;
}



router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]), requireStoreFeature("coupons_enabled"));
const requireStoreAdminRole = requireStoreRole(["owner", "admin"]);

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
        WHERE cp.store_id = ?
        ORDER BY cp.id DESC
      `,
      [storeId, storeId]
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
      WHERE cp.customer_id = ?
        AND cp.coupon_type = ?
        AND cp.store_id = ?
        AND c.store_id = ?
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

router.post("/issue", requireStoreAdminRole, async (req, res, next) => {
  try {
    return res.status(410).json({ message: "優惠活動已停止，系統不再建立新優惠紀錄。" });
  } catch (error) {
    return next(error);
  }
});

router.post("/request-google-review", async (req, res, next) => {
  try {
    const { customerId, orderId } = req.body;
    if (!customerId) {
      throw createError("customerId 為必填欄位", 400);
    }

    try {
      await sendInternalTelegram(
        `🟢 Google 評論待確認\n\n客戶 ID：${customerId}\n訂單 ID：${orderId || "-"}\n\n請確認客戶 Google 評論。`
      );
    } catch (telegramError) {
      console.error("[google-review telegram notify failed]", telegramError.message);
    }
    await logWorkflowEvent("google_review_submitted", "CUSTOMER", customerId, { orderId: orderId || null, couponIssued: false }, req.user.id);

    return res.status(201).json({ message: "已送出 Google 評論確認" });
  } catch (error) {
    return next(error);
  }
});


router.post("/approve-google-review-for-order/:orderId", authorize(["ADMIN", "MANAGER"]), requireStoreAdminRole, async (req, res, next) => {
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
          AND cp.store_id = ?
          AND cp.status = 'pending_approval'
          AND (cp.order_id = o.id OR cp.customer_id = o.customer_id OR c.phone = o.customer_phone)
        ORDER BY cp.id DESC
        LIMIT 1
      `,
      [orderId, storeId, storeId, storeId]
    );

    if (!rows[0]) {
      throw createError("尚未收到此訂單客戶的 Google 評論確認申請", 404);
    }

    const coupon = rows[0];
    await pool.query(
      `
        UPDATE coupons
        SET approved_by_staff_id = ?,
            approved_at = NOW(),
            status = 'approved',
            order_id = ?
        WHERE id = ?
          AND store_id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.user.id, orderId, coupon.id, storeId, storeId]
    );

    await logWorkflowEvent("google_review_confirmed", "ORDER", orderId, {
      couponId: coupon.id,
      couponIssued: false,
      source: "order_edit"
    }, req.user.id);

    if (coupon.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, coupon.lineUserId, [
        {
          type: "text",
          text: "Google 評論已確認，感謝您的回饋。"
        }
      ]);
    }

    return res.json({ message: "Google 評論已確認", couponId: coupon.id });
  } catch (error) {
    return next(error);
  }
});


router.post("/approve-google-review/:id", authorize(["ADMIN", "MANAGER"]), requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, cp.customer_id AS customerId, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ?
          AND cp.coupon_type = 'google_review'
          AND cp.store_id = ?
      `,
      [storeId, req.params.id, storeId]
    );

    if (!rows[0]) {
      throw createError("找不到 Google 評論申請", 404);
    }

    await pool.query(
      `
        UPDATE coupons
        SET approved_by_staff_id = ?,
            approved_at = NOW(),
            status = 'approved'
        WHERE id = ?
          AND store_id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.user.id, req.params.id, storeId, storeId]
    );

    await logKpi(req.user.id, "GOOGLE_REVIEW_APPROVED", "COUPON", req.params.id, 2);

    if (rows[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, rows[0].lineUserId, [
        {
          type: "text",
          text: "Google 評論已確認，感謝您的回饋。"
        }
      ]);
    }

    await sendToGroups(["admin", "staff"], [
      {
        type: "text",
        text: "Google 評論已確認。"
      }
    ]);

    await logWorkflowEvent("google_review_confirmed", "COUPON", req.params.id, { couponIssued: false }, req.user.id);
    return res.json({ message: "Google 評論已確認" });
  } catch (error) {
    return next(error);
  }
});

router.post("/reject-google-review/:id", authorize(["ADMIN", "MANAGER"]), requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.code, c.line_user_id AS lineUserId
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ?
          AND cp.coupon_type = 'google_review'
          AND cp.store_id = ?
      `,
      [storeId, req.params.id, storeId]
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
          AND store_id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.body.reason || "未通過人工審核", req.params.id, storeId, storeId]
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

router.post("/:id/cancel", authorize(["ADMIN", "MANAGER"]), requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT cp.id, cp.status, cp.coupon_type AS couponType, cp.code, cp.is_used AS isUsed
        FROM coupons cp
        INNER JOIN customers c ON c.id = cp.customer_id AND c.store_id = ?
        WHERE cp.id = ?
          AND cp.store_id = ?
        LIMIT 1
      `,
      [storeId, req.params.id, storeId]
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
          AND store_id = ?
          AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [req.body.reason || "後台作廢", req.params.id, storeId, storeId]
    );

    return res.json({ message: "已取消優惠券" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
