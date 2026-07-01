const express = require("express");
const { pool } = require("../db");
const { authenticate, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const ExcelJS = require("exceljs");
const { requireSalesManagementAccess } = require("../utils/roleAccess");

const router = express.Router();

router.use(authenticate, requireStoreScope(), requireSalesManagementAccess, requireStoreFeature("sales_dashboard_enabled"));

function getRequestStoreId(req) {
  return Number(req.storeId || req.user?.store_id || req.user?.storeId || 1);
}

function normalizeDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function normalizeDateBasis(value) {
  return value === "orderCreated" ? "orderCreated" : "paymentCompleted";
}

function todayText() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStartText() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

async function getColumns(tableName) {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_NAME AS columnName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return new Set(rows.map((row) => row.columnName));
}

function pickColumn(columns, candidates, fallback = "NULL", tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  for (const column of candidates) {
    if (columns.has(column)) return `${prefix}\`${column}\``;
  }
  return fallback;
}

function pickAmountExpression(orderColumns, itemColumns) {
  if (itemColumns.has("subtotal")) return "COALESCE(oi.`subtotal`, 0)";
  if (itemColumns.has("unit_price") && itemColumns.has("quantity")) {
    return "COALESCE(oi.`unit_price`, 0) * COALESCE(oi.`quantity`, 0)";
  }
  if (itemColumns.has("price") && itemColumns.has("quantity")) {
    return "COALESCE(oi.`price`, 0) * COALESCE(oi.`quantity`, 0)";
  }
  if (orderColumns.has("total_amount")) return "COALESCE(o.`total_amount`, 0)";
  return "0";
}

function money(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

const PAYMENT_METHOD_LABELS = {
  CASH: "現金",
  CREDIT_CARD: "信用卡",
  BANK_TRANSFER: "轉帳",
  LINE_PAY: "LINE Pay",
  OTHER: "其他 / 未指定"
};

const ORDER_TYPE_TEMPLATE = {
  regular: {
    label: "一般訂單",
    totalOrderAmount: 0,
    actualReceivedAmount: 0,
    paidOrderAmount: 0,
    unpaidAmount: 0,
    depositOnlyAmount: 0,
    totalOrderCount: 0,
    paidOrderCount: 0,
    unpaidOrderCount: 0,
    depositOnlyOrderCount: 0
  },
  repair: {
    label: "維修訂單",
    totalOrderAmount: 0,
    actualReceivedAmount: 0,
    paidOrderAmount: 0,
    unpaidAmount: 0,
    depositOnlyAmount: 0,
    totalOrderCount: 0,
    paidOrderCount: 0,
    unpaidOrderCount: 0,
    depositOnlyOrderCount: 0
  }
};

function createOrderTypeBreakdown() {
  return JSON.parse(JSON.stringify(ORDER_TYPE_TEMPLATE));
}

function normalizeSalesPaymentMethod(value) {
  const text = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!text) return "OTHER";
  if (["CASH", "現金"].includes(text)) return "CASH";
  if (["CARD", "CREDIT_CARD", "CREDITCARD", "刷卡", "信用卡"].includes(text)) return "CREDIT_CARD";
  if (["TRANSFER", "BANK_TRANSFER", "BANK", "匯款", "銀行轉帳", "轉帳", "匯款/轉帳"].includes(text)) return "BANK_TRANSFER";
  if (["LINE_PAY", "LINEPAY", "LINE_PAY_PAYMENT"].includes(text)) return "LINE_PAY";
  return "OTHER";
}

function getPaymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || PAYMENT_METHOD_LABELS.OTHER;
}

function createPaymentStatusBreakdown() {
  return {
    paid: { label: "已收款", amount: 0, count: 0 },
    partial: { label: "訂金已收", amount: 0, count: 0 },
    unpaid: { label: "未收款", amount: 0, count: 0 }
  };
}

function addOrderToTypeBreakdown(target, order) {
  const row = target[order.orderType === "repair" ? "repair" : "regular"];
  row.totalOrderCount += 1;
  row.totalOrderAmount += money(order.totalAmount);
  row.actualReceivedAmount += money(order.actualReceivedAmount);
  row.unpaidAmount += money(order.unpaidBalance);

  if (order.paymentStatusCode === "PAID") {
    row.paidOrderCount += 1;
    row.paidOrderAmount += money(order.totalAmount);
  } else if (order.paymentStatusCode === "DEPOSIT_ONLY") {
    row.depositOnlyOrderCount += 1;
    row.depositOnlyAmount += money(order.depositOnlyAmount);
    row.unpaidOrderCount += 1;
  } else {
    row.unpaidOrderCount += 1;
  }
}

