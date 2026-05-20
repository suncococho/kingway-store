const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ customer: null, orders: [], repairs: [] });

    const digits = q.replace(/\D/g, "");
    const isPhoneSearch = digits.length >= 4;
    const like = isPhoneSearch ? `%${digits}%` : `%${q}%`;

    const [customers] = await pool.query(
      isPhoneSearch
        ? "SELECT id, name, phone, line_user_id AS lineUserId FROM customers WHERE phone LIKE ? AND COALESCE(crm_stage, '') <> 'deleted' ORDER BY updated_at DESC LIMIT 1"
        : "SELECT id, name, phone, line_user_id AS lineUserId FROM customers WHERE name LIKE ? AND COALESCE(crm_stage, '') <> 'deleted' ORDER BY updated_at DESC LIMIT 1",
      [like]
    );

    const customer = customers[0] || null;
    if (!customer) return res.json({ customer: null, orders: [], repairs: [] });

    const [orders] = await pool.query(
      `SELECT id, order_no AS orderNo, total_amount AS totalAmount, deposit_amount AS depositAmount,
              unpaid_balance AS unpaidBalance, final_payment_status AS finalPaymentStatus,
              payment_method AS paymentMethod, status, business_date AS businessDate
       FROM orders
       WHERE customer_id = ? OR customer_phone = ?
       ORDER BY id DESC
       LIMIT 20`,
      [customer.id, customer.phone]
    );

    const [repairs] = await pool.query(
      `SELECT id, bike_model AS bikeModel, issue_description AS issueDescription, status,
              reservation_date AS reservationDate, estimate_amount AS estimateAmount,
              inspection_fee AS inspectionFee, parts_fee AS partsFee, labor_fee AS laborFee,
              storage_fee AS storageFee, completed_at AS completedAt, picked_up_at AS pickedUpAt
       FROM repair_orders
       WHERE customer_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [customer.id]
    );

    return res.json({ customer, orders, repairs });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
