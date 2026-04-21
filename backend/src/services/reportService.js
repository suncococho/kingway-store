const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { pool } = require("../db");
const { sendLineMessage } = require("../utils/line");

dayjs.extend(utc);
dayjs.extend(timezone);

const TAIPEI_TZ = "Asia/Taipei";

async function buildDailyReport(targetDate) {
  const date = targetDate || dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD");

  const [[salesSummary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS orderCount,
        COALESCE(SUM(total_amount), 0) AS totalSales
      FROM orders
      WHERE business_date = ?
    `,
    [date]
  );

  const [topProducts] = await pool.query(
    `
      SELECT
        oi.product_id,
        p.name,
        p.sku,
        SUM(oi.quantity) AS quantitySold
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      INNER JOIN products p ON p.id = oi.product_id
      WHERE o.business_date = ?
      GROUP BY oi.product_id, p.name, p.sku
      ORDER BY quantitySold DESC, p.name ASC
      LIMIT 5
    `,
    [date]
  );

  const [lowStockRows] = await pool.query(
    `
      SELECT sku, name, stock
      FROM products
      WHERE stock <= reorder_level
      ORDER BY stock ASC, name ASC
      LIMIT 10
    `
  );

  const [paymentRows] = await pool.query(
    `
      SELECT payment_method AS paymentMethod, COUNT(*) AS orderCount, COALESCE(SUM(total_amount), 0) AS totalAmount
      FROM orders
      WHERE business_date = ?
      GROUP BY payment_method
      ORDER BY totalAmount DESC
    `,
    [date]
  );

  const [[pendingItems]] = await pool.query(
    `
      SELECT
        (
          (SELECT COUNT(*) FROM purchase_confirmations WHERE status = 'PENDING')
          + (SELECT COUNT(*) FROM repair_orders WHERE status IN ('reserved', 'estimate_pending_approval', 'completed_waiting_pickup'))
          + (SELECT COUNT(*) FROM coupons WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL)
        ) AS totalPending
    `
  );

  const topProductsText =
    topProducts.length > 0
      ? topProducts
          .map((item, index) => `${index + 1}. ${item.name} (${item.sku}) x${item.quantitySold}`)
          .join("\n")
      : "No product sales recorded today.";

  const lowStockText =
    lowStockRows.length > 0
      ? lowStockRows.map((item) => `${item.name} (${item.sku}) stock=${item.stock}`).join("\n")
      : "No low-stock items.";

  const paymentText =
    paymentRows.length > 0
      ? paymentRows
          .map((row) => `${row.paymentMethod}: ${row.orderCount} orders / NT$${Number(row.totalAmount).toFixed(2)}`)
          .join("\n")
      : "No payment data.";

  return [
    "KINGWAY Daily Settlement",
    `Date: ${date}`,
    `Orders: ${Number(salesSummary.orderCount || 0)}`,
    `Sales: NT$${Number(salesSummary.totalSales || 0).toFixed(2)}`,
    `Pending Items: ${Number(pendingItems.totalPending || 0)}`,
    "",
    "Payment Breakdown:",
    paymentText,
    "",
    "Top Products:",
    topProductsText,
    "",
    "Low Stock:",
    lowStockText
  ].join("\n");
}

async function sendDailyReport(config, targetDate) {
  const messageText = await buildDailyReport(targetDate);
  const [registrations] = await pool.query(
    `
      SELECT line_group_id
      FROM line_group_registrations
      WHERE is_active = 1 AND registration_type = 'daily'
    `
  );

  if (registrations.length === 0) {
    return {
      delivered: 0,
      messageText
    };
  }

  for (const registration of registrations) {
    await sendLineMessage(config, registration.line_group_id, [
      {
        type: "text",
        text: messageText
      }
    ]);
  }

  return {
    delivered: registrations.length,
    messageText
  };
}

module.exports = {
  buildDailyReport,
  sendDailyReport,
  TAIPEI_TZ
};
