const express = require("express");
const ExcelJS = require("exceljs");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireFeature } = require("../services/storeAccessService");
const { notifySupplierPurchaseOrderCreated } = require("../services/notificationEventService");
const { buildDemoKeywordCondition, buildDemoExclusionCondition, isExcludeDemoRequested } = require("../utils/demoDataFilter");

const router = express.Router();

const COMPANY_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const HQ_STORE_ROLES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const CHAIN_STORE_ROLES = new Set(["DIRECT_STORE", "FRANCHISE_STORE"]);
const OPEN_RECEIVE_STATUSES = new Set(["ORDERED", "PARTIALLY_RECEIVED"]);
const IDEMPOTENT_RECEIVE_STATUSES = new Set(["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"]);

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "INVENTORY"]), requireFeature("supplier_purchases"));
const requireStoreAdminRole = requireStoreRole(["owner", "admin"]);

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

function makeNo(prefix) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function resolveContext(req, connection = pool) {
  const storeId = Number(req.storeId || req.user?.storeId || 0);
  const [companyRows] = await connection.query(
    `
      SELECT
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cm.role AS companyRole
      FROM company_stores cs
      LEFT JOIN company_memberships cm
        ON cm.company_id = cs.company_id
       AND cm.staff_user_id = ?
       AND cm.status = 'ACTIVE'
      WHERE cs.status = 'ACTIVE'
        AND (cs.store_id = ? OR cm.id IS NOT NULL)
    `,
    [req.user?.id || 0, storeId]
  );
  const companyIds = [...new Set(companyRows.map((row) => Number(row.companyId)).filter(Boolean))];
  const writableCompanyIds = [...new Set(companyRows
    .filter((row) => COMPANY_WRITE_ROLES.has(row.companyRole))
    .map((row) => Number(row.companyId))
    .filter(Boolean))];
  const storeRolesByCompany = {};
  const currentStoreRelationships = [];
  for (const row of companyRows) {
    if (Number(row.storeId) === storeId) {
      storeRolesByCompany[Number(row.companyId)] = row.relationshipType;
      currentStoreRelationships.push(row.relationshipType);
    }
  }
  const isChainStore = currentStoreRelationships.some((role) => CHAIN_STORE_ROLES.has(role));
  const isHqStore = currentStoreRelationships.some((role) => HQ_STORE_ROLES.has(role));
  return {
    storeId,
    staffId: Number(req.user?.id || 0) || null,
    companyIds,
    writableCompanyIds,
    storeRolesByCompany,
    currentStoreRelationships,
    isChainStore,
    isHqStore,
    isIndependent: currentStoreRelationships.length === 0
  };
}

function buildPoAccessWhere(context, scope = "all", alias = "spo") {
  if (context.isChainStore) return { where: "1 = 0", params: [] };
  const clauses = [];
  const params = [];
  const normalizedScope = String(scope || "all").trim().toLowerCase();
  if ((normalizedScope === "all" || normalizedScope === "store") && context.storeId) {
    clauses.push(`${alias}.buyer_type = 'STORE' AND ${alias}.store_id = ?`);
    params.push(context.storeId);
  }
  if ((normalizedScope === "all" || normalizedScope === "company") && context.writableCompanyIds.length) {
    clauses.push(`${alias}.buyer_type = 'COMPANY' AND ${alias}.company_id IN (${context.writableCompanyIds.map(() => "?").join(",")})`);
    params.push(...context.writableCompanyIds);
  }
  if (!clauses.length) return { where: "1 = 0", params: [] };
  return { where: `(${clauses.map((clause) => `(${clause})`).join(" OR ")})`, params };
}

function buildSupplierReturnAccessWhere(context, alias = "sr") {
  if (context.isChainStore) return { where: "1 = 0", params: [] };
  const clauses = [];
  const params = [];
  if (context.storeId) {
    clauses.push(`(${alias}.owner_type = 'STORE' AND ${alias}.owner_store_id = ?)`);
    params.push(context.storeId);
  }
  if (context.writableCompanyIds.length) {
    clauses.push(`(${alias}.owner_type = 'COMPANY' AND ${alias}.owner_company_id IN (${context.writableCompanyIds.map(() => "?").join(",")}))`);
    params.push(...context.writableCompanyIds);
  }
  if (!clauses.length) return { where: "1 = 0", params: [] };
  return { where: `(${clauses.join(" OR ")})`, params };
}

function appendPurchaseDemoExclusion(filters, params) {
  filters.push(buildDemoExclusionCondition([
    "spo.po_no",
    "spo.note",
    "s.name",
    "s.note"
  ], params));
  filters.push(`
    NOT EXISTS (
      SELECT 1
      FROM supplier_purchase_order_items spoi_demo
      LEFT JOIN products p_demo ON p_demo.id = spoi_demo.product_id
      WHERE spoi_demo.purchase_order_id = spo.id
        AND ${buildDemoKeywordCondition([
          "spoi_demo.sku_snapshot",
          "spoi_demo.product_name_snapshot",
          "spoi_demo.note",
          "p_demo.sku",
          "p_demo.name",
          "p_demo.description",
          "p_demo.source"
        ], params)}
    )
  `);
  filters.push(`
    NOT EXISTS (
      SELECT 1
      FROM supplier_purchase_receipts spr_demo
      WHERE spr_demo.purchase_order_id = spo.id
        AND ${buildDemoKeywordCondition(["spr_demo.receipt_no", "spr_demo.note"], params)}
    )
  `);
}

