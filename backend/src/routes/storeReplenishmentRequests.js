const crypto = require("crypto");
const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { loadCompanyMembership } = require("../middleware/companyAuth");
const { requireFeature } = require("../services/storeAccessService");
const { notifyStoreReplenishmentSubmitted } = require("../services/storeReplenishmentNotificationService");
const { createError } = require("../utils/errors");

const router = express.Router();

const HQ_WRITE_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager"]);
const HQ_READ_ROLES = new Set(["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"]);
const REQUEST_OPEN_STATUSES = new Set(["DRAFT", "SUBMITTED", "PARTIALLY_FULFILLED"]);

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "INVENTORY"]), requireFeature("store_transfers"));

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
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
  return `${prefix}-${stamp}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function mapRequest(row) {
  return {
    id: Number(row.id),
    requestNo: row.requestNo,
    companyId: Number(row.companyId),
    requestingStoreId: Number(row.requestingStoreId),
    requestingStoreCode: row.requestingStoreCode || "",
    requestingStoreName: row.requestingStoreName || "",
    status: row.status,
    requestedByStaffUserId: row.requestedByStaffUserId === null ? null : Number(row.requestedByStaffUserId),
    requestedByName: row.requestedByName || "",
    note: row.note || "",
    itemSummary: row.itemSummary || "",
    itemCount: Number(row.itemCount || 0),
    submittedAt: row.submittedAt || null,
    fulfilledAt: row.fulfilledAt || null,
    canceledAt: row.canceledAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function mapItem(row) {
  return {
    id: Number(row.id),
    requestId: Number(row.requestId),
    hqProductId: Number(row.hqProductId),
    requestedSku: row.requestedSku || "",
    requestedProductName: row.requestedProductName || "",
    targetStoreProductId: row.targetStoreProductId === null ? null : Number(row.targetStoreProductId),
    quantityRequested: Number(row.quantityRequested || 0),
    quantityFulfilled: Number(row.quantityFulfilled || 0),
    unitCost: Number(row.unitCost || 0),
    status: row.status,
    transferId: row.transferId === null ? null : Number(row.transferId),
    transferItemId: row.transferItemId === null ? null : Number(row.transferItemId),
    note: row.note || "",
    hqStock: row.hqStock === undefined || row.hqStock === null ? null : Number(row.hqStock),
    targetStock: row.targetStock === undefined || row.targetStock === null ? null : Number(row.targetStock),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

async function loadRequest(requestId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        srr.id,
        srr.request_no AS requestNo,
        srr.company_id AS companyId,
        srr.requesting_store_id AS requestingStoreId,
        rs.code AS requestingStoreCode,
        rs.name AS requestingStoreName,
        srr.status,
        srr.requested_by_staff_user_id AS requestedByStaffUserId,
        su.display_name AS requestedByName,
        srr.note,
        COUNT(srri.id) AS itemCount,
        GROUP_CONCAT(CONCAT(srri.requested_sku, ' x', srri.quantity_requested) ORDER BY srri.id SEPARATOR '；') AS itemSummary,
        srr.submitted_at AS submittedAt,
        srr.fulfilled_at AS fulfilledAt,
        srr.canceled_at AS canceledAt,
        srr.created_at AS createdAt,
        srr.updated_at AS updatedAt
      FROM store_replenishment_requests srr
      INNER JOIN stores rs ON rs.id = srr.requesting_store_id
      LEFT JOIN staff_users su ON su.id = srr.requested_by_staff_user_id
      LEFT JOIN store_replenishment_request_items srri ON srri.request_id = srr.id
      WHERE srr.id = ?
      GROUP BY
        srr.id,
        srr.request_no,
        srr.company_id,
        srr.requesting_store_id,
        rs.code,
        rs.name,
        srr.status,
        srr.requested_by_staff_user_id,
        su.display_name,
        srr.note,
        srr.submitted_at,
        srr.fulfilled_at,
        srr.canceled_at,
        srr.created_at,
        srr.updated_at
      LIMIT 1
    `,
    [requestId]
  );
  return rows[0] ? mapRequest(rows[0]) : null;
}

