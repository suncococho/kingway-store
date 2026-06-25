const express = require("express");
const ExcelJS = require("exceljs");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  getKpiEvents,
  getKpiSummary,
  resolveStaffKpiContext
} = require("../services/staffKpiService");

const router = express.Router();

function isXlsxExport(query = {}) {
  return String(query.export || "").trim().toLowerCase() === "xlsx";
}

function formatDateForFile(value, fallback) {
  return String(value || fallback || "all").replaceAll("-", "");
}

async function sendWorkbook(res, workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

function addHeaderRow(worksheet, headers) {
  worksheet.addRow(headers);
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildSummaryWorkbook(summary, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KINGWAY POS";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("員工KPI總表");
  addHeaderRow(worksheet, [
    "員工ID",
    "員工帳號",
    "員工名稱",
    "門市",
    "完成事件數",
    "KPI參考分數",
    "每日任務完成",
    "系統通知完成",
    "訊息已讀",
    "出貨/入庫處理",
    "供應商處理",
    "逾期件數",
    "期間開始",
    "期間結束"
  ]);
  summary.forEach((row) => {
    worksheet.addRow([
      row.staffUserId,
      row.username,
      row.displayName,
      row.storeName,
      row.totalEvents,
      row.totalScore,
      row.dailyTaskDoneCount,
      row.notificationDoneCount,
      row.messageReadCount,
      row.transferCount,
      row.supplierCount,
      row.lateCount,
      query.startDate || "",
      query.endDate || ""
    ]);
  });
  worksheet.columns.forEach((column) => {
    column.width = Math.max(12, Math.min(28, column.values.reduce((max, value) => Math.max(max, String(value || "").length), 0) + 2));
  });
  return workbook;
}

function buildEventsWorkbook(events) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KINGWAY POS";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("KPI事件明細");
  addHeaderRow(worksheet, [
    "日期時間",
    "員工",
    "門市",
    "事件類型",
    "標題",
    "分數",
    "是否逾期",
    "來源類型",
    "來源ID"
  ]);
  events.forEach((row) => {
    worksheet.addRow([
      row.occurredAt,
      row.displayName || row.username || "",
      row.storeName || "",
      row.eventType,
      row.title,
      row.score,
      row.isLate ? "是" : "否",
      row.refType || "",
      row.refId || ""
    ]);
  });
  worksheet.columns.forEach((column) => {
    column.width = Math.max(12, Math.min(36, column.values.reduce((max, value) => Math.max(max, String(value || "").length), 0) + 2));
  });
  return workbook;
}

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/summary", async (req, res, next) => {
  try {
    const context = await resolveStaffKpiContext(req);
    const summary = await getKpiSummary({ context, query: req.query });
    if (isXlsxExport(req.query)) {
      const workbook = buildSummaryWorkbook(summary, req.query);
      const filename = `kingway_staff_kpi_summary_${formatDateForFile(req.query.startDate)}_${formatDateForFile(req.query.endDate)}.xlsx`;
      return sendWorkbook(res, workbook, filename);
    }
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const context = await resolveStaffKpiContext(req);
    const eventQuery = isXlsxExport(req.query) ? { ...req.query, limit: 1000 } : req.query;
    const events = await getKpiEvents({ context, query: eventQuery });
    if (isXlsxExport(req.query)) {
      const workbook = buildEventsWorkbook(events);
      const filename = `kingway_staff_kpi_events_${formatDateForFile(req.query.startDate)}_${formatDateForFile(req.query.endDate)}.xlsx`;
      return sendWorkbook(res, workbook, filename);
    }
    res.json({ events });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