function mapPurchaseOrder(row) {
  return {
    id: Number(row.id),
    poNo: row.poNo,
    supplierId: Number(row.supplierId),
    supplierName: row.supplierName || "",
    buyerType: row.buyerType,
    storeId: Number(row.storeId),
    storeName: row.storeName || "",
    companyId: row.companyId === null || row.companyId === undefined ? null : Number(row.companyId),
    companyName: row.companyName || "",
    status: row.status,
    paymentStatus: row.paymentStatus,
    settlementMonth: row.settlementMonth || "",
    totalOrderAmount: Number(row.totalOrderAmount || 0),
    totalReceivedAmount: Number(row.totalReceivedAmount || 0),
    paidAmount: Number(row.paidAmount || 0),
    orderedAt: row.orderedAt || null,
    firstReceivedAt: row.firstReceivedAt || null,
    fullyReceivedAt: row.fullyReceivedAt || null,
    paidAt: row.paidAt || null,
    note: row.note || "",
    itemSummary: row.itemSummary || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    canEdit: ["DRAFT", "ORDERED"].includes(row.status),
    canReceive: OPEN_RECEIVE_STATUSES.has(row.status),
    canPay: !["DRAFT", "CANCELED"].includes(row.status)
  };
}

function mapItem(row) {
  return {
    id: Number(row.id),
    purchaseOrderId: Number(row.purchaseOrderId),
    supplierId: Number(row.supplierId),
    productId: Number(row.productId),
    storeId: Number(row.storeId),
    sku: row.sku || "",
    productName: row.productName || "",
    quantityOrdered: Number(row.quantityOrdered || 0),
    quantityReceived: Number(row.quantityReceived || 0),
    unitCost: Number(row.unitCost || 0),
    lineOrderAmount: Number(row.lineOrderAmount || 0),
    lineReceivedAmount: Number(row.lineReceivedAmount || 0),
    stock: row.stock === undefined ? null : Number(row.stock || 0),
    note: row.note || ""
  };
}

function mapReceipt(row) {
  return {
    id: Number(row.id),
    receiptNo: row.receiptNo,
    purchaseOrderId: Number(row.purchaseOrderId),
    totalReceivedAmount: Number(row.totalReceivedAmount || 0),
    receivedByName: row.receivedByName || "",
    receivedAt: row.receivedAt || null,
    note: row.note || ""
  };
}

async function loadSupplier(supplierId, context, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        owner_type AS ownerType,
        owner_store_id AS ownerStoreId,
        owner_company_id AS ownerCompanyId,
        name,
        status,
        is_active AS isActive,
        deleted_at AS deletedAt
      FROM suppliers
      WHERE id = ?
      LIMIT 1
    `,
    [supplierId]
  );
  const supplier = rows[0];
  if (!supplier || !supplier.isActive || supplier.deletedAt) {
    throw createError("找不到可用供應商", 404);
  }
  if (supplier.ownerType === "STORE") {
    if (context.isChainStore) {
      throw createError("直營或加盟門市不可使用供應商發注，請使用門市請貨流程", 403);
    }
    if (Number(supplier.ownerStoreId || supplier.storeId) !== Number(context.storeId)) {
      throw createError("沒有此供應商權限", 403);
    }
    return supplier;
  }
  if (supplier.ownerType === "COMPANY") {
    if (!context.writableCompanyIds.includes(Number(supplier.ownerCompanyId))) {
      throw createError("公司供應商發注需由本部權限建立", 403);
    }
    return supplier;
  }
  throw createError("平台供應商暫不開放發注", 403);
}

async function requireSupplierPurchaseStoreType(req, res, next) {
  try {
    const context = await resolveContext(req);
    if (context.isChainStore) {
      return res.status(403).json({ message: "直營或加盟門市不可使用供應商發注，請使用門市請貨流程" });
    }
    req.supplierPurchaseContext = context;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(requireSupplierPurchaseStoreType);

async function assertCompanyHqStore(companyId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT cs.store_id AS storeId, cs.relationship_type AS relationshipType
      FROM company_stores cs
      WHERE cs.company_id = ?
        AND cs.store_id = ?
        AND cs.status = 'ACTIVE'
      LIMIT 1
    `,
    [companyId, storeId]
  );
  const row = rows[0];
  if (!row || !HQ_STORE_ROLES.has(row.relationshipType)) {
    throw createError("公司供應商只能由本部或倉庫門市入庫", 403);
  }
  return row;
}

async function assertProductForPo(productId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, store_id AS storeId, sku, name, stock, cost_price AS costPrice
      FROM products
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [productId, storeId]
  );
  if (!rows[0]) {
    throw createError("商品不屬於此入庫門市", 403);
  }
  return rows[0];
}

