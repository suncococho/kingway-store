const express = require("express");
const ExcelJS = require("exceljs");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireFeature } = require("../services/storeAccessService");
const {
  notifySupplierReturnCreated,
  notifySupplierReturnShipped
} = require("../services/notificationEventService");
const { createKpiEventOnce } = require("../services/staffKpiService");

const router = express.Router();

const COMPANY_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const HQ_STORE_ROLES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const CHAIN_STORE_ROLES = new Set(["DIRECT_STORE", "FRANCHISE_STORE"]);
const RETURN_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED", "SHIPPED", "RECEIVED_BY_SUPPLIER", "SETTLED", "CANCELED"]);

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "INVENTORY"]), requireFeature("suppliers"));
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

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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
  const currentStoreRelationships = companyRows
    .filter((row) => Number(row.storeId) === storeId)
    .map((row) => row.relationshipType);
  const currentHqCompanyIds = [...new Set(companyRows
    .filter((row) => Number(row.storeId) === storeId && HQ_STORE_ROLES.has(row.relationshipType))
    .map((row) => Number(row.companyId))
    .filter(Boolean))];

  return {
    storeId,
    staffId: Number(req.user?.id || 0) || null,
    companyIds,
    writableCompanyIds,
    currentHqCompanyIds,
    currentStoreRelationships,
    isChainStore: currentStoreRelationships.some((role) => CHAIN_STORE_ROLES.has(role)),
    isHqStore: currentStoreRelationships.some((role) => HQ_STORE_ROLES.has(role)),
    isIndependent: currentStoreRelationships.length === 0
  };
}

