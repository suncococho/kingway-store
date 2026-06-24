const express = require("express");
const ExcelJS = require("exceljs");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { loadCompanyMembership } = require("../middleware/companyAuth");
const { requireFeature } = require("../services/storeAccessService");
const { buildDemoKeywordCondition, buildDemoExclusionCondition, isExcludeDemoRequested } = require("../utils/demoDataFilter");

const router = express.Router();

const HQ_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const HQ_READ_ROLES = new Set(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]);
const FINAL_SETTLEMENT_STATUSES = ["CONFIRMED", "PARTIALLY_PAID", "PAID"];

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "INVENTORY"]), requireFeature("company_store_settlements"));

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeMonth(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function makeSettlementNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `CS-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function hasStoreAdminAccess(staffUserId, storeId, connection = pool) {
  if (!staffUserId || !storeId) return false;
  const [membershipRows] = await connection.query(
    `
      SELECT role
      FROM store_memberships
      WHERE staff_user_id = ?
        AND store_id = ?
        AND status = 'active'
        AND role IN ('owner', 'admin')
      LIMIT 1
    `,
    [staffUserId, storeId]
  );
  if (membershipRows[0]) return true;

  const [staffRows] = await connection.query(
    "SELECT role, store_id AS storeId FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1",
    [staffUserId]
  );
  const staff = staffRows[0];
  return Boolean(staff && Number(staff.storeId) === Number(storeId) && ["ADMIN", "MANAGER", "INVENTORY"].includes(String(staff.role || "").toUpperCase()));
}

async function loadCompanyContext(req, companyId, connection = pool) {
  const membership = await loadCompanyMembership(req.user.id, companyId);
  const role = membership?.role || "";
  return {
    membership,
    role,
    canHqRead: HQ_READ_ROLES.has(role),
    canHqWrite: HQ_WRITE_ROLES.has(role)
  };
}

function mapSettlement(row) {
  const totalAmount = Number(row.totalAmount || 0);
  const paidAmount = Number(row.paidAmount || 0);
  return {
    id: Number(row.id),
    settlementNo: row.settlementNo || "",
    companyId: Number(row.companyId),
    companyName: row.companyName || "",
    hqStoreId: Number(row.hqStoreId),
    hqStoreName: row.hqStoreName || "",
    targetStoreId: Number(row.targetStoreId),
    targetStoreName: row.targetStoreName || "",
    targetRelationshipType: row.targetRelationshipType || "",
    settlementMonth: row.settlementMonth || "",
    status: row.status || "DRAFT",
    totalAmount,
    paidAmount,
    unpaidAmount: Math.max(totalAmount - paidAmount, 0),
    confirmedAt: row.confirmedAt || null,
    paidAt: row.paidAt || null,
    note: row.note || "",
    itemSummary: row.itemSummary || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function mapItem(row) {
  return {
    id: Number(row.id),
    settlementId: Number(row.settlementId),
    transferId: Number(row.transferId),
    transferNo: row.transferNo || "",
    transferItemId: Number(row.transferItemId),
    productId: Number(row.productId),
    sku: row.sku || "",
    productName: row.productName || "",
    quantityReceived: Number(row.quantityReceived || 0),
    unitPrice: Number(row.unitPrice || 0),
    lineAmount: Number(row.lineAmount || 0),
    sourceReceivedAt: row.sourceReceivedAt || null
  };
}

async function loadSettlement(id, req, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        css.id,
        css.settlement_no AS settlementNo,
        css.company_id AS companyId,
        c.name AS companyName,
        css.hq_store_id AS hqStoreId,
        hs.name AS hqStoreName,
        css.target_store_id AS targetStoreId,
        ts.name AS targetStoreName,
        css.target_relationship_type AS targetRelationshipType,
        css.settlement_month AS settlementMonth,
        css.status,
        css.total_amount AS totalAmount,
        css.paid_amount AS paidAmount,
        css.confirmed_at AS confirmedAt,
        css.paid_at AS paidAt,
        css.note,
        css.created_at AS createdAt,
        css.updated_at AS updatedAt
      FROM company_store_settlements css
      INNER JOIN companies c ON c.id = css.company_id
      INNER JOIN stores hs ON hs.id = css.hq_store_id
      INNER JOIN stores ts ON ts.id = css.target_store_id
      WHERE css.id = ?
      LIMIT 1
    `,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const context = await loadCompanyContext(req, row.companyId, connection);
  const isTargetStoreAdmin =
    Number(req.storeId || req.user?.storeId || 0) === Number(row.targetStoreId) &&
    await hasStoreAdminAccess(req.user.id, row.targetStoreId, connection);
  if (!context.canHqRead && !isTargetStoreAdmin) {
    throw createError("沒有月結資料權限", 403);
  }
  return mapSettlement(row);
}