async function loadUnitCost(supplierId, productId, storeId, fallbackCost, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT default_unit_cost AS defaultUnitCost, last_unit_cost AS lastUnitCost
      FROM supplier_product_prices
      WHERE supplier_id = ?
        AND product_id = ?
        AND store_id = ?
        AND is_active = 1
      LIMIT 1
    `,
    [supplierId, productId, storeId]
  );
  const price = rows[0];
  if (!price) return toMoney(fallbackCost);
  return toMoney(price.defaultUnitCost || price.lastUnitCost || fallbackCost);
}

async function loadPurchaseOrder(id, context, connection = pool) {
  const access = buildPoAccessWhere(context);
  const [rows] = await connection.query(
    `
      SELECT
        spo.id,
        spo.po_no AS poNo,
        spo.supplier_id AS supplierId,
        s.name AS supplierName,
        spo.buyer_type AS buyerType,
        spo.store_id AS storeId,
        st.name AS storeName,
        spo.company_id AS companyId,
        c.name AS companyName,
        spo.status,
        spo.payment_status AS paymentStatus,
        spo.settlement_month AS settlementMonth,
        spo.total_order_amount AS totalOrderAmount,
        spo.total_received_amount AS totalReceivedAmount,
        spo.paid_amount AS paidAmount,
        spo.ordered_at AS orderedAt,
        spo.first_received_at AS firstReceivedAt,
        spo.fully_received_at AS fullyReceivedAt,
        spo.paid_at AS paidAt,
        spo.note,
        spo.created_at AS createdAt,
        spo.updated_at AS updatedAt
      FROM supplier_purchase_orders spo
      INNER JOIN suppliers s ON s.id = spo.supplier_id
      INNER JOIN stores st ON st.id = spo.store_id
      LEFT JOIN companies c ON c.id = spo.company_id
      WHERE spo.id = ?
        AND ${access.where}
      LIMIT 1
    `,
    [id, ...access.params]
  );
  return rows[0] ? mapPurchaseOrder(rows[0]) : null;
}

async function loadItems(purchaseOrderId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        spoi.id,
        spoi.purchase_order_id AS purchaseOrderId,
        spoi.supplier_id AS supplierId,
        spoi.product_id AS productId,
        spoi.store_id AS storeId,
        spoi.sku_snapshot AS sku,
        spoi.product_name_snapshot AS productName,
        spoi.quantity_ordered AS quantityOrdered,
        spoi.quantity_received AS quantityReceived,
        spoi.unit_cost AS unitCost,
        spoi.line_order_amount AS lineOrderAmount,
        spoi.line_received_amount AS lineReceivedAmount,
        spoi.note,
        p.stock
      FROM supplier_purchase_order_items spoi
      INNER JOIN products p ON p.id = spoi.product_id
      WHERE spoi.purchase_order_id = ?
      ORDER BY spoi.id ASC
    `,
    [purchaseOrderId]
  );
  return rows.map(mapItem);
}

