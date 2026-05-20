const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { pool } = require("../db");
const { logWorkflowEvent } = require("./lineWorkflowService");
const { sendInternalTelegram } = require("./telegramService");

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
          + (SELECT COUNT(*) FROM repair_orders WHERE status IN ('checking', 'reserved', 'estimate_pending_approval', 'estimate_approved', 'completed_waiting_pickup'))
          + (SELECT COUNT(*) FROM coupons WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL)
        ) AS totalPending
    `
  );

  const topProductsText =
    topProducts.length > 0
      ? topProducts
          .map((item, index) => `${index + 1}. ${item.name} (${item.sku}) x${item.quantitySold}`)
          .join("\n")
      : "今日尚無商品銷售紀錄。";

  const lowStockText =
    lowStockRows.length > 0
      ? lowStockRows.map((item) => `${item.name} (${item.sku}) 庫存=${item.stock}`).join("\n")
      : "目前沒有低庫存商品。";

  const paymentText =
    paymentRows.length > 0
      ? paymentRows
          .map((row) => `${row.paymentMethod}: ${row.orderCount} 筆 / NT$${Number(row.totalAmount).toFixed(2)}`)
          .join("\n")
      : "今日尚無付款資料。";

  return [
    "KINGWAY 每日結算",
    `日期：${date}`,
    `訂單數：${Number(salesSummary.orderCount || 0)}`,
    `銷售額：NT$${Number(salesSummary.totalSales || 0).toFixed(2)}`,
    `待處理事項：${Number(pendingItems.totalPending || 0)}`,
    "",
    "付款方式：",
    paymentText,
    "",
    "熱銷商品：",
    topProductsText,
    "",
    "低庫存：",
    lowStockText
  ].join("\n");
}

async function sendDailyReport(config, targetDate) {
  const messageText = await buildDailyReport(targetDate);
  const delivery = await sendInternalTelegram(["daily"], [
    {
      type: "text",
      text: messageText
    }
  ]);

  if (delivery.delivered === 0) {
    await logWorkflowEvent("daily_report_sent", "SYSTEM", null, {
      targetDate: targetDate || dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD"),
      delivered: 0,
      messageText
    });
    return {
      delivered: 0,
      messageText
    };
  }

  await logWorkflowEvent("daily_report_sent", "SYSTEM", null, {
    targetDate: targetDate || dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD"),
    delivered: delivery.delivered,
    targetGroupIds: delivery.targetGroupIds,
    messageText
  });

  return {
    delivered: delivery.delivered,
    messageText
  };
}

module.exports = {
  buildDailyReport,
  sendDailyReport,
  TAIPEI_TZ
};
