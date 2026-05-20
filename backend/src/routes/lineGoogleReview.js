const express = require("express");
const { pool } = require("../db");
const {
  buildGroupApprovalMessage,
  sendToGroupsWithResult,
  logWorkflowEvent
} = require("../services/lineWorkflowService");

const router = express.Router();

function makeGoogleReviewCode(customerId) {
  return `GR${customerId}${Date.now().toString().slice(-6)}`;
}

router.get("/customer", async (req, res, next) => {
  try {
    const lineUserId = String(req.query.lineUserId || "").trim();
    if (!lineUserId) return res.json({ customer: null });

    const [rows] = await pool.query(
      `SELECT id, name, phone, line_user_id AS lineUserId
       FROM customers
       WHERE line_user_id = ?
         AND COALESCE(crm_stage, '') <> 'deleted'
       LIMIT 1`,
      [lineUserId]
    );

    return res.json({ customer: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.post("/request", async (req, res, next) => {
  try {
    const lineUserId = String(req.body.lineUserId || "").trim();
    if (!lineUserId) return res.status(400).json({ message: "缺少 LINE 使用者資料" });

    const [customers] = await pool.query(
      `SELECT id, name, phone, line_user_id AS lineUserId
       FROM customers
       WHERE line_user_id = ?
         AND COALESCE(crm_stage, '') <> 'deleted'
       LIMIT 1`,
      [lineUserId]
    );

    const customer = customers[0];
    if (!customer) return res.status(404).json({ message: "尚未找到綁定客戶" });

    const [existing] = await pool.query(
      `SELECT id, code, status, is_used AS isUsed, used_at AS usedAt, order_id AS orderId
       FROM coupons
       WHERE customer_id = ?
         AND coupon_type = 'google_review'
       ORDER BY id DESC
       LIMIT 1`,
      [customer.id]
    );

    if (existing[0]) {
      const coupon = existing[0];

      if (Number(coupon.isUsed || 0) || coupon.status === "used") {
        return res.json({
          ok: false,
          alreadyUsed: true,
          message: "您已使用過 Google 評論優惠券，每位顧客限使用一次。"
        });
      }

      if (coupon.status === "pending_approval") {
        return res.json({
          ok: true,
          pending: true,
          couponId: coupon.id,
          message: `您的 Google 評論優惠券已在審核中，申請編號 #${coupon.id}。`
        });
      }

      if (["approved", "issued"].includes(coupon.status)) {
        return res.json({
          ok: true,
          alreadyIssued: true,
          couponId: coupon.id,
          code: coupon.code,
          message: `您已有 Google 評論優惠券，券碼：${coupon.code}`
        });
      }

      if (coupon.status === "rejected") {
        return res.json({
          ok: false,
          rejected: true,
          message: "您的 Google 評論優惠券申請先前未通過，如有疑問請洽門市人員。"
        });
      }
    }

    const [latestOrder] = await pool.query(
      `SELECT id
       FROM orders
       WHERE customer_id = ?
          OR customer_phone = ?
       ORDER BY id DESC
       LIMIT 1`,
      [customer.id, customer.phone || ""]
    );

    const orderId = latestOrder[0]?.id || null;
    const code = makeGoogleReviewCode(customer.id);

    const [result] = await pool.query(
      `INSERT INTO coupons
       (code, coupon_type, amount, customer_id, order_id, status, eligible_category)
       VALUES (?, 'google_review', 1500, ?, ?, 'pending_approval', 'EBIKE')`,
      [code, customer.id, orderId]
    );

    const deliveryResult = await sendToGroupsWithResult(["admin", "staff", "daily"], [
      buildGroupApprovalMessage("google_review", {
        id: result.insertId,
        customerName: customer.name || "LINE 客戶",
        customerPhone: customer.phone || null,
        amount: 1500,
        orderId
      })
    ]);

    await logWorkflowEvent(
      "google_review_coupon_requested",
      "COUPON",
      result.insertId,
      {
        customerId: customer.id,
        orderId,
        delivered: deliveryResult.delivered,
        targetGroupIds: deliveryResult.targetGroupIds,
        source: "line_google_review_page"
      },
      null
    );

    return res.json({
      ok: true,
      couponId: result.insertId,
      message: "已送出 Google 評論優惠券審核，門市確認後會通知您。"
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