async function loadRequestItems(requestId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        srri.id,
        srri.request_id AS requestId,
        srri.hq_product_id AS hqProductId,
        srri.requested_sku AS requestedSku,
        srri.requested_product_name AS requestedProductName,
        srri.target_store_product_id AS targetStoreProductId,
        srri.quantity_requested AS quantityRequested,
        srri.quantity_fulfilled AS quantityFulfilled,
        srri.unit_cost AS unitCost,
        srri.status,
        srri.transfer_id AS transferId,
        srri.transfer_item_id AS transferItemId,
        srri.note,
        hp.stock AS hqStock,
        tp.stock AS targetStock,
        srri.created_at AS createdAt,
        srri.updated_at AS updatedAt
      FROM store_replenishment_request_items srri
      INNER JOIN products hp ON hp.id = srri.hq_product_id
      LEFT JOIN products tp ON tp.id = srri.target_store_product_id
      WHERE srri.request_id = ?
      ORDER BY srri.id ASC
    `,
    [requestId]
  );
  return rows.map(mapItem);
}

async function loadRequestWithItems(requestId, connection = pool) {
  const request = await loadRequest(requestId, connection);
  if (!request) return null;
  request.items = await loadRequestItems(request.id, connection);
  return request;
}

async function loadCompanyStore(storeId, relationshipTypes = [], connection = pool) {
  const params = [storeId];
  const relationshipSql = relationshipTypes.length
    ? `AND cs.relationship_type IN (${relationshipTypes.map(() => "?").join(",")})`
    : "";
  params.push(...relationshipTypes);
  const [rows] = await connection.query(
    `
      SELECT
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        s.code AS storeCode,
        s.name AS storeName
      FROM company_stores cs
      INNER JOIN stores s ON s.id = cs.store_id
      WHERE cs.store_id = ?
        AND cs.status = 'ACTIVE'
        ${relationshipSql}
      LIMIT 1
    `,
    params
  );
  return rows[0] || null;
}

async function requireHqRead(req, companyId, connection = pool) {
  const membership = await loadCompanyMembership(req.user.id, companyId);
  if (!membership || !HQ_READ_ROLES.has(membership.role)) {
    throw createError("沒有本部請貨管理權限", 403);
  }
  return membership;
}

async function requireHqWrite(req, companyId, connection = pool) {
  const membership = await loadCompanyMembership(req.user.id, companyId);
  if (!membership || !HQ_WRITE_ROLES.has(membership.role)) {
    throw createError("本部請貨處理權限不足", 403);
  }
  return membership;
}

async function loadHqProductForStoreRequest(hqProductId, companyId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        p.id,
        p.store_id AS storeId,
        p.sku,
        p.name,
        p.stock,
        p.price,
        p.cost_price AS costPrice
      FROM products p
      INNER JOIN company_stores cs ON cs.store_id = p.store_id
        AND cs.company_id = ?
        AND cs.status = 'ACTIVE'
        AND cs.relationship_type IN ('HEADQUARTERS', 'WAREHOUSE')
      WHERE p.id = ?
        AND p.deleted_at IS NULL
      LIMIT 1
    `,
    [companyId, hqProductId]
  );
  return rows[0] || null;
}

async function findTargetProduct(storeId, sku, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, stock
      FROM products
      WHERE store_id = ?
        AND sku = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [storeId, sku]
  );
  return rows[0] || null;
}

async function refreshRequestStatus(requestId, connection) {
  const [items] = await connection.query(
    "SELECT status FROM store_replenishment_request_items WHERE request_id = ?",
    [requestId]
  );
  const activeItems = items.filter((item) => item.status !== "CANCELED");
  const fulfilledItems = activeItems.filter((item) => item.status === "FULFILLED");
  const nextStatus = activeItems.length > 0 && fulfilledItems.length === activeItems.length
    ? "FULFILLED"
    : fulfilledItems.length > 0
      ? "PARTIALLY_FULFILLED"
      : "SUBMITTED";

  await connection.query(
    "UPDATE store_replenishment_requests SET status = ?, fulfilled_at = IF(? = 'FULFILLED', NOW(), fulfilled_at) WHERE id = ? AND status <> 'CANCELED'",
    [nextStatus, nextStatus, requestId]
  );
}

