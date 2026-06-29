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

function formatDeliveredVehicleRows(rows = []) {
  if (!rows.length) {
    return "今日無交車車輛";
  }

  return rows.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const supplierTotal = Number(item.supplierTotal || 0);
    const name = item.productName || item.sku || "未命名車款";
    return `${index + 1}. ${name} × ${quantity || 0} / ${money(supplierTotal)}`;
  }).join("\n");
}

function formatVisitSummary(summary = {}) {
  if (!Number(summary.totalVisits || 0)) {
    return "今日無來店紀錄";
  }

  return [
    `來店件數：${summary.totalVisits}`,
    `來店人數：${summary.totalVisitorCount}`,
    `LINE 加好友：${summary.lineFriendAddedCount}`,
    `需追蹤：${summary.followUpRequiredCount}`
  ].join("\n");
}

function formatVisitRows(rows = []) {
  if (!rows.length) {
    return "今日無來店紀錄";
  }

  return rows.map((item, index) => {
    const vehicle = item.interestedVehicle || item.interestedProductSku || "未記錄車款";
    const result = VISIT_RESULT_LABELS[item.visitResult] || item.visitResult || "未記錄結果";
    const followUp = Number(item.followUpRequired || 0) ? "需追蹤" : "一般";
    return `${index + 1}. ${vehicle} / ${result} / ${followUp}`;
  }).join("\n");
}

async function getDeliveredVehicleRows(date) {
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
        END AS unitPrice
      FROM (
        SELECT DISTINCT pc.order_id, pc.store_id
        FROM purchase_confirmations pc
        LEFT JOIN orders delivery_order ON delivery_order.id = pc.order_id
          AND delivery_order.store_id = pc.store_id
        WHERE pc.order_id IS NOT NULL
          AND (
            pc.status = 'COMPLETED'
            OR pc.submitted_at IS NOT NULL
            OR pc.final_confirmation_accepted = 1
            OR pc.handover_confirmed_at IS NOT NULL
            OR delivery_order.handover_confirmed_at IS NOT NULL
          )
          AND DATE(COALESCE(pc.handover_confirmed_at, delivery_order.handover_confirmed_at, pc.submitted_at, pc.created_at)) = ?
      ) delivered_orders
      INNER JOIN orders o ON o.id = delivered_orders.order_id
        AND o.store_id = delivered_orders.store_id
      INNER JOIN order_items oi ON oi.order_id = o.id
        AND oi.store_id = o.store_id
      LEFT JOIN products p ON p.id = oi.product_id
        AND p.store_id = oi.store_id
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('cancelled', 'canceled', 'deleted', 'CANCELED', 'CANCELLED', 'DELETED')
        AND COALESCE(oi.product_category_snapshot, p.category) IN (?, ?)
      GROUP BY COALESCE(oi.product_name_snapshot, p.name, oi.sku_snapshot, '未命名車款'), COALESCE(oi.sku_snapshot, p.sku, '')
      ORDER BY quantity DESC, productName ASC
      LIMIT 12
    `,
    [date, ...EBIKE_CATEGORIES]
  );

  return rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unitPrice || 0);
    const supplierUnitPrice = Math.max(unitPrice - 10000, 0);
    return {
      productName: row.productName,
      sku: row.sku,
      quantity,
      supplierTotal: supplierUnitPrice * quantity
    };
  });
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
  const deliveredVehicles = await getDeliveredVehicleRows(date);
  const visitReport = await getVisitReport(date);

  const sections = [
    "📊 KINGWAY 每日營運報告",
    `日期：${date}`,
    "",
    "🚲 今日交車車輛",
    formatDeliveredVehicleRows(deliveredVehicles),
    "",
    "👥 今日來店",
    formatVisitSummary(visitReport.summary)
  ];

  if (Number(visitReport.summary.totalVisits || 0) > 0) {
    sections.push(
      "",
      "🚲 感興趣車款 / 來店結果",
      formatVisitRows(visitReport.rows)
    );
  }

  return sections.join("\n");
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
