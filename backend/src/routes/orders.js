const express = require("express");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { TAIPEI_TZ } = require("../services/reportService");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");
const {
  createFlexMessage,
  createUriAction,
  backfillApprovedRepairOrders,
  createPurchaseConfirmationForOrder,
  logWorkflowEvent,
  sendToGroups,
  sendToGroupsWithResult
} = require("../services/lineWorkflowService");
const {
  mapFinalPaymentStatusLabel,
  mapOrderStatusLabel,
  mapPaymentMethodLabel,
  mapRepairStatusLabel
} = require("../utils/displayLabels");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");
const { sendOrderCreationNotification } = require("../services/telegramService");

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR"]));
const requireOrderManagementFeature = requireStoreFeature("orders_enabled");
const requirePosFeature = requireStoreFeature("pos_enabled");

function normalizeCustomerType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OFFLINE_WITH_PHONE" || normalized === "OFFLINE_NO_PHONE") {
    return normalized;
  }
  if (normalized === "OFFLINE") {
    return "OFFLINE_WITH_PHONE";
  }
  return "LINE";
}

function isLineCustomerType(value) {
  return normalizeCustomerType(value) === "LINE";
}



async function createAutoSupplierRequestForZeroStockOrder(connection, orderId, staffId) {
  const [orderRows] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM orders
      WHERE id = ?
      LIMIT 1
    `,
    [orderId]
  );

  const storeId = orderRows[0]?.storeId;
  if (!storeId) {
    return null;
  }

  const [items] = await connection.query(
    `
      SELECT
        oi.product_id AS productId,
        oi.quantity AS quantity,
        p.name AS productName,
        p.sku AS sku,
        p.stock AS stock
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
        AND oi.store_id = ?
        AND p.store_id = ?
        AND p.stock <= 0
    `,
    [orderId, storeId, storeId]
  );

  if (!items.length) {
    return null;
  }

  const noteLines = [
    `自動發注：訂單 #${orderId} 完成後，偵測到庫存為 0 的商品。`,
    ...items.map((item) => `- ${item.productName} / ${item.sku || "-"} / 數量 ${item.quantity} / 目前庫存 ${item.stock}`)
  ];

  const [requestResult] = await connection.query(
    `
      INSERT INTO supplier_requests
        (store_id, request_type, status, supplier_name, note, requested_by_staff_id)
      VALUES
        (?, 'PO', 'PENDING_SUPPLIER', 'KINGWAY', ?, ?)
    `,
    [storeId, noteLines.join("\n"), staffId || null]
  );

  for (const item of items) {
    await connection.query(
      `
        INSERT INTO supplier_request_items
          (supplier_request_id, product_id, quantity, reason, note)
        VALUES
          (?, ?, ?, 'AUTO_ZERO_STOCK_ORDER', ?)
      `,
      [
        requestResult.insertId,
        item.productId,
        item.quantity,
        `訂單 #${orderId} 完成後自動發注`
      ]
    );
  }

  await sendToGroups(["inventory"], [
    {
      type: "text",
      text:
        `【自動發注】\n` +
        `供應商：KINGWAY\n` +
        `來源：訂單 #${orderId}\n` +
        `原因：訂單完成後偵測到庫存 0 商品\n\n` +
        items.map((item) => `・${item.productName} / ${item.sku || "-"} / 數量 ${item.quantity}`).join("\n")
    }
  ]);

  return requestResult.insertId;
}


async function deductOrderStockOnce(orderId, connection = pool) {
  const [orders] = await connection.query(
    `
      SELECT id, store_id AS storeId, stock_deducted_at AS stockDeductedAt
      FROM orders
      WHERE id = ?
      FOR UPDATE
    `,
    [orderId]
  );

  const order = orders[0];
  if (!order || order.stockDeductedAt) {
    return false;
  }

  const [items] = await connection.query(
    `
      SELECT product_id AS productId, quantity
      FROM order_items
      WHERE order_id = ?
        AND store_id = ?
    `,
    [orderId, order.storeId]
  );

  for (const item of items) {
    await connection.query(
      `
        UPDATE products
        SET stock = GREATEST(stock - ?, 0)
        WHERE id = ?
          AND store_id = ?
      `,
      [Number(item.quantity || 0), item.productId, order.storeId]
    );
  }

  await connection.query(
    `
      UPDATE orders
      SET stock_deducted_at = NOW()
      WHERE id = ?
        AND store_id = ?
    `,
    [orderId, order.storeId]
  );

  return true;
}


async function pushPurchaseConfirmationLineMessage(confirmation, options = {}) {
  const storeId = options.storeId || null;
  if (!confirmation?.lineUserId || !confirmation.link || !config.line.channelAccessToken) {
    return false;
  }
  if (!options.force && confirmation.purchaseConfirmationSentAt) {
    return false;
  }

  await sendLineMessage(config, confirmation.lineUserId, [
    {
      type: "text",
      text: [
        "您的電動自行車購買確認書已建立。",
        "請點擊下方連結完成確認與簽名：",
        confirmation.link
      ].join("\n")
    }
  ]);

  await pool.query(
    `
      UPDATE orders
      SET purchase_confirmation_sent_at = COALESCE(purchase_confirmation_sent_at, NOW())
      WHERE id = ?
        AND (? IS NULL OR store_id = ?)
    `,
    [confirmation.orderId, storeId, storeId]
  );

  return true;
}

