const express = require("express");
const { sendInternalTelegram } = require("../services/telegramService");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");

const router = express.Router();

async function notifySupplierRequestTelegram({ requestId, requestType, supplierName, note, items = [] }) {
  const token = process.env.TELEGRAM_STOCK_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_SUPPLIER_CHAT_ID ||
    process.env.TELEGRAM_STOCK_GROUP_ID ||
    process.env.TELEGRAM_STOCK_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[supplier:telegram] skipped missing env", {
      hasToken: Boolean(token),
      chatId: chatId || null
    });
    return;
  }

  const typeLabel = requestType === "RETURN" ? "退貨 / 換貨" : "發注";
  const itemLines = items.length
    ? items.map((item, index) => {
        const name =
          item.productName ||
          item.product_name ||
          item.product_name_snapshot ||
          item.name ||
          item.note ||
          `商品ID ${item.productId || item.product_id || "-"}`;

        const sku =
          item.sku ||
          item.productSku ||
          item.product_sku ||
          item.product_sku_snapshot ||
          "";

        const qty = Number(item.quantity || item.qty || 0);

        return [
          `${index + 1}. ${name}`,
          sku ? `   SKU：${sku}` : null,
          `   數量：${qty}`
        ].filter(Boolean).join("\n");
      }).join("\n")
    : "- 無商品明細";

  const text = [
    `📦 KINGWAY ${typeLabel}申請`,
    "",
    `單號：PO-${requestId}`,
    `供應商：${supplierName || "-"}`,
    "狀態：待供應商確認",
    "",
    "商品明細",
    itemLines,
    "",
    note ? `備註：${note}` : null,
    "",
    "請供應商確認或拒絕。"
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const body = await response.text();

    if (!response.ok) {
      console.error("[supplier:telegram] send failed", {
        status: response.status,
        body
      });
      return;
    }

    console.log("[supplier:telegram] sent", {
      requestId,
      chatId,
      status: response.status
    });
  } catch (error) {
    console.error("[supplier:telegram] send error", error);
  }
}



async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = process.env.TELEGRAM_STOCK_BOT_TOKEN || process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
  if (!token || !chatId) return;

  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("Telegram supplier message failed:", e.message);
  }
}

async function sendSupplierDecisionRequest(requestId, requestType, supplierName, sku, productName, quantity, note) {
  const supplierGroupId = process.env.TELEGRAM_HQ_GROUP_ID;
  const title = requestType === "RETURN" ? "退貨申請" : "發注申請";

  const text = [
    `📦 ${title}`,
    `單號：#${requestId}`,
    `供應商：${supplierName || "-"}`,
    `SKU：${sku || "-"}`,
    `品項：${productName || "-"}`,
    `數量：${quantity || 0}`,
    note ? `備註：${note}` : null,
    "",
    "請供應商確認或拒絕。"
  ].filter(Boolean).join("\\n");

  await sendTelegramMessage(supplierGroupId, text, {
    inline_keyboard: [[
      { text: "✅ 確認", callback_data: `supplier:approve:${requestId}` },
      { text: "❌ 拒絕", callback_data: `supplier:reject:${requestId}` }
    ]]
  });
}

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]));

router.get("/requests", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(`
      SELECT
        sr.id,
        sr.request_type AS requestType,
        sr.status,
        sr.supplier_name AS supplierName,
        sr.note,
        sr.created_at AS createdAt,
        sri.product_id AS productId,
        sri.quantity,
        sri.received_quantity AS receivedQuantity,
        sri.reason,
        p.sku,
        p.name AS productName,
        p.stock,
        p.cost_price AS costPrice
      FROM supplier_requests sr
      LEFT JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE p.store_id = ?
        AND sr.status IN ('PENDING_SUPPLIER', 'PARTIALLY_RECEIVED')
      ORDER BY sr.id DESC
      LIMIT 200
    `, [storeId]);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});


