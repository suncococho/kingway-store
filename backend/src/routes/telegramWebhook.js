const express = require("express");
const { handleStockCommand } = require("../services/telegramService");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const {
  handleTelegramConversationCallback,
  handleOrderApprovalCallback
} = require("../services/telegramService");

const { pool } = require("../db");

const router = express.Router();







const BOT_NOTIFY = "notify";

const DEFAULT_TELEGRAM_STORE_ID = Number(process.env.TELEGRAM_FALLBACK_STORE_ID || process.env.LEGACY_KINGWAY_STORE_ID || 1);

function resolveTelegramStoreId() {
  const resolved = Number(DEFAULT_TELEGRAM_STORE_ID);

  if (Number.isSafeInteger(resolved) && resolved > 0) {
    return resolved;
  }

  return 1;
}


async function sendDocument(chatId, filePath, caption = "") {
  try {
    const token = process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
    if (!token) return false;

    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption);

    const blob = new Blob([fs.readFileSync(filePath)]);
    form.append("document", blob, path.basename(filePath));

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form
    });

    return res.ok;
  } catch (e) {
    console.error("[TG send document error]", e);
    return false;
  }
}



async function sendStockGroupSupplierResult(text) {
  const stockGroupId = process.env.TELEGRAM_STOCK_GROUP_ID;
  if (!stockGroupId) return;
  await sendMessage(stockGroupId, text);
}


async function editTelegramMessageText(chatId, messageId, text) {
  try {
    const token = process.env.TELEGRAM_STOCK_BOT_TOKEN || process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
    if (!token || !chatId || !messageId) return;

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text
      })
    });
  } catch (e) {
    console.warn("Telegram edit supplier message failed:", e.message);
  }
}

async function sendMessage(chatId, text, replyMarkup = null) {
  try {
    const token = process.env.TELEGRAM_STOCK_BOT_TOKEN || process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
    if (!token) return;

    const body = {
      chat_id: chatId,
      text
    };

    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error("[TG send error]", e);
  }
}








async function handleLowStockAutoCommand(chatId, text, storeId) {
  if (!/^\/lowstock\s+auto$/i.test(String(text || "").trim())) return false;

  const [products] = await pool.query(
    `
      SELECT id, sku, name, stock, reorder_level AS reorderLevel
      FROM products
      WHERE is_active = 1
        AND reorder_level > 0
        AND stock <= reorder_level
        AND store_id = ?
      ORDER BY stock ASC, id DESC
      LIMIT 20
    `,
    [storeId]
  );

  if (!products.length) {
    await sendMessage(chatId, "✅ 目前沒有需要自動補貨的商品。");
    return true;
  }

  const lines = ["🤖 自動建立補貨發注單"];

  for (const product of products) {
    const suggestQty = Math.max(
      Number(product.reorderLevel || 1) - Number(product.stock || 0) + 1,
      1
    );

    const [requestResult] = await pool.query(
      `
        INSERT INTO supplier_requests
        (request_type, status, supplier_name, note, requested_by_staff_id)
        VALUES ('PURCHASE_ORDER', 'PENDING_SUPPLIER', 'kingway', 'AUTO LOW STOCK', 1)
      `
    );

    await pool.query(
      `
        INSERT INTO supplier_request_items
        (supplier_request_id, product_id, quantity, note)
        VALUES (?, ?, ?, 'AUTO LOW STOCK')
      `,
      [requestResult.insertId, product.id, suggestQty]
    );

    lines.push("");
    lines.push(`#${requestResult.insertId}`);
    lines.push(`${product.sku}`);
    lines.push(`${product.name}`);
    lines.push(`庫存：${product.stock}`);
    lines.push(`自動補貨：${suggestQty}`);
  }

  await sendMessage(chatId, lines.join("\n"));
  return true;
}






