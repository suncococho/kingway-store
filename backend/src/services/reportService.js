const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { pool } = require("../db");
const { logWorkflowEvent } = require("./lineWorkflowService");
const { sendInternalTelegram } = require("./telegramService");

dayjs.extend(utc);
dayjs.extend(timezone);

const TAIPEI_TZ = "Asia/Taipei";
const EBIKE_CATEGORIES = ["EB", "EBIKE"];
const VISIT_RESULT_LABELS = {
  INTERESTED: "有興趣",
  TEST_RIDE: "試乘",
  QUOTE_REQUESTED: "已報價",
  RESERVED: "已預約",
  PURCHASED: "已購買",
  NEED_FOLLOW_UP: "需追蹤",
  NO_PURCHASE: "未購買",
  OTHER: "其他"
};

function money(value) {
  return `NT$${Number(value || 0).toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

function normalizeDate(targetDate) {
  if (!targetDate) return dayjs().tz(TAIPEI_TZ).format("YYYY-MM-DD");
  if (typeof targetDate === "string") return dayjs.tz(targetDate, TAIPEI_TZ).format("YYYY-MM-DD");
  return dayjs(targetDate).tz(TAIPEI_TZ).format("YYYY-MM-DD");
}

function formatVehicleRows(rows = []) {
  if (!rows.length) {
    return "今日尚無完成的電動自行車訂單。";
  }

  return rows.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const hasPrice = unitPrice > 0;
    const supplierUnitPrice = Math.max(unitPrice - 10000, 0);
    const supplierTotal = supplierUnitPrice * quantity;
    const name = item.productName || item.sku || "未命名車款";
    const priceText = hasPrice ? money(unitPrice) : "價格未記錄";
    const supplierText = hasPrice ? `${money(supplierUnitPrice)}${quantity > 1 ? ` / 小計 ${money(supplierTotal)}` : ""}` : "價格未記錄";
    return [
      `${index + 1}. ${name} × ${quantity || 0}`,
      `   車價: ${priceText}`,
      `   供應商價格估算: ${supplierText}`
    ].join("\n");
  }).join("\n");
}

function formatVisitRows(rows = []) {
  if (!rows.length) {
    return "今日尚無來店紀錄。";
  }

  return rows.map((item, index) => {
    const vehicle = item.interestedVehicle || item.interestedProductSku || "未記錄車款";
    const result = VISIT_RESULT_LABELS[item.visitResult] || item.visitResult || "未記錄結果";
    const followUp = Number(item.followUpRequired || 0) ? "需追蹤" : "一般";
    return `${index + 1}. ${vehicle} / ${result} / ${followUp}`;
  }).join("\n");
}

async function getCompletedVehicleRows(date) {
  const [rows] = await pool.query(
    `
      SELECT
        COALESCE(oi.product_name_snapshot, p.name, oi.sku_snapshot, '未命名車款') AS productName,
        COALESCE(oi.sku_snapshot, p.sku, '') AS sku,
        SUM(COALESCE(oi.quantity, 0)) AS quantity,
        CASE
          WHEN SUM(COALESCE(oi.quantity, 0)) > 0
            THEN SUM(COALESCE(oi.line_total, COALESCE(oi.unit_price, 0) * COALESCE(oi.quantity, 0))) / SUM(COALESCE(oi.quantity, 0))
          ELSE MAX(COALESCE(oi.unit_price, 0))
        END AS unitPrice,
        SUM(COALESCE(oi.line_total, COALESCE(oi.unit_price, 0) * COALESCE(oi.quantity, 0))) AS lineTotal
      FROM orders o
      INNER JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
      LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = oi.store_id
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('cancelled', 'canceled', 'deleted', 'CANCELED', 'CANCELLED', 'DELETED')
        AND COALESCE(oi.product_category_snapshot, p.category) IN (?, ?)
        AND (
          DATE(o.final_payment_completed_at) = ?
          OR (
            o.final_payment_completed_at IS NULL
            AND o.business_date = ?
            AND COALESCE(o.final_payment_status, '') = 'PAID'
          )
        )
      GROUP BY COALESCE(oi.product_name_snapshot, p.name, oi.sku_snapshot, '未命名車款'), COALESCE(oi.sku_snapshot, p.sku, '')
      ORDER BY quantity DESC, productName ASC
      LIMIT 12
    `,
    [...EBIKE_CATEGORIES, date, date]
  );

  return rows.map((row) => ({
    productName: row.productName,
    sku: row.sku,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unitPrice || 0),
    lineTotal: Number(row.lineTotal || 0)
  }));
}

async function getVisitReport(date) {
  const [[summary]] = await pool.query(
    `
      SELECT
        COUNT(*) AS totalVisits,
        COALESCE(SUM(visitor_count), 0) AS totalVisitorCount,
        COALESCE(SUM(CASE WHEN line_friend_added = 1 THEN 1 ELSE 0 END), 0) AS lineFriendAddedCount,
        COALESCE(SUM(CASE WHEN follow_up_required = 1 THEN 1 ELSE 0 END), 0) AS followUpRequiredCount
      FROM store_visit_records
      WHERE visit_date = ?
    `,
    [date]
  );

  const [rows] = await pool.query(
    `
      SELECT
        interested_vehicle AS interestedVehicle,
        interested_product_sku AS interestedProductSku,
        visit_result AS visitResult,
        follow_up_required AS followUpRequired
      FROM store_visit_records
      WHERE visit_date = ?
      ORDER BY visit_time ASC, id ASC
      LIMIT 12
    `,
    [date]
  );

  return {
    summary: {
      totalVisits: Number(summary?.totalVisits || 0),
      totalVisitorCount: Number(summary?.totalVisitorCount || 0),
      lineFriendAddedCount: Number(summary?.lineFriendAddedCount || 0),
      followUpRequiredCount: Number(summary?.followUpRequiredCount || 0)
    },
    rows
  };
}

async function buildDailyReport(targetDate) {
  const date = normalizeDate(targetDate);

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

  const completedVehicles = await getCompletedVehicleRows(date);
  const visitReport = await getVisitReport(date);

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
          .map((row) => `${row.paymentMethod}: ${row.orderCount} 筆 / ${money(row.totalAmount)}`)
          .join("\n")
      : "今日尚無付款資料。";

  return [
    "📊 KINGWAY 每日營運報告",
    `日期：${date}`,
    `訂單數：${Number(salesSummary.orderCount || 0)}`,
    `銷售額：${money(salesSummary.totalSales)}`,
    `待處理事項：${Number(pendingItems.totalPending || 0)}`,
    "",
    "🚲 今日完成車輛：",
    formatVehicleRows(completedVehicles),
    "",
    "👥 今日來店：",
    `來店件數：${visitReport.summary.totalVisits}`,
    `來店人數：${visitReport.summary.totalVisitorCount}`,
    `LINE 加好友：${visitReport.summary.lineFriendAddedCount}`,
    `需追蹤：${visitReport.summary.followUpRequiredCount}`,
    "",
    "🚲 感興趣車款 / 來店結果：",
    formatVisitRows(visitReport.rows),
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
  buildDailyOperationReportMessage: buildDailyReport,
  sendDailyReport,
  TAIPEI_TZ
};
