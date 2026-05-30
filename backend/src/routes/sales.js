const express = require("express");
const { pool } = require("../db");

const router = express.Router();

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

module.exports = router;