async function insertTransferForRequestItem(connection, request, item, options = {}) {
  if (item.status !== "REQUESTED" || item.transfer_id) {
    throw createError("此請貨品項已處理，不能重複建立出貨單", 409);
  }

  const [productRows] = await connection.query(
    `
      SELECT id, store_id AS storeId, sku, name, stock
      FROM products
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `,
    [item.hq_product_id]
  );
  const hqProduct = productRows[0];
  if (!hqProduct) {
    throw createError("找不到本部商品", 404);
  }

  const [hqStoreRows] = await connection.query(
    `
      SELECT store_id AS storeId
      FROM company_stores
      WHERE company_id = ?
        AND store_id = ?
        AND status = 'ACTIVE'
        AND relationship_type IN ('HEADQUARTERS', 'WAREHOUSE')
      LIMIT 1
    `,
    [request.company_id, hqProduct.storeId]
  );
  if (!hqStoreRows[0]) {
    throw createError("請貨商品不屬於本公司本部或倉庫", 400);
  }

  const targetProduct = await findTargetProduct(request.requesting_store_id, item.requested_sku, connection);
  if (!targetProduct) {
    throw createError("門市尚未建立此 SKU 商品，請先建立門市商品後再出貨。", 400);
  }

  const quantity = Number(options.quantity || item.quantity_requested || 0);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw createError("出貨數量不正確", 400);
  }
  if (Number(hqProduct.stock || 0) < quantity) {
    throw createError("本部庫存不足，無法建立出貨單", 400);
  }

  const unitCost = options.unitCost === undefined || options.unitCost === null || options.unitCost === ""
    ? Number(item.unit_cost || 0)
    : toMoney(options.unitCost);
  const [transferResult] = await connection.query(
    `
      INSERT INTO store_transfers
        (company_id, from_store_id, to_store_id, transfer_no, status, created_by_staff_id, note)
      VALUES (?, ?, ?, ?, 'DRAFT', ?, ?)
    `,
    [
      request.company_id,
      hqProduct.storeId,
      request.requesting_store_id,
      makeNo("ST"),
      options.staffUserId || null,
      options.note || `門市請貨 ${request.request_no}`
    ]
  );
  const transferId = transferResult.insertId;

  const [itemResult] = await connection.query(
    `
      INSERT INTO store_transfer_items
        (transfer_id, from_product_id, to_product_id, sku_snapshot, product_name_snapshot, quantity_shipped, unit_cost, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      transferId,
      hqProduct.id,
      targetProduct.id,
      item.requested_sku,
      item.requested_product_name,
      quantity,
      unitCost,
      options.itemNote || `門市請貨品項 #${item.id}`
    ]
  );

  await connection.query(
    `
      UPDATE store_replenishment_request_items
      SET target_store_product_id = ?,
          quantity_fulfilled = ?,
          status = 'FULFILLED',
          transfer_id = ?,
          transfer_item_id = ?
      WHERE id = ?
    `,
    [targetProduct.id, quantity, transferId, itemResult.insertId, item.id]
  );

  return { transferId, transferItemId: itemResult.insertId, quantity, hqProduct, targetProduct };
}

async function shipTransfer(connection, transferId, staffUserId) {
  const [transferRows] = await connection.query("SELECT * FROM store_transfers WHERE id = ? FOR UPDATE", [transferId]);
  const transfer = transferRows[0];
  if (!transfer) throw createError("找不到出貨單", 404);
  if (transfer.status !== "DRAFT") throw createError("只有草稿可出貨", 409);

  const [items] = await connection.query(
    `
      SELECT sti.*, fp.stock, fp.store_id AS fromStoreId, tp.store_id AS toStoreId
      FROM store_transfer_items sti
      INNER JOIN products fp ON fp.id = sti.from_product_id
      INNER JOIN products tp ON tp.id = sti.to_product_id
      WHERE sti.transfer_id = ?
      FOR UPDATE
    `,
    [transferId]
  );
  if (!items.length) throw createError("出貨單沒有商品", 400);

  for (const item of items) {
    if (Number(item.fromStoreId) !== Number(transfer.from_store_id) || Number(item.toStoreId) !== Number(transfer.to_store_id)) {
      throw createError("出貨商品門市不一致", 409);
    }
    if (Number(item.stock || 0) < Number(item.quantity_shipped || 0)) {
      throw createError(`${item.sku_snapshot} 庫存不足`, 409);
    }
  }

  const [[toStore]] = await connection.query("SELECT name FROM stores WHERE id = ? LIMIT 1", [transfer.to_store_id]);
  for (const item of items) {
    await connection.query(
      "UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?",
      [item.quantity_shipped, item.from_product_id, transfer.from_store_id]
    );
    await connection.query(
      `
        INSERT INTO inventory_movements
          (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
        VALUES (?, ?, 'OUT', ?, 'STORE_TRANSFER', ?, ?, ?)
      `,
      [
        transfer.from_store_id,
        item.from_product_id,
        Math.abs(Number(item.quantity_shipped || 0)),
        transferId,
        staffUserId || null,
        `本部出貨 / 門市請貨出庫 ${transfer.transfer_no} -> ${toStore?.name || transfer.to_store_id}`
      ]
    );
  }
  await connection.query(
    "UPDATE store_transfers SET status = 'SHIPPED', shipped_at = NOW(), shipped_by_staff_id = ? WHERE id = ?",
    [staffUserId || null, transferId]
  );
}

