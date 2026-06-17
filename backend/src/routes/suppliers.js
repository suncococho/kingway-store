const express = require("express");
const { sendInternalTelegram } = require("../services/telegramService");
const { pool } = require("../db");
const config = require("../config");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { resolveStoreLineCredentials } = require("../services/storeLineSettingsService");
const { sendLineMessage } = require("../utils/line");

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

async function sendSupplierDecisionRequest(requestId, requestType, supplierName, sku, productName, quantity, note, storeId = 1) {
  const supplierGroupId = process.env.TELEGRAM_HQ_GROUP_ID;
  const callbackStoreId = Number(storeId || 1);
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
  ].filter(Boolean).join("\n");

  await sendTelegramMessage(supplierGroupId, text, {
    inline_keyboard: [[
      { text: "✅ 確認", callback_data: `supplier:approve:${requestId}:${callbackStoreId}` },
      { text: "❌ 拒絕", callback_data: `supplier:reject:${requestId}:${callbackStoreId}` }
    ]]
  });
}

function buildSupplierLineNotificationText({ requestType, supplierName, sku, productName, quantity }) {
  const isReturn = requestType === "RETURN";
  return [
    isReturn ? "【KINGWAY 退貨通知】" : "【KINGWAY 發注通知】",
    `供應商：${supplierName || "-"}`,
    `商品：${sku || "-"} / ${productName || "-"}`,
    `數量：${Number(quantity || 0)}`,
    `狀態：${isReturn ? "待退貨/已建立" : "待入庫"}`,
    "來源：供應商管理"
  ].join("\n");
}

async function resolveSupplierLineGroupTarget(connection = pool) {
  const fallbackTypes = ["inventory", "daily", "staff", "admin"];
  const orderCases = fallbackTypes.map((type, index) => `WHEN '${type}' THEN ${index + 1}`).join(" ");
  const [rows] = await connection.query(
    `
      SELECT line_group_id AS lineGroupId, registration_type AS registrationType, group_name AS groupName
      FROM line_group_registrations
      WHERE is_active = 1
        AND (group_name = ? OR registration_type IN (?))
      ORDER BY
        CASE WHEN group_name = ? THEN 0 ELSE 1 END,
        CASE registration_type ${orderCases} ELSE 99 END,
        updated_at DESC,
        id DESC
      LIMIT 1
    `,
    ["kw-mini test", fallbackTypes, "kw-mini test"]
  );

  return rows[0] || null;
}

async function notifySupplierRequestLine({ requestId, requestType, supplierName, sku, productName, quantity, storeId }) {
  try {
    const target = await resolveSupplierLineGroupTarget();
    if (!target?.lineGroupId) {
      console.info("[supplier:line] skipped missing target", { requestId });
      return { delivered: 0, skipped: true, reason: "missing_line_group" };
    }

    const credentials = await resolveStoreLineCredentials({
      storeId,
      purpose: "supplier_request_group_notify"
    });

    const channelAccessToken = credentials.channelAccessToken || config.line.channelAccessToken;
    if (!channelAccessToken) {
      console.info("[supplier:line] skipped missing token", { requestId });
      return { delivered: 0, skipped: true, reason: "missing_line_token", target };
    }

    await sendLineMessage(
      config,
      target.lineGroupId,
      [{ type: "text", text: buildSupplierLineNotificationText({ requestType, supplierName, sku, productName, quantity }) }],
      {
        channelAccessToken,
        context: {
          storeId,
          purpose: "supplier_request_group_notify",
          source: "suppliers"
        }
      }
    );

    console.info("[supplier:line] sent", {
      requestId,
      registrationType: target.registrationType,
      groupName: target.groupName || null
    });
    return { delivered: 1, skipped: false, target };
  } catch (error) {
    console.warn("[supplier:line] send failed", {
      requestId,
      message: error.message
    });
    return { delivered: 0, skipped: false, error: error.message };
  }
}

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER"]), requireStoreFeature("suppliers_enabled"));
const requireStoreAdminRole = requireStoreRole(["owner", "admin"]);

function normalizeSupplierPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    contactName: String(body.contactName || body.contact_name || "").trim(),
    phone: String(body.phone || "").trim(),
    lineContact: String(body.lineContact || body.line_contact || "").trim(),
    email: String(body.email || "").trim(),
    address: String(body.address || "").trim(),
    taxId: String(body.taxId || body.tax_id || "").trim(),
    note: String(body.note || "").trim(),
    status: String(body.status || "ACTIVE").trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE"
  };
}

function normalizeSupplierPricePayload(body = {}) {
  const defaultUnitCost = Number(body.defaultUnitCost ?? body.default_unit_cost ?? 0);
  const lastUnitCost = Number(body.lastUnitCost ?? body.last_unit_cost ?? defaultUnitCost);
  return {
    productId: Number(body.productId || body.product_id || 0),
    supplierSku: String(body.supplierSku || body.supplier_sku || "").trim(),
    defaultUnitCost: Number.isFinite(defaultUnitCost) && defaultUnitCost >= 0 ? defaultUnitCost : 0,
    lastUnitCost: Number.isFinite(lastUnitCost) && lastUnitCost >= 0 ? lastUnitCost : 0,
    note: String(body.note || "").trim(),
    isActive: body.isActive === false || body.is_active === 0 || body.is_active === false ? 0 : 1
  };
}

async function fetchSupplierById(id, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        name,
        contact_name AS contactName,
        phone,
        line_contact AS lineContact,
        email,
        address,
        tax_id AS taxId,
        note,
        status,
        is_active AS isActive,
        deleted_at AS deletedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM suppliers
      WHERE id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [id, storeId]
  );
  return rows[0] || null;
}

async function assertSupplierExists(id, storeId, connection = pool) {
  const supplier = await fetchSupplierById(id, storeId, connection);
  if (!supplier) {
    const error = new Error("找不到供應商");
    error.statusCode = 404;
    throw error;
  }
  return supplier;
}

async function assertProductInStore(productId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, sku, name, category, cost_price AS costPrice
      FROM products
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [productId, storeId]
  );
  if (!rows[0]) {
    const error = new Error("找不到同門市商品");
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
}

