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
  backfillMissingRepairQuoteOrderItems,
  createPurchaseConfirmationForOrder,
  getPurchaseConfirmationEligibility,
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
const {
  buildStaffPageUrl,
  createUriAction: createStaffLineUriAction,
  notifyStaffActionRequired
} = require("../services/staffLineNotify");
const { canEditPaymentCompletionDate } = require("../utils/roleAccess");
const { createOrReuseRepairConfirmationForPaidOrder } = require("../services/repairConfirmationService");
const {
  createOrderPaymentRecord,
  getCompanyIdForStore,
  getPaymentRecordsForOrder,
  normalizePaymentCompletionPayload,
  normalizeTaipeiDateTime
} = require("../services/orderPaymentRecordService");
const {
  assertOrderAccessoryInstallConfirmationsComplete,
  crossCheckOrderAccessoryInstallConfirmation,
  listOrderAccessoryInstallConfirmations,
  updateOrderAccessoryInstallConfirmation
} = require("../services/orderAccessoryInstallConfirmationService");

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR"]));
const requireOrderManagementFeature = requireStoreFeature("orders_enabled");
const requirePosFeature = requireStoreFeature("pos_enabled");
const ORDER_CREATE_GUARD_TTL_MS = 60 * 1000;
const recentOrderCreateRequests = new Map();
const DEFAULT_WARRANTY_TERMS_VERSION = "KINGWAY_WARRANTY_REPAIR_TERMS_2026_07";
const WARRANTY_COLUMNS = [
  "warranty_start_date",
  "warranty_months",
  "warranty_mileage_limit_km",
  "warranty_note",
  "warranty_terms_version"
];

function pruneOrderCreateGuards(now = Date.now()) {
  for (const [key, entry] of recentOrderCreateRequests.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentOrderCreateRequests.delete(key);
    }
  }
}

function normalizeOrderItemsForFingerprint(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      productId: Number(item.productId || item.product_id || 0),
      qty: Number(item.quantity || item.qty || 0),
      unitPrice: item.unitPrice === undefined ? null : Number(item.unitPrice)
    }))
    .sort((a, b) => a.productId - b.productId || a.qty - b.qty || Number(a.unitPrice || 0) - Number(b.unitPrice || 0));
}

function getOrderCreateGuardKey(storeId, body = {}) {
  const requestId = String(body.orderCreateRequestId || body.requestId || "").trim();
  if (requestId) {
    return `store:${storeId}:request:${requestId.slice(0, 120)}`;
  }

  const fingerprint = {
    customerId: body.customerId || null,
    customerName: body.customer_name || body.customerName || "",
    customerPhone: body.customer_phone || body.customerPhone || "",
    customerType: body.customer_type || body.customerType || "",
    paymentMethod: body.paymentMethod || "",
    depositAmount: body.depositAmount || 0,
    unpaidBalance: body.unpaidBalance || 0,
    finalPaymentStatus: body.finalPaymentStatus || "",
    couponCode: body.couponCode || "",
    couponAmount: body.couponAmount || 0,
    items: normalizeOrderItemsForFingerprint(body.items)
  };
  return `store:${storeId}:fingerprint:${JSON.stringify(fingerprint)}`;
}

function hasOwnPropertyValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

const ORDER_PRICE_DISCOUNT_FIELDS = [
  "otherDiscount", "other_discount", "unitPrice", "unit_price", "price",
  "salePrice", "sale_price", "lineTotal", "line_total", "totalAmount",
  "total_amount", "discount", "manualDiscount", "manual_discount"
];

function hasOrderPriceDiscountField(body) {
  if (ORDER_PRICE_DISCOUNT_FIELDS.some((field) => hasOwnPropertyValue(body, field))) return true;
  return Array.isArray(body?.items) && body.items.some((item) =>
    ORDER_PRICE_DISCOUNT_FIELDS.some((field) => hasOwnPropertyValue(item, field))
  );
}

function assertAdminCanEditOrderPriceDiscount(req) {
  const requesterRole = String(req.user?.role || "").trim().toUpperCase();
  if (requesterRole !== "ADMIN" && hasOrderPriceDiscountField(req.body)) {
    throw createError("\u53ea\u6709\u7ba1\u7406\u54e1\u53ef\u4ee5\u4fee\u6539\u50f9\u683c\u6216\u6298\u6263", 403);
  }
}

function normalizeOrderCustomerSnapshot(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim();
}

