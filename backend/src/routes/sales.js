const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const ExcelJS = require("exceljs");

const router = express.Router();

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER"]), requireStoreFeature("sales_dashboard_enabled"));

function getRequestStoreId(req) {
  return Number(req.storeId || req.user?.store_id || req.user?.storeId || 1);
}

function normalizeDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
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

router.get("/summary", async (req, res, next) => {
  try {
    const startDate = normalizeDate(req.query.startDate, monthStartText());
    const endDate = normalizeDate(req.query.endDate, todayText());

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    const orderColumns = await getColumns("orders");
    const itemColumns = await getColumns("order_items");

    // SALES_STORE_ID_FILTER_SAFE_V1
    const storeId = getRequestStoreId(req);
    const storeFilter = orderColumns.has("store_id") ? "AND o.`store_id` = ?" : "";

    const orderDateCol = pickColumn(orderColumns, ["created_at", "business_date", "updated_at"], "o.`id`", "o");
    const orderNoCol = pickColumn(orderColumns, ["order_no", "order_number", "id"], "o.`id`", "o");
    const customerNameCol = pickColumn(orderColumns, ["customer_name", "name"], "NULL", "o");
    const customerPhoneCol = pickColumn(orderColumns, ["customer_phone", "phone"], "NULL", "o");
    const orderStatusCol = pickColumn(orderColumns, ["status"], "NULL", "o");
    const paymentMethodCol = pickColumn(orderColumns, ["payment_method"], "NULL", "o");
    const finalPaymentStatusCol = pickColumn(orderColumns, ["final_payment_status", "payment_status"], "NULL", "o");
    const totalAmountCol = pickColumn(orderColumns, ["total_amount", "amount", "grand_total"], "0", "o");

    const itemNameCol = pickColumn(itemColumns, ["product_name_snapshot", "product_name", "name"], "'商品'", "oi");
    const itemSkuCol = pickColumn(itemColumns, ["product_sku_snapshot", "sku"], "''", "oi");
    const itemProductIdCol = pickColumn(itemColumns, ["product_id"], "0", "oi");
    const itemQuantityCol = pickColumn(itemColumns, ["quantity", "qty"], "0", "oi");
    const itemAmountExpr = pickAmountExpression(orderColumns, itemColumns);

    const deletedFilter = orderColumns.has("deleted_at") ? "AND o.`deleted_at` IS NULL" : "";
    const statusFilter = orderColumns.has("status")
      ? "AND COALESCE(o.`status`, '') NOT IN ('CANCELED', 'CANCELLED', 'canceled', 'cancelled')"
      : "";

    const dateFilter = orderColumns.has("created_at") || orderColumns.has("business_date") || orderColumns.has("updated_at")
      ? `AND ${orderDateCol} BETWEEN ? AND ?`
      : "";

    const params = [];
    if (dateFilter) {
      params.push(startDateTime, endDateTime);
    }
    if (storeFilter) {
      params.push(storeId);
    }

    const [summaryRows] = await pool.query(
      `
        SELECT
          COUNT(DISTINCT o.id) AS orderCount,
          COALESCE(SUM(COALESCE(${itemQuantityCol}, 0)), 0) AS totalQuantity,
          COALESCE(SUM(DISTINCT COALESCE(${totalAmountCol}, 0)), 0) AS totalSales,
          COALESCE(AVG(COALESCE(${totalAmountCol}, 0)), 0) AS averageOrderAmount
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE 1=1
          ${deletedFilter}
          ${statusFilter}
          ${dateFilter}
          ${storeFilter}
      `,
      params
    );

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
          COALESCE(${totalAmountCol}, 0) AS totalAmount,
          ${orderDateCol} AS createdAt,
          COALESCE(SUM(COALESCE(${itemQuantityCol}, 0)), 0) AS totalQuantity,
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
        WHERE 1=1
          ${deletedFilter}
          ${statusFilter}
          ${dateFilter}
          ${storeFilter}
        GROUP BY o.id
        ORDER BY createdAt DESC, o.id DESC
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

    res.json({
      range: { startDate, endDate },
      summary: {
        orderCount: Number(summaryRows[0]?.orderCount || 0),
        totalQuantity: Number(summaryRows[0]?.totalQuantity || 0),
        totalSales: Number(summaryRows[0]?.totalSales || 0),
        averageOrderAmount: Number(summaryRows[0]?.averageOrderAmount || 0)
      },
      orders: orderRows.map((row) => ({
        orderId: row.orderId,
        orderNo: row.orderNo,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        status: row.status,
        paymentMethod: row.paymentMethod,
        finalPaymentStatus: row.finalPaymentStatus,
        totalAmount: Number(row.totalAmount || 0),
        totalQuantity: Number(row.totalQuantity || 0),
        itemSummary: row.itemSummary || "",
        createdAt: row.createdAt
      })),
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

async function resolveSalesExportRows(startDate, endDate, req) {
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
  const dateFilter = hasDateColumn
    ? `
      AND COALESCE(
        CASE
          WHEN COALESCE(paymentSummary.paymentTotal, 0) > 0
            THEN paymentSummary.latestPaymentAt
          ELSE ${orderDateValueCol}
        END,
        ${orderDateValueCol}
      ) BETWEEN ? AND ?
    `
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
    const rows = await resolveSalesExportRows(startDate, endDate, req);

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
