const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { createError } = require("../utils/errors");
const config = require("../config");
const { sendLineMessage } = require("../utils/line");

const router = express.Router();

router.get("/public/:token", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          s.id,
          s.customer_id AS customerId,
          s.order_id AS orderId,
          s.rating,
          s.feedback,
          c.name AS customerName
        FROM surveys s
        INNER JOIN customers c ON c.id = s.customer_id
        WHERE s.token = ?
        LIMIT 1
      `,
      [req.params.token]
    );

    if (!rows[0]) {
      throw createError("Survey link not found", 404);
    }

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/public/:token", async (req, res, next) => {
  try {
    const { rating, feedback } = req.body;
    if (!rating || Number(rating) < 1 || Number(rating) > 5) {
      throw createError("rating must be between 1 and 5", 400);
    }

    const [result] = await pool.query(
      `
        UPDATE surveys
        SET rating = ?, feedback = ?, submitted_at = NOW()
        WHERE token = ?
      `,
      [Number(rating), feedback || null, req.params.token]
    );

    if (result.affectedRows === 0) {
      throw createError("Survey link not found", 404);
    }

    return res.json({ message: "Survey submitted" });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          s.id,
          s.customer_id AS customerId,
          s.order_id AS orderId,
          s.rating,
          s.feedback,
          s.submitted_at AS submittedAt,
          s.token,
          c.name AS customerName
        FROM surveys s
        INNER JOIN customers c ON c.id = s.customer_id
        ORDER BY s.id DESC
      `
    );

    return res.json(
      rows.map((row) => ({
        ...row,
        link: row.token ? `${config.frontendBaseUrl}/survey/${row.token}` : null
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/generate-link", async (req, res, next) => {
  try {
    const { customerId, orderId } = req.body;
    if (!customerId || !orderId) {
      throw createError("customerId and orderId are required", 400);
    }

    const token = crypto.randomBytes(20).toString("hex");
    const [result] = await pool.query(
      `
        INSERT INTO surveys (customer_id, order_id, rating, feedback, token)
        VALUES (?, ?, 0, NULL, ?)
      `,
      [customerId, orderId, token]
    );

    const [customers] = await pool.query(
      `
        SELECT line_user_id AS lineUserId
        FROM customers
        WHERE id = ?
      `,
      [customerId]
    );

    const link = `${config.frontendBaseUrl}/survey/${token}`;
    if (customers[0] && customers[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, customers[0].lineUserId, [
        {
          type: "text",
          text: `\u611F\u8B1D\u60A8\u7684\u652F\u6301\uFF0C\u6B61\u8FCE\u586B\u5BEB\u6EFF\u610F\u5EA6\u554F\u5377\uFF1A\n${link}`
        }
      ]);
    }

    return res.status(201).json({ id: result.insertId, token, link });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