function addOrderToPaymentStatusBreakdown(target, order) {
  if (order.paymentStatusCode === "PAID") {
    target.paid.amount += money(order.actualReceivedAmount);
    target.paid.count += 1;
  } else if (order.paymentStatusCode === "DEPOSIT_ONLY") {
    target.partial.amount += money(order.depositOnlyAmount);
    target.partial.count += 1;
  } else {
    target.unpaid.amount += money(order.unpaidBalance);
    target.unpaid.count += 1;
  }
}

function createPaymentMethodBreakdown(orders, paymentRows = []) {
  const byOrderId = new Map(orders.map((order) => [Number(order.orderId), order]));
  const rowsByMethod = new Map();

  function ensure(method) {
    const normalized = normalizeSalesPaymentMethod(method);
    if (!rowsByMethod.has(normalized)) {
      rowsByMethod.set(normalized, {
        paymentMethod: normalized,
        label: getPaymentMethodLabel(normalized),
        actualReceivedAmount: 0,
        paidOrderAmount: 0,
        depositOnlyAmount: 0,
        orderCount: 0,
        paidOrderCount: 0,
        depositOnlyOrderCount: 0,
        orderIds: new Set(),
        paidOrderIds: new Set(),
        depositOnlyOrderIds: new Set()
      });
    }
    return rowsByMethod.get(normalized);
  }

  const ordersWithPaymentRecords = new Set();
  paymentRows.forEach((payment) => {
    const order = byOrderId.get(Number(payment.orderId));
    if (!order) return;
    ordersWithPaymentRecords.add(Number(payment.orderId));
    const row = ensure(payment.paymentMethod);
    const amount = money(payment.receivedAmount);
    row.actualReceivedAmount += amount;
    row.orderIds.add(Number(payment.orderId));
    if (order.paymentStatusCode === "PAID") {
      row.paidOrderAmount += amount;
      row.paidOrderIds.add(Number(payment.orderId));
    } else if (order.paymentStatusCode === "DEPOSIT_ONLY") {
      row.depositOnlyAmount += amount;
      row.depositOnlyOrderIds.add(Number(payment.orderId));
    }
  });

  orders.forEach((order) => {
    if (ordersWithPaymentRecords.has(Number(order.orderId))) return;
    if (money(order.actualReceivedAmount) <= 0) return;
    const row = ensure(order.finalPaymentMethod || order.paymentMethod);
    row.actualReceivedAmount += money(order.actualReceivedAmount);
    row.orderIds.add(Number(order.orderId));
    if (order.paymentStatusCode === "PAID") {
      row.paidOrderAmount += money(order.actualReceivedAmount);
      row.paidOrderIds.add(Number(order.orderId));
    } else if (order.paymentStatusCode === "DEPOSIT_ONLY") {
      row.depositOnlyAmount += money(order.depositOnlyAmount);
      row.depositOnlyOrderIds.add(Number(order.orderId));
    }
  });

  return ["CASH", "CREDIT_CARD", "BANK_TRANSFER", "LINE_PAY", "OTHER"].map((method) => {
    const row = ensure(method);
    return {
      paymentMethod: row.paymentMethod,
      label: row.label,
      actualReceivedAmount: row.actualReceivedAmount,
      paidOrderAmount: row.paidOrderAmount,
      depositOnlyAmount: row.depositOnlyAmount,
      orderCount: row.orderIds.size,
      paidOrderCount: row.paidOrderIds.size,
      depositOnlyOrderCount: row.depositOnlyOrderIds.size
    };
  });
}

function buildPaymentSummaryJoin(recordColumns, eventColumns) {
  const hasPaymentRecords = recordColumns.has("order_id") &&
    recordColumns.has("received_amount") &&
    recordColumns.has("payment_stage") &&
    recordColumns.has("received_at");

  if (hasPaymentRecords) {
    return `
      LEFT JOIN (
        SELECT
          order_id AS orderId,
          SUM(COALESCE(received_amount, 0)) AS paymentTotal,
          SUM(CASE WHEN payment_stage = 'DEPOSIT' THEN COALESCE(received_amount, 0) ELSE 0 END) AS depositPaymentTotal,
          MAX(received_at) AS latestPaymentAt
        FROM order_payment_records
        WHERE order_id IS NOT NULL
        GROUP BY order_id
      ) paymentSummary ON paymentSummary.orderId = o.id
    `;
  }

  const hasPaymentEvents = eventColumns.has("order_id") &&
    eventColumns.has("amount") &&
    eventColumns.has("payment_kind") &&
    eventColumns.has("created_at");

  if (hasPaymentEvents) {
    return `
      LEFT JOIN (
        SELECT
          order_id AS orderId,
          SUM(COALESCE(amount, 0)) AS paymentTotal,
          SUM(CASE WHEN payment_kind IN ('DEPOSIT', 'PARTIAL') THEN COALESCE(amount, 0) ELSE 0 END) AS depositPaymentTotal,
          MAX(created_at) AS latestPaymentAt
        FROM order_payment_events
        WHERE order_id IS NOT NULL
        GROUP BY order_id
      ) paymentSummary ON paymentSummary.orderId = o.id
    `;
  }

  return `
    LEFT JOIN (
      SELECT
        NULL AS orderId,
        0 AS paymentTotal,
        0 AS depositPaymentTotal,
        NULL AS latestPaymentAt
    ) paymentSummary ON paymentSummary.orderId = o.id
  `;
}