router.get("/", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await backfillApprovedRepairOrders();
    const orderColumns = await getTableColumns(pool, "orders");
    const repairOrderColumns = await getTableColumns(pool, "repair_orders");
    const customerColumns = await getTableColumns(pool, "customers");
    const staffColumns = await getTableColumns(pool, "staff_users");
    const orderItemColumns = await getTableColumns(pool, "order_items");
    const canClassifyRepair = hasColumn(orderItemColumns, "product_category_snapshot");
    const repairExistsChecks = [
      hasColumn(orderColumns, "repair_order_id") ? "o.repair_order_id IS NOT NULL" : null,
      hasColumn(orderColumns, "source") ? "o.source = 'repair_quote'" : null,
      hasColumn(repairOrderColumns, "order_id")
        ? `
            EXISTS (
              SELECT 1
              FROM repair_orders ro
              WHERE ro.order_id = o.id
            )
          `
        : null,
      canClassifyRepair
        ? `
            EXISTS (
              SELECT 1
              FROM order_items oi
              WHERE oi.order_id = o.id
                AND oi.product_category_snapshot = 'REPAIR'
            )
          `
        : null
    ].filter(Boolean);
    const repairExistsSql = repairExistsChecks.length > 0
      ? `(${repairExistsChecks.join("\n OR ")})`
      : "0";
    const repairIdSql = hasColumn(repairOrderColumns, "id")
      ? `
          COALESCE(
            ${hasColumn(orderColumns, "repair_order_id") ? "o.repair_order_id" : "NULL"},
            (
              SELECT ro.id
              FROM repair_orders ro
              WHERE ro.order_id = o.id
              ORDER BY ro.id DESC
              LIMIT 1
            )
          )
        `
      : "NULL";
    const repairStatusSql = hasColumn(repairOrderColumns, "status")
      ? `
          COALESCE(
            (
              SELECT ro.status
              FROM repair_orders ro
              WHERE ro.id = ${hasColumn(orderColumns, "repair_order_id") ? "o.repair_order_id" : "NULL"}
              LIMIT 1
            ),
            (
              SELECT ro.status
              FROM repair_orders ro
              WHERE ro.order_id = o.id
              ORDER BY ro.id DESC
              LIMIT 1
            )
          )
        `
      : "NULL";
    const [rows] = await pool.query(
      `
        SELECT
          ${selectColumn(orderColumns, "o", "id", "id")},
          ${selectColumn(orderColumns, "o", "order_no", "orderNo")},
          ${selectColumn(orderColumns, "o", "business_date", "businessDate")},
          ${selectColumn(orderColumns, "o", "total_amount", "totalAmount", "0")},
          ${selectColumn(orderColumns, "o", "customer_name", "customerNameSnapshot")},
          ${selectColumn(orderColumns, "o", "customer_phone", "customerPhoneSnapshot")},
          ${selectColumn(orderColumns, "o", "customer_type", "customerType", "'LINE'")},
          ${selectColumn(orderColumns, "o", "payment_method", "paymentMethod", "'OTHER'")},
          ${selectColumn(orderColumns, "o", "status", "status", "'COMPLETED'")},
          ${selectColumn(orderColumns, "o", "order_type", "orderType", "'GENERAL'")},
          ${selectColumn(orderColumns, "o", "source", "source")},
          ${selectColumn(orderColumns, "o", "repair_order_id", "repairOrderId", "NULL")},
          ${repairIdSql} AS repairId,
          ${repairStatusSql} AS repairStatus,
          ${selectColumn(orderColumns, "o", "is_reservation_order", "isReservationOrder", "0")},
          ${selectColumn(orderColumns, "o", "deposit_amount", "depositAmount", "0")},
          ${selectColumn(orderColumns, "o", "unpaid_balance", "unpaidBalance", "0")},
          ${selectColumn(orderColumns, "o", "final_payment_status", "finalPaymentStatus", "'PAID'")},
          ${selectColumn(orderColumns, "o", "final_paid_at", "finalPaidAt")},
          ${selectColumn(orderColumns, "o", "purchase_confirmation_sent_at", "purchaseConfirmationSentAt")},
          ${selectColumn(orderColumns, "o", "handover_confirmed_at", "handoverConfirmedAt")},
          ${selectColumn(orderColumns, "o", "notes", "notes")},
          ${selectColumn(orderColumns, "o", "created_at", "createdAt")},
          ${selectColumn(customerColumns, "c", "id", "customerId")},
          ${selectColumn(customerColumns, "c", "name", "customerName")},
          ${selectColumn(staffColumns, "s", "id", "staffId")},
          ${selectColumn(staffColumns, "s", "display_name", "staffName")},
          ${repairExistsSql} AS isRepairOrder
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        WHERE o.store_id = ?
          AND o.deleted_at IS NULL
        ORDER BY o.id DESC
        LIMIT 100
      `,
      [storeId]
    );

    return res.json(
      rows.map((row) => ({
        ...row,
        isRepairOrder: Boolean(row.isRepairOrder),
        paymentMethodLabel: mapPaymentMethodLabel(row.paymentMethod),
        statusLabel: mapOrderStatusLabel(row.status),
        finalPaymentStatusLabel: mapFinalPaymentStatusLabel(row.finalPaymentStatus),
        repairStatusLabel: mapRepairStatusLabel(row.repairStatus)
      }))
    );
  } catch (error) {
    return next(error);
  }
});


router.get("/trash/list", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;

    const [rows] = await pool.query(`
      SELECT
        o.id,
        o.order_no AS orderNo,
        o.customer_name AS customerNameSnapshot,
        o.customer_phone AS customerPhoneSnapshot,
        o.total_amount AS totalAmount,
        o.status,
        o.source,
        o.created_at AS createdAt,
        o.deleted_at AS deletedAt,
        s.display_name AS deletedByName
      FROM orders o
      LEFT JOIN staff_users s ON s.id = o.deleted_by
      WHERE o.store_id = ?
        AND o.deleted_at IS NOT NULL
      ORDER BY o.deleted_at DESC, o.id DESC
      LIMIT 200
    `, [storeId]);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;

    const [result] = await pool.query(
      "UPDATE orders SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND store_id = ? AND deleted_at IS NULL",
      [req.user?.id || null, req.params.id, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到訂單或已刪除" });
    }
    return res.json({ message: "訂單已移至已刪除資料" });
  } catch (error) {
    return next(error);
  }
});