async function handleSupplierXlsxCommand(chatId, text, storeId) {
  const raw = String(text || "").trim();
  if (!/^\/supplier\s+xlsx(?:\s+\S+)?$/i.test(raw)) return false;

  const parts = raw.split(/\s+/);
  const supplierFilter = parts[2] || null;

  const where = [
    "DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')"
  ];

  const params = [];

  if (supplierFilter) {
    where.push("sr.supplier_name = ?");
    params.push(supplierFilter);
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.id,
        sr.supplier_name AS supplierName,
        sr.request_type AS requestType,
        sr.status,
        DATE_FORMAT(sr.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        p.sku,
        p.name,
        p.cost_price AS costPrice,
        sri.quantity,
        sri.received_quantity AS receivedQuantity,
        GREATEST(sri.quantity - sri.received_quantity, 0) AS pendingQuantity,
        sri.reason,
        sr.note
      FROM supplier_requests sr
      LEFT JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE ${where.join(" AND ")}
        AND p.store_id = ?
      ORDER BY sr.id DESC
    `,
    [...params, storeId]
  );

  if (!rows.length) {
    await sendMessage(chatId, "本月沒有可匯出的 XLSX 紀錄。");
    return true;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Supplier Report");

  sheet.columns = [
    { header: "單號", key: "id", width: 10 },
    { header: "供應商", key: "supplierName", width: 18 },
    { header: "類型", key: "requestType", width: 20 },
    { header: "狀態", key: "status", width: 24 },
    { header: "日期", key: "createdAt", width: 22 },
    { header: "SKU", key: "sku", width: 24 },
    { header: "商品名", key: "name", width: 30 },
    { header: "供應價", key: "costPrice", width: 12 },
    { header: "數量", key: "quantity", width: 10 },
    { header: "已入庫", key: "receivedQuantity", width: 10 },
    { header: "未入庫", key: "pendingQuantity", width: 10 },
    { header: "反品原因", key: "reason", width: 24 },
    { header: "備註", key: "note", width: 30 },
    { header: "小計", key: "subtotal", width: 14 }
  ];

  rows.forEach((r) => {
    sheet.addRow({
      ...r,
      subtotal: Number(r.costPrice || 0) * Number(r.quantity || 0)
    });
  });

  sheet.getRow(1).font = { bold: true };

  const month = new Date().toISOString().slice(0,7);
  const fileName = `supplier-${supplierFilter || "all"}-${month}.xlsx`;

  const dir = path.join(__dirname, "..", "storage", "reports");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, fileName);

  await workbook.xlsx.writeFile(filePath);

  const sent = await sendDocument(
    chatId,
    filePath,
    `供應商月報 XLSX｜${supplierFilter || "全部"}｜${month}`
  );

  await sendMessage(chatId, [
    sent ? "✅ XLSX 月報已傳送" : "⚠️ XLSX 已建立，但傳送失敗",
    `檔名：${fileName}`,
    `筆數：${rows.length}`
  ].join("\n"));

  return true;
}


async function handleSupplierMonthlyCommand(chatId, text, storeId) {
  const raw = String(text || "").trim();
  if (!/^\/supplier\s+monthly(?:\s+\S+)?$/i.test(raw)) return false;

  const parts = raw.split(/\s+/);
  const supplierFilter = parts[2] || null;

  const where = ["DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')"];
  const params = [];
  if (supplierFilter) {
    where.push("sr.supplier_name = ?");
    params.push(supplierFilter);
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.supplier_name AS supplierName,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.quantity ELSE 0 END) AS poQty,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.received_quantity ELSE 0 END) AS receivedQty,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN GREATEST(sri.quantity - sri.received_quantity, 0) ELSE 0 END) AS pendingQty,
        SUM(CASE WHEN sr.request_type='RETURN' THEN sri.quantity ELSE 0 END) AS returnQty,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.quantity * p.cost_price ELSE 0 END) AS poAmount,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN sri.received_quantity * p.cost_price ELSE 0 END) AS receivedAmount,
        SUM(CASE WHEN sr.request_type='PURCHASE_ORDER' THEN GREATEST(sri.quantity - sri.received_quantity, 0) * p.cost_price ELSE 0 END) AS pendingAmount,
        SUM(CASE WHEN sr.request_type='RETURN' THEN sri.quantity * p.cost_price ELSE 0 END) AS returnAmount
      FROM supplier_requests sr
      INNER JOIN supplier_request_items sri
        ON sri.supplier_request_id = sr.id
      INNER JOIN products p
        ON p.id = sri.product_id
       AND p.store_id = ?
      WHERE ${where.join(" AND ")}
      GROUP BY sr.supplier_name
      ORDER BY sr.supplier_name ASC
    `,
    [...params, storeId]
  );

  if (!rows.length) {
    await sendMessage(chatId, "本月沒有供應商月結資料。");
    return true;
  }

  const lines = [`📊 供應商月結${supplierFilter ? `｜${supplierFilter}` : ""}`];

  rows.forEach((r) => {
    lines.push("");
    lines.push(`供應商：${r.supplierName || "-"}`);
    lines.push(`發注數量：${Number(r.poQty || 0)}`);
    lines.push(`已入庫：${Number(r.receivedQty || 0)}`);
    lines.push(`未入庫：${Number(r.pendingQty || 0)}`);
    lines.push(`退貨數量：${Number(r.returnQty || 0)}`);
    lines.push(`發注金額：NT$ ${Number(r.poAmount || 0).toLocaleString()}`);
    lines.push(`已入庫金額：NT$ ${Number(r.receivedAmount || 0).toLocaleString()}`);
    lines.push(`未入庫金額：NT$ ${Number(r.pendingAmount || 0).toLocaleString()}`);
    lines.push(`退貨金額：NT$ ${Number(r.returnAmount || 0).toLocaleString()}`);
  });

  await sendMessage(chatId, lines.join("\n"));
  return true;
}


async function handleSupplierCsvCommand(chatId, text, storeId) {
  const raw = String(text || "").trim();
  if (!/^\/supplier\s+excel(?:\s+\S+)?$/i.test(raw)) return false;

  const parts = raw.split(/\s+/);
  const supplierFilter = parts[2] || null;

  const where = [
    "DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')"
  ];
  const params = [];

  if (supplierFilter) {
    where.push("sr.supplier_name = ?");
    params.push(supplierFilter);
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.id,
        sr.supplier_name AS supplierName,
        sr.request_type AS requestType,
        sr.status,
        DATE_FORMAT(sr.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        p.sku,
        p.name,
        p.cost_price AS costPrice,
        sri.quantity,
        sri.received_quantity AS receivedQuantity,
        GREATEST(sri.quantity - sri.received_quantity, 0) AS pendingQuantity,
        sri.reason,
        sr.note
      FROM supplier_requests sr
      INNER JOIN supplier_request_items sri
        ON sri.supplier_request_id = sr.id
      INNER JOIN products p
        ON p.id = sri.product_id
       AND p.store_id = ?
      WHERE ${where.join(" AND ")}
      ORDER BY sr.id DESC
    `,
    [...params, storeId]
  );

  if (!rows.length) {
    await sendMessage(chatId, "本月沒有可匯出的供應商紀錄。");
    return true;
  }

  const month = new Date().toISOString().slice(0,7);
  const fileName = `supplier-${supplierFilter || "all"}-${month}.csv`;
  const dir = path.join(__dirname, "..", "storage", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);

  const header = [
    "單號","供應商","類型","狀態","日期","SKU","商品名",
    "供應價","數量","已入庫","未入庫","反品原因","備註","小計"
  ];

  function csvCell(v) {
    const value = v === null || v === undefined ? "" : String(v);
    return `"${value.replace(/"/g, '""')}"`;
  }

  const lines = [header.map(csvCell).join(",")];

  rows.forEach((r) => {
    const subtotal = Number(r.costPrice || 0) * Number(r.quantity || 0);
    lines.push([
      r.id,
      r.supplierName,
      r.requestType,
      r.status,
      r.createdAt,
      r.sku,
      r.name,
      r.costPrice,
      r.quantity,
      r.receivedQuantity,
      r.pendingQuantity,
      r.reason,
      r.note,
      subtotal
    ].map(csvCell).join(","));
  });

  fs.writeFileSync(filePath, "\uFEFF" + lines.join("\n"), "utf8");

  const sentFile = await sendDocument(
    chatId,
    filePath,
    `供應商月報 CSV｜${supplierFilter || "全部"}｜${month}`
  );

  await sendMessage(chatId, [
    sentFile ? "✅ 供應商月報 CSV 已傳送" : "✅ 供應商月報 CSV 已建立，但檔案傳送失敗",
    `檔名：${fileName}`,
    `筆數：${rows.length}`
  ].join("\n"));

  return true;
}