async function loadReceipts(purchaseOrderId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        spr.id,
        spr.receipt_no AS receiptNo,
        spr.purchase_order_id AS purchaseOrderId,
        spr.total_received_amount AS totalReceivedAmount,
        su.display_name AS receivedByName,
        spr.received_at AS receivedAt,
        spr.note
      FROM supplier_purchase_receipts spr
      LEFT JOIN staff_users su ON su.id = spr.received_by_staff_id
      WHERE spr.purchase_order_id = ?
      ORDER BY spr.id DESC
    `,
    [purchaseOrderId]
  );
  return rows.map(mapReceipt);
}

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const access = buildPoAccessWhere(context, req.query.scope || "all");
    const params = [...access.params];
    const filters = [];
    if (req.query.supplierId) {
      filters.push("spo.supplier_id = ?");
      params.push(Number(req.query.supplierId));
    }
    if (req.query.storeId) {
      filters.push("spo.store_id = ?");
      params.push(Number(req.query.storeId));
    }
    if (req.query.status) {
      filters.push("spo.status = ?");
      params.push(String(req.query.status).toUpperCase());
    }
    if (req.query.paymentStatus) {
      filters.push("spo.payment_status = ?");
      params.push(String(req.query.paymentStatus).toUpperCase());
    }
    if (req.query.month) {
      filters.push("spo.settlement_month = ?");
      params.push(normalizeMonth(req.query.month));
    }
    if (isExcludeDemoRequested(req.query.excludeDemo)) {
      appendPurchaseDemoExclusion(filters, params);
    }

    const [rows] = await pool.query(
      `
        SELECT
          spo.id,
          spo.po_no AS poNo,
          spo.supplier_id AS supplierId,
          s.name AS supplierName,
          spo.buyer_type AS buyerType,
          spo.store_id AS storeId,
          st.name AS storeName,
          spo.company_id AS companyId,
          c.name AS companyName,
          spo.status,
          spo.payment_status AS paymentStatus,
          spo.settlement_month AS settlementMonth,
          spo.total_order_amount AS totalOrderAmount,
          spo.total_received_amount AS totalReceivedAmount,
          spo.paid_amount AS paidAmount,
          spo.ordered_at AS orderedAt,
          spo.first_received_at AS firstReceivedAt,
          spo.fully_received_at AS fullyReceivedAt,
          spo.paid_at AS paidAt,
          spo.note,
          GROUP_CONCAT(CONCAT(spoi.sku_snapshot, ' x', spoi.quantity_ordered, IF(spoi.quantity_received > 0, CONCAT(' / 已入庫 ', spoi.quantity_received), '')) ORDER BY spoi.id SEPARATOR '；') AS itemSummary,
          spo.created_at AS createdAt,
          spo.updated_at AS updatedAt
        FROM supplier_purchase_orders spo
        INNER JOIN suppliers s ON s.id = spo.supplier_id
        INNER JOIN stores st ON st.id = spo.store_id
        LEFT JOIN companies c ON c.id = spo.company_id
        LEFT JOIN supplier_purchase_order_items spoi ON spoi.purchase_order_id = spo.id
        WHERE ${access.where}
          ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
        GROUP BY spo.id, s.name, st.name, c.name
        ORDER BY spo.id DESC
        LIMIT 200
      `,
      params
    );
    return res.json(rows.map(mapPurchaseOrder));
  } catch (error) {
    return next(error);
  }
});

router.get("/monthly-summary", async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const access = buildPoAccessWhere(context, req.query.scope || "all");
    const month = normalizeMonth(req.query.month);
    const params = [...access.params, month];
    const filters = [];
    if (isExcludeDemoRequested(req.query.excludeDemo)) {
      appendPurchaseDemoExclusion(filters, params);
    }
    const [rows] = await pool.query(
      `
        SELECT
          spo.supplier_id AS supplierId,
          s.name AS supplierName,
          spo.settlement_month AS settlementMonth,
          COUNT(DISTINCT spo.id) AS poCount,
          SUM(COALESCE(rc.receiptCount, 0)) AS receiptCount,
          SUM(spo.total_received_amount) AS totalReceivedAmount,
          SUM(spo.paid_amount) AS paidAmount,
          SUM(GREATEST(spo.total_received_amount - spo.paid_amount, 0)) AS unpaidAmount,
          SUM(CASE WHEN spo.payment_status = 'PAID' THEN 1 ELSE 0 END) AS paidPoCount,
          SUM(CASE WHEN spo.payment_status <> 'PAID' THEN 1 ELSE 0 END) AS unpaidPoCount
        FROM supplier_purchase_orders spo
        INNER JOIN suppliers s ON s.id = spo.supplier_id
        LEFT JOIN (
          SELECT purchase_order_id, COUNT(*) AS receiptCount
          FROM supplier_purchase_receipts
          GROUP BY purchase_order_id
        ) rc ON rc.purchase_order_id = spo.id
        WHERE ${access.where}
          AND spo.settlement_month = ?
          AND spo.status <> 'CANCELED'
          ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
        GROUP BY spo.supplier_id, s.name, spo.settlement_month
        ORDER BY unpaidAmount DESC, s.name ASC
      `,
      params
    );
    return res.json(rows.map((row) => ({
      supplierId: Number(row.supplierId),
      supplierName: row.supplierName,
      settlementMonth: row.settlementMonth,
      poCount: Number(row.poCount || 0),
      receiptCount: Number(row.receiptCount || 0),
      totalReceivedAmount: Number(row.totalReceivedAmount || 0),
      paidAmount: Number(row.paidAmount || 0),
      unpaidAmount: Number(row.unpaidAmount || 0),
      paidPoCount: Number(row.paidPoCount || 0),
      unpaidPoCount: Number(row.unpaidPoCount || 0)
    })));
  } catch (error) {
    return next(error);
  }
});

function normalizeReportDate(value, fallback) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return fallback;
}

function buildSupplierSettlementSummary(rows) {
  const supplierMap = new Map();
  const summary = {
    purchaseAmount: 0,
    returnAmount: 0,
    netAmount: 0,
    purchaseQuantity: 0,
    returnQuantity: 0,
    rowCount: rows.length
  };

  for (const row of rows) {
    const current = supplierMap.get(row.supplierId) || {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      purchaseAmount: 0,
      returnAmount: 0,
      netAmount: 0,
      purchaseQuantity: 0,
      returnQuantity: 0,
      rowCount: 0
    };
    if (row.type === "PURCHASE_RECEIPT") {
      summary.purchaseAmount += row.amount;
      summary.purchaseQuantity += row.quantity;
      current.purchaseAmount += row.amount;
      current.purchaseQuantity += row.quantity;
    } else {
      summary.returnAmount += row.amount;
      summary.returnQuantity += row.quantity;
      current.returnAmount += row.amount;
      current.returnQuantity += row.quantity;
    }
    current.rowCount += 1;
    current.netAmount = toMoney(current.purchaseAmount - current.returnAmount);
    supplierMap.set(row.supplierId, current);
  }
  summary.purchaseAmount = toMoney(summary.purchaseAmount);
  summary.returnAmount = toMoney(summary.returnAmount);
  summary.netAmount = toMoney(summary.purchaseAmount - summary.returnAmount);
  return {
    summary,
    supplierSummary: Array.from(supplierMap.values())
      .map((row) => ({
        ...row,
        purchaseAmount: toMoney(row.purchaseAmount),
        returnAmount: toMoney(row.returnAmount),
        netAmount: toMoney(row.netAmount)
      }))
      .sort((a, b) => b.netAmount - a.netAmount || a.supplierName.localeCompare(b.supplierName))
  };
}

function buildSupplierSettlementWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const detailSheet = workbook.addWorksheet("供應商月結明細");
  detailSheet.columns = [
    { header: "日期", key: "date", width: 14 },
    { header: "類型", key: "typeLabel", width: 14 },
    { header: "單號", key: "documentNo", width: 24 },
    { header: "供應商", key: "supplierName", width: 24 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "商品名稱", key: "productName", width: 30 },
    { header: "數量", key: "quantity", width: 10 },
    { header: "單價", key: "unitCost", width: 12 },
    { header: "金額", key: "amount", width: 14 },
    { header: "正負金額", key: "signedAmount", width: 14 },
    { header: "狀態", key: "status", width: 18 },
    { header: "結算狀態", key: "settlementStatus", width: 18 },
    { header: "備註", key: "note", width: 30 }
  ];
  report.rows.forEach((row) => detailSheet.addRow({
    ...row,
    typeLabel: row.type === "SUPPLIER_RETURN" ? "退貨" : "入庫"
  }));
  detailSheet.getRow(1).font = { bold: true };

  const summarySheet = workbook.addWorksheet("供應商彙總");
  summarySheet.columns = [
    { header: "供應商", key: "supplierName", width: 24 },
    { header: "入庫金額", key: "purchaseAmount", width: 14 },
    { header: "退貨金額", key: "returnAmount", width: 14 },
    { header: "淨應付金額", key: "netAmount", width: 14 },
    { header: "入庫數量", key: "purchaseQuantity", width: 12 },
    { header: "退貨數量", key: "returnQuantity", width: 12 },
    { header: "明細筆數", key: "rowCount", width: 12 }
  ];
  report.supplierSummary.forEach((row) => summarySheet.addRow(row));
  summarySheet.getRow(1).font = { bold: true };
  return workbook;
}

async function buildSupplierSettlementReport(context, query = {}) {
  if (context.isChainStore) {
    throw createError("直營或加盟門市不可查看供應商月結報表", 403);
  }
  const fromDate = normalizeReportDate(query.fromDate, `${new Date().toISOString().slice(0, 7)}-01`);
  const toDate = normalizeReportDate(query.toDate, new Date().toISOString().slice(0, 10));
  const status = String(query.status || "ALL").trim().toUpperCase();
  const supplierId = Number(query.supplierId || 0);

  const purchaseAccess = buildPoAccessWhere(context, "all", "spo");
  const purchaseFilters = [
    purchaseAccess.where,
    "spo.status <> 'CANCELED'",
    "DATE(spr.received_at) >= ?",
    "DATE(spr.received_at) <= ?"
  ];
  const purchaseParams = [...purchaseAccess.params, fromDate, toDate];
  if (supplierId) {
    purchaseFilters.push("spo.supplier_id = ?");
    purchaseParams.push(supplierId);
  }
  if (status !== "ALL") {
    purchaseFilters.push("(spo.status = ? OR spo.payment_status = ?)");
    purchaseParams.push(status, status);
  }

  const [purchaseRows] = await pool.query(
    `
      SELECT
        DATE(spr.received_at) AS rowDate,
        spr.receipt_no AS documentNo,
        spo.supplier_id AS supplierId,
        s.name AS supplierName,
        spoi.sku_snapshot AS sku,
        spoi.product_name_snapshot AS productName,
        spri.quantity_received_delta AS quantity,
        spri.unit_cost AS unitCost,
        spri.line_received_amount AS amount,
        spo.status,
        spo.payment_status AS settlementStatus,
        COALESCE(spr.note, spoi.note, spo.note) AS note
      FROM supplier_purchase_receipts spr
      INNER JOIN supplier_purchase_orders spo ON spo.id = spr.purchase_order_id
      INNER JOIN suppliers s ON s.id = spo.supplier_id
      INNER JOIN supplier_purchase_receipt_items spri ON spri.receipt_id = spr.id
      INNER JOIN supplier_purchase_order_items spoi ON spoi.id = spri.purchase_order_item_id
      WHERE ${purchaseFilters.join(" AND ")}
    `,
    purchaseParams
  );

  const returnAccess = buildSupplierReturnAccessWhere(context, "sr");
  const returnFilters = [
    returnAccess.where,
    "sr.status IN ('SHIPPED', 'RECEIVED_BY_SUPPLIER', 'SETTLED')",
    "DATE(COALESCE(sr.shipped_at, sr.return_date, sr.created_at)) >= ?",
    "DATE(COALESCE(sr.shipped_at, sr.return_date, sr.created_at)) <= ?"
  ];
  const returnParams = [...returnAccess.params, fromDate, toDate];
  if (supplierId) {
    returnFilters.push("sr.supplier_id = ?");
    returnParams.push(supplierId);
  }
  if (status !== "ALL") {
    returnFilters.push("sr.status = ?");
    returnParams.push(status);
  }

  const [returnRows] = await pool.query(
    `
      SELECT
        DATE(COALESCE(sr.shipped_at, sr.return_date, sr.created_at)) AS rowDate,
        sr.return_no AS documentNo,
        sr.supplier_id AS supplierId,
        s.name AS supplierName,
        sri.sku,
        sri.product_name AS productName,
        sri.quantity,
        sri.unit_cost AS unitCost,
        sri.line_amount AS amount,
        sr.status,
        sr.status AS settlementStatus,
        COALESCE(sri.reason, sr.note) AS note
      FROM supplier_returns sr
      INNER JOIN suppliers s ON s.id = sr.supplier_id
      INNER JOIN supplier_return_items sri ON sri.return_id = sr.id
      WHERE ${returnFilters.join(" AND ")}
    `,
    returnParams
  );

  const rows = [
    ...purchaseRows.map((row) => {
      const amount = toMoney(row.amount);
      return {
        date: row.rowDate,
        type: "PURCHASE_RECEIPT",
        documentNo: row.documentNo,
        supplierId: Number(row.supplierId),
        supplierName: row.supplierName || "",
        sku: row.sku || "",
        productName: row.productName || "",
        quantity: Number(row.quantity || 0),
        unitCost: Number(row.unitCost || 0),
        amount,
        signedAmount: amount,
        status: row.status,
        settlementStatus: row.settlementStatus,
        note: row.note || ""
      };
    }),
    ...returnRows.map((row) => {
      const amount = toMoney(row.amount);
      return {
        date: row.rowDate,
        type: "SUPPLIER_RETURN",
        documentNo: row.documentNo,
        supplierId: Number(row.supplierId),
        supplierName: row.supplierName || "",
        sku: row.sku || "",
        productName: row.productName || "",
        quantity: Number(row.quantity || 0),
        unitCost: Number(row.unitCost || 0),
        amount,
        signedAmount: toMoney(-amount),
        status: row.status,
        settlementStatus: row.settlementStatus,
        note: row.note || ""
      };
    })
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.documentNo || "").localeCompare(String(a.documentNo || "")));

  const { summary, supplierSummary } = buildSupplierSettlementSummary(rows);
  return { rows, summary, supplierSummary, filters: { fromDate, toDate } };
}

router.get("/settlement-report", async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const report = await buildSupplierSettlementReport(context, req.query);
    if (String(req.query.export || "").toLowerCase() === "xlsx") {
      const workbook = buildSupplierSettlementWorkbook(report);
      const from = report.filters.fromDate.replaceAll("-", "");
      const to = report.filters.toDate.replaceAll("-", "");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=\"kingway_supplier_settlement_report_${from}_${to}.xlsx\"`);
      await workbook.xlsx.write(res);
      return res.end();
    }
    return res.json(report);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const purchaseOrder = await loadPurchaseOrder(Number(req.params.id), context);
    if (!purchaseOrder) return res.status(404).json({ message: "找不到供應商發注單" });
    purchaseOrder.items = await loadItems(purchaseOrder.id);
    purchaseOrder.receipts = await loadReceipts(purchaseOrder.id);
    return res.json(purchaseOrder);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const purchaseOrderId = await withTransaction(async (connection) => {
      const supplierId = Number(req.body?.supplierId || req.body?.supplier_id || 0);
      const storeId = Number(req.body?.storeId || req.body?.store_id || context.storeId || 0);
      const supplier = await loadSupplier(supplierId, context, connection);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) throw createError("請至少加入一個發注商品", 400);

      let buyerType = "STORE";
      let companyId = null;
      if (supplier.ownerType === "STORE") {
        if (Number(storeId) !== Number(context.storeId) || Number(supplier.ownerStoreId || supplier.storeId) !== Number(storeId)) {
          throw createError("本店供應商只能發注到本店", 403);
        }
      } else if (supplier.ownerType === "COMPANY") {
        buyerType = "COMPANY";
        companyId = Number(supplier.ownerCompanyId);
        await assertCompanyHqStore(companyId, storeId, connection);
      }

      const poNo = makeNo("SPO");
      const [insertResult] = await connection.query(
        `
          INSERT INTO supplier_purchase_orders
            (po_no, supplier_id, buyer_type, store_id, company_id, settlement_month, created_by_staff_id, updated_by_staff_id, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [poNo, supplierId, buyerType, storeId, companyId, normalizeMonth(req.body?.settlementMonth || req.body?.settlement_month), context.staffId, context.staffId, req.body?.note || null]
      );

      let total = 0;
      for (const rawItem of items) {
        const productId = Number(rawItem.productId || rawItem.product_id || 0);
        const quantityOrdered = Number(rawItem.quantityOrdered || rawItem.quantity_ordered || rawItem.quantity || 0);
        if (!Number.isSafeInteger(quantityOrdered) || quantityOrdered <= 0) {
          throw createError("發注數量不正確", 400);
        }
        const product = await assertProductForPo(productId, storeId, connection);
        const fallbackCost = await loadUnitCost(supplierId, productId, storeId, product.costPrice, connection);
        const unitCost = rawItem.unitCost === undefined && rawItem.unit_cost === undefined
          ? fallbackCost
          : toMoney(rawItem.unitCost ?? rawItem.unit_cost);
        const lineAmount = toMoney(quantityOrdered * unitCost);
        total += lineAmount;
        await connection.query(
          `
            INSERT INTO supplier_purchase_order_items
              (purchase_order_id, supplier_id, product_id, store_id, sku_snapshot, product_name_snapshot, quantity_ordered, unit_cost, line_order_amount, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [insertResult.insertId, supplierId, productId, storeId, product.sku || null, product.name, quantityOrdered, unitCost, lineAmount, rawItem.note || null]
        );
      }
      await connection.query(
        "UPDATE supplier_purchase_orders SET total_order_amount = ? WHERE id = ?",
        [toMoney(total), insertResult.insertId]
      );
      return insertResult.insertId;
    });

    const purchaseOrder = await loadPurchaseOrder(purchaseOrderId, await resolveContext(req));
    purchaseOrder.items = await loadItems(purchaseOrderId);
    notifySupplierPurchaseOrderCreated(purchaseOrder).catch((notificationError) => {
      console.warn("[notification-event] SUPPLIER_PURCHASE_ORDER_CREATED failed", {
        purchaseOrderId,
        poNo: purchaseOrder.poNo,
        message: notificationError.message
      });
    });
    return res.status(201).json(purchaseOrder);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/order", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const id = Number(req.params.id);
    const purchaseOrder = await loadPurchaseOrder(id, context);
    if (!purchaseOrder) return res.status(404).json({ message: "找不到供應商發注單" });
    if (purchaseOrder.status !== "DRAFT") return res.status(409).json({ message: "只有草稿可確認發注" });
    await pool.query(
      "UPDATE supplier_purchase_orders SET status = 'ORDERED', ordered_at = NOW(), updated_by_staff_id = ? WHERE id = ?",
      [context.staffId, id]
    );
    return res.json(await loadPurchaseOrder(id, context));
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/receive", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const id = Number(req.params.id);
    const result = await withTransaction(async (connection) => {
      const access = buildPoAccessWhere(context);
      const [poRows] = await connection.query(
        `SELECT * FROM supplier_purchase_orders spo WHERE spo.id = ? AND ${access.where} FOR UPDATE`,
        [id, ...access.params]
      );
      const po = poRows[0];
      if (!po) throw createError("找不到供應商發注單", 404);

      const inputItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!inputItems.length) throw createError("請輸入入庫數量", 400);
      const inputById = new Map(inputItems.map((item) => [Number(item.itemId || item.id || item.purchaseOrderItemId), item]));
      const [items] = await connection.query("SELECT * FROM supplier_purchase_order_items WHERE purchase_order_id = ? FOR UPDATE", [id]);
      if (!items.length) throw createError("找不到發注商品明細", 404);

      let hasInputChange = false;
      for (const item of items) {
        const input = inputById.get(Number(item.id));
        if (!input) continue;

        const ordered = Number(item.quantity_ordered || 0);
        const currentReceived = Number(item.quantity_received || 0);
        const nextReceived = Number(input.quantityReceived ?? input.quantity_received ?? input.receivedQuantity ?? currentReceived);
        if (!Number.isSafeInteger(nextReceived) || nextReceived < currentReceived || nextReceived > ordered) {
          throw createError("入庫累計數量不正確", 400);
        }
        if (nextReceived > currentReceived) {
          hasInputChange = true;
        }
      }

      if (!hasInputChange) {
        if (!IDEMPOTENT_RECEIVE_STATUSES.has(po.status)) {
          throw createError("此發注單目前不可入庫", 409);
        }
        return { id, idempotent: true, noOp: true, message: "入庫數量未變更" };
      }

      if (!OPEN_RECEIVE_STATUSES.has(po.status)) {
        if (po.status === "RECEIVED") {
          throw createError("此發注單已完成入庫，無法增加入庫數量", 409);
        }
        throw createError("此發注單目前不可入庫", 409);
      }

      let totalOrderedQty = 0;
      let totalReceivedQty = 0;
      let receiptAmount = 0;
      let changed = false;
      const receiptLines = [];

      for (const item of items) {
        const input = inputById.get(Number(item.id));
        const ordered = Number(item.quantity_ordered || 0);
        const currentReceived = Number(item.quantity_received || 0);
        let nextReceived = currentReceived;
        if (input) {
          nextReceived = Number(input.quantityReceived ?? input.quantity_received ?? input.receivedQuantity ?? currentReceived);
          if (!Number.isSafeInteger(nextReceived) || nextReceived < currentReceived || nextReceived > ordered) {
            throw createError("入庫累計數量不正確", 400);
          }
        }
        const delta = nextReceived - currentReceived;
        if (delta > 0) {
          const lineReceivedAmount = toMoney(nextReceived * Number(item.unit_cost || 0));
          const deltaAmount = toMoney(delta * Number(item.unit_cost || 0));
          await connection.query(
            "UPDATE supplier_purchase_order_items SET quantity_received = ?, line_received_amount = ? WHERE id = ?",
            [nextReceived, lineReceivedAmount, item.id]
          );
          await connection.query("UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?", [delta, item.product_id, po.store_id]);
          await connection.query(
            `
              INSERT INTO inventory_movements
                (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
              VALUES (?, ?, 'IN', ?, 'SUPPLIER_PURCHASE', ?, ?, ?)
            `,
            [po.store_id, item.product_id, delta, id, context.staffId, "供應商入庫確認 / supplier receipt"]
          );
          receiptLines.push({ item, delta, deltaAmount });
          receiptAmount += deltaAmount;
          changed = true;
        }
        totalOrderedQty += ordered;
        totalReceivedQty += nextReceived;
      }

      if (!changed) {
        return { id, idempotent: true };
      }

      const [receiptResult] = await connection.query(
        `
          INSERT INTO supplier_purchase_receipts
            (receipt_no, purchase_order_id, supplier_id, store_id, company_id, total_received_amount, received_by_staff_id, received_at, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
        `,
        [makeNo("SPR"), id, po.supplier_id, po.store_id, po.company_id || null, toMoney(receiptAmount), context.staffId, req.body?.note || null]
      );
      for (const line of receiptLines) {
        await connection.query(
          `
            INSERT INTO supplier_purchase_receipt_items
              (receipt_id, purchase_order_item_id, product_id, quantity_received_delta, unit_cost, line_received_amount)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [receiptResult.insertId, line.item.id, line.item.product_id, line.delta, line.item.unit_cost, line.deltaAmount]
        );
      }

      const [[summary]] = await connection.query(
        `
          SELECT
            SUM(line_received_amount) AS totalReceivedAmount,
            SUM(quantity_ordered) AS totalOrderedQty,
            SUM(quantity_received) AS totalReceivedQty
          FROM supplier_purchase_order_items
          WHERE purchase_order_id = ?
        `,
        [id]
      );
      const nextStatus = Number(summary.totalReceivedQty || 0) >= Number(summary.totalOrderedQty || 0) ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await connection.query(
        `
          UPDATE supplier_purchase_orders
          SET status = ?,
              total_received_amount = ?,
              first_received_at = COALESCE(first_received_at, NOW()),
              fully_received_at = IF(? = 'RECEIVED', NOW(), fully_received_at),
              updated_by_staff_id = ?
          WHERE id = ?
        `,
        [nextStatus, toMoney(summary.totalReceivedAmount), nextStatus, context.staffId, id]
      );
      return { id, idempotent: false };
    });

    const purchaseOrder = await loadPurchaseOrder(result.id, context);
    purchaseOrder.items = await loadItems(result.id);
    purchaseOrder.receipts = await loadReceipts(result.id);
    purchaseOrder.idempotent = result.idempotent;
    if (result.noOp) {
      purchaseOrder.noOp = true;
      purchaseOrder.message = result.message;
    }
    return res.json(purchaseOrder);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/mark-paid", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const id = Number(req.params.id);
    const purchaseOrder = await loadPurchaseOrder(id, context);
    if (!purchaseOrder) return res.status(404).json({ message: "找不到供應商發注單" });
    if (purchaseOrder.status === "DRAFT" || purchaseOrder.status === "CANCELED") {
      return res.status(409).json({ message: "此發注單目前不可付款" });
    }
    const paidAmount = toMoney(req.body?.paidAmount ?? req.body?.paid_amount ?? 0);
    if (paidAmount < 0) return res.status(400).json({ message: "付款金額不正確" });
    const totalReceived = Number(purchaseOrder.totalReceivedAmount || 0);
    const paymentStatus = paidAmount <= 0 ? "UNPAID" : paidAmount >= totalReceived ? "PAID" : "PARTIALLY_PAID";
    await pool.query(
      `
        UPDATE supplier_purchase_orders
        SET paid_amount = ?,
            payment_status = ?,
            paid_at = IF(? = 'PAID', COALESCE(?, NOW()), paid_at),
            updated_by_staff_id = ?,
            note = COALESCE(?, note)
        WHERE id = ?
      `,
      [paidAmount, paymentStatus, paymentStatus, req.body?.paidAt || req.body?.paid_at || null, context.staffId, req.body?.note || null, id]
    );
    return res.json(await loadPurchaseOrder(id, context));
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cancel", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = await resolveContext(req);
    const id = Number(req.params.id);
    const purchaseOrder = await loadPurchaseOrder(id, context);
    if (!purchaseOrder) return res.status(404).json({ message: "找不到供應商發注單" });
    if (!["DRAFT", "ORDERED"].includes(purchaseOrder.status)) {
      return res.status(409).json({ message: "此發注單不可取消" });
    }
    const [[summary]] = await pool.query(
      "SELECT COALESCE(SUM(quantity_received), 0) AS receivedQty FROM supplier_purchase_order_items WHERE purchase_order_id = ?",
      [id]
    );
    if (Number(summary.receivedQty || 0) > 0) {
      return res.status(409).json({ message: "已有入庫紀錄，不能取消" });
    }
    await pool.query(
      "UPDATE supplier_purchase_orders SET status = 'CANCELED', updated_by_staff_id = ? WHERE id = ?",
      [context.staffId, id]
    );
    return res.json(await loadPurchaseOrder(id, context));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
