const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { createError } = require("../utils/errors");
const {
  createButtonMessage,
  createConfirmTemplate,
  createPostbackAction,
  buildGroupApprovalMessage,
  logWorkflowEvent,
  sendToGroups
} = require("../services/lineWorkflowService");
const {
  mapSupplierRequestStatusLabel,
  mapSupplierRequestTypeLabel
} = require("../utils/displayLabels");

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



router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "INVENTORY"]));

router.get("/movements", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          im.id,
          im.product_id AS productId,
          p.name AS productName,
          p.sku,
          im.movement_type AS movementType,
          im.quantity,
          im.notes,
          im.reference_type AS referenceType,
          im.reference_id AS referenceId,
          im.created_at AS createdAt
        FROM inventory_movements im
        INNER JOIN products p ON p.id = im.product_id AND p.store_id = ?
        ORDER BY im.id DESC
        LIMIT 200
      `,
      [storeId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/low-stock", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT id, name, sku, category, stock, reorder_level AS reorderLevel
        FROM products
        WHERE store_id = ?
          AND stock <= reorder_level
        ORDER BY stock ASC, name ASC
      `,
      [storeId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/supplier-requests", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          sr.id,
          sr.request_type AS requestType,
          sr.status,
          sr.supplier_name AS supplierName,
          sr.note,
          sr.supplier_response_note AS supplierResponseNote,
          sr.supplier_responded_at AS supplierRespondedAt,
          sr.created_at AS createdAt,
          su.display_name AS requestedByName,
          GROUP_CONCAT(CONCAT(p.name, ' x', sri.quantity, IF(sri.received_quantity > 0, CONCAT(' / 已入庫 ', sri.received_quantity), '')) ORDER BY sri.id SEPARATOR '；') AS itemSummary
        FROM supplier_requests sr
        INNER JOIN staff_users su ON su.id = sr.requested_by_staff_id
        LEFT JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        LEFT JOIN products p ON p.id = sri.product_id
        WHERE p.store_id = ?
        GROUP BY sr.id, sr.request_type, sr.status, sr.supplier_name, sr.note, sr.supplier_response_note, sr.supplier_responded_at, sr.created_at, su.display_name
        ORDER BY sr.id DESC
      `,
      [storeId]
    );

    return res.json(rows.map((row) => ({
      ...row,
      requestTypeLabel: mapSupplierRequestTypeLabel(row.requestType),
      statusLabel: mapSupplierRequestStatusLabel(row.status)
    })));
  } catch (error) {
    return next(error);
  }
});

router.post("/movements", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { productId, type, qty, note } = req.body;
    const normalizedQty = Number(qty);

    const movementType = String(type).toUpperCase();
    if (!["IN", "OUT", "ADJUST"].includes(movementType)) {
      throw createError("異動類型必須為入庫、出庫或調整", 400);
    }

    if (!productId || !type || !Number.isInteger(normalizedQty)) {
      throw createError("請提供商品、異動類型與有效數量", 400);
    }
    if (movementType === "ADJUST" && normalizedQty < 0) {
      throw createError("直接調整後的庫存不可小於 0", 400);
    }
    if (movementType !== "ADJUST" && normalizedQty <= 0) {
      throw createError("入庫與出庫數量必須為正整數", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [products] = await connection.query(
        `
          SELECT id, stock, name, sku
          FROM products
          WHERE id = ?
            AND store_id = ?
          FOR UPDATE
        `,
        [productId, storeId]
      );

      const product = products[0];
      if (!product) {
        throw createError("找不到商品", 404);
      }

      const signedQty = movementType === "OUT" ? -normalizedQty : normalizedQty;
      const nextStock = movementType === "ADJUST" ? normalizedQty : product.stock + signedQty;
      const movementQuantity = movementType === "ADJUST" ? nextStock - Number(product.stock || 0) : signedQty;

      if (nextStock < 0) {
        throw createError("庫存不可小於 0", 409);
      }

      await connection.query(
        `
          UPDATE products
          SET stock = ?
          WHERE id = ?
            AND store_id = ?
        `,
        [nextStock, productId, storeId]
      );

      await connection.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, created_by)
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          productId,
          movementType,
          movementQuantity,
          note || (movementType === "ADJUST" ? `直接調整庫存為 ${nextStock}` : null),
          req.user.id
        ]
      );

      return {
        productId: Number(productId),
        productName: product.name,
        sku: product.sku,
        previousStock: Number(product.stock || 0),
        stock: nextStock,
        movementType,
        movementQuantity
      };
    });

    // INVENTORY_SUPPLIER_NOTIFY_CALL_V2
    await notifySupplierRequestTelegram({
      requestId: result.id,
      requestType: result.requestType || result.request_type || requestType,
      supplierName: result.supplierName || result.supplier_name || supplierName,
      note: result.note || note,
      items
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { requestType, supplierName, note, items } = req.body;
    if (!["PURCHASE_ORDER", "RETURN"].includes(requestType)) {
      throw createError("請選擇發注或退貨", 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw createError("請至少提供一個品項", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [requestResult] = await connection.query(
        `
          INSERT INTO supplier_requests (request_type, status, supplier_name, note, requested_by_staff_id)
          VALUES (?, 'PENDING_SUPPLIER', ?, ?, ?)
        `,
        [requestType, supplierName || null, note || null, req.user.id]
      );

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
          throw createError("供應商流程品項需提供商品與正整數數量", 400);
        }

        const [[product]] = await connection.query(
          "SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1",
          [productId, storeId]
        );
        if (!product) {
          throw createError("找不到商品", 404);
        }

        await connection.query(
          `
            INSERT INTO supplier_request_items (supplier_request_id, product_id, quantity, reason, note)
            VALUES (?, ?, ?, ?, ?)
          `,
          [requestResult.insertId, productId, quantity, item.reason || null, item.note || null]
        );
      }

      await logWorkflowEvent("supplier_request_created", "SUPPLIER_REQUEST", requestResult.insertId, {
        requestType,
        itemCount: items.length
      }, req.user.id, connection);

      return { id: requestResult.insertId };
    });

    await sendToGroups(["inventory", "admin"], [
      buildGroupApprovalMessage("supplier_request", {
        id: result.id,
        requestTypeLabel: mapSupplierRequestTypeLabel(requestType),
        supplierName: supplierName || "-",
        approveAction: requestType === "RETURN" ? "supplier_return_approve" : "supplier_po_approve",
        rejectAction: requestType === "RETURN" ? "supplier_return_reject" : "supplier_po_reject"
      })
    ]);

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests/:id/respond", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const id = Number(req.params.id);
    const approved = Boolean(req.body.approved);
    const nextStatus = approved ? "APPROVED" : "REJECTED";
    const [[request]] = await pool.query(
      `
        SELECT sr.id
        FROM supplier_requests sr
        INNER JOIN supplier_request_items sri ON sri.supplier_request_id = sr.id
        INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
        WHERE sr.id = ?
        LIMIT 1
      `,
      [storeId, id]
    );
    if (!request) {
      throw createError("找不到供應商請求", 404);
    }

    await pool.query(
      `
        UPDATE supplier_requests
        SET status = ?,
            supplier_response_note = ?,
            supplier_responded_at = NOW()
        WHERE id = ?
      `,
      [nextStatus, req.body.note || null, id]
    );

    await logWorkflowEvent("supplier_request_responded", "SUPPLIER_REQUEST", id, { approved }, req.user.id);
    return res.json({ status: nextStatus, statusLabel: mapSupplierRequestStatusLabel(nextStatus) });
  } catch (error) {
    return next(error);
  }
});

router.post("/supplier-requests/:id/receive", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const id = Number(req.params.id);
    const receivedItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (receivedItems.length === 0) {
      throw createError("請提供入庫品項", 400);
    }

    const result = await withTransaction(async (connection) => {
      for (const item of receivedItems) {
        const itemId = Number(item.itemId);
        const receivedQuantity = Number(item.receivedQuantity);
        if (!itemId || !Number.isInteger(receivedQuantity) || receivedQuantity <= 0) {
          throw createError("入庫品項與數量不正確", 400);
        }

        const [rows] = await connection.query(
          `
            SELECT sri.product_id AS productId, sri.quantity, sri.received_quantity AS receivedQuantity
            FROM supplier_request_items sri
            INNER JOIN products p ON p.id = sri.product_id AND p.store_id = ?
            WHERE sri.id = ? AND sri.supplier_request_id = ?
            FOR UPDATE
          `,
          [storeId, itemId, id]
        );
        const requestItem = rows[0];
        if (!requestItem) {
          throw createError("找不到入庫品項", 404);
        }
        const nextReceived = Math.min(Number(requestItem.receivedQuantity || 0) + receivedQuantity, Number(requestItem.quantity));
        const delta = nextReceived - Number(requestItem.receivedQuantity || 0);
        if (delta <= 0) {
          continue;
        }

        await connection.query("UPDATE supplier_request_items SET received_quantity = ? WHERE id = ?", [nextReceived, itemId]);
        await connection.query("UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?", [delta, requestItem.productId, storeId]);
        console.log('[INVENTORY_RECEIVE]', {
          requestId: id,
          itemId,
          productId: requestItem.productId,
          delta
        });

        await connection.query(
          `
            INSERT INTO inventory_movements (
              product_id,
              movement_type,
              quantity,
              reference_type,
              reference_id,
              created_by,
              notes
            )
            VALUES (?, 'RESTOCK', ?, 'SUPPLIER_REQUEST', ?, ?, ?)
          `,
          [
            requestItem.productId,
            delta,
            id,
            req.user.id,
            `Supplier receive #${id}`
          ]
        );

        console.log('[INVENTORY_RECEIVE_DONE]', {
          requestId: id,
          productId: requestItem.productId
        });
      }

      const [[summary]] = await connection.query(
        `
          SELECT
            SUM(received_quantity >= quantity) AS completedItems,
            COUNT(*) AS totalItems
          FROM supplier_request_items
          WHERE supplier_request_id = ?
        `,
        [id]
      );
      const status = Number(summary.completedItems || 0) === Number(summary.totalItems || 0) ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await connection.query(
          "UPDATE supplier_requests SET status = ? WHERE id = ? AND store_id = ?",
          [status, id, storeId]
        );
      await logWorkflowEvent("supplier_request_received", "SUPPLIER_REQUEST", id, { status }, req.user.id, connection);
      return { status };
    });

    return res.json({ status: result.status, statusLabel: mapSupplierRequestStatusLabel(result.status) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