async function queryRequests(whereSql, params, query = {}) {
  const filters = [];
  const nextParams = [...params];
  if (query.status) {
    filters.push("srr.status = ?");
    nextParams.push(String(query.status).trim().toUpperCase());
  }
  if (query.requestingStoreId) {
    filters.push("srr.requesting_store_id = ?");
    nextParams.push(Number(query.requestingStoreId));
  }

  const [rows] = await pool.query(
    `
      SELECT
        srr.id,
        srr.request_no AS requestNo,
        srr.company_id AS companyId,
        srr.requesting_store_id AS requestingStoreId,
        rs.code AS requestingStoreCode,
        rs.name AS requestingStoreName,
        srr.status,
        srr.requested_by_staff_user_id AS requestedByStaffUserId,
        su.display_name AS requestedByName,
        srr.note,
        COUNT(srri.id) AS itemCount,
        GROUP_CONCAT(CONCAT(srri.requested_sku, ' x', srri.quantity_requested, ' / ', srri.status) ORDER BY srri.id SEPARATOR '；') AS itemSummary,
        srr.submitted_at AS submittedAt,
        srr.fulfilled_at AS fulfilledAt,
        srr.canceled_at AS canceledAt,
        srr.created_at AS createdAt,
        srr.updated_at AS updatedAt
      FROM store_replenishment_requests srr
      INNER JOIN stores rs ON rs.id = srr.requesting_store_id
      LEFT JOIN staff_users su ON su.id = srr.requested_by_staff_user_id
      LEFT JOIN store_replenishment_request_items srri ON srri.request_id = srr.id
      WHERE ${whereSql}
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      GROUP BY
        srr.id,
        srr.request_no,
        srr.company_id,
        srr.requesting_store_id,
        rs.code,
        rs.name,
        srr.status,
        srr.requested_by_staff_user_id,
        su.display_name,
        srr.note,
        srr.submitted_at,
        srr.fulfilled_at,
        srr.canceled_at,
        srr.created_at,
        srr.updated_at
      ORDER BY srr.id DESC
      LIMIT 200
    `,
    nextParams
  );
  return rows.map(mapRequest);
}

