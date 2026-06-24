const express = require("express");
const { pool } = require("../db");
const {
  buildGroupApprovalMessage,
  sendToGroupsWithResult,
  logWorkflowEvent
} = require("../services/lineWorkflowService");

const router = express.Router();

router.get("/customer", async (req, res, next) => {
  try {
    const lineUserId = String(req.query.lineUserId || "").trim();
    if (!lineUserId) return res.json({ customer: null });

    const [rows] = await pool.query(
      `SELECT id, name, phone, line_user_id AS lineUserId, store_id AS storeId
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
      `SELECT id, name, phone, line_user_id AS lineUserId, store_id AS storeId
       FROM customers
       WHERE line_user_id = ?
         AND COALESCE(crm_stage, '') <> 'deleted'
       LIMIT 1`,
      [lineUserId]
    );

    const customer = customers[0];
    if (!customer) return res.status(404).json({ message: "尚未找到綁定客戶" });
    const storeId = Number(customer.storeId || 1);

    const [existing] = await pool.query(
      `SELECT id, code, status, is_used AS isUsed, used_at AS usedAt, order_id AS orderId
       FROM coupons
       WHERE customer_id = ?
         AND coupon_type = 'google_review'
         AND store_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [customer.id, storeId]
    );

    if (existing[0]) {
      const coupon = existing[0];

      if (Number(coupon.isUsed || 0) || coupon.status === "used") {
        return res.json({
          ok: false,
          alreadyUsed: true,
          message: "您已完成過 Google 評論確認。"
        });
      }

      if (coupon.status === "pending_approval") {
        return res.json({
          ok: true,
          pending: true,
          message: "您的 Google 評論已在確認中。"
        });
      }

      if (["approved", "issued"].includes(coupon.status)) {
        return res.json({
          ok: true,
          alreadyIssued: true,
          message: `您已有 Google 評論紀錄。`
        });
      }

      if (coupon.status === "rejected") {
        return res.json({
          ok: false,
          rejected: true,
          message: "您的 Google 評論先前未通過確認，如有疑問請洽門市人員。"
        });
      }
    }

    const [latestOrder] = await pool.query(
      `SELECT id
       FROM orders
       WHERE (customer_id = ?
          OR customer_phone = ?)
         AND store_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [customer.id, customer.phone || "", storeId]
    );

    const orderId = latestOrder[0]?.id || null;
    const deliveryResult = await sendToGroupsWithResult(["admin", "staff", "daily"], [
      buildGroupApprovalMessage("google_review", {
        customerName: customer.name || "LINE 客戶",
        customerPhone: customer.phone || null,
        orderId
      })
    ]);

    await logWorkflowEvent(
      "google_review_submitted",
      "CUSTOMER",
      customer.id,
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
      message: "已送出 Google 評論確認，門市確認後會通知您。"
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