function resolvePaymentStatus(row) {
  const status = String(row.finalPaymentStatus || "").trim().toUpperCase();
  const totalAmount = money(row.totalAmount);
  const depositAmount = money(row.depositAmount);
  const recordTotal = money(row.paymentRecordTotal);
  const finalReceivedAmount = money(row.finalPaymentReceivedAmount);
  const rawUnpaidBalance = row.unpaidBalance === null || row.unpaidBalance === undefined
    ? Math.max(totalAmount - Math.max(depositAmount, recordTotal, finalReceivedAmount), 0)
    : money(row.unpaidBalance);
  const hasCompletionAt = Boolean(row.finalPaymentCompletedAt || row.finalPaidAt);
  const isPaid = status === "PAID" || hasCompletionAt || rawUnpaidBalance <= 0;

  const actualReceivedAmount = isPaid
    ? Math.max(totalAmount, recordTotal, finalReceivedAmount, 0)
    : Math.max(recordTotal, depositAmount, totalAmount - rawUnpaidBalance, 0);
  const unpaidAmount = isPaid ? 0 : Math.max(totalAmount - actualReceivedAmount, rawUnpaidBalance, 0);
  const isDepositOnly = !isPaid && actualReceivedAmount > 0;

  if (isPaid) {
    return {
      paymentStatusCode: "PAID",
      paymentStatusLabel: "已收款",
      actualReceivedAmount,
      unpaidAmount,
      depositOnlyAmount: 0
    };
  }

  if (isDepositOnly) {
    return {
      paymentStatusCode: "DEPOSIT_ONLY",
      paymentStatusLabel: "訂金已收",
      actualReceivedAmount,
      unpaidAmount,
      depositOnlyAmount: actualReceivedAmount
    };
  }

  return {
    paymentStatusCode: "UNPAID",
    paymentStatusLabel: "未收款",
    actualReceivedAmount: 0,
    unpaidAmount,
    depositOnlyAmount: 0
  };
}