router.get("/hq-products", async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const q = String(req.query.q || "").trim();
    const storeContext = await loadCompanyStore(storeId, ["DIRECT_STORE", "FRANCHISE_STORE"]);
    if (!storeContext) {
      throw createError("只有直營或加盟門市可建立請貨單", 403);
    }

    const params = [storeContext.companyId, storeId];
    let searchSql = "";
    if (q) {
      searchSql = "AND (p.sku LIKE ? OR p.name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `
        SELECT
          p.id AS hqProductId,
          p.store_id AS hqStoreId,
          p.sku,
          p.name,
          p.stock AS hqStock,
          p.price,
          p.cost_price AS costPrice,
          CASE WHEN p.cost_price > 0 THEN p.cost_price ELSE p.price END AS unitCost,
          tp.id AS targetStoreProductId,
          tp.stock AS targetStock
        FROM products p
        INNER JOIN company_stores hqcs ON hqcs.store_id = p.store_id
          AND hqcs.company_id = ?
          AND hqcs.status = 'ACTIVE'
          AND hqcs.relationship_type IN ('HEADQUARTERS', 'WAREHOUSE')
        LEFT JOIN products tp ON tp.store_id = ?
          AND tp.sku = p.sku
          AND tp.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND p.sku IS NOT NULL
          AND p.sku <> ''
          ${searchSql}
        ORDER BY p.stock DESC, p.sku ASC
        LIMIT 50
      `,
      params
    );

    return res.json({
      ok: true,
      products: rows.map((row) => ({
        hqProductId: Number(row.hqProductId),
        hqStoreId: Number(row.hqStoreId),
        sku: row.sku || "",
        name: row.name || "",
        hqStock: Number(row.hqStock || 0),
        price: Number(row.price || 0),
        costPrice: Number(row.costPrice || 0),
        unitCost: Number(row.unitCost || 0),
        targetStoreProductId: row.targetStoreProductId === null ? null : Number(row.targetStoreProductId),
        targetStock: row.targetStock === null || row.targetStock === undefined ? null : Number(row.targetStock),
        mapped: Boolean(row.targetStoreProductId)
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const requests = await queryRequests("srr.requesting_store_id = ?", [storeId], req.query);
    return res.json({ ok: true, requests });
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireStoreRole(["owner", "admin", "staff"]), async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw createError("請至少加入一個請貨商品", 400);

    const requestId = await withTransaction(async (connection) => {
      const storeContext = await loadCompanyStore(storeId, ["DIRECT_STORE", "FRANCHISE_STORE"], connection);
      if (!storeContext) throw createError("只有直營或加盟門市可建立請貨單", 403);

      const [insertResult] = await connection.query(
        `
          INSERT INTO store_replenishment_requests
            (request_no, company_id, requesting_store_id, status, requested_by_staff_user_id, note)
          VALUES (?, ?, ?, 'DRAFT', ?, ?)
        `,
        [makeNo("REQ"), storeContext.companyId, storeId, req.user.id || null, req.body?.note || null]
      );

      for (const rawItem of items) {
        const hqProductId = Number(rawItem.hqProductId || rawItem.hq_product_id || 0);
        const quantity = Number(rawItem.quantityRequested || rawItem.quantity_requested || rawItem.quantity || 0);
        if (!Number.isSafeInteger(hqProductId) || hqProductId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
          throw createError("請貨商品與數量不正確", 400);
        }

        const hqProduct = await loadHqProductForStoreRequest(hqProductId, storeContext.companyId, connection);
        if (!hqProduct) throw createError("請貨商品不屬於本公司本部或倉庫", 400);
        const targetProduct = await findTargetProduct(storeId, hqProduct.sku, connection);
        const unitCost = toMoney(Number(hqProduct.costPrice || 0) > 0 ? hqProduct.costPrice : hqProduct.price);

        await connection.query(
          `
            INSERT INTO store_replenishment_request_items
              (request_id, hq_product_id, requested_sku, requested_product_name, target_store_product_id, quantity_requested, unit_cost, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            insertResult.insertId,
            hqProduct.id,
            hqProduct.sku,
            hqProduct.name,
            targetProduct?.id || null,
            quantity,
            unitCost,
            rawItem.note || null
          ]
        );
      }
      return insertResult.insertId;
    });

    const request = await loadRequestWithItems(requestId);
    return res.status(201).json({ ok: true, request });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/submit", requireStoreRole(["owner", "admin", "staff"]), async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const requestId = Number(req.params.id);
    const submittedRequest = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT * FROM store_replenishment_requests WHERE id = ? AND requesting_store_id = ? FOR UPDATE",
        [requestId, storeId]
      );
      const request = rows[0];
      if (!request) throw createError("找不到請貨單", 404);
      if (request.status !== "DRAFT") throw createError("只有草稿可送出", 409);

      const [[itemCount]] = await connection.query(
        "SELECT COUNT(*) AS count FROM store_replenishment_request_items WHERE request_id = ? AND status = 'REQUESTED'",
        [requestId]
      );
      if (!Number(itemCount?.count || 0)) throw createError("請貨單沒有可送出的品項", 400);

      await connection.query(
        "UPDATE store_replenishment_requests SET status = 'SUBMITTED', submitted_at = NOW() WHERE id = ?",
        [requestId]
      );
      return loadRequestWithItems(requestId, connection);
    });

    notifyStoreReplenishmentSubmitted({
      requestId: submittedRequest.id,
      requestNo: submittedRequest.requestNo,
      companyId: submittedRequest.companyId,
      storeId: submittedRequest.requestingStoreId,
      storeCode: submittedRequest.requestingStoreCode,
      storeName: submittedRequest.requestingStoreName,
      itemCount: submittedRequest.itemCount,
      note: submittedRequest.note
    }).catch((error) => {
      console.info("[store-replenishment] notify_async_failed", {
        requestId: submittedRequest.id,
        requestNo: submittedRequest.requestNo,
        error: error.message
      });
    });

    return res.json({ ok: true, request: submittedRequest });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cancel", requireStoreRole(["owner", "admin", "staff"]), async (req, res, next) => {
  try {
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const requestId = Number(req.params.id);
    await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT * FROM store_replenishment_requests WHERE id = ? AND requesting_store_id = ? FOR UPDATE",
        [requestId, storeId]
      );
      const request = rows[0];
      if (!request) throw createError("找不到請貨單", 404);
      if (!REQUEST_OPEN_STATUSES.has(request.status)) throw createError("此請貨單不可取消", 409);
      const [[fulfilled]] = await connection.query(
        "SELECT COUNT(*) AS count FROM store_replenishment_request_items WHERE request_id = ? AND transfer_id IS NOT NULL",
        [requestId]
      );
      if (Number(fulfilled?.count || 0) > 0) throw createError("已有品項建立出貨單，不能取消", 409);
      await connection.query("UPDATE store_replenishment_requests SET status = 'CANCELED', canceled_at = NOW() WHERE id = ?", [requestId]);
      await connection.query("UPDATE store_replenishment_request_items SET status = 'CANCELED' WHERE request_id = ?", [requestId]);
    });
    const request = await loadRequestWithItems(requestId);
    return res.json({ ok: true, request });
  } catch (error) {
    return next(error);
  }
});