async function handleSupplierReportCommand(chatId, text, storeId) {
  const raw = String(text || "").trim();
  if (!/^\/supplier\s+report(?:\s+\S+)?$/i.test(raw)) return false;

  const parts = raw.split(/\s+/);
  const supplierFilter = parts[2] || null;

  const where = [
    "DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')"
  ];

  const params = [];

  if (supplierFilter) {
    where.push("sr.supplier_name = ?");
    params.push(supplierFilter);
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.supplier_name AS supplierName,
        sr.request_type AS requestType,
        sr.status,
        SUM(sri.quantity) AS qty
      FROM supplier_requests sr
      INNER JOIN supplier_request_items sri
        ON sri.supplier_request_id = sr.id
      INNER JOIN products p
        ON p.id = sri.product_id
       AND p.store_id = ?
      WHERE ${where.join(" AND ")}
      GROUP BY sr.supplier_name, sr.request_type, sr.status
      ORDER BY sr.supplier_name ASC
    `,
    [...params, storeId]
  );

  if (!rows.length) {
    await sendMessage(chatId, "本月沒有供應商紀錄。");
    return true;
  }

  const lines = [
    `📊 供應商月報表${supplierFilter ? `｜${supplierFilter}` : ""}`
  ];

  rows.forEach((row) => {
    lines.push("");
    lines.push(`供應商：${row.supplierName || "-"}`);
    lines.push(`類型：${row.requestType}`);
    lines.push(`狀態：${row.status}`);
    lines.push(`總數量：${row.qty || 0}`);
  });

  await sendMessage(chatId, lines.join("\n"));
  return true;
}


async function handleSupplierHelpCommand(chatId, text) {
  const normalized = String(text || "").trim();

  if (!/^\/(help|po_help|supplier_help)(?:@\w+)?(?:\s+.*)?$/i.test(normalized)) {
    return false;
  }

  await sendMessage(chatId, [
    "📦 台南怪獸屋 庫存 / 發注 / 換貨指令",
    "",
    "【查詢】",
    "/stock SKU",
    "/lowstock",
    "/supplier_list",
    "",
    "【發注】",
    "/po 供應商 SKU 數量 備註",
    "例：/po KINGWAY B-EB-001-S1 1 補貨",
    "",
    "【換貨 / 退貨】",
    "/return 供應商 SKU 數量 原因",
    "例：/return KINGWAY B-EB-001-S1 1 瑕疵換貨",
    "",
    "【入庫】",
    "/receive 發注單號 數量",
    "",
    "【月結 / 報表】",
    "/supplier_monthly",
    "/supplier_xlsx"
  ].join("\n"));

  return true;
}

async function handleLowStockCommand(chatId, text, storeId) {
  if (!/^\/lowstock$/i.test(String(text || "").trim())) return false;

  const [rows] = await pool.query(
    `
      SELECT id, sku, name, stock, reorder_level AS reorderLevel
      FROM products
      WHERE is_active = 1
        AND reorder_level > 0
        AND stock <= reorder_level
        AND store_id = ?
      ORDER BY stock ASC, id DESC
      LIMIT 20
    `,
    [storeId]
  );

  if (!rows.length) {
    await sendMessage(chatId, "✅ 目前沒有低庫存商品。");
    return true;
  }

  const lines = ["⚠️ 低庫存商品"];
  rows.forEach((p, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${p.sku}`);
    lines.push(`${p.name}`);
    lines.push(`庫存：${p.stock} / 安全庫存：${p.reorderLevel}`);
    lines.push(`建議：/po ${p.sku} ${Math.max(Number(p.reorderLevel || 1) - Number(p.stock || 0) + 1, 1)} 補貨`);
  });

  await sendMessage(chatId, lines.join("\n"));
  return true;
}