router.post("/:id/restore", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;

    const [result] = await pool.query(
      "UPDATE orders SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND store_id = ? AND deleted_at IS NOT NULL",
      [req.params.id, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到已刪除訂單" });
    }
    return res.json({ message: "訂單已復原" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/permanent", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;

    await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT id FROM orders WHERE id = ? AND store_id = ? AND deleted_at IS NOT NULL LIMIT 1",
        [req.params.id, storeId]
      );
      if (!rows[0]) {
        throw createError("找不到已刪除訂單", 404);
      }

      await connection.query("DELETE FROM order_items WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("DELETE FROM purchase_confirmation_tokens WHERE order_id = ?", [req.params.id]);
      await connection.query("DELETE FROM purchase_confirmations WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("UPDATE coupons SET order_id = NULL WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("UPDATE repair_orders SET order_id = NULL WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("DELETE FROM orders WHERE id = ? AND store_id = ?", [req.params.id, storeId]);
    });

    return res.json({ message: "訂單已永久刪除" });
  } catch (error) {
    return next(error);
  }
});


router.get("/:id", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const orderId = req.params.id;

    const [rows] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          o.business_date AS businessDate,
          o.total_amount AS totalAmount,
          o.customer_id AS customerId,
          o.customer_name AS customerNameSnapshot,
          o.customer_phone AS customerPhoneSnapshot,
          o.customer_type AS customerType,
          o.order_type AS orderType,
          o.source AS source,
          o.repair_order_id AS repairOrderId,
          COALESCE(
            o.repair_order_id,
            (
              SELECT ro.id
              FROM repair_orders ro
              WHERE ro.order_id = o.id
              ORDER BY ro.id DESC
              LIMIT 1
            )
          ) AS repairId,
          COALESCE(
            (
              SELECT ro.status
              FROM repair_orders ro
              WHERE ro.id = o.repair_order_id
              LIMIT 1
            ),
            (
              SELECT ro.status
              FROM repair_orders ro
              WHERE ro.order_id = o.id
              ORDER BY ro.id DESC
              LIMIT 1
            )
          ) AS repairStatus,
          o.payment_method AS paymentMethod,
          o.status,
          o.is_reservation_order AS isReservationOrder,
          o.deposit_amount AS depositAmount,
          o.unpaid_balance AS unpaidBalance,
          COALESCE(o.other_discount, 0) AS otherDiscount,
          o.final_payment_status AS finalPaymentStatus,
          o.final_paid_at AS finalPaidAt,
          o.purchase_confirmation_sent_at AS purchaseConfirmationSentAt,
          o.handover_confirmed_at AS handoverConfirmedAt,
          o.notes,
          o.created_at AS createdAt,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          s.display_name AS staffName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        WHERE o.id = ?
          AND o.store_id = ?
        LIMIT 1
      `,
      [orderId, storeId]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "找不到訂單" });
    }

    const [items] = await pool.query(
      `
        SELECT
          id,
          product_id AS productId,
          sku_snapshot AS sku,
          product_name_snapshot AS productName,
          product_category_snapshot AS productCategory,
          quantity,
          unit_price AS unitPrice,
          line_total AS lineTotal
        FROM order_items
        WHERE order_id = ?
          AND store_id = ?
        ORDER BY id ASC
      `,
      [orderId, storeId]
    );

    return res.json({
      ...rows[0],
      repairStatusLabel: mapRepairStatusLabel(rows[0].repairStatus),
      items
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", requirePosFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const {
      customerId,
      customer_name: customerNameInput,
      customer_phone: customerPhoneInput,
      customerType,
      customer_type: customerTypeInput,
      customerName,
      customerPhone,
      paymentMethod,
      isReservationOrder,
      depositAmount,
      unpaidBalance,
      otherDiscount,
      finalPaymentStatus,
      couponCode,
      couponAmount,
      notes,
      items
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "必須提供訂單品項" });
    }

    const order = await withTransaction(async (connection) => {
      let resolvedCustomerId = customerId ? Number(customerId) : null;
      const resolvedCustomerName = customerNameInput || customerName || null;
      const resolvedCustomerPhone = customerPhoneInput || customerPhone || null;
      let resolvedCustomerType = normalizeCustomerType(customerTypeInput || customerType);

      if (resolvedCustomerId) {
        const [customerRows] = await connection.query(
          `
            SELECT customer_type AS customerType, line_user_id AS lineUserId
            FROM customers
            WHERE id = ?
              AND store_id = ?
            LIMIT 1
          `,
          [resolvedCustomerId, storeId]
        );
        if (customerRows[0]) {
          resolvedCustomerType = normalizeCustomerType(customerRows[0].customerType || (customerRows[0].lineUserId ? "LINE" : resolvedCustomerType));
        }
      }

      if (!resolvedCustomerId && resolvedCustomerPhone) {
        const [matches] = await connection.query(
          `
            SELECT id, customer_type AS customerType, line_user_id AS lineUserId
            FROM customers
            WHERE phone = ?
              AND store_id = ?
            ORDER BY id DESC
            LIMIT 1
          `,
          [resolvedCustomerPhone, storeId]
        );

        if (matches[0]) {
          resolvedCustomerId = matches[0].id;
          resolvedCustomerType = normalizeCustomerType(matches[0].customerType || (matches[0].lineUserId ? "LINE" : resolvedCustomerType));
        }
      }

      if (!resolvedCustomerId && (resolvedCustomerName || resolvedCustomerPhone)) {
        if (!resolvedCustomerName) {
          throw createError("一般客戶至少需要姓名", 400);
        } else {
          const [customerResult] = await connection.query(
            `
              INSERT INTO customers (store_id, name, phone, customer_type)
              VALUES (?, ?, ?, ?)
            `,
            [storeId, resolvedCustomerName, resolvedCustomerType === "OFFLINE_NO_PHONE" ? null : resolvedCustomerPhone || null, resolvedCustomerType]
          );
          resolvedCustomerId = customerResult.insertId;
        }
      }

      const mergedItems = new Map();
      for (const item of items) {
        const productId = Number(item.productId || item.product_id);
        const quantity = Number(item.quantity || item.qty);

        if (!Number.isInteger(productId) || !Number.isInteger(quantity)) {
          throw createError("每筆品項都必須提供整數的 productId 與 quantity", 400);
        }

        const existing = mergedItems.get(productId);
        if (existing) {
          existing.quantity += quantity;
          if (item.unitPrice !== undefined) {
            existing.unitPrice = Number(item.unitPrice);
          }
        } else {
          mergedItems.set(productId, {
            productId,
            quantity,
            unitPrice: item.unitPrice !== undefined ? Number(item.unitPrice) : undefined
          });
        }
      }

      const itemList = Array.from(mergedItems.values());
      const productIds = itemList.map((item) => item.productId);
      const [products] = await connection.query(
        `
          SELECT id, sku, name, category, price, stock, is_active
          FROM products
          WHERE id IN (?)
            AND store_id = ?
          FOR UPDATE
        `,
        [productIds, storeId]
      );

      if (products.length !== productIds.length) {
          throw createError("有商品不存在", 400);
      }

      const productMap = new Map(products.map((product) => [product.id, product]));
      const totalAmount = itemList.reduce((sum, item) => {
        const product = productMap.get(item.productId);
        const quantity = Number(item.quantity);
        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.price);
        return sum + unitPrice * quantity;
      }, 0);
      const normalizedDeposit = Number(depositAmount || 0);
      const requestedUnpaidBalance =
        unpaidBalance === undefined || unpaidBalance === null || unpaidBalance === ""
          ? Math.max(totalAmount - normalizedDeposit, 0)
          : Number(unpaidBalance);
      const normalizedFinalPaymentStatus =
        finalPaymentStatus || (requestedUnpaidBalance > 0 ? "PARTIAL" : "PAID");
      const normalizedIsReservation = Boolean(isReservationOrder) || normalizedDeposit > 0 || requestedUnpaidBalance > 0;
      const normalizedItems = [];

      for (const item of itemList) {
        const product = productMap.get(item.productId);
        const quantity = Number(item.quantity);

        if (!product || !product.is_active) {
          throw createError(`商品 ${item.productId} 無法使用`, 400);
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw createError(`商品 ${item.productId} 數量不正確`, 400);
        }

        const isReservationOrder = Number(depositAmount || 0) > 0 || Number(requestedUnpaidBalance || 0) > 0 || normalizedFinalPaymentStatus !== "PAID";

        if (!isReservationOrder && product.stock < quantity) {
          throw createError(`${product.sku} 庫存不足`, 409);
        }

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.price);
        const lineTotal = unitPrice * quantity;

        normalizedItems.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category,
          quantity,
          unitPrice,
          lineTotal
        });
      }

      const businessDate = dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD");
      const orderNo = `POS-${dayjs().tz(TAIPEI_TZ).format("YYYYMMDD-HHmmss-SSS")}`;
      const [orderResult] = await connection.query(
        `
          INSERT INTO orders (
            store_id,
            order_no,
            customer_id,
            customer_name,
            customer_phone,
            customer_type,
            order_type,
            total_amount,
            payment_method,
            status,
            is_reservation_order,
            deposit_amount,
            unpaid_balance,
            final_payment_status,
            final_paid_at,
            notes,
            created_by,
            business_date
          )
          VALUES (?, ?, ?, ?, ?, ?, 'GENERAL', ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          storeId,
          orderNo,
          resolvedCustomerId || null,
          resolvedCustomerName,
          resolvedCustomerType === "OFFLINE_NO_PHONE" ? null : resolvedCustomerPhone,
          resolvedCustomerType,
          totalAmount,
          paymentMethod || "CASH",
          normalizedIsReservation ? 1 : 0,
          normalizedDeposit,
          requestedUnpaidBalance,
          normalizedFinalPaymentStatus,
          normalizedFinalPaymentStatus === "PAID" ? new Date() : null,
          notes || null,
          req.user.id,
          businessDate
        ]
      );

      const couponCodes = String(couponCode || "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean);

      if (couponCodes.length) {
        await connection.query(
          `
            UPDATE coupons
            SET is_used = 1,
                status = 'used',
                used_at = NOW(),
                order_id = ?
            WHERE code IN (?)
              AND customer_id = ?
              AND is_used = 0
              AND status IN ('issued', 'approved')
          `,
          [orderResult.insertId, couponCodes, resolvedCustomerId]
        );
      }

      for (const item of normalizedItems) {
        await connection.query(
          `
            INSERT INTO order_items (
              store_id,
              order_id,
              product_id,
              sku_snapshot,
              product_name_snapshot,
              product_category_snapshot,
              quantity,
              unit_price,
              line_total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            storeId,
            orderResult.insertId,
            item.productId,
            item.sku,
            item.name,
            item.category,
            item.quantity,
            item.unitPrice,
            item.lineTotal
          ]
        );

        await connection.query(
          `
            UPDATE products
            SET stock = stock - ?
            WHERE id = ?
              AND store_id = ?
          `,
          [item.quantity, item.productId, storeId]
        );

        await connection.query(
          `
            INSERT INTO inventory_movements (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
            VALUES (?, ?, 'SALE', ?, 'ORDER', ?, ?, ?)
          `,
          [storeId, item.productId, -item.quantity, orderResult.insertId, req.user.id, `Auto deduction for ${orderNo}`]
        );
      }

      return {
        id: orderResult.insertId,
        orderNo,
        businessDate,
        totalAmount,
        customerId: resolvedCustomerId,
        customerName: resolvedCustomerName,
        customerPhone: resolvedCustomerType === "OFFLINE_NO_PHONE" ? null : resolvedCustomerPhone,
        customerType: resolvedCustomerType,
        isReservationOrder: normalizedIsReservation,
        depositAmount: normalizedDeposit,
        unpaidBalance: requestedUnpaidBalance,
        finalPaymentStatus: normalizedFinalPaymentStatus,
        items: normalizedItems
      };
    });

    await logKpi(req.user.id, "ORDER_CREATED", "ORDER", order.id, 2);
    await logWorkflowEvent("order_created", "ORDER", order.id, {
      orderNo: order.orderNo,
      totalAmount: order.totalAmount,
      finalPaymentStatus: order.finalPaymentStatus
    }, req.user.id);

    if (isLineCustomerType(order.customerType)) {
      await sendOrderCreationNotification(order);
    }

    const confirmation = await createPurchaseConfirmationForOrder(order.id, pool, { storeId });
    if (await pushPurchaseConfirmationLineMessage(confirmation, { storeId })) {
      await sendToGroups(["admin", "staff"], [
        createFlexMessage(
          "訂單已完款",
          "訂單已完款",
          [`訂單 ${order.orderNo} 已完款，購買確認書已送出。`],
          [createUriAction("前往訂單", `${config.frontendBaseUrl}/orders`)]
        )
      ]);
    }

    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const {
      customerName,
      customerPhone,
      paymentMethod,
      isReservationOrder,
      depositAmount,
      unpaidBalance,
      otherDiscount,
      finalPaymentStatus,
      notes
    } = req.body;

    const [rows] = await pool.query(
      `
        SELECT id, total_amount AS totalAmount, deposit_amount AS depositAmount, unpaid_balance AS unpaidBalance, COALESCE(other_discount,0) AS otherDiscount, final_payment_status AS finalPaymentStatus
        FROM orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [orderId, storeId]
    );

    if (!rows[0]) {
      throw createError("找不到訂單", 404);
    }

    const hasDepositAmount = depositAmount !== undefined;
    const hasOtherDiscount = otherDiscount !== undefined;
    const hasFinalPaymentStatus = finalPaymentStatus !== undefined;
    const nextDepositAmount = hasDepositAmount ? Number(depositAmount || 0) : Number(rows[0].depositAmount || 0);
    const nextOtherDiscount = hasOtherDiscount ? Number(otherDiscount || 0) : Number(rows[0].otherDiscount || 0);

    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(line_total), 0) AS itemTotal FROM order_items WHERE order_id = ? AND store_id = ?`,
      [orderId, storeId]
    );

    const itemTotal = Number(sumRows[0]?.itemTotal || 0);
    const currentPayable = Number(rows[0].totalAmount || 0);
    const currentOtherDiscount = Number(rows[0].otherDiscount || 0);
    const couponDiscount = Math.max(itemTotal - currentPayable - currentOtherDiscount, 0);
    const nextTotalAmount = Math.max(itemTotal - couponDiscount - nextOtherDiscount, 0);
    const nextUnpaidBalance = Math.max(nextTotalAmount - nextDepositAmount, 0);

    const nextFinalPaymentStatus =
      hasFinalPaymentStatus ? finalPaymentStatus : nextUnpaidBalance > 0 ? "PARTIAL" : "PAID";

    const wasPaid = rows[0].finalPaymentStatus === "PAID";

    await pool.query(
      `
        UPDATE orders
        SET
          customer_name = COALESCE(?, customer_name),
          customer_phone = COALESCE(?, customer_phone),
          payment_method = COALESCE(?, payment_method),
          is_reservation_order = COALESCE(?, is_reservation_order),
          deposit_amount = COALESCE(?, deposit_amount),
          other_discount = ?,
          total_amount = ?,
          unpaid_balance = ?,
          final_payment_status = ?,
          final_paid_at = CASE
            WHEN ? = 'PAID' THEN COALESCE(final_paid_at, NOW())
            ELSE NULL
          END,
          notes = COALESCE(?, notes)
        WHERE id = ?
          AND store_id = ?
      `,
      [
        customerName === undefined ? null : customerName,
        customerPhone === undefined ? null : customerPhone,
        paymentMethod === undefined ? null : paymentMethod,
        isReservationOrder === undefined ? null : Number(Boolean(isReservationOrder)),
        hasDepositAmount ? nextDepositAmount : null,
        nextOtherDiscount,
        nextTotalAmount,
        nextUnpaidBalance,
        nextFinalPaymentStatus,
        nextFinalPaymentStatus,
        notes === undefined ? null : notes,
        orderId,
        storeId
      ]
    );

    if (!wasPaid && nextFinalPaymentStatus === "PAID") {
      const [repairCheckRows] = await pool.query(
        `
          SELECT EXISTS (
            SELECT 1
            FROM order_items
            WHERE order_id = ?
              AND store_id = ?
              AND product_category_snapshot IN ('RP', 'REPAIR')
          ) AS isRepairOrder
        `,
        [orderId, storeId]
      );

      if (!repairCheckRows[0]?.isRepairOrder) {
        const confirmation = await createPurchaseConfirmationForOrder(orderId, pool, { storeId });
        await pushPurchaseConfirmationLineMessage(confirmation, { storeId });
      }
    }

    const [updated] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          o.business_date AS businessDate,
          o.total_amount AS totalAmount,
          o.customer_id AS customerId,
          o.customer_name AS customerNameSnapshot,
          o.customer_phone AS customerPhoneSnapshot,
          o.customer_type AS customerType,
          o.payment_method AS paymentMethod,
          o.status,
          o.is_reservation_order AS isReservationOrder,
          o.deposit_amount AS depositAmount,
          o.unpaid_balance AS unpaidBalance,
          COALESCE(o.other_discount, 0) AS otherDiscount,
          o.final_payment_status AS finalPaymentStatus,
          o.final_paid_at AS finalPaidAt,
          o.purchase_confirmation_sent_at AS purchaseConfirmationSentAt,
          o.handover_confirmed_at AS handoverConfirmedAt,
          o.notes,
          o.created_at AS createdAt,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          s.display_name AS staffName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        WHERE o.id = ?
          AND o.store_id = ?
        LIMIT 1
      `,
      [orderId, storeId]
    );

    return res.json(updated[0]);
  } catch (error) {
    return next(error);
  }
});


