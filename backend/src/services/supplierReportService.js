const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { pool } = require("../db");
const { sendDocumentToTelegramGroups } = require("./telegramService");

async function generateAndSendMonthlySupplierReports() {
  const [suppliers] = await pool.query(`
    SELECT DISTINCT supplier_name AS supplierName
    FROM supplier_requests
    WHERE supplier_name IS NOT NULL
      AND supplier_name <> ''
  `);

  let sent = 0;
  let files = 0;

  for (const supplier of suppliers) {
    const supplierName = supplier.supplierName;

    const [rows] = await pool.query(
      `
        SELECT
          sr.id,
          sr.supplier_name AS supplierName,
          sr.request_type AS requestType,
          sr.status,
          DATE_FORMAT(sr.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
          p.sku,
          p.name,
          p.cost_price AS costPrice,
          sri.quantity,
          sri.received_quantity AS receivedQuantity
        FROM supplier_requests sr
        LEFT JOIN supplier_request_items sri
          ON sri.supplier_request_id = sr.id
        LEFT JOIN products p
          ON p.id = sri.product_id
        WHERE sr.supplier_name = ?
          AND DATE_FORMAT(sr.created_at, '%Y-%m')
              = DATE_FORMAT(NOW(), '%Y-%m')
        ORDER BY sr.id DESC
      `,
      [supplierName]
    );

    if (!rows.length) continue;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Supplier Report");

    sheet.columns = [
      { header: "單號", key: "id", width: 10 },
      { header: "SKU", key: "sku", width: 24 },
      { header: "商品", key: "name", width: 28 },
      { header: "類型", key: "requestType", width: 18 },
      { header: "狀態", key: "status", width: 24 },
      { header: "供應價", key: "costPrice", width: 12 },
      { header: "數量", key: "quantity", width: 10 },
      { header: "已入庫", key: "receivedQuantity", width: 10 },
      { header: "日期", key: "createdAt", width: 22 }
    ];

    rows.forEach((r) => sheet.addRow(r));

    const month = new Date().toISOString().slice(0,7);

    const dir = path.join(__dirname, "..", "storage", "reports");
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `supplier-${supplierName}-${month}.xlsx`;
    const filePath = path.join(dir, fileName);

    await workbook.xlsx.writeFile(filePath);

    files++;

    try {
      await sendDocumentToTelegramGroups(
        ["daily"],
        filePath,
        `供應商月報｜${supplierName}｜${month}`
      );

      sent++;
    } catch (e) {
      console.error("[Supplier XLSX telegram send failed]", e);
    }
  }

  return { sent, files };
}

module.exports = {
  generateAndSendMonthlySupplierReports
};