async function handleSupplierListCommand(chatId, text, storeId) {
  const raw = String(text || "").trim();
  if (!/^\/supplier(?:\s+(pending))?(?:\s+(\S+))?$/i.test(raw) && !/^\/supplier\s+\S+$/i.test(raw)) return false;

  const parts = raw.split(/\s+/);
  let onlyPending = false;
  let supplierFilter = null;

  if (parts[1]?.toLowerCase() === "pending") {
    onlyPending = true;
    supplierFilter = parts[2] || null;
  } else {
    supplierFilter = parts[1] || null;
  }

  const where = [];
  const params = [];

  if (onlyPending) {
    where.push("sr.status IN ('PENDING_SUPPLIER', 'PARTIALLY_RECEIVED')");
  }

  if (supplierFilter) {
    where.push("sr.supplier_name = ?");
    params.push(supplierFilter);
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.id,
        sr.request_type AS requestType,
        sr.status,
        sr.supplier_name AS supplierName,
        sr.note,
        sri.quantity,
        sri.received_quantity AS receivedQuantity,
        sri.reason,
        p.sku,
        p.name
      FROM supplier_requests sr
      INNER JOIN supplier_request_items sri
        ON sri.supplier_request_id = sr.id
      INNER JOIN products p
        ON p.id = sri.product_id
       AND p.store_id = ?
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY sr.id DESC
      LIMIT 10
    `,
    [storeId, ...params]
  );

  if (!rows.length) {
    await sendMessage(chatId, supplierFilter ? `目前沒有 ${supplierFilter} 的發注/退貨紀錄。` : "目前沒有發注/退貨紀錄。");
    return true;
  }

  const lines = [
    `${onlyPending ? "📦 待處理發注 / 退貨紀錄" : "📦 最近發注 / 退貨紀錄"}${supplierFilter ? `｜${supplierFilter}` : ""}`
  ];

  rows.forEach((row) => {
    lines.push("");
    lines.push(`#${row.id} ${row.requestType} / ${row.status} / ${row.supplierName || "-"}`);
    lines.push(`${row.sku || "-"} / ${row.name || "-"}`);
    lines.push(`數量：${row.quantity || 0} / 已入庫：${row.receivedQuantity || 0}`);
    if (row.reason) lines.push(`原因：${row.reason}`);
    if (row.note) lines.push(`備註：${row.note}`);
  });

  await sendMessage(chatId, lines.join("\n"));
  return true;
}