router.put("/:id/items", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    // ORDERS_ITEMS_STORE_SCOPE_V1
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!orderId || items.length === 0) {
      throw createError("請提供訂單商品", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [orderRows] = await connection.query(
        `SELECT id, final_payment_status AS finalPaymentStatus
         FROM orders
         WHERE id = ?
           AND store_id = ?
         FOR UPDATE`,
        [orderId, storeId]
      );

      const order = orderRows[0];
      if (!order) throw createError("找不到訂單", 404);
      let totalAmount = 0;
      const normalized = [];

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Math.max(Number(item.quantity || 1), 1);

        const [productRows] = await connection.query(
          `SELECT id, sku, name, category, price
           FROM products
           WHERE id = ?
             AND store_id = ?
             AND is_active = 1
           LIMIT 1`,
          [productId, storeId]
        );

        const product = productRows[0];
        if (!product) throw createError("找不到商品", 400);

        const unitPrice = Number(item.unitPrice ?? product.price ?? 0);
        const lineTotal = unitPrice * quantity;
        totalAmount += lineTotal;

        const category =
          product.category === "EB" ? "EBIKE" :
          product.category === "RP" ? "REPAIR" :
          product.category === "AC" ? "ACCESSORY" :
          "OTHER";

        normalized.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category,
          quantity,
          unitPrice,
          lineTotal
        });
      }

      await connection.query(
        `DELETE FROM order_items WHERE order_id = ? AND store_id = ?`,
        [orderId, storeId]
      );

      for (const item of normalized) {
        await connection.query(
          `INSERT INTO order_items
           (store_id, order_id, product_id, sku_snapshot, product_name_snapshot,
            product_category_snapshot, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            storeId,
            orderId,
            item.productId,
            item.sku,
            item.name,
            item.category,
            item.quantity,
            item.unitPrice,
            item.lineTotal
          ]
        );
      }

      const [payRows] = await connection.query(
        `SELECT total_amount AS currentTotalAmount,
                deposit_amount AS depositAmount,
                COALESCE(other_discount, 0) AS otherDiscount,
                source,
                notes
         FROM orders
         WHERE id = ?
           AND store_id = ?
         LIMIT 1`,
        [orderId, storeId]
      );

      const depositAmount = Number(payRows[0]?.depositAmount || 0);
      const otherDiscount = Number(payRows[0]?.otherDiscount || 0);
      const isLineOrderWithNewFriendCoupon =
        String(payRows[0]?.source || "") === "line_order" &&
        String(payRows[0]?.notes || "").includes("新朋友折扣");

      const couponDiscount = isLineOrderWithNewFriendCoupon ? 500 : 0;
      const payableAmount = Math.max(totalAmount - couponDiscount - otherDiscount, 0);
      const unpaidBalance = Math.max(payableAmount - depositAmount, 0);
      const finalPaymentStatus =
        unpaidBalance <= 0 ? "PAID" : depositAmount > 0 ? "PARTIAL" : "UNPAID";

      await connection.query(
        `UPDATE orders
         SET total_amount = ?,
             unpaid_balance = ?,
             final_payment_status = ?,
             final_paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(final_paid_at, NOW()) ELSE NULL END
         WHERE id = ?
           AND store_id = ?`,
        [payableAmount, unpaidBalance, finalPaymentStatus, finalPaymentStatus, orderId, storeId]
      );

      return { orderId, totalAmount: payableAmount, unpaidBalance, finalPaymentStatus, items: normalized };
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});


router.post("/:id/purchase-confirmation", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const confirmation = await createPurchaseConfirmationForOrder(orderId, pool, { storeId });

    if (!confirmation) {
      throw createError("只有已完款的電動自行車訂單可以產生購買確認書", 400);
    }

    const sent = await pushPurchaseConfirmationLineMessage(confirmation, { force: true, storeId });

    if (sent) {
      await sendToGroups(["admin", "staff"], [
        createFlexMessage(
          "購買確認書重新送出",
          "購買確認書重新送出",
          [`訂單 #${orderId} 的購買確認書連結已重新送出。`],
          [createUriAction("前往訂單", `${config.frontendBaseUrl}/orders`)]
        )
      ]);
    }

    return res.json({ link: confirmation.link, sent });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/collect-balance", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const amount = Number(req.body.amount || 0);
    if (!orderId || amount <= 0) {
      throw createError("請提供有效的補收金額", 400);
    }

    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `
          SELECT id, order_no AS orderNo, customer_type AS customerType, unpaid_balance AS unpaidBalance
          FROM orders
          WHERE id = ?
            AND store_id = ?
          FOR UPDATE
        `,
        [orderId, storeId]
      );

      const order = rows[0];
      if (!order) {
        throw createError("找不到訂單", 404);
      }

      const nextBalance = Math.max(Number(order.unpaidBalance || 0) - amount, 0);
      const nextStatus = nextBalance === 0 ? "PAID" : "PARTIAL";

      await connection.query(
        `
          UPDATE orders
          SET unpaid_balance = ?,
              final_payment_status = ?,
              final_paid_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE final_paid_at END
          WHERE id = ?
            AND store_id = ?
        `,
        [nextBalance, nextStatus, nextStatus, orderId, storeId]
      );

      await logWorkflowEvent("order_balance_collected", "ORDER", orderId, {
        amount,
        unpaidBalance: nextBalance
      }, req.user.id, connection);

      const [typeRows] = await connection.query(
        `
          SELECT
            EXISTS (
              SELECT 1 FROM order_items
              WHERE order_id = ?
                AND store_id = ?
                AND product_category_snapshot IN ('EB', 'EBIKE')
            ) AS isEbikeOrder,
            EXISTS (
              SELECT 1 FROM order_items
              WHERE order_id = ?
                AND store_id = ?
                AND product_category_snapshot IN ('RP', 'REPAIR')
            ) AS isRepairOrder,
            purchase_confirmation_sent_at AS purchaseConfirmationSentAt
          FROM orders
          WHERE id = ?
            AND store_id = ?
          LIMIT 1
        `,
        [orderId, storeId, orderId, storeId, orderId, storeId]
      );

      const orderType = typeRows[0] || {};

      return {
        orderNo: order.orderNo,
        customerType: normalizeCustomerType(order.customerType),
        unpaidBalance: nextBalance,
        finalPaymentStatus: nextStatus,
        becamePaid:
          nextBalance === 0 &&
          Boolean(orderType.isEbikeOrder) &&
          !Boolean(orderType.isRepairOrder) &&
          !orderType.purchaseConfirmationSentAt
      };
    });

    if (result.becamePaid) {
      try {
        const [customerRows] = await pool.query(
          `
            SELECT c.line_user_id AS lineUserId,
                   o.order_no AS orderNo,
                   EXISTS (
                     SELECT 1
                     FROM order_items oi
                     WHERE oi.order_id = o.id
                       AND oi.store_id = ?
                       AND oi.product_category_snapshot IN ('RP', 'REPAIR')
                   ) AS isRepairOrder
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id
            WHERE o.id = ?
              AND o.store_id = ?
            LIMIT 1
          `,
          [storeId, orderId, storeId]
        );

        const customer = customerRows[0];

        if (customer?.lineUserId) {
          const lineText = customer.isRepairOrder
            ? [
                "您的維修費用已完成收款，車輛已完成交付。",
                `訂單編號：${customer.orderNo}`,
                "",
                "感謝您的信任，歡迎再次使用 KINGWAY 維修服務。"
              ].join("\n")
            : [
                "您的尾款已完成收款",
                `訂單編號：${customer.orderNo}`,
                "",
                "我們將為您安排交車與購買確認流程。"
              ].join("\n");

          await sendLineMessage(config, customer.lineUserId, [
            {
              type: "text",
              text: lineText
            }
          ]);
        }
      } catch (e) {
        console.error("[collect-balance line push failed]", e);
      }

      const [repairCheckRows] = await pool.query(
        `
          SELECT EXISTS (
            SELECT 1
            FROM order_items
            WHERE order_id = ?
              AND store_id = ?
              AND product_category_snapshot IN ('RP', 'REPAIR')
          ) AS isRepairOrder
        `,
        [orderId, storeId]
      );

      if (!repairCheckRows[0]?.isRepairOrder) {
        const confirmation = await createPurchaseConfirmationForOrder(orderId, pool, { storeId });
        await pushPurchaseConfirmationLineMessage(confirmation, { storeId });
      }
    }

    if (isLineCustomerType(result.customerType)) {
      await sendToGroupsWithResult(["admin", "staff"], [
        {
          type: "text",
          text: [
            "尾款已完成",
            `訂單 ${result.orderNo} 已補收尾款。`,
            `完款狀態：${mapFinalPaymentStatusLabel(result.finalPaymentStatus)}`,
            "",
            "交車待確認，請由現場人員完成交車確認。"
          ].join("\n"),
          actions: [
            { type: "postback", label: "確認交車", data: `action=tg_crm_handover&id=${orderId}` },
            { type: "uri", label: "前往訂單", uri: `${config.frontendBaseUrl}/orders` }
          ]
        }
      ]);
    }

    return res.json({
      ...result,
      finalPaymentStatusLabel: mapFinalPaymentStatusLabel(result.finalPaymentStatus)
    });
  } catch (error) {
    return next(error);
  }
});