function normalizeNullableWarrantyDate(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${label}格式需為 YYYY-MM-DD`, 400);
  }
  return text;
}

function normalizeNullableUnsignedInteger(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw createError(`${label}必須為非負整數`, 400);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw createError(`${label}必須為非負整數`, 400);
  }
  return Number(text);
}

function normalizeNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeWarrantyPayload(body = {}) {
  const payload = {};

  if (hasOwnPropertyValue(body, "warrantyStartDate") || hasOwnPropertyValue(body, "warranty_start_date")) {
    payload.warranty_start_date = normalizeNullableWarrantyDate(
      body.warranty_start_date !== undefined ? body.warranty_start_date : body.warrantyStartDate,
      "保固起算日"
    );
  }

  if (hasOwnPropertyValue(body, "warrantyMonths") || hasOwnPropertyValue(body, "warranty_months")) {
    payload.warranty_months = normalizeNullableUnsignedInteger(
      body.warranty_months !== undefined ? body.warranty_months : body.warrantyMonths,
      "保固期間"
    );
  }

  if (hasOwnPropertyValue(body, "warrantyMileageLimitKm") || hasOwnPropertyValue(body, "warranty_mileage_limit_km")) {
    payload.warranty_mileage_limit_km = normalizeNullableUnsignedInteger(
      body.warranty_mileage_limit_km !== undefined ? body.warranty_mileage_limit_km : body.warrantyMileageLimitKm,
      "保固里程上限"
    );
  }

  if (hasOwnPropertyValue(body, "warrantyNote") || hasOwnPropertyValue(body, "warranty_note")) {
    payload.warranty_note = normalizeNullableText(
      body.warranty_note !== undefined ? body.warranty_note : body.warrantyNote
    );
  }

  if (hasOwnPropertyValue(body, "warrantyTermsVersion") || hasOwnPropertyValue(body, "warranty_terms_version")) {
    payload.warranty_terms_version =
      normalizeNullableText(body.warranty_terms_version !== undefined ? body.warranty_terms_version : body.warrantyTermsVersion) ||
      DEFAULT_WARRANTY_TERMS_VERSION;
  } else if (Object.keys(payload).length > 0) {
    payload.warranty_terms_version = DEFAULT_WARRANTY_TERMS_VERSION;
  }

  return payload;
}

function hasWarrantyPayload(body = {}) {
  return [
    "warrantyStartDate",
    "warranty_start_date",
    "warrantyMonths",
    "warranty_months",
    "warrantyMileageLimitKm",
    "warranty_mileage_limit_km",
    "warrantyNote",
    "warranty_note",
    "warrantyTermsVersion",
    "warranty_terms_version"
  ].some((key) => hasOwnPropertyValue(body, key));
}

function hasOrderWarrantyColumns(orderColumns) {
  return WARRANTY_COLUMNS.every((column) => hasColumn(orderColumns, column));
}

function buildWarrantySelects(orderColumns) {
  return [
    selectColumn(orderColumns, "o", "warranty_start_date", "warrantyStartDate"),
    selectColumn(orderColumns, "o", "warranty_months", "warrantyMonths"),
    selectColumn(orderColumns, "o", "warranty_mileage_limit_km", "warrantyMileageLimitKm"),
    selectColumn(orderColumns, "o", "warranty_note", "warrantyNote"),
    selectColumn(orderColumns, "o", "warranty_terms_version", "warrantyTermsVersion"),
    `${hasOrderWarrantyColumns(orderColumns) ? "1" : "0"} AS warrantySchemaReady`
  ].join(",\n          ");
}

function startOrderCreateGuard(storeId, body = {}) {
  const now = Date.now();
  pruneOrderCreateGuards(now);
  const key = getOrderCreateGuardKey(storeId, body);
  const existing = recentOrderCreateRequests.get(key);

  if (existing && existing.expiresAt > now) {
    return {
      duplicate: true,
      response: existing.status === "completed" ? existing.response : null
    };
  }

  const entry = {
    status: "processing",
    response: null,
    expiresAt: now + ORDER_CREATE_GUARD_TTL_MS
  };
  recentOrderCreateRequests.set(key, entry);
  return { duplicate: false, key, entry };
}

function completeOrderCreateGuard(guard, response) {
  if (!guard?.key || !guard.entry) {
    return;
  }

  guard.entry.status = "completed";
  guard.entry.response = response;
  guard.entry.expiresAt = Date.now() + ORDER_CREATE_GUARD_TTL_MS;
}

function clearOrderCreateGuard(guard) {
  if (guard?.entry?.status === "completed") {
    return;
  }
  if (guard?.key) {
    recentOrderCreateRequests.delete(guard.key);
  }
}

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

function isCanceledOrDeletedOrderStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["CANCELED", "CANCELLED", "DELETED", "VOID"].includes(normalized);
}

function buildPickupItemSummary(items = []) {
  const names = items
    .map((item) => String(item.productName || item.sku || "商品").trim())
    .filter(Boolean);

  if (!names.length) {
    return "商品/車輛";
  }

  const summary = names.slice(0, 3).join("、");
  return names.length > 3 ? `${summary} 等 ${names.length} 項` : summary;
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
    const orderItemTotalSql = hasColumn(orderItemColumns, "line_total")
      ? `
          (
            SELECT COALESCE(SUM(oi_amount.line_total), 0)
            FROM order_items oi_amount
            WHERE oi_amount.order_id = o.id
              AND oi_amount.store_id = o.store_id
          )
        `
      : "0";
    const orderTotalAmountSql = hasColumn(orderColumns, "total_amount") ? "COALESCE(o.total_amount, 0)" : "0";
    const orderOtherDiscountSql = hasColumn(orderColumns, "other_discount") ? "COALESCE(o.other_discount, 0)" : "0";
    const orderNotesSql = hasColumn(orderColumns, "notes") ? "COALESCE(o.notes, '')" : "''";
    const orderDisplayFinalAmountSql = `
      GREATEST(
        ${orderItemTotalSql}
        - GREATEST(${orderItemTotalSql} - ${orderTotalAmountSql} - ${orderOtherDiscountSql}, 0)
        - ${orderOtherDiscountSql},
        0
      )
    `;
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
          ${orderItemTotalSql} AS itemTotal,
          ${orderOtherDiscountSql} AS otherDiscount,
          ${orderDisplayFinalAmountSql} AS displayFinalAmount,
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
          ${selectColumn(orderColumns, "o", "final_payment_method", "finalPaymentMethod")},
          ${selectColumn(orderColumns, "o", "final_payment_received_amount", "finalPaymentReceivedAmount")},
          ${selectColumn(orderColumns, "o", "final_payment_note", "finalPaymentNote")},
          ${selectColumn(orderColumns, "o", "final_payment_completed_by_staff_user_id", "finalPaymentCompletedByStaffUserId")},
          ${selectColumn(orderColumns, "o", "final_payment_completed_at", "finalPaymentCompletedAt")},
          paid_staff.display_name AS finalPaymentCompletedByName,
          ${selectColumn(orderColumns, "o", "purchase_confirmation_sent_at", "purchaseConfirmationSentAt")},
          ${selectColumn(orderColumns, "o", "handover_confirmed_at", "handoverConfirmedAt")},
          ${buildWarrantySelects(orderColumns)},
          ${selectColumn(orderColumns, "o", "notes", "notes")},
          ${selectColumn(orderColumns, "o", "created_at", "createdAt")},
          ${selectColumn(customerColumns, "c", "id", "customerId")},
          c.line_user_id AS lineUserId,
          COALESCE(o.customer_name, ${hasColumn(customerColumns, "name") ? "c.name" : "NULL"}) AS customerName,
          COALESCE(o.customer_phone, ${hasColumn(customerColumns, "phone") ? "c.phone" : "NULL"}) AS customerPhone,
          ${selectColumn(staffColumns, "s", "id", "staffId")},
          ${selectColumn(staffColumns, "s", "display_name", "staffName")},
          EXISTS (
            SELECT 1
            FROM order_items oi_eb
            WHERE oi_eb.order_id = o.id
              AND oi_eb.store_id = o.store_id
              AND (
                UPPER(COALESCE(oi_eb.product_category_snapshot, '')) IN ('EB', 'EBIKE')
                OR COALESCE(oi_eb.product_category_snapshot, '') LIKE '%電動自行車%'
                OR UPPER(COALESCE(oi_eb.sku_snapshot, '')) LIKE 'B-EB-%'
              )
            LIMIT 1
          ) AS hasEbikeItems,
          EXISTS (
            SELECT 1
            FROM order_items oi_accessory
            WHERE oi_accessory.order_id = o.id
              AND oi_accessory.store_id = o.store_id
              AND UPPER(COALESCE(oi_accessory.product_category_snapshot, '')) = 'ACCESSORY'
            LIMIT 1
          ) AS hasAccessoryItems,
          ${repairExistsSql} AS isRepairOrder
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        LEFT JOIN staff_users paid_staff ON paid_staff.id = o.final_payment_completed_by_staff_user_id
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
        hasEbikeItems: Boolean(row.hasEbikeItems),
        hasAccessoryItems: Boolean(row.hasAccessoryItems),
        paymentMethodLabel: mapPaymentMethodLabel(row.paymentMethod),
        finalPaymentMethodLabel: mapPaymentMethodLabel(row.finalPaymentMethod || row.paymentMethod),
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
      await connection.query("DELETE FROM order_accessory_install_confirmations WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("UPDATE coupons SET order_id = NULL WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("UPDATE repair_orders SET order_id = NULL WHERE order_id = ? AND store_id = ?", [req.params.id, storeId]);
      await connection.query("DELETE FROM orders WHERE id = ? AND store_id = ?", [req.params.id, storeId]);
    });

    return res.json({ message: "訂單已永久刪除" });
  } catch (error) {
    return next(error);
  }
});


router.post("/repair-quote-backfill-missing-items", authorize(["ADMIN", "MANAGER"]), requireOrderManagementFeature, async (req, res, next) => {
  try {
    const apply = req.body?.apply === true;
    const limit = req.body?.limit;
    const result = await backfillMissingRepairQuoteOrderItems({
      storeId: req.storeId,
      limit,
      apply
    });

    return res.json({
      message: apply ? "維修報價品項同步完成" : "維修報價品項同步 dry-run 完成",
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/install-check", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const orderId = Number(req.params.id);
    if (!orderId) {
      throw createError("找不到訂單", 404);
    }

    const orderColumns = await getTableColumns(pool, "orders");
    const [orderRows] = await pool.query(
      `
        SELECT
          ${selectColumn(orderColumns, "o", "id", "id")},
          ${selectColumn(orderColumns, "o", "order_no", "orderNumber")},
          ${selectColumn(orderColumns, "o", "status", "status")},
          ${selectColumn(orderColumns, "o", "source", "source")},
          ${selectColumn(orderColumns, "o", "repair_order_id", "repairOrderId")},
          ${selectColumn(orderColumns, "o", "created_at", "createdAt")},
          ${selectColumn(orderColumns, "o", "completed_at", "completedAt")},
          ${selectColumn(orderColumns, "o", "business_date", "businessDate")},
          ${selectColumn(orderColumns, "o", "handover_confirmed_at", "handoverConfirmedAt")},
          ${selectColumn(orderColumns, "o", "customer_name", "customerNameSnapshot")},
          ${selectColumn(orderColumns, "o", "customer_phone", "customerPhoneSnapshot")},
          COALESCE(o.customer_name, c.name) AS customerName,
          COALESCE(o.customer_phone, c.phone) AS customerPhone,
          st.name AS storeName,
          st.code AS storeCode
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN stores st ON st.id = o.store_id
        WHERE o.id = ?
          AND o.store_id = ?
          AND o.deleted_at IS NULL
        LIMIT 1
      `,
      [orderId, storeId]
    );

    const order = orderRows[0];
    if (!order) {
      throw createError("找不到訂單", 404);
    }

    const isRepairQuote = String(order.source || "").trim().toLowerCase() === "repair_quote" || Boolean(order.repairOrderId);
    const [itemRows] = await pool.query(
      `
        SELECT
          oi.id AS orderItemId,
          oi.product_id AS productId,
          oi.sku_snapshot AS sku,
          oi.product_name_snapshot AS name,
          oi.product_category_snapshot AS category,
          oi.quantity
        FROM order_items oi
        WHERE oi.order_id = ?
          AND oi.store_id = ?
        ORDER BY oi.id ASC
      `,
      [orderId, storeId]
    );

    const isEbikeItem = (item = {}) => {
      const category = String(item.category || "").trim().toUpperCase();
      const sku = String(item.sku || "").trim().toUpperCase();
      return category === "EB" || category === "EBIKE" || category.includes("電動自行車") || sku.startsWith("B-EB-");
    };
    const hasEbike = itemRows.some(isEbikeItem);
    const vehicleItem = itemRows.find(isEbikeItem) || null;
    const accessoryItems = itemRows.filter((item) => String(item.category || "").trim().toUpperCase() === "ACCESSORY");
    let confirmationByOrderItemId = new Map();

    const [tableRows] = await pool.query(
      `
        SELECT 1 AS existsFlag
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'order_accessory_install_confirmations'
        LIMIT 1
      `
    );

    if (tableRows[0]) {
      const [confirmationRows] = await pool.query(
        `
          SELECT
            order_item_id AS orderItemId,
            note,
            is_installed AS isInstalled,
            is_tested AS isTested,
            is_photo_confirmed AS isPhotoConfirmed,
            cross_checked_at AS crossCheckedAt
          FROM order_accessory_install_confirmations
          WHERE order_id = ?
            AND store_id = ?
        `,
        [orderId, storeId]
      );
      confirmationByOrderItemId = new Map(confirmationRows.map((row) => [Number(row.orderItemId), row]));
    }

    const installItems = !isRepairQuote && hasEbike
      ? [vehicleItem, ...accessoryItems].filter(Boolean).map((item) => {
          const confirmation = confirmationByOrderItemId.get(Number(item.orderItemId)) || {};
          const isInstalled = Boolean(confirmation.isInstalled);
          const isTested = Boolean(confirmation.isTested);
          const isPhotoConfirmed = Boolean(confirmation.isPhotoConfirmed);
          const crossCheckedAt = confirmation.crossCheckedAt || null;
          return {
            name: item.name || "商品",
            sku: item.sku || "",
            quantity: Number(item.quantity || 0),
            note: confirmation.note || "",
            confirmation: {
              isInstalled,
              isTested,
              isPhotoConfirmed,
              crossCheckedAt,
              completed: Boolean(isInstalled && isTested && isPhotoConfirmed && crossCheckedAt)
            }
          };
        })
      : [];

    return res.json({
      order: {
        id: order.id,
        orderNumber: order.orderNumber || `#${order.id}`,
        status: order.status,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
        businessDate: order.businessDate,
        handoverStatus: order.handoverConfirmedAt ? "confirmed" : "pending",
        handoverConfirmedAt: order.handoverConfirmedAt || null,
        repairQuote: isRepairQuote,
        printable: Boolean(!isRepairQuote && hasEbike && installItems.length)
      },
      customer: {
        name: order.customerName || order.customerNameSnapshot || "",
        phone: order.customerPhone || order.customerPhoneSnapshot || ""
      },
      store: {
        name: order.storeName || "",
        code: order.storeCode || ""
      },
      vehicle: vehicleItem ? {
        name: vehicleItem.name || "",
        sku: vehicleItem.sku || "",
        quantity: Number(vehicleItem.quantity || 0)
      } : null,
      installItems
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const orderId = req.params.id;
    const orderColumns = await getTableColumns(pool, "orders");

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
          o.final_payment_method AS finalPaymentMethod,
          o.final_payment_received_amount AS finalPaymentReceivedAmount,
          o.final_payment_note AS finalPaymentNote,
          o.final_payment_completed_by_staff_user_id AS finalPaymentCompletedByStaffUserId,
          o.final_payment_completed_at AS finalPaymentCompletedAt,
          paid_staff.display_name AS finalPaymentCompletedByName,
          o.purchase_confirmation_sent_at AS purchaseConfirmationSentAt,
          o.handover_confirmed_at AS handoverConfirmedAt,
          ${buildWarrantySelects(orderColumns)},
          o.notes,
          o.created_at AS createdAt,
          COALESCE(o.customer_name, c.name) AS customerName,
          COALESCE(o.customer_phone, c.phone) AS customerPhone,
          c.line_user_id AS lineUserId,
          s.display_name AS staffName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        LEFT JOIN staff_users paid_staff ON paid_staff.id = o.final_payment_completed_by_staff_user_id
        WHERE o.id = ?
          AND o.store_id = ?
          AND o.deleted_at IS NULL
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
    const itemTotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const otherDiscount = Number(rows[0].otherDiscount || 0);
    const couponDiscount = Math.max(itemTotal - Number(rows[0].totalAmount || 0) - otherDiscount, 0);
    const displayFinalAmount = Math.max(itemTotal - couponDiscount - otherDiscount, 0);
    const paymentRecords = await getPaymentRecordsForOrder(orderId, storeId);

    return res.json({
      ...rows[0],
      itemTotal,
      displayFinalAmount,
      repairStatusLabel: mapRepairStatusLabel(rows[0].repairStatus),
      paymentMethodLabel: mapPaymentMethodLabel(rows[0].paymentMethod),
      finalPaymentMethodLabel: mapPaymentMethodLabel(rows[0].finalPaymentMethod || rows[0].paymentMethod),
      paymentRecords,
      items
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:orderId/accessory-install-confirmations", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    const storeId = req.storeId;
    if (!orderId) {
      throw createError("找不到訂單", 404);
    }

    const result = await withTransaction(async (connection) =>
      listOrderAccessoryInstallConfirmations(orderId, storeId, connection)
    );

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:orderId/accessory-install-confirmations/:confirmationId", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    const confirmationId = Number(req.params.confirmationId);
    const storeId = req.storeId;
    if (!orderId || !confirmationId) {
      throw createError("找不到配件安裝確認項目", 404);
    }

    const result = await withTransaction(async (connection) =>
      updateOrderAccessoryInstallConfirmation(
        orderId,
        confirmationId,
        storeId,
        req.body || {},
        req.user?.id || null,
        req.user?.displayName || req.user?.username || "",
        connection
      )
    );

    return res.json({
      message: "配件安裝確認已更新",
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:orderId/accessory-install-confirmations/:confirmationId/cross-check", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    const confirmationId = Number(req.params.confirmationId);
    const storeId = req.storeId;
    if (!orderId || !confirmationId) {
      throw createError("找不到配件安裝確認項目", 404);
    }

    const result = await withTransaction(async (connection) =>
      crossCheckOrderAccessoryInstallConfirmation(
        orderId,
        confirmationId,
        storeId,
        req.user?.id || null,
        req.user?.displayName || req.user?.username || "",
        connection
      )
    );

    if (result.readyForHandoverChecklist) {
      try {
        const [orderRows] = await pool.query(
          `
            SELECT o.id, o.order_no AS orderNo, COALESCE(o.customer_name, c.name) AS customerName
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id AND c.store_id = o.store_id
            WHERE o.id = ?
              AND o.store_id = ?
            LIMIT 1
          `,
          [orderId, storeId]
        );
        const order = orderRows[0] || {};
        await notifyStaffActionRequired({
          eventType: "ORDER_READY",
          relatedType: "ORDER",
          relatedId: orderId,
          storeId,
          title: "🚲 交車檢查待確認",
          altText: "交車檢查待確認",
          bodyLines: [
            `訂單：#${orderId}`,
            `客戶：${order.customerName || "-"}`,
            "配件安裝交叉確認已完成，請在後台確認交車前檢查。"
          ],
          actions: [
            { label: "✅ 已確認", action: "staff_line_ack" },
            { label: "🙋 我來處理", action: "staff_line_assign" },
            createStaffLineUriAction("📋 查看詳情", buildStaffPageUrl(`/orders/${orderId}/edit`))
          ],
          payload: { orderId, orderNo: order.orderNo || null, source: "accessory_install_cross_check", scope: "internal_handover_check" }
        }, {
          registrationTypes: ["staff", "admin"],
          purpose: "order_ready_staff_group_notify"
        });
      } catch (staffLineError) {
        console.warn("[staff-line] order ready notification failed", {
          orderId,
          message: staffLineError.message
        });
      }
    }

    return res.json({
      message: "交叉確認已完成",
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", requirePosFeature, async (req, res, next) => {
  let orderCreateGuard = null;
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

    orderCreateGuard = startOrderCreateGuard(storeId, req.body || {});
    if (orderCreateGuard.duplicate) {
      if (orderCreateGuard.response) {
        return res.status(200).json({
          ...orderCreateGuard.response,
          duplicate: true,
          message: "訂單正在建立中，請勿重複送出。"
        });
      }

      return res.status(409).json({ message: "訂單正在建立中，請勿重複送出。" });
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
              AND store_id = ?
              AND is_used = 0
              AND status IN ('issued', 'approved')
          `,
          [orderResult.insertId, couponCodes, resolvedCustomerId, storeId]
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
    completeOrderCreateGuard(orderCreateGuard, order);

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
    clearOrderCreateGuard(orderCreateGuard);
    return next(error);
  }
});

router.patch("/:id", requireOrderManagementFeature, async (req, res, next) => {
  try {
    assertAdminCanEditOrderPriceDiscount(req);
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const {
      customerName,
      customerPhone,
      customer_name: customerNameSnake,
      customer_phone: customerPhoneSnake,
      paymentMethod,
      isReservationOrder,
      depositAmount,
      unpaidBalance,
      otherDiscount,
        other_discount: otherDiscountSnake,
      finalPaymentStatus,
      notes
    } = req.body;
    const orderColumns = await getTableColumns(pool, "orders");
    const warrantyPayload = normalizeWarrantyPayload(req.body || {});
    const shouldUpdateWarranty = hasWarrantyPayload(req.body || {}) && hasOrderWarrantyColumns(orderColumns);
    if (hasWarrantyPayload(req.body || {}) && !shouldUpdateWarranty) {
      const hasNonEmptyWarrantyValue = Object.values(warrantyPayload).some((value) => value !== null && value !== undefined && value !== DEFAULT_WARRANTY_TERMS_VERSION);
      if (hasNonEmptyWarrantyValue) {
        throw createError("保固欄位尚未建立，請先套用訂單保固 migration", 400);
      }
    }
    const hasCustomerName = hasOwnPropertyValue(req.body, "customerName") || hasOwnPropertyValue(req.body, "customer_name");
    const hasCustomerPhone = hasOwnPropertyValue(req.body, "customerPhone") || hasOwnPropertyValue(req.body, "customer_phone");
    const nextCustomerName = normalizeOrderCustomerSnapshot(customerNameSnake !== undefined ? customerNameSnake : customerName);
    const nextCustomerPhone = normalizeOrderCustomerSnapshot(customerPhoneSnake !== undefined ? customerPhoneSnake : customerPhone);

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
    const hasOtherDiscount =
      Object.prototype.hasOwnProperty.call(req.body || {}, "otherDiscount") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "other_discount");
    const requestedOtherDiscount =
      otherDiscount !== undefined ? otherDiscount : otherDiscountSnake;
    const requesterRole = String(req.user?.role || "").trim().toUpperCase();

    if (hasOtherDiscount && requesterRole !== "ADMIN") {
      throw createError("只有管理員可以修改其他折扣", 403);
    }

    const hasFinalPaymentStatus = finalPaymentStatus !== undefined;
    const nextDepositAmount = hasDepositAmount ? Number(depositAmount || 0) : Number(rows[0].depositAmount || 0);
    const nextOtherDiscount = hasOtherDiscount ? Number(requestedOtherDiscount || 0) : Number(rows[0].otherDiscount || 0);

    const [sumRows] = await pool.query(
      `SELECT COALESCE(SUM(line_total), 0) AS itemTotal FROM order_items WHERE order_id = ? AND store_id = ?`,
      [orderId, storeId]
    );

    const itemTotal = Number(sumRows[0]?.itemTotal || 0);
    const currentPayable = Number(rows[0].totalAmount || 0);
    const currentOtherDiscount = Number(rows[0].otherDiscount || 0);
    const couponDiscount = Math.max(itemTotal - currentPayable - currentOtherDiscount, 0);
    const nextTotalAmount = Math.max(itemTotal - couponDiscount - nextOtherDiscount, 0);
    const currentFinalPaymentStatus = String(rows[0].finalPaymentStatus || "").trim().toUpperCase();
    const requestedFinalPaymentStatus = hasFinalPaymentStatus ? String(finalPaymentStatus || "").trim().toUpperCase() : "";
    const recalculatedUnpaidBalance = Math.max(nextTotalAmount - nextDepositAmount, 0);
    const nextFinalPaymentStatus = hasFinalPaymentStatus
      ? requestedFinalPaymentStatus
      : currentFinalPaymentStatus === "PAID"
        ? "PAID"
        : recalculatedUnpaidBalance > 0
          ? "PARTIAL"
          : "PAID";
    const nextUnpaidBalance = nextFinalPaymentStatus === "PAID" ? 0 : recalculatedUnpaidBalance;

    const wasPaid = currentFinalPaymentStatus === "PAID";

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
          ${shouldUpdateWarranty ? `,
          warranty_start_date = ?,
          warranty_months = ?,
          warranty_mileage_limit_km = ?,
          warranty_note = ?,
          warranty_terms_version = ?` : ""}
        WHERE id = ?
          AND store_id = ?
      `,
      [
        hasCustomerName ? nextCustomerName : null,
        hasCustomerPhone ? nextCustomerPhone : null,
        paymentMethod === undefined ? null : paymentMethod,
        isReservationOrder === undefined ? null : Number(Boolean(isReservationOrder)),
        hasDepositAmount ? nextDepositAmount : null,
        nextOtherDiscount,
        nextTotalAmount,
        nextUnpaidBalance,
        nextFinalPaymentStatus,
        nextFinalPaymentStatus,
        notes === undefined ? null : notes,
        ...(shouldUpdateWarranty ? [
          warrantyPayload.warranty_start_date,
          warrantyPayload.warranty_months,
          warrantyPayload.warranty_mileage_limit_km,
          warrantyPayload.warranty_note,
          warrantyPayload.warranty_terms_version || DEFAULT_WARRANTY_TERMS_VERSION
        ] : []),
        orderId,
        storeId
      ]
    );

    let repairConfirmation = null;
    let repairConfirmationWarning = null;

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

      if (repairCheckRows[0]?.isRepairOrder) {
        try {
          const confirmationResult = await createOrReuseRepairConfirmationForPaidOrder(
            orderId,
            storeId,
            req.user?.id || null,
            {
              source: "payment_completed",
              purpose: "repair_confirmation_auto_after_payment_complete"
            }
          );
          if (confirmationResult.ok) {
            repairConfirmation = confirmationResult.confirmation || null;
          } else if (confirmationResult.reason !== "維修完成後可發送確認書") {
            repairConfirmationWarning = confirmationResult.reason || "維修完成確認書尚未自動建立";
          }
        } catch (confirmationError) {
          repairConfirmationWarning = confirmationError.message || "維修完成確認書自動建立失敗";
        }
      } else {
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
          o.final_payment_method AS finalPaymentMethod,
          o.final_payment_received_amount AS finalPaymentReceivedAmount,
          o.final_payment_note AS finalPaymentNote,
          o.final_payment_completed_by_staff_user_id AS finalPaymentCompletedByStaffUserId,
          o.final_payment_completed_at AS finalPaymentCompletedAt,
          paid_staff.display_name AS finalPaymentCompletedByName,
          o.purchase_confirmation_sent_at AS purchaseConfirmationSentAt,
          o.handover_confirmed_at AS handoverConfirmedAt,
          ${buildWarrantySelects(orderColumns)},
          o.notes,
          o.created_at AS createdAt,
          COALESCE(o.customer_name, c.name) AS customerName,
          COALESCE(o.customer_phone, c.phone) AS customerPhone,
          c.line_user_id AS lineUserId,
          s.display_name AS staffName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN staff_users s ON s.id = o.created_by
        LEFT JOIN staff_users paid_staff ON paid_staff.id = o.final_payment_completed_by_staff_user_id
        WHERE o.id = ?
          AND o.store_id = ?
        LIMIT 1
      `,
      [orderId, storeId]
    );

    return res.json({
      ...updated[0],
      paymentMethodLabel: mapPaymentMethodLabel(updated[0]?.paymentMethod),
      finalPaymentMethodLabel: mapPaymentMethodLabel(updated[0]?.finalPaymentMethod || updated[0]?.paymentMethod),
      repairConfirmation,
      repairConfirmationWarning
    });
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
      const couponDiscount = 0;
      const payableAmount = Math.max(totalAmount - couponDiscount - otherDiscount, 0);
      const currentFinalPaymentStatus = String(order.finalPaymentStatus || "").trim().toUpperCase();
      const recalculatedUnpaidBalance = Math.max(payableAmount - depositAmount, 0);
      const unpaidBalance = currentFinalPaymentStatus === "PAID" ? 0 : recalculatedUnpaidBalance;
      const finalPaymentStatus = currentFinalPaymentStatus === "PAID"
        ? "PAID"
        : unpaidBalance <= 0
          ? "PAID"
          : depositAmount > 0
            ? "PARTIAL"
            : "UNPAID";

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
    const eligibility = await getPurchaseConfirmationEligibility(orderId, pool, { storeId });
    if (!eligibility.ok) {
      throw createError(eligibility.message, eligibility.reason === "not_found" ? 404 : 400);
    }

    const confirmation = await createPurchaseConfirmationForOrder(orderId, pool, { storeId });

    if (!confirmation) {
      throw createError("找不到可用的購買確認書連結", 400);
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


router.patch("/:id/payment-completed-at", requireOrderManagementFeature, async (req, res, next) => {
  try {
    if (!canEditPaymentCompletionDate(req.user || {})) {
      throw createError("僅店長以上可修改實際付款完成日期", 403);
    }

    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const staffUserId = Number(req.user?.id || 0);
    if (!orderId) {
      throw createError("找不到訂單", 404);
    }
    if (!staffUserId) {
      throw createError("請重新登入後再修改付款完成日期", 401);
    }

    const rawPaymentCompletedAt =
      req.body?.paymentCompletedAt ||
      req.body?.payment_completed_at ||
      req.body?.finalPaymentCompletedAt ||
      req.body?.final_payment_completed_at;
    if (!String(rawPaymentCompletedAt || "").trim()) {
      throw createError("請輸入實際付款完成日期", 400);
    }
    const nextPaymentCompletedAt = normalizeTaipeiDateTime(rawPaymentCompletedAt, "實際付款完成日期");

    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `
          SELECT id,
                 order_no AS orderNo,
                 final_payment_status AS finalPaymentStatus,
                 final_payment_completed_at AS oldFinalPaymentCompletedAt,
                 final_paid_at AS oldFinalPaidAt
          FROM orders
          WHERE id = ?
            AND store_id = ?
          FOR UPDATE
        `,
        [orderId, storeId]
      );

      const order = rows[0];
      if (!order) {
        const [scopeRows] = await connection.query(
          "SELECT store_id AS storeId FROM orders WHERE id = ? LIMIT 1",
          [orderId]
        );
        if (scopeRows[0]) {
          throw createError("無權限處理其他門市訂單", 403);
        }
        throw createError("找不到訂單", 404);
      }

      if (String(order.finalPaymentStatus || "").toUpperCase() !== "PAID") {
        throw createError("僅已付款完成訂單可修改付款完成日期", 409);
      }

      await connection.query(
        `
          UPDATE orders
          SET final_payment_completed_at = ?,
              final_paid_at = ?
          WHERE id = ?
            AND store_id = ?
        `,
        [nextPaymentCompletedAt, nextPaymentCompletedAt, orderId, storeId]
      );

      const [paymentRows] = await connection.query(
        `
          SELECT id
          FROM order_payment_records
          WHERE order_id = ?
            AND store_id = ?
          ORDER BY CASE WHEN payment_stage IN ('BALANCE', 'FULL_PAYMENT') THEN 0 ELSE 1 END,
                   received_at DESC,
                   id DESC
          LIMIT 1
        `,
        [orderId, storeId]
      );

      const updatedPaymentRecordIds = [];
      const paymentRecordId = paymentRows[0]?.id ? Number(paymentRows[0].id) : null;
      if (paymentRecordId) {
        await connection.query(
          `
            UPDATE order_payment_records
            SET received_at = ?
            WHERE id = ?
              AND order_id = ?
              AND store_id = ?
          `,
          [nextPaymentCompletedAt, paymentRecordId, orderId, storeId]
        );
        updatedPaymentRecordIds.push(paymentRecordId);
      }

      await logWorkflowEvent("payment_completed_at_updated", "ORDER", orderId, {
        orderNo: order.orderNo,
        oldFinalPaymentCompletedAt: order.oldFinalPaymentCompletedAt || null,
        oldFinalPaidAt: order.oldFinalPaidAt || null,
        newFinalPaymentCompletedAt: nextPaymentCompletedAt,
        updatedPaymentRecordIds
      }, staffUserId, connection);

      return {
        orderId,
        oldFinalPaymentCompletedAt: order.oldFinalPaymentCompletedAt || null,
        newFinalPaymentCompletedAt: nextPaymentCompletedAt,
        updatedPaymentRecordIds,
        warning: updatedPaymentRecordIds.length ? null : "此訂單沒有可同步的收款紀錄，已更新訂單付款完成日期。"
      };
    });

    return res.json({
      ...result,
      finalPaymentCompletedAt: result.newFinalPaymentCompletedAt,
      finalPaidAt: result.newFinalPaymentCompletedAt,
      message: "實際付款完成日期已更新"
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/collect-balance", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;
    const staffUserId = Number(req.user?.id || 0);
    if (!orderId) {
      throw createError("找不到訂單", 404);
    }
    if (!staffUserId) {
      throw createError("請重新登入後再處理收款", 401);
    }

    const paymentPayload = normalizePaymentCompletionPayload(req.body || {});

    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `
          SELECT id,
                 order_no AS orderNo,
                 customer_id AS customerId,
                 customer_type AS customerType,
                 total_amount AS totalAmount,
                 deposit_amount AS depositAmount,
                 is_reservation_order AS isReservationOrder,
                 unpaid_balance AS unpaidBalance,
                 final_payment_status AS finalPaymentStatus,
                 payment_method AS paymentMethod,
                 notes
          FROM orders
          WHERE id = ?
            AND store_id = ?
          FOR UPDATE
        `,
        [orderId, storeId]
      );

      const order = rows[0];
      if (!order) {
        const [scopeRows] = await connection.query(
          "SELECT store_id AS storeId FROM orders WHERE id = ? LIMIT 1",
          [orderId]
        );
        if (scopeRows[0]) {
          throw createError("無權限處理其他門市訂單", 403);
        }
        throw createError("找不到訂單", 404);
      }

      const finalPaymentStatus = String(order.finalPaymentStatus || "").trim().toUpperCase();
      const unpaidBalance = Math.max(Number(order.unpaidBalance || 0), 0);
      if (finalPaymentStatus === "PAID" || unpaidBalance <= 0) {
        throw createError("此訂單已完款，請勿重複收款。", 400);
      }

      const unpaidCents = Math.round(unpaidBalance * 100);
      if (paymentPayload.receivedAmountCents < unpaidCents) {
        throw createError("實收金額不可小於未收尾款", 400);
      }

      const inferredStage = req.body?.paymentStage || req.body?.payment_stage
        ? paymentPayload.paymentStage
        : Number(order.depositAmount || 0) > 0 || Number(order.isReservationOrder || 0) === 1
          ? "BALANCE"
          : "FULL_PAYMENT";
      const nextBalance = 0;
      const nextStatus = "PAID";
      const companyId = await getCompanyIdForStore(storeId, connection);

      await connection.query(
        `
          UPDATE orders
          SET unpaid_balance = ?,
              final_payment_status = ?,
              final_paid_at = ?,
              payment_method = ?,
              notes = COALESCE(?, notes),
              final_payment_method = ?,
              final_payment_received_amount = ?,
              final_payment_note = ?,
              final_payment_completed_by_staff_user_id = ?,
              final_payment_completed_at = ?
          WHERE id = ?
            AND store_id = ?
        `,
        [
          nextBalance,
          nextStatus,
          paymentPayload.paymentCompletedAt,
          paymentPayload.paymentMethod,
          paymentPayload.note,
          paymentPayload.paymentMethod,
          paymentPayload.receivedAmount,
          paymentPayload.note,
          staffUserId,
          paymentPayload.paymentCompletedAt,
          orderId,
          storeId
        ]
      );

      const paymentRecordId = await createOrderPaymentRecord(connection, {
        companyId,
        storeId,
        orderId,
        paymentStage: inferredStage,
        paymentMethod: paymentPayload.paymentMethod,
        receivedAmount: paymentPayload.receivedAmount,
        note: paymentPayload.note,
        staffUserId,
        paymentCompletedAt: paymentPayload.paymentCompletedAt
      });

      await connection.query(
        `
          INSERT INTO order_payment_events (
            order_id,
            customer_id,
            payment_kind,
            amount,
            unpaid_balance_after,
            note,
            source,
            created_by_staff_id,
            meta_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, JSON_OBJECT('paymentMethod', ?, 'paymentRecordId', ?, 'paymentCompletedAt', ?))
        `,
        [
          orderId,
          order.customerId || null,
          inferredStage,
          paymentPayload.receivedAmount,
          nextBalance,
          paymentPayload.note,
          "collect_balance",
          staffUserId,
          paymentPayload.paymentMethod,
          paymentRecordId,
          paymentPayload.paymentCompletedAt
        ]
      );

      await logWorkflowEvent("order_balance_collected", "ORDER", orderId, {
        amount: Number(paymentPayload.receivedAmount),
        paymentMethod: paymentPayload.paymentMethod,
        paymentMethodLabel: mapPaymentMethodLabel(paymentPayload.paymentMethod),
        paymentStage: inferredStage,
        paymentRecordId,
        paymentCompletedAt: paymentPayload.paymentCompletedAt,
        unpaidBalance: nextBalance
      }, staffUserId, connection);

      const [typeRows] = await connection.query(
        `
          SELECT
            EXISTS (
              SELECT 1 FROM order_items oi
              INNER JOIN products p ON p.id = oi.product_id
                AND p.store_id = ?
              WHERE order_id = ?
                AND oi.store_id = ?
                AND p.requires_purchase_confirmation = 1
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
        [storeId, orderId, storeId, orderId, storeId, orderId, storeId]
      );

      const orderType = typeRows[0] || {};

      return {
        orderNo: order.orderNo,
        customerType: normalizeCustomerType(order.customerType),
        unpaidBalance: nextBalance,
        finalPaymentStatus: nextStatus,
        paymentMethod: paymentPayload.paymentMethod,
        paymentMethodLabel: mapPaymentMethodLabel(paymentPayload.paymentMethod),
        receivedAmount: paymentPayload.receivedAmount,
        paymentNote: paymentPayload.note,
        paymentCompletedAt: paymentPayload.paymentCompletedAt,
        finalPaymentCompletedAt: paymentPayload.paymentCompletedAt,
        finalPaidAt: paymentPayload.paymentCompletedAt,
        paymentStage: inferredStage,
        paymentRecordId,
        receivedByStaffUserId: staffUserId,
        isRepairOrder: Boolean(orderType.isRepairOrder),
        becamePaid:
          nextBalance === 0 &&
          Boolean(orderType.isEbikeOrder) &&
          !Boolean(orderType.isRepairOrder) &&
          !orderType.purchaseConfirmationSentAt,
        becameRepairPaid:
          nextBalance === 0 &&
          Number(order.unpaidBalance || 0) > 0 &&
          Boolean(orderType.isRepairOrder)
      };
    });

    if (result.becamePaid) {
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

    let repairConfirmation = null;
    let repairConfirmationWarning = null;
    if (result.becameRepairPaid) {
      try {
        const confirmationResult = await createOrReuseRepairConfirmationForPaidOrder(
          orderId,
          storeId,
          req.user?.id || null,
          {
            source: "collect_balance",
            purpose: "repair_confirmation_auto_after_collect_balance"
          }
        );
        if (confirmationResult.ok) {
          repairConfirmation = confirmationResult.confirmation || null;
        } else if (confirmationResult.reason !== "維修完成後可發送確認書") {
          repairConfirmationWarning = confirmationResult.reason || "維修完成確認書尚未自動建立";
        }
      } catch (confirmationError) {
        repairConfirmationWarning = confirmationError.message || "維修完成確認書自動建立失敗";
      }
    }

    if (isLineCustomerType(result.customerType)) {
      try {
        await sendToGroupsWithResult(["admin", "staff"], [
          {
            type: "text",
            text: [
              "尾款已完成",
              `訂單 ${result.orderNo} 已補收尾款。`,
              `付款方式：${result.paymentMethodLabel}`,
              `實收金額：NT$ ${Number(result.receivedAmount || 0).toLocaleString()}`,
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
      } catch (notificationError) {
        console.warn("collect-balance staff group notification failed", {
          orderId,
          message: notificationError.message
        });
      }
    }

    return res.json({
      ...result,
      repairConfirmation,
      repairConfirmationWarning,
      finalPaymentStatusLabel: mapFinalPaymentStatusLabel(result.finalPaymentStatus)
    });
  } catch (error) {
    return next(error);
  }
});

async function createKingwayAutoPurchaseOrderOnHandover(orderId, storeId, staffId = 1) {
  const autoNote = `AUTO_FROM_HANDOVER_ORDER:${orderId}｜交車確認自動發注`;
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
        AND note = ?
      LIMIT 1
    `,
    [storeId, autoNote]
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
    [storeId, autoNote, staffId || 1]
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


router.post("/:id/notify-pickup", requireOrderManagementFeature, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const storeId = req.storeId;

    if (!orderId) {
      return res.status(404).json({ sent: false, message: "找不到訂單" });
    }

    const [orderRows] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          o.customer_id AS customerId,
          o.status,
          o.unpaid_balance AS unpaidBalance,
          o.final_payment_status AS finalPaymentStatus,
          o.handover_confirmed_at AS handoverConfirmedAt,
          COALESCE(o.customer_name, c.name) AS customerName,
          c.line_user_id AS lineUserId,
          st.name AS storeName
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN stores st ON st.id = o.store_id
        WHERE o.id = ?
          AND o.store_id = ?
          AND o.deleted_at IS NULL
        LIMIT 1
      `,
      [orderId, storeId]
    );

    const order = orderRows[0];
    if (!order) {
      return res.status(404).json({ sent: false, message: "找不到訂單" });
    }
    if (isCanceledOrDeletedOrderStatus(order.status)) {
      return res.status(409).json({ sent: false, message: "此訂單已取消或刪除，無法發送取車通知。" });
    }
    if (order.handoverConfirmedAt) {
      return res.status(409).json({ sent: false, message: "此訂單已完成交車，不需發送取車通知。" });
    }
    if (!order.lineUserId) {
      return res.status(409).json({ sent: false, message: "此客戶尚未綁定 LINE，無法發送取車通知。" });
    }

    const [items] = await pool.query(
      `
        SELECT
          sku_snapshot AS sku,
          product_name_snapshot AS productName,
          product_category_snapshot AS productCategory,
          quantity
        FROM order_items
        WHERE order_id = ?
          AND store_id = ?
        ORDER BY id ASC
      `,
      [orderId, storeId]
    );
    const itemSummary = buildPickupItemSummary(items);
    const orderNo = order.orderNo || `#${orderId}`;
    const storeName = order.storeName || "KINGWAY";

    try {
      await sendLineMessage(config, order.lineUserId, [
        {
          type: "text",
          text: [
            "親愛的客戶您好！",
            "您的訂車已經送達門市，可以預約時間來牽車了。",
            "",
            `訂單編號：${orderNo}`,
            `商品/車款：${itemSummary}`,
            `門市：${storeName}`,
            "",
            "取車時請完成尾款與交車確認。",
            "取車前如需確認時間，請直接回覆此訊息，謝謝。"
          ].join("\n")
        }
      ]);
    } catch (lineError) {
      return res.status(502).json({
        sent: false,
        message: "LINE 取車通知發送失敗，請稍後再試。",
        lineError: lineError.safeDetails || lineError.message || "LINE_PUSH_FAILED"
      });
    }

    await logWorkflowEvent("order_pickup_notified", "ORDER", orderId, {
      action: "order_pickup_notified",
      orderNo,
      customerId: order.customerId || null,
      hasLineUserId: Boolean(order.lineUserId),
      itemSummary,
      storeId,
      storeName
    }, req.user?.id || null);

    return res.json({ sent: true, message: "已發送取車通知" });
  } catch (error) {
    return next(error);
  }
});

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

    await assertOrderAccessoryInstallConfirmationsComplete(Number(req.params.id), storeId, pool);

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

    if (autoPoId) {
      try {
        await notifyStaffActionRequired({
          eventType: "STOCK_ZERO_AUTO_PO_CREATED",
          relatedType: "SUPPLIER_REQUEST",
          relatedId: autoPoId,
          storeId,
          title: "📦 庫存 0，已建立自動發注",
          altText: "庫存 0，已建立自動發注",
          bodyLines: [
            `發注單：#${autoPoId}`,
            `來源訂單：#${req.params.id}`,
            "系統已依交車確認建立 KINGWAY 自動發注，請確認後續入庫。"
          ],
          actions: [
            { label: "✅ 已確認", action: "staff_line_ack" },
            { label: "🙋 我來處理", action: "staff_line_assign" },
            createStaffLineUriAction("📋 查看詳情", buildStaffPageUrl("/suppliers"))
          ],
          payload: { orderId: Number(req.params.id), autoPoId }
        }, {
          registrationTypes: ["staff", "admin"],
          purpose: "stock_zero_auto_po_staff_group_notify"
        });
      } catch (staffLineError) {
        console.warn("[staff-line] auto PO notification failed", {
          orderId: req.params.id,
          autoPoId,
          message: staffLineError.message
        });
      }
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
          COALESCE(o.customer_name, c.name) AS resolved_customer_name,
          COALESCE(o.customer_phone, c.phone) AS resolved_customer_phone
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