async function handleSupplierReturnDoneCommand(chatId, text, storeId) {
  const match = String(text || "").trim().match(/^\/return-done\s+(\d+)$/i);
  if (!match) return false;

  const requestId = Number(match[1]);

  const [[reqRow]] = await pool.query(
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

  if (!reqRow) {
    await sendMessage(chatId, `找不到退貨單 #${requestId}`);
    return true;
  }

  if (reqRow.requestType !== "RETURN") {
    await sendMessage(chatId, `#${requestId} 不是退貨單。`);
    return true;
  }

  if (reqRow.status === "RETURN_CONFIRMED") {
    await sendMessage(chatId, `退貨單 #${requestId} 已確認過，未重複扣庫存。`);
    return true;
  }

  const [[item]] = await pool.query(
    `
      SELECT sri.id, sri.product_id AS productId, sri.quantity,
             p.sku, p.name, p.stock
      FROM supplier_request_items sri
      JOIN products p ON p.id = sri.product_id AND p.store_id = ?
      WHERE sri.supplier_request_id = ?
      LIMIT 1
    `,
    [storeId, requestId]
  );

  if (!item) {
    await sendMessage(chatId, `退貨單 #${requestId} 沒有商品資料`);
    return true;
  }

  await pool.query(
    `UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ? AND store_id = ?`,
    [Number(item.quantity || 0), item.productId, storeId]
  );

  await pool.query(
    `UPDATE supplier_requests SET status = 'RETURN_CONFIRMED', supplier_responded_at = NOW() WHERE id = ?`,
    [requestId]
  );

  await sendMessage(
    chatId,
    [
      "✅ 退貨完成",
      `單號：#${requestId}`,
      `SKU：${item.sku}`,
      `商品：${item.name}`,
      `退貨數量：${item.quantity}`,
      `庫存：${Number(item.stock || 0)} → ${Math.max(Number(item.stock || 0) - Number(item.quantity || 0), 0)}`,
      "狀態：RETURN_CONFIRMED"
    ].join("\n")
  );

  return true;
}


async function handleSupplierReceiveCommand(chatId, text, storeId) {
  const match = String(text || "").trim().match(/^\/receive\s+(\d+)\s+(\d+)$/i);
  if (!match) return false;

  const requestId = Number(match[1]);
  const receiveQty = Number(match[2]);

  if (!requestId || receiveQty <= 0) {
    await sendMessage(chatId, "格式錯誤：/receive 發注單號 數量");
    return true;
  }

  const [[reqRow]] = await pool.query(
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

  if (!reqRow) {
    await sendMessage(chatId, `找不到發注單 #${requestId}`);
    return true;
  }

  if (reqRow.requestType !== "PURCHASE_ORDER") {
    await sendMessage(chatId, `#${requestId} 不是發注單，無法入庫。`);
    return true;
  }

  const [[item]] = await pool.query(
    `
      SELECT sri.id, sri.product_id AS productId, sri.quantity, sri.received_quantity AS receivedQuantity,
             p.sku, p.name, p.stock
      FROM supplier_request_items sri
      JOIN products p ON p.id = sri.product_id AND p.store_id = ?
      WHERE sri.supplier_request_id = ?
      LIMIT 1
    `,
    [storeId, requestId]
  );

  if (!item) {
    await sendMessage(chatId, `發注單 #${requestId} 沒有商品資料`);
    return true;
  }

  const remaining = Math.max(Number(item.quantity || 0) - Number(item.receivedQuantity || 0), 0);
  const actualReceive = Math.min(receiveQty, remaining);

  if (actualReceive <= 0) {
    await sendMessage(chatId, `發注單 #${requestId} 已全部入庫。`);
    return true;
  }

  await pool.query(
    `UPDATE supplier_request_items SET received_quantity = received_quantity + ? WHERE id = ?`,
    [actualReceive, item.id]
  );

  await pool.query(
    `UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?`,
    [actualReceive, item.productId, storeId]
  );

  const newReceived = Number(item.receivedQuantity || 0) + actualReceive;
  const newStatus = newReceived >= Number(item.quantity || 0) ? "RECEIVED" : "PARTIALLY_RECEIVED";

  await pool.query(
    `UPDATE supplier_requests SET status = ?, supplier_responded_at = NOW() WHERE id = ?`,
    [newStatus, requestId]
  );

  await sendMessage(
    chatId,
    [
      "✅ 發注入庫完成",
      `單號：#${requestId}`,
      `SKU：${item.sku}`,
      `商品：${item.name}`,
      `本次入庫：${actualReceive}`,
      `累計入庫：${newReceived}/${item.quantity}`,
      `庫存：${Number(item.stock || 0)} → ${Number(item.stock || 0) + actualReceive}`,
      `狀態：${newStatus}`
    ].join("\n")
  );

  return true;
}


async function handleSupplierCommand(chatId, text, storeId) {
  const parts = String(text || "").trim().split(/\s+/);
  if (!parts.length || !/^\/(po|return)$/i.test(parts[0])) return false;

  const command = parts[0].replace("/", "").toLowerCase();

  let supplierName = "kingway";
  let skuIndex = 1;

  if (parts.length >= 4 && !parts[1].includes("-")) {
    supplierName = parts[1];
    skuIndex = 2;
  }

  const sku = parts[skuIndex];
  const quantity = Number(parts[skuIndex + 1] || 0);
  const note = parts.slice(skuIndex + 2).join(" ") || null;

  if (!sku || quantity <= 0) {
    await sendMessage(chatId, "格式錯誤：/po [供應商] SKU 數量 備註 或 /return [供應商] SKU 數量 原因");
    return true;
  }

  const [[product]] = await pool.query(
    `SELECT id, sku, name, stock FROM products WHERE sku = ? AND store_id = ? LIMIT 1`,
    [sku, storeId]
  );

  if (!product) {
    await sendMessage(chatId, `找不到商品 SKU：${sku}`);
    return true;
  }

  const requestType = command === "po" ? "PURCHASE_ORDER" : "RETURN";
  const [requestResult] = await pool.query(
    `
      INSERT INTO supplier_requests
      (request_type, status, supplier_name, note, requested_by_staff_id)
      VALUES (?, 'PENDING_SUPPLIER', ?, ?, 1)
    `,
    [requestType, supplierName, note]
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
      quantity,
      command === "return" ? note : null,
      command === "po" ? note : null
    ]
  );

  await sendMessage(
    chatId,
    [
      command === "po" ? "✅ 發注單已建立" : "✅ 退貨單已建立",
      `單號：#${requestResult.insertId}`,
      `供應商：${supplierName}`,
      `SKU：${product.sku}`,
      `商品：${product.name}`,
      `數量：${quantity}`,
      `目前庫存：${product.stock}`,
      note ? `${command === "po" ? "備註" : "原因"}：${note}` : null
    ].filter(Boolean).join("\n")
  );

  return true;
}


router.post("/webhook", async (req, res) => {
  try {
    const telegramStoreId = resolveTelegramStoreId();
    const callbackQuery = req.body?.callback_query;

    console.log("[TG_CALLBACK_DEBUG]", {
      hasCallback: !!callbackQuery,
      data: callbackQuery?.data
    });

    const rawCallbackData = String(callbackQuery?.data || "");
    const lineOrderMatch = rawCallbackData.match(/^line_order:(confirm|reject):(\d+)$/);
    if (lineOrderMatch) {
      const approveAction = lineOrderMatch[1] === "confirm" ? "approve_order" : "reject_order";
      console.log("[LINE_ORDER_CALLBACK_ROUTE_MATCH]", {
        rawCallbackData,
        approveAction,
        orderId: lineOrderMatch[2]
      });
      await handleOrderApprovalCallback(BOT_NOTIFY, callbackQuery, approveAction, lineOrderMatch[2]);
      return res.json({ ok: true });
    }

    if (callbackQuery?.data && String(callbackQuery.data).startsWith("line_order:")) {
      const parts = String(callbackQuery.data).split(":");
      const action = parts[1];
      const orderId = Number(parts[2]);
      const chatId = callbackQuery.message?.chat?.id;

      if (!orderId || !["confirm", "reject"].includes(action)) {
        if (chatId) await sendMessage(chatId, "此 LINE 訂單按鈕資料無效。");
        return res.json({ ok: true });
      }

      const nextStatus = action === "confirm" ? "PENDING_PAYMENT" : "CANCELED";
      const noteText = action === "confirm" ? "Telegram 已確認 LINE 訂單" : "Telegram 已拒絕 LINE 訂單";

      await pool.query(
        `UPDATE orders
         SET status = ?,
             notes = CONCAT(COALESCE(notes, ''), '\n', ?)
         WHERE id = ?
           AND source = 'line_order'`,
        [nextStatus, noteText, orderId]
      );

      if (chatId) {
        await sendMessage(
          chatId,
          action === "confirm"
            ? `✅ LINE 訂單 #${orderId} 已確認，等待客戶付款。`
            : `❌ LINE 訂單 #${orderId} 已拒絕。`
        );
      }

      return res.json({ ok: true });
    }

    const googleReviewMatch = rawCallbackData.match(/^action=google_review_(approve|reject)&id=(\d+)$/);
    if (googleReviewMatch) {
      const action = googleReviewMatch[1];
      const couponId = Number(googleReviewMatch[2]);
      const approved = action === "approve";
      const chatId = callbackQuery.message?.chat?.id;

      const [[coupon]] = await pool.query(
        `
          SELECT
            cp.id,
            cp.code,
            cp.amount,
            cp.customer_id AS customerId,
            cp.order_id AS orderId,
            cp.status,
            cp.is_used AS isUsed,
            c.name AS customerName,
            c.phone AS customerPhone,
            c.line_user_id AS lineUserId
          FROM coupons cp
          INNER JOIN customers c ON c.id = cp.customer_id
          WHERE cp.id = ?
            AND cp.coupon_type = 'google_review'
          LIMIT 1
        `,
        [couponId]
      );

      if (!coupon) {
        if (chatId) await sendMessage(chatId, `找不到 Google 評論 #${couponId}`);
        return res.json({ ok: true });
      }

      if (Number(coupon.isUsed || 0) || coupon.status === "used") {
        if (chatId) await sendMessage(chatId, `Google 評論 #${couponId} 已處理過。`);
        return res.json({ ok: true });
      }

      if (!approved) {
        await pool.query(
          `
            UPDATE coupons
            SET status='rejected',
                rejected_at=NOW(),
                rejection_reason='Telegram 審核拒絕'
            WHERE id=?
          `,
          [couponId]
        );

        if (chatId) await sendMessage(chatId, `❌ Google 評論 #${couponId} 已拒絕。`);
        return res.json({ ok: true });
      }

      await pool.query(
        `
          UPDATE coupons
          SET status='approved',
              approved_at=NOW()
          WHERE id=?
        `,
        [couponId]
      );

      if (chatId) {
        await sendMessage(
          chatId,
          `✅ Google 評論 #${couponId} 已確認。`
        );
      }

      return res.json({ ok: true });
    }

    if (callbackQuery?.data && String(callbackQuery.data).startsWith("supplier:")) {
      const parts = String(callbackQuery.data).split(":");
      const action = parts[1];
      const requestId = Number(parts[2]);
      const callbackStoreId = Number(parts[3]);
      const requestStoreIdFilter = Number.isSafeInteger(callbackStoreId) && callbackStoreId > 0 ? callbackStoreId : Number(telegramStoreId);

      if (!requestId || !["approve", "reject"].includes(action)) {
        if (callbackQuery.message?.chat?.id) {
          await sendMessage(callbackQuery.message.chat.id, "此按鈕資料無效。");
        }
        return res.json({ ok: true });
      }

      const [[request]] = await pool.query(
        `
          SELECT
            sr.id,
            sr.request_type AS requestType,
            sr.status,
            sr.supplier_name AS supplierName,
            sr.note,
            sri.quantity,
            p.id AS product_id,
            p.store_id AS product_store_id,
            p.sku,
            p.name AS productName
          FROM supplier_requests sr
          INNER JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
          INNER JOIN products p ON p.id = sri.product_id
            AND p.store_id = ?
          WHERE sr.id = ?
          LIMIT 1
        `,
        [requestStoreIdFilter, requestId]
      );

      if (!request) {
        if (callbackQuery.message?.chat?.id) {
          await sendMessage(callbackQuery.message.chat.id, `找不到單號 #${requestId}`);
        }
        return res.json({ ok: true });
      }

      if (["RECEIVED", "RETURN_CONFIRMED"].includes(request.status)) {
        if (callbackQuery.message?.chat?.id) {
          await sendMessage(callbackQuery.message.chat.id, `#${requestId} 已完成，不能再變更。`);
        }
        return res.json({ ok: true });
      }

      let nextStatus = action === "approve" ? "APPROVED" : "REJECTED";

  if (action === "approve" && request.requestType === "RETURN") {
    nextStatus = "RETURN_CONFIRMED";

        const returnQty = Math.abs(Number(request.quantity || 0));

        if (returnQty > 0 && request.product_id) {
          await pool.query(
            `INSERT INTO inventory_movements
             (product_id, movement_type, quantity, reference_type, reference_id, notes)
            VALUES (?, 'OUT', ?, 'SUPPLIER_REQUEST', ?, ?)`,
            [
              request.product_id,
              -returnQty,
              requestId,
              `Supplier return confirmed #${requestId} / ${request.sku}`
            ]
          );

          await pool.query(
            "UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?",
            [returnQty, request.product_id, requestStoreIdFilter]
          );
        }
      }

      await pool.query(
        "UPDATE supplier_requests SET status = ?, supplier_responded_at = NOW(), supplier_response_note = ? WHERE id = ?",
        [nextStatus, action === "approve" ? "供應商確認" : "供應商拒絕", requestId]
      );

      const typeLabel = request.requestType === "RETURN" ? "退貨" : "發注";
      const resultLabel = action === "approve" ? "✅ 供應商已確認" : "❌ 供應商已拒絕";

      const resultText = [
        resultLabel,
        `${typeLabel}單號：#${requestId}`,
        `供應商：${request.supplierName || "-"}`,
        `SKU：${request.sku || "-"}`,
        `品項：${request.productName || "-"}`,
        `數量：${request.quantity || 0}`,
        `狀態：${nextStatus}`
      ].join("\n");

      if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
        await editTelegramMessageText(
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          resultText
        );
      } else if (callbackQuery.message?.chat?.id) {
        await sendMessage(callbackQuery.message.chat.id, resultText);
      }

      await sendStockGroupSupplierResult(resultText);

      return res.json({ ok: true });
    }

    if (callbackQuery) {
      console.log("[TG callback]", callbackQuery.data);

      const handled = await handleTelegramConversationCallback(BOT_NOTIFY, callbackQuery);
      if (!handled) {
        await sendMessage(callbackQuery.message?.chat?.id, "此按鈕目前無法處理。");
      }

      return res.sendStatus(200);
    }

    const msg = req.body?.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text;

    console.log("[TG webhook]", text, JSON.stringify({
    chatId: req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id,
    chatType: req.body?.message?.chat?.type || req.body?.callback_query?.message?.chat?.type,
    chatTitle: req.body?.message?.chat?.title || req.body?.callback_query?.message?.chat?.title
  }));

    if (!chatId || !text) return res.sendStatus(200);

    if (await handleSupplierXlsxCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierMonthlyCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierCsvCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierReportCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleLowStockAutoCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierHelpCommand(chatId, text)) {
      return res.sendStatus(200);
    }

    if (await handleLowStockCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierListCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierReturnDoneCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierReceiveCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (await handleSupplierCommand(chatId, text, telegramStoreId)) {
      return res.sendStatus(200);
    }

    if (text === "/start") {
      await sendMessage(chatId, "Telegram 連接完成");
      return res.sendStatus(200);
    }

    if (text === "維修確認" || text === "確認維修") {
      await sendMessage(chatId, "✅ 維修已確認（測試）");
      return res.sendStatus(200);
    }

    await sendMessage(chatId, "指令未識別");
    return res.sendStatus(200);

  } catch (err) {
    console.error("[TG error]", err);
    return res.sendStatus(200);
  }
});

module.exports = router;