router.post("/requests", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { type, supplierName = "kingway", sku, quantity, note } = req.body || {};
    const requestType = String(type || "").toUpperCase() === "RETURN" ? "RETURN" : "PURCHASE_ORDER";
    const qty = Math.max(Number(quantity || 0), 0);

    if (!sku || qty <= 0) {
      return res.status(400).json({ message: "SKU 與數量必填" });
    }

    const [[product]] = await pool.query(
      "SELECT id, sku, name, stock FROM products WHERE sku = ? AND store_id = ? LIMIT 1",
      [sku, storeId]
    );

    if (!product) {
      return res.status(404).json({ message: `找不到商品 SKU：${sku}` });
    }

    const [requestResult] = await pool.query(
      `
        INSERT INTO supplier_requests
        (request_type, status, supplier_name, note, requested_by_staff_id)
        VALUES (?, 'PENDING_SUPPLIER', ?, ?, ?)
      `,
      [requestType, supplierName, note || null, req.user.id]
    );

    await pool.query(
      `
        INSERT INTO supplier_request_items
        (supplier_request_id, product_id, quantity, reason, note)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        requestResult.insertId,
        product.id,
        qty,
        requestType === "RETURN" ? note || null : null,
        requestType === "PURCHASE_ORDER" ? note || null : null
      ]
    );

    try {
      await sendSupplierDecisionRequest(
        requestResult.insertId,
        requestType,
        supplierName,
        sku,
        product.name,
        qty,
        note
      );
    } catch (e) {
      console.warn("Supplier decision request send failed:", e.message);
    }

    // SUPPLIERS_NOTIFY_CALL_V2
    await notifySupplierRequestTelegram({
      requestId,
      requestType,
      supplierName,
      note,
      items
    });

    return res.status(201).json({
      id: requestResult.insertId,
      requestType,
      supplierName,
      sku: product.sku,
      productName: product.name,
      quantity: qty
    });
  } catch (error) {
    return next(error);
  }
});



router.post("/:id/receive", async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    const storeId = req.storeId;
    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.status(400).json({ message: "請提供有效單號" });
    }

    await conn.beginTransaction();

    const [[request]] = await conn.query(
      `
        SELECT sr.id, sr.request_type AS requestType, sr.status
        FROM supplier_requests sr
        INNER JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sr.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [storeId, requestId]
    );

    if (!request) {
      await conn.rollback();
      return res.status(404).json({ message: "找不到發注單" });
    }

    if (request.requestType !== "PURCHASE_ORDER") {
      await conn.rollback();
      return res.status(400).json({ message: "此單不是發注單，不能入庫" });
    }

    if (request.status === "RECEIVED") {
      await conn.rollback();
      return res.status(409).json({ message: "此發注單已入庫完成，不能重複入庫" });
    }

    const [[item]] = await conn.query(
      `
        SELECT sri.id, sri.product_id AS productId, sri.quantity,
               sri.received_quantity AS receivedQuantity,
               p.stock, p.sku, p.name
        FROM supplier_request_items sri
        JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sri.supplier_request_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [storeId, requestId]
    );

    if (!item) {
      await conn.rollback();
      return res.status(404).json({ message: "找不到商品項目" });
    }

    const remaining = Math.max(Number(item.quantity || 0) - Number(item.receivedQuantity || 0), 0);

    if (remaining <= 0) {
      await conn.query(
        "UPDATE supplier_requests SET status = 'RECEIVED', supplier_responded_at = NOW() WHERE id = ?",
        [requestId]
      );
      await conn.commit();
      return res.json({ message: "此發注單已全部入庫", actualReceive: 0, status: "RECEIVED" });
    }

    const actualReceive = remaining;

    await conn.query(
      "UPDATE supplier_request_items SET received_quantity = received_quantity + ? WHERE id = ?",
      [actualReceive, item.id]
    );

    await conn.query(
      "UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?",
      [actualReceive, item.productId, storeId]
    );

    console.log("[SUPPLIER_RECEIVE] before movement insert", {
      requestId,
      productId: item.productId,
      actualReceive,
      sku: item.sku
    });

    await conn.query(
      `INSERT INTO inventory_movements
       (product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
       VALUES (?, 'IN', ?, 'SUPPLIER_REQUEST', ?, ?, ?)`,
      [
        item.productId,
        actualReceive,
        requestId,
        req.user?.id || 1,
        `Supplier receive #${requestId} / ${item.sku}`
      ]
    );

    console.log("[SUPPLIER_RECEIVE] after movement insert", { requestId });

    const newReceived = Number(item.receivedQuantity || 0) + actualReceive;
    const newStatus = newReceived >= Number(item.quantity || 0) ? "RECEIVED" : "PARTIALLY_RECEIVED";

    await conn.query(
      "UPDATE supplier_requests SET status = ?, supplier_responded_at = NOW() WHERE id = ?",
      [newStatus, requestId]
    );

    await conn.commit();

    return res.json({
      id: requestId,
      sku: item.sku,
      productName: item.name,
      actualReceive,
      receivedQuantity: newReceived,
      totalQuantity: item.quantity,
      stockBefore: item.stock,
      stockAfter: Number(item.stock || 0) + actualReceive,
      status: newStatus
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    return next(error);
  } finally {
    conn.release();
  }
});