function buildReturnAccessWhere(context, alias = "sr") {
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

async function requireSupplierReturnStoreType(req, res, next) {
  try {
    const context = await resolveContext(req);
    if (context.isChainStore) {
      return res.status(403).json({ message: "直營或加盟門市不可使用供應商退貨，請使用門市請貨流程" });
    }
    req.supplierReturnContext = context;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(requireSupplierReturnStoreType);

async function loadSupplierForReturn(supplierId, ownerType, context, connection = pool) {
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
  if (!supplier || !supplier.isActive || supplier.deletedAt || supplier.status !== "ACTIVE") {
    throw createError("找不到可用供應商", 404);
  }

  if (supplier.ownerType === "PLATFORM") {
    throw createError("平台供應商暫不開放退貨", 403);
  }

  if (ownerType === "STORE") {
    if (supplier.ownerType !== "STORE") throw createError("請選擇本店供應商", 403);
    if (Number(supplier.ownerStoreId || supplier.storeId) !== Number(context.storeId)) {
      throw createError("沒有此供應商權限", 403);
    }
    return supplier;
  }

  if (ownerType === "COMPANY") {
    if (!context.isHqStore) throw createError("公司供應商退貨需由本部或倉庫處理", 403);
    if (supplier.ownerType !== "COMPANY") throw createError("請選擇公司供應商", 403);
    if (!context.writableCompanyIds.includes(Number(supplier.ownerCompanyId))) {
      throw createError("沒有此公司供應商權限", 403);
    }
    return supplier;
  }

  throw createError("退貨範圍不正確", 400);
}

async function assertCompanyHqStore(companyId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT relationship_type AS relationshipType
      FROM company_stores
      WHERE company_id = ?
        AND store_id = ?
        AND status = 'ACTIVE'
      LIMIT 1
    `,
    [companyId, storeId]
  );
  if (!rows[0] || !HQ_STORE_ROLES.has(rows[0].relationshipType)) {
    throw createError("公司供應商退貨需由本部或倉庫商品處理", 403);
  }
}

async function loadProductForReturn(productId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, store_id AS storeId, sku, name, stock, cost_price AS costPrice, price
      FROM products
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [productId, storeId]
  );
  if (!rows[0]) throw createError("商品不屬於此退貨門市", 403);
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

function mapReturn(row) {
  return {
    id: Number(row.id),
    returnNo: row.returnNo,
    ownerType: row.ownerType,
    ownerStoreId: row.ownerStoreId === null || row.ownerStoreId === undefined ? null : Number(row.ownerStoreId),
    ownerCompanyId: row.ownerCompanyId === null || row.ownerCompanyId === undefined ? null : Number(row.ownerCompanyId),
    supplierId: Number(row.supplierId),
    supplierName: row.supplierName || "",
    status: row.status,
    returnDate: row.returnDate || null,
    totalAmount: Number(row.totalAmount || 0),
    submittedAt: row.submittedAt || null,
    approvedAt: row.approvedAt || null,
    shippedAt: row.shippedAt || null,
    receivedBySupplierAt: row.receivedBySupplierAt || null,
    settledAt: row.settledAt || null,
    canceledAt: row.canceledAt || null,
    note: row.note || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function mapItem(row) {
  return {
    id: Number(row.id),
    returnId: Number(row.returnId),
    productId: Number(row.productId),
    sku: row.sku || "",
    productName: row.productName || "",
    quantity: Number(row.quantity || 0),
    unitCost: Number(row.unitCost || 0),
    lineAmount: Number(row.lineAmount || 0),
    reason: row.reason || "",
    photoUrl: row.photoUrl || "",
    status: row.status,
    inventoryMovementId: row.inventoryMovementId === null || row.inventoryMovementId === undefined ? null : Number(row.inventoryMovementId),
    stock: row.stock === undefined ? null : Number(row.stock || 0)
  };
}

async function loadReturn(id, context, connection = pool, options = {}) {
  const access = buildReturnAccessWhere(context);
  const [rows] = await connection.query(
    `
      SELECT
        sr.id,
        sr.return_no AS returnNo,
        sr.owner_type AS ownerType,
        sr.owner_store_id AS ownerStoreId,
        sr.owner_company_id AS ownerCompanyId,
        sr.supplier_id AS supplierId,
        s.name AS supplierName,
        sr.status,
        sr.return_date AS returnDate,
        sr.submitted_at AS submittedAt,
        sr.approved_at AS approvedAt,
        sr.shipped_at AS shippedAt,
        sr.received_by_supplier_at AS receivedBySupplierAt,
        sr.settled_at AS settledAt,
        sr.canceled_at AS canceledAt,
        sr.note,
        sr.created_at AS createdAt,
        sr.updated_at AS updatedAt,
        COALESCE(SUM(sri.line_amount), 0) AS totalAmount
      FROM supplier_returns sr
      INNER JOIN suppliers s ON s.id = sr.supplier_id
      LEFT JOIN supplier_return_items sri ON sri.return_id = sr.id
      WHERE sr.id = ?
        AND ${access.where}
      GROUP BY sr.id
    `,
    [id, ...access.params]
  );
  return rows[0] ? mapReturn(rows[0]) : null;
}

async function lockReturnHeader(id, context, connection) {
  const access = buildReturnAccessWhere(context);
  const [rows] = await connection.query(
    `
      SELECT
        sr.id,
        sr.return_no AS returnNo,
        sr.owner_type AS ownerType,
        sr.owner_store_id AS ownerStoreId,
        sr.owner_company_id AS ownerCompanyId,
        sr.supplier_id AS supplierId,
        s.name AS supplierName,
        sr.status
      FROM supplier_returns sr
      INNER JOIN suppliers s ON s.id = sr.supplier_id
      WHERE sr.id = ?
        AND ${access.where}
      LIMIT 1
      FOR UPDATE
    `,
    [id, ...access.params]
  );
  return rows[0] ? {
    id: Number(rows[0].id),
    returnNo: rows[0].returnNo,
    ownerType: rows[0].ownerType,
    ownerStoreId: rows[0].ownerStoreId === null || rows[0].ownerStoreId === undefined ? null : Number(rows[0].ownerStoreId),
    ownerCompanyId: rows[0].ownerCompanyId === null || rows[0].ownerCompanyId === undefined ? null : Number(rows[0].ownerCompanyId),
    supplierId: Number(rows[0].supplierId),
    supplierName: rows[0].supplierName || "",
    status: rows[0].status
  } : null;
}

async function loadReturnItems(returnId, connection = pool, options = {}) {
  const [rows] = await connection.query(
    `
      SELECT
        sri.id,
        sri.return_id AS returnId,
        sri.product_id AS productId,
        sri.sku,
        sri.product_name AS productName,
        sri.quantity,
        sri.unit_cost AS unitCost,
        sri.line_amount AS lineAmount,
        sri.reason,
        sri.photo_url AS photoUrl,
        sri.status,
        sri.inventory_movement_id AS inventoryMovementId,
        p.stock
      FROM supplier_return_items sri
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE sri.return_id = ?
      ORDER BY sri.id
      ${options.forUpdate ? "FOR UPDATE" : ""}
    `,
    [returnId]
  );
  return rows.map(mapItem);
}

async function loadReturns(context, query = {}) {
  const access = buildReturnAccessWhere(context);
  const filters = [access.where];
  const params = [...access.params];

  if (query.status && String(query.status).toUpperCase() !== "ALL") {
    const status = String(query.status).trim().toUpperCase();
    if (RETURN_STATUSES.has(status)) {
      filters.push("sr.status = ?");
      params.push(status);
    }
  }
  if (query.supplierId) {
    filters.push("sr.supplier_id = ?");
    params.push(Number(query.supplierId));
  }
  if (query.fromDate) {
    filters.push("COALESCE(sr.return_date, DATE(sr.created_at)) >= ?");
    params.push(query.fromDate);
  }
  if (query.toDate) {
    filters.push("COALESCE(sr.return_date, DATE(sr.created_at)) <= ?");
    params.push(query.toDate);
  }
  if (query.ownerType) {
    filters.push("sr.owner_type = ?");
    params.push(String(query.ownerType).trim().toUpperCase());
  }
  if (query.ownerStoreId) {
    filters.push("sr.owner_store_id = ?");
    params.push(Number(query.ownerStoreId));
  }
  if (query.ownerCompanyId) {
    filters.push("sr.owner_company_id = ?");
    params.push(Number(query.ownerCompanyId));
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.id,
        sr.return_no AS returnNo,
        sr.owner_type AS ownerType,
        sr.owner_store_id AS ownerStoreId,
        sr.owner_company_id AS ownerCompanyId,
        sr.supplier_id AS supplierId,
        s.name AS supplierName,
        sr.status,
        sr.return_date AS returnDate,
        sr.submitted_at AS submittedAt,
        sr.approved_at AS approvedAt,
        sr.shipped_at AS shippedAt,
        sr.received_by_supplier_at AS receivedBySupplierAt,
        sr.settled_at AS settledAt,
        sr.canceled_at AS canceledAt,
        sr.note,
        sr.created_at AS createdAt,
        sr.updated_at AS updatedAt,
        COALESCE(SUM(sri.line_amount), 0) AS totalAmount
      FROM supplier_returns sr
      INNER JOIN suppliers s ON s.id = sr.supplier_id
      LEFT JOIN supplier_return_items sri ON sri.return_id = sr.id
      WHERE ${filters.join(" AND ")}
      GROUP BY sr.id
      ORDER BY sr.id DESC
      LIMIT 200
    `,
    params
  );
  return rows.map(mapReturn);
}

async function buildReport(context, query = {}) {
  const access = buildReturnAccessWhere(context);
  const filters = [access.where];
  const params = [...access.params];

  if (query.fromDate) {
    filters.push("COALESCE(sr.return_date, DATE(sr.created_at)) >= ?");
    params.push(query.fromDate);
  }
  if (query.toDate) {
    filters.push("COALESCE(sr.return_date, DATE(sr.created_at)) <= ?");
    params.push(query.toDate);
  }
  if (query.supplierId) {
    filters.push("sr.supplier_id = ?");
    params.push(Number(query.supplierId));
  }
  if (query.status && String(query.status).toUpperCase() !== "ALL") {
    filters.push("sr.status = ?");
    params.push(String(query.status).trim().toUpperCase());
  }

  const [rows] = await pool.query(
    `
      SELECT
        sr.id AS returnId,
        sr.return_no AS returnNo,
        sr.owner_type AS ownerType,
        sr.status,
        sr.return_date AS returnDate,
        sr.shipped_at AS shippedAt,
        sr.received_by_supplier_at AS receivedBySupplierAt,
        sr.settled_at AS settledAt,
        s.name AS supplierName,
        sri.sku,
        sri.product_name AS productName,
        sri.quantity,
        sri.unit_cost AS unitCost,
        sri.line_amount AS lineAmount,
        sri.reason,
        sri.status AS itemStatus,
        sr.note
      FROM supplier_returns sr
      INNER JOIN suppliers s ON s.id = sr.supplier_id
      INNER JOIN supplier_return_items sri ON sri.return_id = sr.id
      WHERE ${filters.join(" AND ")}
      ORDER BY COALESCE(sr.return_date, DATE(sr.created_at)) DESC, sr.id DESC, sri.id
    `,
    params
  );

  const mappedRows = rows.map((row) => ({
    returnId: Number(row.returnId),
    returnNo: row.returnNo,
    ownerType: row.ownerType,
    status: row.status,
    returnDate: row.returnDate || null,
    shippedAt: row.shippedAt || null,
    receivedBySupplierAt: row.receivedBySupplierAt || null,
    settledAt: row.settledAt || null,
    supplierName: row.supplierName || "",
    sku: row.sku || "",
    productName: row.productName || "",
    quantity: Number(row.quantity || 0),
    unitCost: Number(row.unitCost || 0),
    lineAmount: Number(row.lineAmount || 0),
    reason: row.reason || "",
    itemStatus: row.itemStatus,
    note: row.note || ""
  }));

  return {
    rows: mappedRows,
    summary: {
      rowCount: mappedRows.length,
      totalQuantity: mappedRows.reduce((sum, row) => sum + row.quantity, 0),
      totalAmount: toMoney(mappedRows.reduce((sum, row) => sum + row.lineAmount, 0))
    }
  };
}

function buildReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("供應商退貨明細");
  sheet.columns = [
    { header: "日期", key: "returnDate", width: 14 },
    { header: "退貨單號", key: "returnNo", width: 24 },
    { header: "供應商", key: "supplierName", width: 24 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "商品名稱", key: "productName", width: 30 },
    { header: "數量", key: "quantity", width: 10 },
    { header: "單價", key: "unitCost", width: 12 },
    { header: "金額", key: "lineAmount", width: 14 },
    { header: "狀態", key: "status", width: 18 },
    { header: "原因", key: "reason", width: 28 },
    { header: "備註", key: "note", width: 28 }
  ];
  report.rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  return workbook;
}

router.get("/", async (req, res, next) => {
  try {
    const returns = await loadReturns(req.supplierReturnContext, req.query);
    return res.json({ ok: true, returns });
  } catch (error) {
    return next(error);
  }
});

router.get("/monthly-summary", async (req, res, next) => {
  try {
    const context = req.supplierReturnContext;
    const access = buildReturnAccessWhere(context);
    const filters = [access.where, "sr.status <> 'CANCELED'"];
    const params = [...access.params];
    if (req.query.month) {
      filters.push("DATE_FORMAT(COALESCE(sr.return_date, sr.created_at), '%Y-%m') = ?");
      params.push(String(req.query.month));
    }
    if (req.query.supplierId) {
      filters.push("sr.supplier_id = ?");
      params.push(Number(req.query.supplierId));
    }

    const [rows] = await pool.query(
      `
        SELECT
          sr.supplier_id AS supplierId,
          s.name AS supplierName,
          DATE_FORMAT(COALESCE(sr.return_date, sr.created_at), '%Y-%m') AS settlementMonth,
          COUNT(DISTINCT sr.id) AS returnCount,
          COALESCE(SUM(sri.quantity), 0) AS totalQuantity,
          COALESCE(SUM(sri.line_amount), 0) AS returnAmount
        FROM supplier_returns sr
        INNER JOIN suppliers s ON s.id = sr.supplier_id
        LEFT JOIN supplier_return_items sri ON sri.return_id = sr.id
        WHERE ${filters.join(" AND ")}
        GROUP BY sr.supplier_id, s.name, DATE_FORMAT(COALESCE(sr.return_date, sr.created_at), '%Y-%m')
        ORDER BY settlementMonth DESC, s.name
      `,
      params
    );

    return res.json(rows.map((row) => ({
      supplierId: Number(row.supplierId),
      supplierName: row.supplierName,
      settlementMonth: row.settlementMonth,
      returnCount: Number(row.returnCount || 0),
      totalQuantity: Number(row.totalQuantity || 0),
      returnAmount: Number(row.returnAmount || 0)
    })));
  } catch (error) {
    return next(error);
  }
});

router.get("/report", async (req, res, next) => {
  try {
    const report = await buildReport(req.supplierReturnContext, req.query);
    if (String(req.query.export || "").toLowerCase() === "xlsx") {
      const workbook = buildReportWorkbook(report);
      const from = String(req.query.fromDate || "all").replaceAll("-", "");
      const to = String(req.query.toDate || "all").replaceAll("-", "");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=\"kingway_supplier_returns_${from}_${to}.xlsx\"`);
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
    const returnId = Number(req.params.id);
    const supplierReturn = await loadReturn(returnId, req.supplierReturnContext);
    if (!supplierReturn) return res.status(404).json({ message: "找不到供應商退貨單" });
    supplierReturn.items = await loadReturnItems(returnId);
    return res.json(supplierReturn);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireStoreAdminRole, async (req, res, next) => {
  try {
    const context = req.supplierReturnContext;
    const ownerType = String(req.body?.ownerType || req.body?.owner_type || "STORE").trim().toUpperCase();
    const supplierId = Number(req.body?.supplierId || req.body?.supplier_id || 0);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!["STORE", "COMPANY"].includes(ownerType)) throw createError("退貨範圍不正確", 400);
    if (context.isIndependent && ownerType !== "STORE") throw createError("獨立門市只能建立本店供應商退貨", 403);
    if (!supplierId) throw createError("請選擇供應商", 400);
    if (!items.length) throw createError("請至少加入一個退貨商品", 400);

    const returnId = await withTransaction(async (connection) => {
      const supplier = await loadSupplierForReturn(supplierId, ownerType, context, connection);
      const ownerStoreId = ownerType === "STORE" ? context.storeId : null;
      const ownerCompanyId = ownerType === "COMPANY" ? Number(supplier.ownerCompanyId) : null;
      if (ownerType === "COMPANY") {
        await assertCompanyHqStore(ownerCompanyId, context.storeId, connection);
      }

      const [insertResult] = await connection.query(
        `
          INSERT INTO supplier_returns
            (return_no, owner_type, owner_store_id, owner_company_id, supplier_id, status, return_date, created_by_staff_user_id, note)
          VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
        `,
        [
          makeNo("SR"),
          ownerType,
          ownerStoreId,
          ownerCompanyId,
          supplierId,
          normalizeDate(req.body?.returnDate || req.body?.return_date),
          context.staffId,
          req.body?.note || null
        ]
      );

      for (const rawItem of items) {
        const productId = Number(rawItem.productId || rawItem.product_id || 0);
        const quantity = Number(rawItem.quantity || 0);
        if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
          throw createError("退貨商品與數量不正確", 400);
        }

        const product = await loadProductForReturn(productId, context.storeId, connection);
        const fallbackCost = Number(product.costPrice || 0) > 0 ? product.costPrice : product.price;
        const unitCost = rawItem.unitCost === undefined && rawItem.unit_cost === undefined
          ? await loadUnitCost(supplierId, productId, context.storeId, fallbackCost, connection)
          : toMoney(rawItem.unitCost ?? rawItem.unit_cost);
        const lineAmount = toMoney(unitCost * quantity);

        await connection.query(
          `
            INSERT INTO supplier_return_items
              (return_id, product_id, sku, product_name, quantity, unit_cost, line_amount, reason, photo_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
          `,
          [
            insertResult.insertId,
            product.id,
            product.sku,
            product.name,
            quantity,
            unitCost,
            lineAmount,
            rawItem.reason || null,
            rawItem.photoUrl || rawItem.photo_url || null
          ]
        );
      }

      return insertResult.insertId;
    });

    const supplierReturn = await loadReturn(returnId, context);
    supplierReturn.items = await loadReturnItems(returnId);
    createKpiEventOnce({
      companyId: supplierReturn.ownerCompanyId,
      storeId: context.storeId,
      staffUserId: context.staffId,
      eventType: "SUPPLIER_RETURN_CREATED",
      refType: "SUPPLIER_RETURN",
      refId: supplierReturn.id,
      title: `供應商退貨建立：${supplierReturn.returnNo}`,
      score: 1,
      metadata: {
        supplierId: supplierReturn.supplierId,
        supplierName: supplierReturn.supplierName,
        itemCount: supplierReturn.items.length
      }
    }).catch((kpiError) => {
      console.warn("[staff-kpi] supplier return created KPI event failed", {
        returnId,
        returnNo: supplierReturn.returnNo,
        message: kpiError.message
      });
    });
    notifySupplierReturnCreated({
      ...supplierReturn,
      storeId: context.storeId
    }).catch((notificationError) => {
      console.warn("[notification-event] SUPPLIER_RETURN_CREATED failed", {
        returnId,
        returnNo: supplierReturn.returnNo,
        message: notificationError.message
      });
    });
    return res.status(201).json(supplierReturn);
  } catch (error) {
    return next(error);
  }
});

async function updateStatus(req, res, next, config) {
  try {
    const returnId = Number(req.params.id);
    const context = req.supplierReturnContext;
    const supplierReturn = await withTransaction(async (connection) => {
      const row = await lockReturnHeader(returnId, context, connection);
      if (!row) throw createError("找不到供應商退貨單", 404);
      if (!config.from.includes(row.status)) throw createError(config.invalidMessage, 409);
      await connection.query(config.sql, config.params(context, returnId));
      await connection.query("UPDATE supplier_return_items SET status = ? WHERE return_id = ?", [config.itemStatus, returnId]);
      return loadReturn(returnId, context, connection);
    });
    supplierReturn.items = await loadReturnItems(returnId);
    return res.json(supplierReturn);
  } catch (error) {
    return next(error);
  }
}

router.post("/:id/submit", requireStoreAdminRole, (req, res, next) => updateStatus(req, res, next, {
  from: ["DRAFT"],
  invalidMessage: "只有草稿退貨單可以送出",
  itemStatus: "SUBMITTED",
  sql: "UPDATE supplier_returns SET status = 'SUBMITTED', submitted_at = NOW() WHERE id = ?",
  params: (context, id) => [id]
}));

router.post("/:id/approve", requireStoreAdminRole, (req, res, next) => updateStatus(req, res, next, {
  from: ["SUBMITTED"],
  invalidMessage: "只有已送出的退貨單可以核准",
  itemStatus: "APPROVED",
  sql: "UPDATE supplier_returns SET status = 'APPROVED', approved_at = NOW(), approved_by_staff_user_id = ? WHERE id = ?",
  params: (context, id) => [context.staffId, id]
}));

router.post("/:id/ship", requireStoreAdminRole, async (req, res, next) => {
  try {
    const returnId = Number(req.params.id);
    const context = req.supplierReturnContext;
    await withTransaction(async (connection) => {
      const supplierReturn = await lockReturnHeader(returnId, context, connection);
      if (!supplierReturn) throw createError("找不到供應商退貨單", 404);
      if (!["SUBMITTED", "APPROVED"].includes(supplierReturn.status)) {
        throw createError("只有已送出或已核准的退貨單可以確認出貨", 409);
      }

      const items = await loadReturnItems(returnId, connection, { forUpdate: true });
      if (!items.length) throw createError("退貨單沒有品項", 400);

      for (const item of items) {
        if (item.inventoryMovementId) throw createError("此退貨單已出貨，不能重複扣庫存", 409);
        const [productRows] = await connection.query(
          "SELECT id, stock, sku, name FROM products WHERE id = ? AND store_id = ? FOR UPDATE",
          [item.productId, context.storeId]
        );
        const product = productRows[0];
        if (!product) throw createError(`${item.sku} 商品不屬於目前門市`, 403);
        if (Number(product.stock || 0) < item.quantity) {
          throw createError(`${item.sku} 庫存不足，無法退貨出庫`, 409);
        }

        await connection.query("UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?", [item.quantity, item.productId, context.storeId]);
        const [movementResult] = await connection.query(
          `
            INSERT INTO inventory_movements
              (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
            VALUES (?, ?, 'OUT', ?, 'SUPPLIER_RETURN', ?, ?, ?)
          `,
          [
            context.storeId,
            item.productId,
            Math.abs(item.quantity),
            returnId,
            context.staffId,
            `供應商退貨出庫 ${supplierReturn.returnNo} / ${supplierReturn.supplierName} / ${item.sku}`
          ]
        );
        await connection.query(
          "UPDATE supplier_return_items SET status = 'SHIPPED', inventory_movement_id = ? WHERE id = ?",
          [movementResult.insertId, item.id]
        );
      }

      await connection.query("UPDATE supplier_returns SET status = 'SHIPPED', shipped_at = NOW() WHERE id = ?", [returnId]);
    });

    const supplierReturn = await loadReturn(returnId, context);
    supplierReturn.items = await loadReturnItems(returnId);
    createKpiEventOnce({
      companyId: supplierReturn.ownerCompanyId,
      storeId: context.storeId,
      staffUserId: context.staffId,
      eventType: "SUPPLIER_RETURN_SHIPPED",
      refType: "SUPPLIER_RETURN",
      refId: supplierReturn.id,
      title: `供應商退貨出貨：${supplierReturn.returnNo}`,
      score: 1,
      occurredAt: supplierReturn.shippedAt || new Date(),
      completedAt: supplierReturn.shippedAt || new Date(),
      metadata: {
        supplierId: supplierReturn.supplierId,
        supplierName: supplierReturn.supplierName,
        itemCount: supplierReturn.items.length
      }
    }).catch((kpiError) => {
      console.warn("[staff-kpi] supplier return shipped KPI event failed", {
        returnId,
        returnNo: supplierReturn.returnNo,
        message: kpiError.message
      });
    });
    notifySupplierReturnShipped({
      ...supplierReturn,
      storeId: context.storeId
    }).catch((notificationError) => {
      console.warn("[notification-event] SUPPLIER_RETURN_SHIPPED failed", {
        returnId,
        returnNo: supplierReturn.returnNo,
        message: notificationError.message
      });
    });
    return res.json(supplierReturn);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/mark-received-by-supplier", requireStoreAdminRole, (req, res, next) => updateStatus(req, res, next, {
  from: ["SHIPPED"],
  invalidMessage: "只有已出貨的退貨單可以標記供應商已收",
  itemStatus: "RECEIVED_BY_SUPPLIER",
  sql: "UPDATE supplier_returns SET status = 'RECEIVED_BY_SUPPLIER', received_by_supplier_at = NOW() WHERE id = ?",
  params: (context, id) => [id]
}));

router.post("/:id/settle", requireStoreAdminRole, (req, res, next) => updateStatus(req, res, next, {
  from: ["SHIPPED", "RECEIVED_BY_SUPPLIER"],
  invalidMessage: "只有已出貨或供應商已收的退貨單可以結算",
  itemStatus: "SETTLED",
  sql: "UPDATE supplier_returns SET status = 'SETTLED', settled_at = NOW(), settled_by_staff_user_id = ? WHERE id = ?",
  params: (context, id) => [context.staffId, id]
}));

router.post("/:id/cancel", requireStoreAdminRole, (req, res, next) => updateStatus(req, res, next, {
  from: ["DRAFT", "SUBMITTED", "APPROVED"],
  invalidMessage: "已出貨後不能取消退貨單",
  itemStatus: "CANCELED",
  sql: "UPDATE supplier_returns SET status = 'CANCELED', canceled_at = NOW() WHERE id = ?",
  params: (context, id) => [id]
}));

module.exports = router;