router.get("/summary", async (req, res, next) => {
  try {
    const startDate = normalizeDate(req.query.startDate, monthStartText());
    const endDate = normalizeDate(req.query.endDate, todayText());
    const dateBasis = normalizeDateBasis(req.query.dateBasis);

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    const orderColumns = await getColumns("orders");
    const itemColumns = await getColumns("order_items");
    const paymentRecordColumns = await getColumns("order_payment_records");
    const paymentEventColumns = await getColumns("order_payment_events");

    const storeId = getRequestStoreId(req);
    const storeFilter = orderColumns.has("store_id") ? "AND o.`store_id` = ?" : "";

    const orderDateCol = pickColumn(orderColumns, ["created_at", "business_date", "updated_at"], "o.`id`", "o");
    const orderNoCol = pickColumn(orderColumns, ["order_no", "order_number", "id"], "o.`id`", "o");
    const customerNameCol = pickColumn(orderColumns, ["customer_name", "name"], "NULL", "o");
    const customerPhoneCol = pickColumn(orderColumns, ["customer_phone", "phone"], "NULL", "o");
    const orderStatusCol = pickColumn(orderColumns, ["status"], "NULL", "o");
    const paymentMethodCol = pickColumn(orderColumns, ["payment_method"], "NULL", "o");
    const finalPaymentStatusCol = pickColumn(orderColumns, ["final_payment_status", "payment_status"], "NULL", "o");
    const finalPaymentMethodCol = pickColumn(orderColumns, ["final_payment_method", "payment_method"], "NULL", "o");
    const repairOrderIdCol = pickColumn(orderColumns, ["repair_order_id"], "NULL", "o");
    const finalPaymentReceivedCol = pickColumn(orderColumns, ["final_payment_received_amount"], "NULL", "o");
    const finalPaymentCompletedCol = pickColumn(orderColumns, ["final_payment_completed_at", "final_paid_at"], "NULL", "o");
    const finalPaidAtCol = pickColumn(orderColumns, ["final_paid_at"], "NULL", "o");
    const depositAmountCol = pickColumn(orderColumns, ["deposit_amount"], "0", "o");
    const unpaidBalanceCol = pickColumn(orderColumns, ["unpaid_balance"], "NULL", "o");
    const totalAmountCol = pickColumn(orderColumns, ["total_amount", "amount", "grand_total"], "0", "o");
    const otherDiscountCol = pickColumn(orderColumns, ["other_discount"], "0", "o");

    const itemNameCol = pickColumn(itemColumns, ["product_name_snapshot", "product_name", "name"], "'商品'", "oi");
    const itemSkuCol = pickColumn(itemColumns, ["product_sku_snapshot", "sku"], "''", "oi");
    const itemProductIdCol = pickColumn(itemColumns, ["product_id"], "0", "oi");
    const itemCategoryCol = pickColumn(itemColumns, ["product_category_snapshot", "category_snapshot", "product_category", "category"], "NULL", "oi");
    const itemQuantityCol = pickColumn(itemColumns, ["quantity", "qty"], "0", "oi");
    const itemAmountExpr = pickAmountExpression(orderColumns, itemColumns);

    const deletedFilter = orderColumns.has("deleted_at") ? "AND o.`deleted_at` IS NULL" : "";
    const statusFilter = orderColumns.has("status")
      ? "AND COALESCE(o.`status`, '') NOT IN ('CANCELED', 'CANCELLED', 'canceled', 'cancelled')"
      : "";

    const paymentSummaryJoin = buildPaymentSummaryJoin(paymentRecordColumns, paymentEventColumns);
    const isPaidExpression = `(UPPER(COALESCE(${finalPaymentStatusCol}, '')) = 'PAID' OR ${finalPaymentCompletedCol} IS NOT NULL OR COALESCE(${unpaidBalanceCol}, 0) <= 0)`;
    const paymentDateExpression = `
      CASE
        WHEN ${isPaidExpression} THEN COALESCE(${finalPaymentCompletedCol}, ${finalPaidAtCol}, paymentSummary.latestPaymentAt, ${orderDateCol})
        WHEN COALESCE(paymentSummary.paymentTotal, 0) > 0 OR COALESCE(${depositAmountCol}, 0) > 0 THEN COALESCE(paymentSummary.latestPaymentAt, ${orderDateCol})
        ELSE ${orderDateCol}
      END
    `;
    const basisDateExpression = dateBasis === "orderCreated" ? orderDateCol : paymentDateExpression;
    const dateFilter = `AND ${basisDateExpression} BETWEEN ? AND ?`;

    const params = [startDateTime, endDateTime];
    if (storeFilter) {
      params.push(storeId);
    }

    const [orderRows] = await pool.query(
      `
        SELECT
          o.id AS orderId,
          ${orderNoCol} AS orderNo,
          ${customerNameCol} AS customerName,
          ${customerPhoneCol} AS customerPhone,
          ${orderStatusCol} AS status,
          ${paymentMethodCol} AS paymentMethod,
          ${finalPaymentStatusCol} AS finalPaymentStatus,
          ${finalPaymentMethodCol} AS finalPaymentMethod,
          CASE
            WHEN ${repairOrderIdCol} IS NOT NULL THEN 1
            WHEN MAX(CASE WHEN UPPER(COALESCE(${itemCategoryCol}, '')) IN ('RP', 'REPAIR') THEN 1 ELSE 0 END) = 1 THEN 1
            ELSE 0
          END AS hasRepairItem,
          ${finalPaymentReceivedCol} AS finalPaymentReceivedAmount,
          ${finalPaymentCompletedCol} AS finalPaymentCompletedAt,
          ${finalPaidAtCol} AS finalPaidAt,
          COALESCE(${depositAmountCol}, 0) AS depositAmount,
          ${unpaidBalanceCol} AS unpaidBalance,
          COALESCE(${otherDiscountCol}, 0) AS otherDiscountAmount,
          COALESCE(${totalAmountCol}, 0) AS totalAmount,
          ${orderDateCol} AS createdAt,
          ${paymentDateExpression} AS paymentBasisAt,
          COALESCE(paymentSummary.paymentTotal, 0) AS paymentRecordTotal,
          COALESCE(paymentSummary.depositPaymentTotal, 0) AS depositPaymentRecordTotal,
          paymentSummary.latestPaymentAt AS latestPaymentAt,
          COALESCE(SUM(COALESCE(${itemQuantityCol}, 0)), 0) AS totalQuantity,
          COALESCE(SUM(COALESCE(${itemAmountExpr}, 0)), 0) AS originalAmount,
          GROUP_CONCAT(
            CONCAT(
              COALESCE(${itemNameCol}, '商品'),
              ' x ',
              COALESCE(${itemQuantityCol}, 0),
              ' = NT$',
              FORMAT(COALESCE(${itemAmountExpr}, 0), 0)
            )
            ORDER BY oi.id
            SEPARATOR ' / '
          ) AS itemSummary
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        ${paymentSummaryJoin}
        WHERE 1=1
          ${deletedFilter}
          ${statusFilter}
          ${dateFilter}
          ${storeFilter}
        GROUP BY o.id
        ORDER BY ${basisDateExpression} DESC, o.id DESC
        LIMIT 500
      `,
      params
    );

    const [productRows] = await pool.query(
      `
        SELECT
          COALESCE(${itemProductIdCol}, 0) AS productId,
          COALESCE(${itemSkuCol}, '') AS sku,
          COALESCE(${itemNameCol}, '商品') AS productName,
          COALESCE(SUM(COALESCE(${itemQuantityCol}, 0)), 0) AS quantity,
          COALESCE(SUM(COALESCE(${itemAmountExpr}, 0)), 0) AS totalSales
        FROM orders o
        INNER JOIN order_items oi ON oi.order_id = o.id
        ${paymentSummaryJoin}
        WHERE 1=1
          ${deletedFilter}
          ${statusFilter}
          ${dateFilter}
          ${storeFilter}
        GROUP BY productId, sku, productName
        ORDER BY totalSales DESC, quantity DESC
        LIMIT 300
      `,
      params
    );

    const orders = orderRows.map((row) => {
      const payment = resolvePaymentStatus(row);
      const orderType = Number(row.hasRepairItem || 0) > 0 ? "repair" : "regular";
      const normalizedPaymentMethod = normalizeSalesPaymentMethod(row.finalPaymentMethod || row.paymentMethod);
      const totalAmount = money(row.totalAmount);
      const originalAmount = money(row.originalAmount || totalAmount);
      const otherDiscountAmount = money(row.otherDiscountAmount);
      const discountAmount = Math.max(originalAmount - totalAmount, 0);
      const couponDiscountAmount = Math.max(discountAmount - otherDiscountAmount, 0);

      return {
        orderId: row.orderId,
        orderNo: row.orderNo,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        status: row.status,
        paymentMethod: row.paymentMethod,
        paymentMethodCode: normalizedPaymentMethod,
        paymentMethodLabel: getPaymentMethodLabel(normalizedPaymentMethod),
        finalPaymentStatus: row.finalPaymentStatus,
        finalPaymentMethod: row.finalPaymentMethod,
        orderType,
        orderTypeLabel: orderType === "repair" ? "維修訂單" : "一般訂單",
        finalPaymentCompletedAt: row.finalPaymentCompletedAt,
        finalPaidAt: row.finalPaidAt,
        latestPaymentAt: row.latestPaymentAt,
        paymentBasisAt: row.paymentBasisAt,
        totalAmount,
        originalAmount,
        discountAmount,
        couponDiscountAmount,
        otherDiscountAmount,
        depositAmount: money(row.depositAmount),
        unpaidBalance: payment.unpaidAmount,
        actualReceivedAmount: payment.actualReceivedAmount,
        depositOnlyAmount: payment.depositOnlyAmount,
        paymentStatusCode: payment.paymentStatusCode,
        paymentStatusLabel: payment.paymentStatusLabel,
        paymentRecordTotal: money(row.paymentRecordTotal),
        totalQuantity: Number(row.totalQuantity || 0),
        itemSummary: row.itemSummary || "",
        createdAt: row.createdAt
      };
    });

    const byOrderType = createOrderTypeBreakdown();
    const byPaymentStatus = createPaymentStatusBreakdown();

    const summary = orders.reduce((acc, order) => {
      acc.totalOrderCount += 1;
      acc.orderCount += 1;
      acc.totalQuantity += Number(order.totalQuantity || 0);
      acc.grossSales += money(order.originalAmount);
      acc.totalDiscount += money(order.discountAmount);
      acc.totalOrderAmount += money(order.totalAmount);
      acc.totalSales += money(order.totalAmount);
      acc.actualReceivedAmount += money(order.actualReceivedAmount);
      acc.unpaidAmount += money(order.unpaidBalance);
      addOrderToTypeBreakdown(byOrderType, order);
      addOrderToPaymentStatusBreakdown(byPaymentStatus, order);
      if (order.paymentStatusCode === "PAID") {
        acc.paidOrderCount += 1;
        acc.paidOrderAmount += money(order.totalAmount);
      } else if (order.paymentStatusCode === "DEPOSIT_ONLY") {
        acc.depositOnlyOrderCount += 1;
        acc.depositOnlyAmount += money(order.depositOnlyAmount);
        acc.unpaidOrderCount += 1;
      } else {
        acc.unpaidOrderCount += 1;
      }
      return acc;
    }, {
      orderCount: 0,
      totalOrderCount: 0,
      totalQuantity: 0,
      grossSales: 0,
      totalDiscount: 0,
      totalSales: 0,
      totalOrderAmount: 0,
      paidOrderAmount: 0,
      actualReceivedAmount: 0,
      unpaidAmount: 0,
      depositOnlyAmount: 0,
      paidOrderCount: 0,
      unpaidOrderCount: 0,
      depositOnlyOrderCount: 0,
      averageOrderAmount: 0
    });

    summary.averageOrderAmount = summary.totalOrderCount > 0
      ? summary.totalOrderAmount / summary.totalOrderCount
      : 0;

    let paymentRows = [];
    const orderIds = orders.map((order) => Number(order.orderId)).filter(Boolean);
    if (
      orderIds.length &&
      paymentRecordColumns.has("order_id") &&
      paymentRecordColumns.has("received_amount") &&
      paymentRecordColumns.has("payment_method")
    ) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `
          SELECT
            order_id AS orderId,
            payment_method AS paymentMethod,
            SUM(COALESCE(received_amount, 0)) AS receivedAmount
          FROM order_payment_records
          WHERE order_id IN (${placeholders})
          GROUP BY order_id, payment_method
        `,
        orderIds
      );
      paymentRows = rows;
    }

    summary.byOrderType = byOrderType;
    summary.byPaymentMethod = createPaymentMethodBreakdown(orders, paymentRows);
    summary.byPaymentStatus = byPaymentStatus;

    res.json({
      range: { startDate, endDate, dateBasis },
      dateBasis,
      summary,
      byOrderType,
      byPaymentMethod: summary.byPaymentMethod,
      byPaymentStatus,
      orders,
      products: productRows.map((row) => ({
        productId: row.productId,
        sku: row.sku,
        productName: row.productName,
        quantity: Number(row.quantity || 0),
        totalSales: Number(row.totalSales || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

function normalizePaymentMethod(value) {
  const valueText = String(value || "").trim().toLowerCase();
  if (!valueText) return "other";
  if (["cash", "現金"].includes(valueText)) return "cash";
  if (["bank_transfer", "匯款", "銀行轉帳", "transfer", "匯款/轉帳", "轉帳", "bank"].includes(valueText)) {
    return "bank_transfer";
  }
  if (["card", "credit_card", "信用卡", "刷卡", "line_pay", "linepay"].includes(valueText)) {
    return "card";
  }
  return "other";
}

function paymentLabel(type) {
  if (type === "cash") return "現金";
  if (type === "bank_transfer") return "銀行轉帳";
  if (type === "card") return "刷卡";
  return "其他";
}

function buildPaymentMethodExpression(columnExpr) {
  return `
    CASE
      WHEN LOWER(${columnExpr}) IN ('cash', '現金') THEN 'cash'
      WHEN LOWER(${columnExpr}) IN ('bank_transfer', 'transfer', '匯款', '銀行轉帳', '轉帳') THEN 'bank_transfer'
      WHEN LOWER(${columnExpr}) IN ('card', 'credit_card', '刷卡', '信用卡', 'line_pay', 'linepay', 'line pay') THEN 'card'
      ELSE 'other'
    END
  `;
}

async function resolveSalesExportRows(startDate, endDate, req, dateBasis = normalizeDateBasis(req.query.dateBasis)) {
  const orderColumns = await getColumns("orders");
  const itemColumns = await getColumns("order_items");
  const paymentColumns = await getColumns("order_payment_events");

  const hasPaymentEvent = paymentColumns.has("order_id") && paymentColumns.has("payment_kind") && paymentColumns.has("amount") && paymentColumns.has("created_at");

  const storeId = getRequestStoreId(req);
  const storeFilter = orderColumns.has("store_id") ? "AND o.`store_id` = ?" : "";
  const orderDateCol = pickColumn(orderColumns, ["created_at", "business_date", "updated_at"], "o.`id`", "o");
  const orderDateValueCol = pickColumn(orderColumns, ["business_date", "created_at", "updated_at"], "o.`created_at`", "o");
  const orderNoCol = pickColumn(orderColumns, ["order_no", "order_number", "id"], "o.`id`", "o");
  const customerNameCol = pickColumn(orderColumns, ["customer_name", "name"], "NULL", "o");
  const customerPhoneCol = pickColumn(orderColumns, ["customer_phone", "phone"], "NULL", "o");
  const orderStatusCol = pickColumn(orderColumns, ["status"], "NULL", "o");
  const paymentMethodCol = pickColumn(orderColumns, ["payment_method"], "NULL", "o");
  const totalAmountCol = pickColumn(orderColumns, ["total_amount", "amount", "grand_total"], "0", "o");
  const notesCol = pickColumn(orderColumns, ["notes"], "NULL", "o");
  const itemNameCol = pickColumn(itemColumns, ["product_name_snapshot", "product_name", "name"], "'商品'", "oi");
  const itemQuantityCol = pickColumn(itemColumns, ["quantity", "qty"], "0", "oi");
  const deletedFilter = orderColumns.has("deleted_at") ? "AND o.`deleted_at` IS NULL" : "";
  const statusFilter = orderColumns.has("status")
    ? "AND COALESCE(o.`status`, '') NOT IN ('CANCELED', 'CANCELLED', 'canceled', 'cancelled')"
    : "";

  const dateStart = `${startDate} 00:00:00`;
  const dateEnd = `${endDate} 23:59:59`;
  const hasDateColumn = orderColumns.has("created_at") || orderColumns.has("business_date") || orderColumns.has("updated_at");
  const exportDateExpression = dateBasis === "orderCreated"
    ? orderDateValueCol
    : `
      COALESCE(
        CASE
          WHEN COALESCE(paymentSummary.paymentTotal, 0) > 0
            THEN paymentSummary.latestPaymentAt
          ELSE ${orderDateValueCol}
        END,
        ${orderDateValueCol}
      )
    `;
  const dateFilter = hasDateColumn
    ? `AND ${exportDateExpression} BETWEEN ? AND ?`
    : "";

  const paymentSummaryJoin = hasPaymentEvent ? `
    LEFT JOIN (
      SELECT
        pe.order_id AS orderId,
        SUM(COALESCE(pe.amount, 0)) AS paymentTotal,
        SUM(CASE WHEN ${buildPaymentMethodExpression("pe.payment_kind")} = 'cash' THEN COALESCE(pe.amount, 0) ELSE 0 END) AS cashAmount,
        SUM(CASE WHEN ${buildPaymentMethodExpression("pe.payment_kind")} = 'bank_transfer' THEN COALESCE(pe.amount, 0) ELSE 0 END) AS bankTransferAmount,
        SUM(CASE WHEN ${buildPaymentMethodExpression("pe.payment_kind")} = 'card' THEN COALESCE(pe.amount, 0) ELSE 0 END) AS cardAmount,
        SUM(CASE WHEN ${buildPaymentMethodExpression("pe.payment_kind")} = 'other' THEN COALESCE(pe.amount, 0) ELSE 0 END) AS otherAmount,
        COUNT(*) AS paymentEventCount,
        MAX(pe.created_at) AS latestPaymentAt
      FROM order_payment_events pe
      WHERE pe.order_id IS NOT NULL
      GROUP BY pe.order_id
    ) paymentSummary ON paymentSummary.orderId = o.id
  ` : "";

  const params = [];
  if (storeFilter) {
    params.push(storeId);
  }
  if (dateFilter) {
    params.push(dateStart, dateEnd);
  }

  const [rows] = await pool.query(
    `
      SELECT
        ANY_VALUE(o.id) AS orderId,
        ANY_VALUE(${orderNoCol}) AS orderNo,
        ANY_VALUE(${customerNameCol}) AS customerName,
        ANY_VALUE(${customerPhoneCol}) AS customerPhone,
        ANY_VALUE(${orderStatusCol}) AS orderStatus,
        ANY_VALUE(${paymentMethodCol}) AS paymentMethod,
        ANY_VALUE(COALESCE(${totalAmountCol}, 0)) AS salesAmount,
        ANY_VALUE(COALESCE(${orderDateValueCol}, NOW())) AS orderDate,
        COALESCE(SUM(COALESCE(${itemQuantityCol}, 0)), 0) AS itemQuantity,
        GROUP_CONCAT(
          CONCAT(
            COALESCE(${itemNameCol}, '商品'),
            ' x ',
            COALESCE(${itemQuantityCol}, 0)
          )
          ORDER BY oi.id
          SEPARATOR ' / '
        ) AS productNames,
        ANY_VALUE(COALESCE(${notesCol}, '')) AS notes,
        ANY_VALUE(COALESCE(paymentSummary.cashAmount, 0)) AS cashAmount,
        ANY_VALUE(COALESCE(paymentSummary.bankTransferAmount, 0)) AS bankTransferAmount,
        ANY_VALUE(COALESCE(paymentSummary.cardAmount, 0)) AS cardAmount,
        ANY_VALUE(COALESCE(paymentSummary.otherAmount, 0)) AS otherAmount,
        ANY_VALUE(COALESCE(paymentSummary.paymentEventCount, 0)) AS paymentEventCount,
        ANY_VALUE(paymentSummary.paymentTotal) AS paymentTotal,
        ANY_VALUE(COALESCE(paymentSummary.latestPaymentAt, NULL)) AS latestPaymentAt
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${paymentSummaryJoin}
      WHERE 1=1
        ${deletedFilter}
        ${statusFilter}
        ${storeFilter}
        ${dateFilter}
      GROUP BY o.id
      ORDER BY orderDate DESC, o.id DESC
    `,
    params
  );

  const resolvedRows = rows.map((row) => {
    const hasPaymentEvents = Number(row.paymentEventCount || 0) > 0;
    const totalAmount = Number(row.salesAmount || 0);
    let cashAmount = Number(row.cashAmount || 0);
    let bankTransferAmount = Number(row.bankTransferAmount || 0);
    let cardAmount = Number(row.cardAmount || 0);
    let otherAmount = Number(row.otherAmount || 0);

    if (!hasPaymentEvents) {
      const mapped = normalizePaymentMethod(row.paymentMethod);
      if (mapped === "cash") cashAmount = totalAmount;
      else if (mapped === "bank_transfer") bankTransferAmount = totalAmount;
      else if (mapped === "card") cardAmount = totalAmount;
      else otherAmount = totalAmount;
    }

    const paymentMethod = hasPaymentEvents
      ? "拆分付款"
      : paymentLabel(normalizePaymentMethod(row.paymentMethod));

    const orderDate = row.latestPaymentAt ? row.latestPaymentAt : row.orderDate;

    return {
      orderId: row.orderId,
      orderNo: row.orderNo,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      productNames: row.productNames || "",
      itemQuantity: Number(row.itemQuantity || 0),
      salesAmount: totalAmount,
      paymentMethod,
      paymentDate: orderDate,
      cashAmount,
      bankTransferAmount,
      cardAmount,
      otherAmount,
      orderStatus: row.orderStatus,
      notes: row.notes || "",
      paymentEventCount: row.paymentEventCount || 0,
      paymentTotal: Number(row.paymentTotal || 0)
    };
  });

  return resolvedRows;
}

function buildSalesExportRows(rows) {
  return rows.map((row) => ({
    日期: row.paymentDate ? String(row.paymentDate).slice(0, 10) : "",
    訂單編號: row.orderNo || row.orderId,
    客戶姓名: row.customerName || "",
    電話: row.customerPhone || "",
    "商品/車款": row.productNames || "",
    數量: row.itemQuantity,
    銷售金額: row.salesAmount,
    付款方式: row.paymentMethod || "",
    現金金額: row.cashAmount,
    銀行轉帳金額: row.bankTransferAmount,
    刷卡金額: row.cardAmount,
    其他金額: row.otherAmount,
    訂單狀態: row.orderStatus || "",
    備註: row.notes || ""
  }));
}

function addSalesSummaryRows(sheet, summary) {
  const startRow = sheet.rowCount + 2;
  const summaryRows = [
    ["現金合計", summary.cash],
    ["銀行轉帳合計", summary.bankTransfer],
    ["刷卡合計", summary.card],
    ["其他合計", summary.other],
    ["總銷售額", summary.totalSales]
  ];

  const titleRow = sheet.getRow(startRow);
  titleRow.getCell("A").value = "結算合計";
  titleRow.getCell("A").font = { bold: true };

  summaryRows.forEach((item, index) => {
    const row = sheet.getRow(startRow + 1 + index);
    row.getCell("A").value = item[0];
    row.getCell("B").value = item[1];
    if (typeof item[1] === "number") {
      row.getCell("B").numFmt = "#,##0";
    }
  });
}

router.get("/export-sales", async (req, res, next) => {
  try {
    const startDate = normalizeDate(req.query.startDate, monthStartText());
    const endDate = normalizeDate(req.query.endDate, todayText());
    const dateBasis = normalizeDateBasis(req.query.dateBasis);
    const rows = await resolveSalesExportRows(startDate, endDate, req, dateBasis);

    const exportRows = buildSalesExportRows(rows);
    const summary = exportRows.reduce((acc, row) => {
      acc.totalSales += Number(row.銷售金額 || 0);
      acc.cash += Number(row.現金金額 || 0);
      acc.bankTransfer += Number(row.銀行轉帳金額 || 0);
      acc.card += Number(row.刷卡金額 || 0);
      acc.other += Number(row.其他金額 || 0);
      return acc;
    }, { totalSales: 0, cash: 0, bankTransfer: 0, card: 0, other: 0 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KINGWAY";
    const sheet = workbook.addWorksheet("銷售明細");
    sheet.columns = [
      { header: "日期", key: "日期", width: 14 },
      { header: "訂單編號", key: "訂單編號", width: 20 },
      { header: "客戶姓名", key: "客戶姓名", width: 18 },
      { header: "電話", key: "電話", width: 14 },
      { header: "商品/車款", key: "商品/車款", width: 36 },
      { header: "數量", key: "數量", width: 10 },
      { header: "銷售金額", key: "銷售金額", width: 14 },
      { header: "付款方式", key: "付款方式", width: 14 },
      { header: "現金金額", key: "現金金額", width: 12 },
      { header: "銀行轉帳金額", key: "銀行轉帳金額", width: 12 },
      { header: "刷卡金額", key: "刷卡金額", width: 12 },
      { header: "其他金額", key: "其他金額", width: 12 },
      { header: "訂單狀態", key: "訂單狀態", width: 14 },
      { header: "備註", key: "備註", width: 36 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.addRows(exportRows);

    addSalesSummaryRows(sheet, summary);

    const numberColumns = ["銷售金額", "現金金額", "銀行轉帳金額", "刷卡金額", "其他金額"];
    for (const header of numberColumns) {
      const column = sheet.getColumn(header);
      column.numFmt = "#,##0";
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `KINGWAY_sales_${startDate}_${endDate}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