router.post("/:id/return-done", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const requestId = Number(req.params.id);

    const [[request]] = await pool.query(
      `
        SELECT sr.id, sr.request_type AS requestType, sr.status
        FROM supplier_requests sr
        INNER JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sr.id = ?
        LIMIT 1
      `,
      [storeId, requestId]
    );

    if (!request) {
      return res.status(404).json({ message: "找不到退貨單" });
    }

    if (request.requestType !== "RETURN") {
      return res.status(400).json({ message: "此單不是退貨單" });
    }

    if (request.status === "RETURN_CONFIRMED") {
      return res.json({ message: "退貨單已確認過，未重複扣庫存" });
    }

    const [[item]] = await pool.query(
      `
        SELECT sri.product_id AS productId,
               sri.quantity,
               p.stock,
               p.sku,
               p.name
        FROM supplier_request_items sri
        JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sri.supplier_request_id = ?
        LIMIT 1
      `,
      [storeId, requestId]
    );

    if (!item) {
      return res.status(404).json({ message: "找不到退貨商品" });
    }

    await pool.query(
      "UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ? AND store_id = ?",
      [Number(item.quantity || 0), item.productId, storeId]
    );

    await pool.query(
      "UPDATE supplier_requests SET status = 'RETURN_CONFIRMED', supplier_responded_at = NOW() WHERE id = ?",
      [requestId]
    );

    return res.json({
      id: requestId,
      sku: item.sku,
      productName: item.name,
      quantity: item.quantity,
      stockBefore: item.stock,
      stockAfter: Math.max(Number(item.stock || 0) - Number(item.quantity || 0), 0),
      status: "RETURN_CONFIRMED"
    });
  } catch (error) {
    return next(error);
  }
});


router.get("/monthly", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(`
      SELECT
        sr.supplier_name AS supplierName,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.quantity ELSE 0 END) AS poQty,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.received_quantity ELSE 0 END) AS receivedQty,
        SUM(CASE WHEN sr.request_type='RETURN' THEN sri.quantity ELSE 0 END) AS returnQty,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.quantity * p.cost_price ELSE 0 END) AS poAmount,
        SUM(CASE WHEN sr.request_type='RETURN' THEN sri.quantity * p.cost_price ELSE 0 END) AS returnAmount
      FROM supplier_requests sr
      LEFT JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE p.store_id = ?
        AND DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
      GROUP BY sr.supplier_name
      ORDER BY sr.supplier_name ASC
    `, [storeId]);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