router.get("/", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    const whereInactive = includeInactive ? "" : "AND is_active = 1 AND deleted_at IS NULL";
    const [rows] = await pool.query(
      `
        SELECT
          id,
          store_id AS storeId,
          name,
          contact_name AS contactName,
          phone,
          line_contact AS lineContact,
          email,
          address,
          tax_id AS taxId,
          note,
          status,
          is_active AS isActive,
          deleted_at AS deletedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM suppliers
        WHERE store_id = ?
          ${whereInactive}
        ORDER BY is_active DESC, name ASC
      `,
      [storeId]
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const payload = normalizeSupplierPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ message: "請輸入供應商名稱" });
    }

    const [result] = await pool.query(
      `
        INSERT INTO suppliers (
          store_id,
          name,
          contact_name,
          phone,
          line_contact,
          email,
          address,
          tax_id,
          note,
          status,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        storeId,
        payload.name,
        payload.contactName || null,
        payload.phone || null,
        payload.lineContact || null,
        payload.email || null,
        payload.address || null,
        payload.taxId || null,
        payload.note || null,
        payload.status,
        payload.status === "ACTIVE" ? 1 : 0
      ]
    );

    const supplier = await fetchSupplierById(result.insertId, storeId);
    return res.status(201).json(supplier);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "同門市已有相同供應商名稱" });
    }
    return next(error);
  }
});

router.patch("/:id", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    const payload = normalizeSupplierPayload(req.body);
    if (!supplierId) {
      return res.status(400).json({ message: "請提供有效供應商" });
    }
    if (!payload.name) {
      return res.status(400).json({ message: "請輸入供應商名稱" });
    }

    await assertSupplierExists(supplierId, storeId);
    await pool.query(
      `
        UPDATE suppliers
        SET
          name = ?,
          contact_name = ?,
          phone = ?,
          line_contact = ?,
          email = ?,
          address = ?,
          tax_id = ?,
          note = ?,
          status = ?,
          is_active = ?,
          deleted_at = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE deleted_at END
        WHERE id = ?
          AND store_id = ?
      `,
      [
        payload.name,
        payload.contactName || null,
        payload.phone || null,
        payload.lineContact || null,
        payload.email || null,
        payload.address || null,
        payload.taxId || null,
        payload.note || null,
        payload.status,
        payload.status === "ACTIVE" ? 1 : 0,
        payload.status,
        supplierId,
        storeId
      ]
    );

    return res.json(await fetchSupplierById(supplierId, storeId));
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "同門市已有相同供應商名稱" });
    }
    return next(error);
  }
});

router.delete("/:id", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    if (!supplierId) {
      return res.status(400).json({ message: "請提供有效供應商" });
    }

    await assertSupplierExists(supplierId, storeId);
    await pool.query(
      `
        UPDATE suppliers
        SET status = 'INACTIVE',
            is_active = 0,
            deleted_at = COALESCE(deleted_at, NOW()),
            deleted_by = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [req.user?.id || null, supplierId, storeId]
    );

    return res.json(await fetchSupplierById(supplierId, storeId));
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/product-prices", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    await assertSupplierExists(supplierId, storeId);

    const [rows] = await pool.query(
      `
        SELECT
          spp.id,
          spp.store_id AS storeId,
          spp.supplier_id AS supplierId,
          spp.product_id AS productId,
          spp.supplier_sku AS supplierSku,
          spp.default_unit_cost AS defaultUnitCost,
          spp.last_unit_cost AS lastUnitCost,
          spp.note,
          spp.is_active AS isActive,
          spp.created_at AS createdAt,
          spp.updated_at AS updatedAt,
          p.sku,
          p.name AS productName,
          p.category,
          p.cost_price AS costPrice,
          p.price,
          p.stock
        FROM supplier_product_prices spp
        INNER JOIN products p ON p.id = spp.product_id
          AND p.store_id = spp.store_id
        WHERE spp.store_id = ?
          AND spp.supplier_id = ?
        ORDER BY spp.is_active DESC, p.sku ASC
      `,
      [storeId, supplierId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/product-prices", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    const payload = normalizeSupplierPricePayload(req.body);
    if (!payload.productId) {
      return res.status(400).json({ message: "請選擇商品" });
    }

    await assertSupplierExists(supplierId, storeId);
    await assertProductInStore(payload.productId, storeId);
    const [result] = await pool.query(
      `
        INSERT INTO supplier_product_prices (
          store_id,
          supplier_id,
          product_id,
          supplier_sku,
          default_unit_cost,
          last_unit_cost,
          note,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        storeId,
        supplierId,
        payload.productId,
        payload.supplierSku || null,
        payload.defaultUnitCost,
        payload.lastUnitCost,
        payload.note || null,
        payload.isActive
      ]
    );

    return res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "此供應商已有該商品供應價" });
    }
    return next(error);
  }
});

router.patch("/:id/product-prices/:priceId", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    const priceId = Number(req.params.priceId);
    const payload = normalizeSupplierPricePayload(req.body);

    await assertSupplierExists(supplierId, storeId);
    const [rows] = await pool.query(
      `
        SELECT id, product_id AS productId
        FROM supplier_product_prices
        WHERE id = ?
          AND supplier_id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [priceId, supplierId, storeId]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: "找不到商品供應價" });
    }

    await pool.query(
      `
        UPDATE supplier_product_prices
        SET supplier_sku = ?,
            default_unit_cost = ?,
            last_unit_cost = ?,
            note = ?,
            is_active = ?
        WHERE id = ?
          AND supplier_id = ?
          AND store_id = ?
      `,
      [
        payload.supplierSku || null,
        payload.defaultUnitCost,
        payload.lastUnitCost,
        payload.note || null,
        payload.isActive,
        priceId,
        supplierId,
        storeId
      ]
    );

    return res.json({ id: priceId });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/product-prices/:priceId", requireStoreAdminRole, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const supplierId = Number(req.params.id);
    const priceId = Number(req.params.priceId);
    await assertSupplierExists(supplierId, storeId);
    const [result] = await pool.query(
      `
        UPDATE supplier_product_prices
        SET is_active = 0
        WHERE id = ?
          AND supplier_id = ?
          AND store_id = ?
      `,
      [priceId, supplierId, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到商品供應價" });
    }
    return res.json({ id: priceId, isActive: 0 });
  } catch (error) {
    return next(error);
  }
});

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
        AND (sr.store_id = ? OR sr.store_id IS NULL)
        AND sr.status IN ('PENDING_SUPPLIER', 'PARTIALLY_RECEIVED')
      ORDER BY sr.id DESC
      LIMIT 200
    `, [storeId, storeId]);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});


router.post("/requests", requireStoreAdminRole, async (req, res, next) => {
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
        (store_id, request_type, status, supplier_name, note, requested_by_staff_id)
        VALUES (?, ?, 'PENDING_SUPPLIER', ?, ?, ?)
      `,
      [storeId, requestType, supplierName, note || null, req.user.id]
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

    const requestId = requestResult.insertId;
    const supplierItems = [
      {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        quantity: qty
      }
    ];

    try {
      await sendSupplierDecisionRequest(
        requestId,
        requestType,
        supplierName,
        sku,
        product.name,
        qty,
        note,
        storeId
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
      items: supplierItems
    });

    await notifySupplierRequestLine({
      requestId,
      requestType,
      supplierName,
      sku: product.sku,
      productName: product.name,
      quantity: qty,
      storeId
    });

    return res.status(201).json({
      id: requestId,
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



router.post("/:id/receive", requireStoreAdminRole, async (req, res, next) => {
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
          AND (sr.store_id = ? OR sr.store_id IS NULL)
        LIMIT 1
        FOR UPDATE
      `,
      [storeId, requestId, storeId]
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
        "UPDATE supplier_requests SET status = 'RECEIVED', supplier_responded_at = NOW() WHERE id = ? AND (store_id = ? OR store_id IS NULL)",
        [requestId, storeId]
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
       (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
       VALUES (?, ?, 'IN', ?, 'SUPPLIER_REQUEST', ?, ?, ?)`,
      [
        storeId,
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
      "UPDATE supplier_requests SET status = ?, supplier_responded_at = NOW() WHERE id = ? AND (store_id = ? OR store_id IS NULL)",
      [newStatus, requestId, storeId]
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



router.post("/:id/return-done", requireStoreAdminRole, async (req, res, next) => {
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
          AND (sr.store_id = ? OR sr.store_id IS NULL)
        LIMIT 1
      `,
      [storeId, requestId, storeId]
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
      `
        INSERT INTO inventory_movements
          (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
        VALUES (?, ?, 'OUT', ?, 'SUPPLIER_REQUEST', ?, ?, ?)
      `,
      [
        storeId,
        item.productId,
        -Math.abs(Number(item.quantity || 0)),
        requestId,
        req.user?.id || 1,
        `Supplier return confirmed #${requestId} / ${item.sku}`
      ]
    );

    await pool.query(
      "UPDATE supplier_requests SET status = 'RETURN_CONFIRMED', supplier_responded_at = NOW() WHERE id = ? AND (store_id = ? OR store_id IS NULL)",
      [requestId, storeId]
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
        AND (sr.store_id = ? OR sr.store_id IS NULL)
        AND DATE_FORMAT(sr.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
      GROUP BY sr.supplier_name
      ORDER BY sr.supplier_name ASC
    `, [storeId, storeId]);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