async function createKingwayAutoPurchaseOrderOnHandover(orderId, storeId, staffId = 1) {
  const [orderRows] = await pool.query(
    `
      SELECT id
      FROM orders
      WHERE id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [orderId, storeId]
  );

  if (!orderRows[0]) {
    return null;
  }

  const [[existing]] = await pool.query(
    `
      SELECT id
      FROM supplier_requests
      WHERE store_id = ?
        AND request_type = 'PURCHASE_ORDER'
        AND supplier_name = 'KINGWAY'
        AND note LIKE ?
      LIMIT 1
    `,
    [storeId, `%AUTO_FROM_HANDOVER_ORDER:${orderId}%`]
  );

  if (existing) return null;

  const [items] = await pool.query(
    `
      SELECT
        product_id AS productId,
        quantity,
        product_name_snapshot AS productName,
        sku_snapshot AS sku
      FROM order_items
      WHERE order_id = ?
        AND store_id = ?
        AND quantity > 0
    `,
    [orderId, storeId]
  );

  if (!items.length) return null;

  const [requestResult] = await pool.query(
    `
      INSERT INTO supplier_requests
        (store_id, request_type, status, supplier_name, note, requested_by_staff_id)
      VALUES
        (?, 'PURCHASE_ORDER', 'PENDING_SUPPLIER', 'KINGWAY', ?, ?)
    `,
    [storeId, `AUTO_FROM_HANDOVER_ORDER:${orderId}｜交車確認自動發注`, staffId || 1]
  );

  const requestId = requestResult.insertId;

  for (const item of items) {
    await pool.query(
      `
        INSERT INTO supplier_request_items
          (supplier_request_id, product_id, quantity, note)
        VALUES
          (?, ?, ?, ?)
      `,
      [
        requestId,
        item.productId,
        item.quantity,
        `${item.productName || ""} / ${item.sku || ""}`.trim()
      ]
    );
  }

  return requestId;
}


router.post("/:id/confirm-handover", authorize(["ADMIN", "MANAGER"]), requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [orderRows] = await pool.query(
      `
        SELECT id
        FROM orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );

    if (!orderRows[0]) {
      return res.status(404).json({ message: "找不到訂單" });
    }

    await pool.query(
      `
        UPDATE orders
        SET handover_confirmed_at = NOW(),
            handover_confirmed_by_staff_id = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [req.user.id, req.params.id, storeId]
    );

    await pool.query(
      `
        UPDATE purchase_confirmations
        SET handover_confirmed_at = NOW(),
            handover_confirmed_by_staff_id = ?
        WHERE order_id = ?
          AND store_id = ?
      `,
      [req.user.id, req.params.id, storeId]
    );

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'picked_up',
            picked_up_at = COALESCE(picked_up_at, NOW()),
            updated_at = NOW()
        WHERE order_id = ?
          AND store_id = ?
          AND status = 'completed_waiting_pickup'
      `,
      [req.params.id, storeId]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        SELECT id, 'picked_up', '訂單管理確認交車，同步更新為已取車'
        FROM repair_orders
        WHERE order_id = ?
          AND status = 'picked_up'
          AND picked_up_at IS NOT NULL
      `,
      [req.params.id]
    );

    let autoPoId = null;
    try {
      autoPoId = await createKingwayAutoPurchaseOrderOnHandover(req.params.id, storeId, req.user?.id || 1);
    } catch (autoPoError) {
      console.error("[auto-kingway-po handover failed]", autoPoError.message);
    }

    await logWorkflowEvent("order_handover_confirmed", "ORDER", req.params.id, { autoKingwayPurchaseOrderId: autoPoId }, req.user.id);
    await logKpi(req.user.id, "ORDER_HANDOVER_CONFIRMED", "ORDER", req.params.id, 3);
    return res.json({ message: autoPoId ? "已確認交車，並已建立 KINGWAY 自動發注" : "已確認交車" });
  } catch (error) {
    return next(error);
  }
});



// Order invoice print data
router.get("/:id/invoice", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const orderKey = String(req.params.id || "").trim();
    const decodedOrderKey = decodeURIComponent(orderKey);
    const orderId = Number(decodedOrderKey);
    const isNumericId = Number.isInteger(orderId) && orderId > 0;

    console.log("[orders:invoice] request", {
      orderKey,
      isNumericId,
      userId: req.user?.id,
      username: req.user?.username,
      storeId
    });

    if (!orderKey) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const [orderRows] = await pool.query(
      `
        SELECT
          o.*,
          COALESCE(c.name, o.customer_name) AS resolved_customer_name,
          COALESCE(c.phone, o.customer_phone) AS resolved_customer_phone
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
          AND c.store_id = o.store_id
        WHERE ${isNumericId ? "(o.id = ? OR o.order_no = ?)" : "o.order_no = ?"}
          AND o.store_id = ?
        LIMIT 1
      `,
      isNumericId ? [orderId, decodedOrderKey, storeId] : [decodedOrderKey, storeId]
    );

    console.log("[orders:invoice] orderRows", {
      orderKey,
      storeId,
      count: orderRows.length,
      foundId: orderRows[0]?.id,
      foundOrderNo: orderRows[0]?.order_no
    });

    if (!orderRows.length) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderRows[0];

    const [columns] = await pool.query(
      `
        SELECT COLUMN_NAME AS columnName
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'order_items'
      `
    );

    const columnSet = new Set(columns.map((row) => row.columnName));

    function col(candidates, fallback) {
      for (const name of candidates) {
        if (columnSet.has(name)) return `oi.\`${name}\``;
      }
      return fallback;
    }

    const nameExpr = col(["product_name_snapshot", "product_name", "name"], "'商品'");
    const skuExpr = col(["product_sku_snapshot", "sku"], "''");
    const qtyExpr = col(["quantity", "qty"], "0");
    const unitExpr = col(["unit_price", "price"], "0");
    const totalExpr = columnSet.has("subtotal")
      ? "COALESCE(oi.`subtotal`, 0)"
      : columnSet.has("line_total")
        ? "COALESCE(oi.`line_total`, 0)"
        : `COALESCE(${unitExpr}, 0) * COALESCE(${qtyExpr}, 0)`;

    const [itemRows] = await pool.query(
      `
        SELECT
          oi.id,
          ${nameExpr} AS productName,
          ${skuExpr} AS sku,
          COALESCE(${qtyExpr}, 0) AS quantity,
          COALESCE(${unitExpr}, 0) AS unitPrice,
          ${totalExpr} AS subtotal
        FROM order_items oi
        WHERE oi.order_id = ?
          AND oi.store_id = ?
        ORDER BY oi.id
      `,
      [order.id, storeId]
    );

    console.log("[orders:invoice] itemRows", {
      orderId: order.id,
      storeId,
      count: itemRows.length
    });

    const items = itemRows.map((item) => ({
      id: item.id,
      productName: item.productName || "商品",
      sku: item.sku || "",
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal || 0)
    }));

    const itemTotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const receivableAmount = Number(order.total_amount || 0);
    const couponDiscountAmount = Number(order.coupon_discount || order.coupon_discount_amount || order.coupon_amount || 0);
    const storedOtherDiscount = Number(order.other_discount || order.manual_discount || order.discount_amount || 0);
    const computedOtherDiscount = Math.max(itemTotal - receivableAmount - couponDiscountAmount, 0);
    const otherDiscountAmount = storedOtherDiscount > 0 ? storedOtherDiscount : computedOtherDiscount;
    const originalAmount = Math.max(itemTotal, receivableAmount + couponDiscountAmount + otherDiscountAmount);
    const depositAmount = Number(order.deposit_amount || 0);
    const unpaidBalance = Number(order.unpaid_balance || Math.max(receivableAmount - depositAmount, 0));

    res.json({
      order: {
        id: order.id,
        orderNo: order.order_no,
        createdAt: order.created_at,
        businessDate: order.business_date,
        customerName: order.resolved_customer_name || order.customer_name || "",
        customerPhone: order.resolved_customer_phone || order.customer_phone || "",
        paymentMethod: order.payment_method,
        finalPaymentStatus: order.final_payment_status,
        status: order.status,
        notes: order.notes || ""
      },
      items,
      totals: {
        originalAmount,
        couponDiscountAmount,
        otherDiscountAmount,
        discountAmount: couponDiscountAmount + otherDiscountAmount,
        receivableAmount,
        depositAmount,
        unpaidBalance
      }
    });
  } catch (error) {
    console.error("[orders:invoice] error", error);
    next(error);
  }
});


module.exports = router;
