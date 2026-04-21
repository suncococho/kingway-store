const crypto = require("crypto");
const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { writePurchaseConfirmationPdf } = require("../services/pdfService");
const config = require("../config");
const { sendLineMessage } = require("../utils/line");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");

const router = express.Router();

router.get("/public/:token", async (req, res, next) => {
  try {
    const tokenRow = await fetchPurchaseConfirmationToken(req.params.token);
    if (!tokenRow) {
      throw createError("Confirmation link not found", 404);
    }

    const [items] = await pool.query(
      `
        SELECT product_name_snapshot AS productName, quantity, unit_price AS unitPrice, line_total AS lineTotal
        FROM order_items
        WHERE order_id = ?
      `,
      [tokenRow.orderId]
    );

    return res.json({
      orderId: tokenRow.orderId,
      customerId: tokenRow.customerId,
      customerName: tokenRow.customerName,
      customerPhone: tokenRow.customerPhone,
      orderNo: tokenRow.orderNo,
      expiresAt: tokenRow.expiresAt,
      usedAt: tokenRow.usedAt,
      items
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/public/:token", async (req, res, next) => {
  try {
    const { signatureData } = req.body;
    if (!signatureData) {
      throw createError("Signature is required", 400);
    }

    const tokenRow = await fetchPurchaseConfirmationToken(req.params.token);
    if (!tokenRow) {
      throw createError("Confirmation link not found", 404);
    }

    if (tokenRow.usedAt) {
      throw createError("This confirmation link has already been used", 409);
    }

    const confirmation = await withTransaction(async (connection) => {
      const [existingRows] = await connection.query(
        `
          SELECT id
          FROM purchase_confirmations
          WHERE token = ?
          LIMIT 1
        `,
        [req.params.token]
      );

      let confirmationId;
      if (existingRows[0]) {
        confirmationId = existingRows[0].id;
        await connection.query(
          `
            UPDATE purchase_confirmations
            SET
              signature_data = ?,
              confirmed_by_line_user_id = ?,
              submitted_at = NOW(),
              status = 'COMPLETED'
            WHERE id = ?
          `,
          [signatureData, tokenRow.lineUserId || null, confirmationId]
        );
      } else {
        const [insertResult] = await connection.query(
          `
            INSERT INTO purchase_confirmations (
              token,
              order_id,
              customer_id,
              status,
              signature_data,
              confirmed_by_line_user_id,
              submitted_at
            )
            VALUES (?, ?, ?, 'COMPLETED', ?, ?, NOW())
          `,
          [req.params.token, tokenRow.orderId, tokenRow.customerId, signatureData, tokenRow.lineUserId || null]
        );
        confirmationId = insertResult.insertId;
      }

      await connection.query(
        `
          UPDATE purchase_confirmation_tokens
          SET used_at = NOW()
          WHERE id = ?
        `,
        [tokenRow.id]
      );

      return {
        id: confirmationId,
        orderId: tokenRow.orderId,
        customerId: tokenRow.customerId,
        orderNo: tokenRow.orderNo,
        customerName: tokenRow.customerName,
        customerPhone: tokenRow.customerPhone
      };
    });

    const pdf = await writePurchaseConfirmationPdf({
      confirmationId: confirmation.id,
      orderNo: confirmation.orderNo,
      customerName: confirmation.customerName,
      customerPhone: confirmation.customerPhone,
      submittedAt: new Date().toISOString()
    });

    await pool.query(
      `
        UPDATE purchase_confirmations
        SET pdf_path = ?
        WHERE id = ?
      `,
      [pdf.publicPath, confirmation.id]
    );

    await logKpi(null, "PURCHASE_CONFIRMATION_COMPLETED", "PURCHASE_CONFIRMATION", confirmation.id, 5);

    return res.status(201).json({
      id: confirmation.id,
      pdfPath: pdf.publicPath,
      message: "Purchase confirmation submitted"
    });
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
          pc.id,
          pc.token,
          pc.status,
          pc.order_id AS orderId,
          pc.customer_id AS customerId,
          pc.pdf_path AS pdfPath,
          pc.submitted_at AS submittedAt,
          pc.created_at AS createdAt,
          pc.confirmed_by_line_user_id AS confirmedByLineUserId,
          c.name AS customerName,
          c.phone AS customerPhone,
          o.order_no AS orderNo
        FROM purchase_confirmations pc
        INNER JOIN customers c ON c.id = pc.customer_id
        INNER JOIN orders o ON o.id = pc.order_id
        ORDER BY pc.id DESC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/pending-links", async (req, res, next) => {
  try {
    const [pendingRows] = await pool.query(
      `
        SELECT
          pc.id,
          pc.token,
          pc.status,
          pc.order_id AS order_id,
          pc.customer_id AS customer_id,
          pc.created_at AS created_at,
          pc.submitted_at AS submitted_at,
          pct.expires_at AS expires_at,
          c.name AS customer_name
        FROM purchase_confirmations pc
        LEFT JOIN customers c ON c.id = pc.customer_id
        LEFT JOIN purchase_confirmation_tokens pct ON pct.token = pc.token
        WHERE pc.status = 'PENDING'
        ORDER BY pc.created_at DESC
      `
    );

    const pending = pendingRows.map((row) => ({
      ...row,
      orderId: row.order_id,
      customerId: row.customer_id,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      expiresAt: row.expires_at,
      customerName: row.customer_name,
      link: row.token ? `${config.frontendBaseUrl}/purchase-confirm/${row.token}` : null
    }));

    return res.json({ pending });
  } catch (error) {
    return next(error);
  }
});

router.post("/generate-link", async (req, res, next) => {
  try {
    const customerId = Number(req.body.customerId);
    if (!customerId) {
      throw createError("customerId is required", 400);
    }

    const [rows] = await pool.query(
      `
        SELECT
          o.id AS orderId,
          o.order_no AS orderNo,
          c.id AS customerId,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          GROUP_CONCAT(DISTINCT p.id ORDER BY p.id) AS matchedProductIds,
          GROUP_CONCAT(DISTINCT p.category ORDER BY p.category) AS matchedProductCategories
        FROM orders o
        INNER JOIN customers c ON c.id = o.customer_id
        INNER JOIN order_items oi ON oi.order_id = o.id
        INNER JOIN products p ON p.id = oi.product_id
        WHERE c.id = ?
          AND o.status = 'COMPLETED'
          AND p.category = 'EBIKE'
        GROUP BY o.id, o.order_no, c.id, c.name, c.phone, c.line_user_id
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 1
      `,
      [customerId]
    );

    const order = rows[0];
    if (!order) {
      throw createError("No eligible completed EBIKE order found for this customer", 404);
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await withTransaction(async (connection) => {
      await connection.query(
        `
          INSERT INTO purchase_confirmation_tokens (token, order_id, customer_id, expires_at)
          VALUES (?, ?, ?, ?)
        `,
        [token, order.orderId, order.customerId, expiresAt]
      );

      await connection.query(
        `
          INSERT INTO purchase_confirmations (
            token,
            customer_id,
            order_id,
            status,
            created_at
          )
          VALUES (?, ?, ?, 'PENDING', NOW())
        `,
        [token, order.customerId, order.orderId]
      );
    });

    const link = `${config.frontendBaseUrl}/purchase-confirm/${token}`;

    if (order.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, order.lineUserId, [
        {
          type: "text",
          text: `\u8ACB\u9EDE\u64CA\u4EE5\u4E0B\u9023\u7D50\u5B8C\u6210\u8CFC\u8ECA\u78BA\u8A8D\uFF1A\n${link}`
        }
      ]);
    }

    return res.status(201).json({
      token,
      link,
      orderId: order.orderId,
      customerId: order.customerId,
      status: "PENDING",
      debug: {
        matchedOrderId: order.orderId,
        matchedProductIds: order.matchedProductIds ? order.matchedProductIds.split(",").map((value) => Number(value)) : [],
        matchedProductCategories: order.matchedProductCategories ? order.matchedProductCategories.split(",") : []
      }
    });
  } catch (error) {
    return next(error);
  }
});

async function fetchPurchaseConfirmationToken(token) {
  const [rows] = await pool.query(
    `
      SELECT
        pct.id,
        pct.token,
        pct.order_id AS orderId,
        pct.customer_id AS customerId,
        pct.expires_at AS expiresAt,
        pct.used_at AS usedAt,
        c.name AS customerName,
        c.phone AS customerPhone,
        c.line_user_id AS lineUserId,
        o.order_no AS orderNo
      FROM purchase_confirmation_tokens pct
      INNER JOIN customers c ON c.id = pct.customer_id
      INNER JOIN orders o ON o.id = pct.order_id
      WHERE pct.token = ?
      LIMIT 1
    `,
    [token]
  );

  return rows[0];
}

module.exports = router;