async function loadItems(settlementId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        cssi.id,
        cssi.settlement_id AS settlementId,
        cssi.transfer_id AS transferId,
        st.transfer_no AS transferNo,
        cssi.transfer_item_id AS transferItemId,
        cssi.product_id AS productId,
        cssi.sku_snapshot AS sku,
        cssi.product_name_snapshot AS productName,
        cssi.quantity_received AS quantityReceived,
        cssi.unit_price AS unitPrice,
        cssi.line_amount AS lineAmount,
        cssi.source_received_at AS sourceReceivedAt
      FROM company_store_settlement_items cssi
      INNER JOIN store_transfers st ON st.id = cssi.transfer_id
      WHERE cssi.settlement_id = ?
      ORDER BY cssi.id ASC
    `,
    [settlementId]
  );
  return rows.map(mapItem);
}

function buildListFilters(query, params) {
  const filters = [];
  if (query.companyId) {
    filters.push("css.company_id = ?");
    params.push(Number(query.companyId));
  }
  if (query.targetStoreId) {
    filters.push("css.target_store_id = ?");
    params.push(Number(query.targetStoreId));
  }
  if (query.month) {
    filters.push("css.settlement_month = ?");
    params.push(normalizeMonth(query.month));
  }
  if (query.status) {
    filters.push("css.status = ?");
    params.push(String(query.status).toUpperCase());
  }
  if (isExcludeDemoRequested(query.excludeDemo)) {
    appendSettlementDemoExclusion(filters, params);
  }
  return filters;
}

function appendSettlementDemoExclusion(filters, params) {
  filters.push(buildDemoExclusionCondition([
    "css.settlement_no",
    "css.note",
    "ts.code",
    "ts.name",
    "ts.billing_note"
  ], params));
  filters.push(`
    NOT EXISTS (
      SELECT 1
      FROM company_store_settlement_items cssi_demo
      LEFT JOIN store_transfers st_demo ON st_demo.id = cssi_demo.transfer_id
      LEFT JOIN store_transfer_items sti_demo ON sti_demo.id = cssi_demo.transfer_item_id
      LEFT JOIN products p_demo ON p_demo.id = cssi_demo.product_id
      WHERE cssi_demo.settlement_id = css.id
        AND ${buildDemoKeywordCondition([
          "cssi_demo.sku_snapshot",
          "cssi_demo.product_name_snapshot",
          "st_demo.transfer_no",
          "st_demo.note",
          "sti_demo.sku_snapshot",
          "sti_demo.product_name_snapshot",
          "sti_demo.note",
          "p_demo.sku",
          "p_demo.name",
          "p_demo.description",
          "p_demo.source"
        ], params)}
    )
  `);
}

function normalizeDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartText() {
  return `${todayText().slice(0, 7)}-01`;
}

function normalizeTransferStatus(value) {
  const status = String(value || "ALL").trim().toUpperCase();
  return ["DRAFT", "SHIPPED", "PARTIALLY_RECEIVED", "RECEIVED", "DISCREPANCY", "CANCELED"].includes(status) ? status : "ALL";
}

function normalizeSettlementStatus(value) {
  const status = String(value || "ALL").trim().toUpperCase();
  return ["SETTLED", "UNSETTLED"].includes(status) ? status : "ALL";
}

function formatReportDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function mapTransferReportRow(row) {
  const quantityShipped = Number(row.quantityShipped || 0);
  const quantityReceived = Number(row.quantityReceived || 0);
  const unitCost = Number(row.unitCost || 0);
  return {
    transferId: Number(row.transferId),
    transferNo: row.transferNo || "",
    transferStatus: row.transferStatus || "",
    fromStoreId: Number(row.fromStoreId),
    fromStoreName: row.fromStoreName || "",
    targetStoreId: Number(row.targetStoreId),
    targetStoreName: row.targetStoreName || "",
    shippedAt: row.shippedAt || null,
    receivedAt: row.receivedAt || null,
    sku: row.sku || "",
    productName: row.productName || "",
    quantityShipped,
    quantityReceived,
    unitCost,
    lineAmount: toMoney(row.lineAmount),
    unitCostSource: row.unitCostSource || "transfer_item",
    settlementId: row.settlementId === null || row.settlementId === undefined ? null : Number(row.settlementId),
    settlementNo: row.settlementNo || "",
    settlementStatus: row.settlementStatus || "UNSETTLED",
    settlementMonth: row.settlementMonth || ""
  };
}

function buildTransferReportSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.totalQuantityShipped += Number(row.quantityShipped || 0);
    summary.totalQuantityReceived += Number(row.quantityReceived || 0);
    summary.totalAmount = toMoney(summary.totalAmount + Number(row.lineAmount || 0));
    summary.rowCount += 1;
    return summary;
  }, {
    totalQuantityShipped: 0,
    totalQuantityReceived: 0,
    totalAmount: 0,
    rowCount: 0
  });
}

async function resolveReportCompanyIds(req, requestedCompanyId) {
  if (requestedCompanyId) {
    const context = await loadCompanyContext(req, requestedCompanyId);
    if (!context.canHqRead) throw createError("沒有本部出貨明細權限", 403);
    return [requestedCompanyId];
  }
  const [memberships] = await pool.query(
    "SELECT company_id AS companyId, role FROM company_memberships WHERE staff_user_id = ? AND status = 'ACTIVE'",
    [req.user.id]
  );
  return memberships
    .filter((row) => HQ_READ_ROLES.has(row.role))
    .map((row) => Number(row.companyId))
    .filter(Boolean);
}

async function queryTransferReportRows(req) {
  const startDate = normalizeDate(req.query.fromDate || req.query.startDate, monthStartText());
  const endDate = normalizeDate(req.query.toDate || req.query.endDate, todayText());
  const companyIds = await resolveReportCompanyIds(req, Number(req.query.companyId || 0));
  if (!companyIds.length) throw createError("沒有本部出貨明細權限", 403);

  const params = [...companyIds, startDate, endDate];
  const filters = [
    `st.company_id IN (${companyIds.map(() => "?").join(",")})`,
    "DATE(COALESCE(st.shipped_at, st.created_at)) BETWEEN ? AND ?"
  ];

  const targetStoreId = Number(req.query.targetStoreId || 0);
  if (targetStoreId) {
    filters.push("st.to_store_id = ?");
    params.push(targetStoreId);
  }

  const status = normalizeTransferStatus(req.query.status);
  if (status !== "ALL") {
    filters.push("st.status = ?");
    params.push(status);
  }

  const settlementStatus = normalizeSettlementStatus(req.query.settlementStatus);
  if (settlementStatus === "SETTLED") {
    filters.push("css.id IS NOT NULL");
  } else if (settlementStatus === "UNSETTLED") {
    filters.push("css.id IS NULL");
  }

  const [rows] = await pool.query(
    `
      SELECT
        st.id AS transferId,
        st.transfer_no AS transferNo,
        st.status AS transferStatus,
        st.from_store_id AS fromStoreId,
        fs.name AS fromStoreName,
        st.to_store_id AS targetStoreId,
        ts.name AS targetStoreName,
        st.shipped_at AS shippedAt,
        st.received_at AS receivedAt,
        sti.sku_snapshot AS sku,
        sti.product_name_snapshot AS productName,
        sti.quantity_shipped AS quantityShipped,
        sti.quantity_received AS quantityReceived,
        CASE
          WHEN sti.unit_cost IS NOT NULL THEN sti.unit_cost
          WHEN fp.cost_price IS NOT NULL AND fp.cost_price > 0 THEN fp.cost_price
          WHEN fp.price IS NOT NULL THEN fp.price
          ELSE 0
        END AS unitCost,
        CASE
          WHEN sti.unit_cost IS NOT NULL THEN 'transfer_item'
          WHEN fp.cost_price IS NOT NULL AND fp.cost_price > 0 THEN 'product_cost_price_fallback'
          WHEN fp.price IS NOT NULL THEN 'product_price_fallback'
          ELSE 'missing'
        END AS unitCostSource,
        (sti.quantity_shipped * CASE
          WHEN sti.unit_cost IS NOT NULL THEN sti.unit_cost
          WHEN fp.cost_price IS NOT NULL AND fp.cost_price > 0 THEN fp.cost_price
          WHEN fp.price IS NOT NULL THEN fp.price
          ELSE 0
        END) AS lineAmount,
        css.id AS settlementId,
        css.settlement_no AS settlementNo,
        css.status AS settlementStatus,
        css.settlement_month AS settlementMonth
      FROM store_transfers st
      INNER JOIN store_transfer_items sti ON sti.transfer_id = st.id
      INNER JOIN stores fs ON fs.id = st.from_store_id
      INNER JOIN stores ts ON ts.id = st.to_store_id
      INNER JOIN company_stores hqcs ON hqcs.company_id = st.company_id
        AND hqcs.store_id = st.from_store_id
        AND hqcs.status = 'ACTIVE'
        AND hqcs.relationship_type IN ('HEADQUARTERS','WAREHOUSE')
      LEFT JOIN products fp ON fp.id = sti.from_product_id
      LEFT JOIN company_store_settlement_items cssi ON cssi.transfer_item_id = sti.id
      LEFT JOIN company_store_settlements css ON css.id = cssi.settlement_id
        AND css.status <> 'CANCELED'
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(st.shipped_at, st.created_at) DESC, st.id DESC, sti.id ASC
      LIMIT 2000
    `,
    params
  );

  const mappedRows = rows.map(mapTransferReportRow);
  return {
    startDate,
    endDate,
    rows: mappedRows,
    summary: buildTransferReportSummary(mappedRows)
  };
}

function buildTransferReportWorkbook({ rows, summary, startDate, endDate }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KINGWAY";
  const sheet = workbook.addWorksheet("本部出貨明細");
  sheet.columns = [
    { header: "出貨日期", key: "出貨日期", width: 14 },
    { header: "入庫日期", key: "入庫日期", width: 14 },
    { header: "出貨單號", key: "出貨單號", width: 24 },
    { header: "月結單號", key: "月結單號", width: 24 },
    { header: "出貨狀態", key: "出貨狀態", width: 16 },
    { header: "月結狀態", key: "月結狀態", width: 16 },
    { header: "本部", key: "本部", width: 22 },
    { header: "門市", key: "門市", width: 22 },
    { header: "SKU", key: "SKU", width: 18 },
    { header: "商品名稱", key: "商品名稱", width: 34 },
    { header: "出貨數量", key: "出貨數量", width: 12 },
    { header: "入庫數量", key: "入庫數量", width: 12 },
    { header: "本部批發價", key: "本部批發價", width: 14 },
    { header: "小計", key: "小計", width: 14 },
    { header: "備註", key: "備註", width: 32 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows.map((row) => ({
    出貨日期: formatReportDate(row.shippedAt),
    入庫日期: formatReportDate(row.receivedAt),
    出貨單號: row.transferNo,
    月結單號: row.settlementNo || "",
    出貨狀態: row.transferStatus,
    月結狀態: row.settlementStatus,
    本部: row.fromStoreName,
    門市: row.targetStoreName,
    SKU: row.sku,
    商品名稱: row.productName,
    出貨數量: row.quantityShipped,
    入庫數量: row.quantityReceived,
    本部批發價: row.unitCost,
    小計: row.lineAmount,
    備註: row.unitCostSource === "transfer_item" ? "" : `unit cost fallback: ${row.unitCostSource}`
  })));
  for (const key of ["出貨數量", "入庫數量", "本部批發價", "小計"]) {
    sheet.getColumn(key).numFmt = "#,##0";
  }
  const summaryStart = rows.length + 3;
  sheet.getCell(`A${summaryStart}`).value = `查詢期間 ${startDate} ~ ${endDate}`;
  sheet.getCell(`A${summaryStart}`).font = { bold: true };
  sheet.getCell(`A${summaryStart + 1}`).value = "明細筆數";
  sheet.getCell(`B${summaryStart + 1}`).value = summary.rowCount;
  sheet.getCell(`A${summaryStart + 2}`).value = "出貨總數";
  sheet.getCell(`B${summaryStart + 2}`).value = summary.totalQuantityShipped;
  sheet.getCell(`A${summaryStart + 3}`).value = "入庫總數";
  sheet.getCell(`B${summaryStart + 3}`).value = summary.totalQuantityReceived;
  sheet.getCell(`A${summaryStart + 4}`).value = "批發總額";
  sheet.getCell(`B${summaryStart + 4}`).value = summary.totalAmount;
  sheet.getColumn("B").numFmt = "#,##0";
  return workbook;
}

router.get("/", async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const requestedCompanyId = Number(req.query.companyId || 0);
    const view = String(req.query.view || "").trim().toLowerCase();
    const clauses = [];
    const params = [];

    if (requestedCompanyId) {
      const context = await loadCompanyContext(req, requestedCompanyId);
      if (context.canHqRead && view !== "payable") {
        clauses.push("css.company_id = ?");
        params.push(requestedCompanyId);
      } else if (storeId && await hasStoreAdminAccess(req.user.id, storeId)) {
        clauses.push("css.company_id = ? AND css.target_store_id = ?");
        params.push(requestedCompanyId, storeId);
      } else {
        return res.status(403).json({ message: "沒有月結資料權限" });
      }
    } else {
      const [memberships] = await pool.query(
        "SELECT company_id AS companyId, role FROM company_memberships WHERE staff_user_id = ? AND status = 'ACTIVE'",
        [req.user.id]
      );
      const hqCompanyIds = memberships.filter((row) => HQ_READ_ROLES.has(row.role)).map((row) => Number(row.companyId));
      if (hqCompanyIds.length && view !== "payable") {
        clauses.push(`css.company_id IN (${hqCompanyIds.map(() => "?").join(",")})`);
        params.push(...hqCompanyIds);
      }
      if (storeId && await hasStoreAdminAccess(req.user.id, storeId)) {
        clauses.push("css.target_store_id = ?");
        params.push(storeId);
      }
      if (!clauses.length) {
        return res.json({ ok: true, settlements: [] });
      }
    }

    const extraFilters = buildListFilters(req.query, params);
    const [rows] = await pool.query(
      `
        SELECT
          css.id,
          css.settlement_no AS settlementNo,
          css.company_id AS companyId,
          c.name AS companyName,
          css.hq_store_id AS hqStoreId,
          hs.name AS hqStoreName,
          css.target_store_id AS targetStoreId,
          ts.name AS targetStoreName,
          css.target_relationship_type AS targetRelationshipType,
          css.settlement_month AS settlementMonth,
          css.status,
          css.total_amount AS totalAmount,
          css.paid_amount AS paidAmount,
          css.confirmed_at AS confirmedAt,
          css.paid_at AS paidAt,
          css.note,
          GROUP_CONCAT(CONCAT(cssi.sku_snapshot, ' x', cssi.quantity_received) ORDER BY cssi.id SEPARATOR '；') AS itemSummary,
          css.created_at AS createdAt,
          css.updated_at AS updatedAt
        FROM company_store_settlements css
        INNER JOIN companies c ON c.id = css.company_id
        INNER JOIN stores hs ON hs.id = css.hq_store_id
        INNER JOIN stores ts ON ts.id = css.target_store_id
        LEFT JOIN company_store_settlement_items cssi ON cssi.settlement_id = css.id
        WHERE (${clauses.join(" OR ")})
          ${extraFilters.length ? `AND ${extraFilters.join(" AND ")}` : ""}
        GROUP BY css.id, c.name, hs.name, ts.name
        ORDER BY css.settlement_month DESC, css.id DESC
        LIMIT 200
      `,
      params
    );
    return res.json({ ok: true, settlements: rows.map(mapSettlement) });
  } catch (error) {
    return next(error);
  }
});

router.get("/monthly-summary", async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const companyId = Number(req.query.companyId || 0);
    const month = normalizeMonth(req.query.month);
    const params = [month];
    const clauses = ["css.settlement_month = ?"];

    if (companyId) {
      const context = await loadCompanyContext(req, companyId);
      if (context.canHqRead) {
        clauses.push("css.company_id = ?");
        params.push(companyId);
      } else if (storeId && await hasStoreAdminAccess(req.user.id, storeId)) {
        clauses.push("css.company_id = ? AND css.target_store_id = ?");
        params.push(companyId, storeId);
      } else {
        return res.status(403).json({ message: "沒有月結資料權限" });
      }
    } else if (storeId && await hasStoreAdminAccess(req.user.id, storeId)) {
      clauses.push("css.target_store_id = ?");
      params.push(storeId);
    }
    if (req.query.targetStoreId) {
      clauses.push("css.target_store_id = ?");
      params.push(Number(req.query.targetStoreId));
    }
    if (isExcludeDemoRequested(req.query.excludeDemo)) {
      appendSettlementDemoExclusion(clauses, params);
    }

    const [rows] = await pool.query(
      `
        SELECT
          css.target_store_id AS targetStoreId,
          ts.name AS targetStoreName,
          css.target_relationship_type AS targetRelationshipType,
          COUNT(*) AS settlementCount,
          SUM(css.total_amount) AS totalAmount,
          SUM(css.paid_amount) AS paidAmount,
          SUM(GREATEST(css.total_amount - css.paid_amount, 0)) AS unpaidAmount,
          SUM(CASE WHEN css.status = 'PAID' THEN 1 ELSE 0 END) AS paidCount,
          SUM(CASE WHEN css.status = 'PARTIALLY_PAID' THEN 1 ELSE 0 END) AS partiallyPaidCount,
          SUM(CASE WHEN css.status IN ('DRAFT','CONFIRMED') THEN 1 ELSE 0 END) AS unpaidCount
        FROM company_store_settlements css
        INNER JOIN stores ts ON ts.id = css.target_store_id
        WHERE ${clauses.join(" AND ")}
          AND css.status <> 'CANCELED'
        GROUP BY css.target_store_id, ts.name, css.target_relationship_type
        ORDER BY unpaidAmount DESC, ts.name ASC
      `,
      params
    );
    return res.json({
      ok: true,
      summary: rows.map((row) => ({
        targetStoreId: Number(row.targetStoreId),
        targetStoreName: row.targetStoreName,
        targetRelationshipType: row.targetRelationshipType,
        settlementCount: Number(row.settlementCount || 0),
        totalAmount: Number(row.totalAmount || 0),
        paidAmount: Number(row.paidAmount || 0),
        unpaidAmount: Number(row.unpaidAmount || 0),
        paidCount: Number(row.paidCount || 0),
        partiallyPaidCount: Number(row.partiallyPaidCount || 0),
        unpaidCount: Number(row.unpaidCount || 0)
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/transfer-report", async (req, res, next) => {
  try {
    const report = await queryTransferReportRows(req);
    if (String(req.query.export || "").trim().toLowerCase() === "xlsx") {
      const workbook = buildTransferReportWorkbook(report);
      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `kingway_hq_transfer_report_${report.startDate.replaceAll("-", "")}_${report.endDate.replaceAll("-", "")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
    return res.json({
      ok: true,
      rows: report.rows,
      summary: report.summary,
      filters: {
        fromDate: report.startDate,
        toDate: report.endDate
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const settlement = await loadSettlement(Number(req.params.id), req);
    if (!settlement) return res.status(404).json({ message: "找不到月結單" });
    settlement.items = await loadItems(settlement.id);
    return res.json({ ok: true, settlement });
  } catch (error) {
    return next(error);
  }
});

async function assertHqWrite(req, companyId, connection = pool) {
  const context = await loadCompanyContext(req, companyId, connection);
  if (!context.canHqWrite) {
    throw createError("沒有本部月結管理權限", 403);
  }
  return context;
}

async function loadTargetStore(companyId, targetStoreId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT cs.store_id AS storeId, cs.relationship_type AS relationshipType, s.name AS storeName
      FROM company_stores cs
      INNER JOIN stores s ON s.id = cs.store_id
      WHERE cs.company_id = ?
        AND cs.store_id = ?
        AND cs.status = 'ACTIVE'
        AND cs.relationship_type IN ('DIRECT_STORE','FRANCHISE_STORE')
      LIMIT 1
    `,
    [companyId, targetStoreId]
  );
  if (!rows[0]) throw createError("請選擇直營或加盟門市", 400);
  return rows[0];
}

router.post("/generate", async (req, res, next) => {
  try {
    const companyId = Number(req.body?.companyId || req.body?.company_id || 0);
    const targetStoreId = Number(req.body?.targetStoreId || req.body?.target_store_id || 0);
    const month = normalizeMonth(req.body?.month || req.body?.settlementMonth);
    if (!companyId || !targetStoreId) return res.status(400).json({ message: "請提供公司與門市" });

    const settlementId = await withTransaction(async (connection) => {
      await assertHqWrite(req, companyId, connection);
      const targetStore = await loadTargetStore(companyId, targetStoreId, connection);
      const [candidateRows] = await connection.query(
        `
          SELECT
            st.id AS transferId,
            st.from_store_id AS hqStoreId,
            st.to_store_id AS targetStoreId,
            COALESCE(st.received_at, st.updated_at) AS sourceReceivedAt,
            sti.id AS transferItemId,
            sti.to_product_id AS productId,
            sti.sku_snapshot AS sku,
            sti.product_name_snapshot AS productName,
            sti.quantity_received AS quantityReceived,
            sti.unit_cost AS unitPrice
          FROM store_transfers st
          INNER JOIN store_transfer_items sti ON sti.transfer_id = st.id
          INNER JOIN company_stores csh ON csh.company_id = st.company_id
            AND csh.store_id = st.from_store_id
            AND csh.status = 'ACTIVE'
            AND csh.relationship_type IN ('HEADQUARTERS','WAREHOUSE')
          LEFT JOIN company_store_settlement_items existing_item ON existing_item.transfer_item_id = sti.id
          LEFT JOIN company_store_settlements existing_settlement ON existing_settlement.id = existing_item.settlement_id
            AND existing_settlement.status IN (${FINAL_SETTLEMENT_STATUSES.map(() => "?").join(",")})
          WHERE st.company_id = ?
            AND st.to_store_id = ?
            AND st.status IN ('PARTIALLY_RECEIVED','RECEIVED')
            AND sti.quantity_received > 0
            AND DATE_FORMAT(COALESCE(st.received_at, st.updated_at), '%Y-%m') = ?
            AND existing_settlement.id IS NULL
          ORDER BY st.id ASC, sti.id ASC
          FOR UPDATE
        `,
        [...FINAL_SETTLEMENT_STATUSES, companyId, targetStoreId, month]
      );

      if (!candidateRows.length) {
        throw createError("此月份沒有可產生月結的入庫資料", 404);
      }
      const missingCost = candidateRows.find((row) => row.unitPrice === null || row.unitPrice === undefined);
      if (missingCost) {
        throw createError("調撥商品未設定結算單價，請先補上結算單價", 400);
      }

      const hqStoreId = Number(candidateRows[0].hqStoreId);
      const [draftRows] = await connection.query(
        `
          SELECT id
          FROM company_store_settlements
          WHERE company_id = ?
            AND target_store_id = ?
            AND settlement_month = ?
            AND status = 'DRAFT'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [companyId, targetStoreId, month]
      );

      let settlementId = Number(draftRows[0]?.id || 0);
      if (!settlementId) {
        const [result] = await connection.query(
          `
            INSERT INTO company_store_settlements
              (settlement_no, company_id, hq_store_id, target_store_id, target_relationship_type, settlement_month, generated_by_staff_id, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [makeSettlementNo(), companyId, hqStoreId, targetStoreId, targetStore.relationshipType, month, req.user.id, req.body?.note || null]
        );
        settlementId = result.insertId;
      } else {
        await connection.query("DELETE FROM company_store_settlement_items WHERE settlement_id = ?", [settlementId]);
        await connection.query(
          "UPDATE company_store_settlements SET hq_store_id = ?, target_relationship_type = ?, generated_by_staff_id = ?, note = COALESCE(?, note) WHERE id = ?",
          [hqStoreId, targetStore.relationshipType, req.user.id, req.body?.note || null, settlementId]
        );
      }

      let totalAmount = 0;
      for (const row of candidateRows) {
        const lineAmount = toMoney(Number(row.quantityReceived || 0) * Number(row.unitPrice || 0));
        totalAmount += lineAmount;
        await connection.query(
          `
            INSERT INTO company_store_settlement_items
              (settlement_id, transfer_id, transfer_item_id, product_id, sku_snapshot, product_name_snapshot, quantity_received, unit_price, line_amount, source_received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            settlementId,
            row.transferId,
            row.transferItemId,
            row.productId,
            row.sku,
            row.productName,
            row.quantityReceived,
            row.unitPrice,
            lineAmount,
            row.sourceReceivedAt
          ]
        );
      }
      await connection.query(
        "UPDATE company_store_settlements SET total_amount = ?, paid_amount = 0 WHERE id = ?",
        [toMoney(totalAmount), settlementId]
      );
      return settlementId;
    });

    const settlement = await loadSettlement(settlementId, req);
    settlement.items = await loadItems(settlementId);
    return res.status(201).json({ ok: true, settlement });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/confirm", async (req, res, next) => {
  try {
    const settlement = await loadSettlement(Number(req.params.id), req);
    if (!settlement) return res.status(404).json({ message: "找不到月結單" });
    await assertHqWrite(req, settlement.companyId);
    if (settlement.status !== "DRAFT") return res.status(409).json({ message: "只有草稿可確認月結" });
    await pool.query(
      "UPDATE company_store_settlements SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by_staff_id = ? WHERE id = ?",
      [req.user.id, settlement.id]
    );
    return res.json({ ok: true, settlement: await loadSettlement(settlement.id, req) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/mark-paid", async (req, res, next) => {
  try {
    const settlement = await loadSettlement(Number(req.params.id), req);
    if (!settlement) return res.status(404).json({ message: "找不到月結單" });
    await assertHqWrite(req, settlement.companyId);
    if (!["CONFIRMED", "PARTIALLY_PAID", "PAID"].includes(settlement.status)) {
      return res.status(409).json({ message: "請先確認月結" });
    }
    const paidAmount = toMoney(req.body?.paidAmount ?? req.body?.paid_amount ?? 0);
    if (paidAmount < 0) return res.status(400).json({ message: "付款金額不正確" });
    const nextStatus = paidAmount <= 0
      ? "CONFIRMED"
      : paidAmount >= Number(settlement.totalAmount || 0)
        ? "PAID"
        : "PARTIALLY_PAID";
    await pool.query(
      `
        UPDATE company_store_settlements
        SET paid_amount = ?,
            status = ?,
            paid_at = IF(? = 'PAID', COALESCE(?, NOW()), paid_at),
            paid_by_staff_id = ?,
            note = COALESCE(?, note)
        WHERE id = ?
      `,
      [paidAmount, nextStatus, nextStatus, req.body?.paidAt || req.body?.paid_at || null, req.user.id, req.body?.note || null, settlement.id]
    );
    return res.json({ ok: true, settlement: await loadSettlement(settlement.id, req) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cancel", async (req, res, next) => {
  try {
    const settlement = await loadSettlement(Number(req.params.id), req);
    if (!settlement) return res.status(404).json({ message: "找不到月結單" });
    await assertHqWrite(req, settlement.companyId);
    if (settlement.status !== "DRAFT") return res.status(409).json({ message: "只有草稿可取消" });
    await pool.query("UPDATE company_store_settlements SET status = 'CANCELED' WHERE id = ?", [settlement.id]);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