router.get("/company", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || 0);
    if (!companyId) throw createError("請提供公司", 400);
    await requireHqRead(req, companyId);
    const requests = await queryRequests("srr.company_id = ?", [companyId], req.query);
    return res.json({ ok: true, requests });
  } catch (error) {
    return next(error);
  }
});

router.get("/company/pending", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || 0);
    if (!companyId) throw createError("請提供公司", 400);
    await requireHqRead(req, companyId);
    const requests = await queryRequests("srr.company_id = ? AND srr.status IN ('SUBMITTED', 'PARTIALLY_FULFILLED')", [companyId], req.query);
    return res.json({ ok: true, requests });
  } catch (error) {
    return next(error);
  }
});

async function createTransferFromRequestItem(req, res, next, shouldShip) {
  try {
    const requestId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const result = await withTransaction(async (connection) => {
      const [requestRows] = await connection.query(
        "SELECT * FROM store_replenishment_requests WHERE id = ? FOR UPDATE",
        [requestId]
      );
      const request = requestRows[0];
      if (!request) throw createError("找不到請貨單", 404);
      if (!["SUBMITTED", "PARTIALLY_FULFILLED"].includes(request.status)) {
        throw createError("此請貨單目前不可建立出貨", 409);
      }
      await requireHqWrite(req, Number(request.company_id), connection);

      const [itemRows] = await connection.query(
        "SELECT * FROM store_replenishment_request_items WHERE id = ? AND request_id = ? FOR UPDATE",
        [itemId, requestId]
      );
      const item = itemRows[0];
      if (!item) throw createError("找不到請貨品項", 404);

      const transferResult = await insertTransferForRequestItem(connection, request, item, {
        quantity: Number(req.body?.quantity || item.quantity_requested),
        unitCost: req.body?.unitCost ?? req.body?.unit_cost,
        note: req.body?.note || `門市請貨 ${request.request_no}`,
        itemNote: req.body?.itemNote || null,
        staffUserId: req.user.id
      });

      if (shouldShip) {
        await shipTransfer(connection, transferResult.transferId, req.user.id);
      }
      await refreshRequestStatus(requestId, connection);
      return transferResult;
    });

    const request = await loadRequestWithItems(requestId);
    return res.status(201).json({ ok: true, request, transferId: result.transferId, transferItemId: result.transferItemId });
  } catch (error) {
    return next(error);
  }
}

router.post("/:id/items/:itemId/create-transfer", async (req, res, next) => {
  return createTransferFromRequestItem(req, res, next, false);
});

router.post("/:id/items/:itemId/create-and-ship-transfer", async (req, res, next) => {
  return createTransferFromRequestItem(req, res, next, true);
});

router.get("/:id", async (req, res, next) => {
  try {
    const request = await loadRequestWithItems(Number(req.params.id));
    if (!request) throw createError("找不到請貨單", 404);
    const storeId = Number(req.storeId || req.user?.storeId || 0);
    const membership = await loadCompanyMembership(req.user.id, request.companyId);
    if (Number(request.requestingStoreId) !== storeId && !membership) {
      throw createError("沒有請貨單權限", 403);
    }
    return res.json({ ok: true, request });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
