const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { loadCompanyMembership, requireCompanyRole } = require("../middleware/companyAuth");
const { createError } = require("../utils/errors");

const router = express.Router();
const HQ_WRITE_ROLES = ["company_owner", "hq_admin", "inventory_manager"];
const HQ_READ_ROLES = ["company_owner", "hq_admin", "finance", "inventory_manager", "viewer"];
const OPEN_STATUSES = ["SHIPPED", "PARTIALLY_RECEIVED", "DISCREPANCY"];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeTransferNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `ST-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function mapTransfer(row) {
  return {
    id: toNumber(row.id),
    companyId: toNumber(row.companyId),
    fromStoreId: toNumber(row.fromStoreId),
    toStoreId: toNumber(row.toStoreId),
    transferNo: row.transferNo || "",
    status: row.status || "DRAFT",
    shippedAt: row.shippedAt || null,
    receivedAt: row.receivedAt || null,
    note: row.note || "",
    fromStoreName: row.fromStoreName || "",
    toStoreName: row.toStoreName || "",
    createdByName: row.createdByName || "",
    receivedByName: row.receivedByName || "",
    itemSummary: row.itemSummary || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function mapItem(row) {
  return {
    id: toNumber(row.id),
    transferId: toNumber(row.transferId),
    fromProductId: toNumber(row.fromProductId),
    toProductId: toNumber(row.toProductId),
    sku: row.sku || "",
    productName: row.productName || "",
    quantityShipped: toNumber(row.quantityShipped),
    quantityReceived: toNumber(row.quantityReceived),
    unitCost: Number(row.unitCost || 0),
    note: row.note || "",
    fromStock: row.fromStock === undefined ? null : toNumber(row.fromStock),
    toStock: row.toStock === undefined ? null : toNumber(row.toStock)
  };
}

async function loadCompanyStore(companyId, storeId, relationshipTypes = []) {
  const params = [companyId, storeId];
  let relationshipSql = "";
  if (relationshipTypes.length) {
    relationshipSql = ` AND cs.relationship_type IN (${relationshipTypes.map(() => "?").join(",")})`;
    params.push(...relationshipTypes);
  }
  const [rows] = await pool.query(
    `
      SELECT cs.store_id AS storeId, cs.relationship_type AS relationshipType, s.name AS storeName
      FROM company_stores cs
      INNER JOIN stores s ON s.id = cs.store_id
      WHERE cs.company_id = ?
        AND cs.store_id = ?
        AND cs.status = 'ACTIVE'
        ${relationshipSql}
      LIMIT 1
    `,
    params
  );
  return rows[0] || null;
}

async function assertCompanyStores(companyId, fromStoreId, toStoreId) {
  const fromStore = await loadCompanyStore(companyId, fromStoreId, ["HEADQUARTERS", "WAREHOUSE"]);
  if (!fromStore) {
    throw createError("出貨門市必須是總部或本部倉庫", 400);
  }
  const toStore = await loadCompanyStore(companyId, toStoreId, ["FRANCHISE_STORE", "DIRECT_STORE"]);
  if (!toStore) {
    throw createError("收貨門市必須是加盟或直營門市", 400);
  }
  if (fromStoreId === toStoreId) {
    throw createError("出貨與收貨門市不可相同", 400);
  }
  return { fromStore, toStore };
}

async function hasStoreAdminAccess(staffUserId, storeId) {
  if (!staffUserId || !storeId) return false;
  const [membershipRows] = await pool.query(
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

  const [staffRows] = await pool.query(
    "SELECT role, store_id AS storeId FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1",
    [staffUserId]
  );
  const staff = staffRows[0];
  return Boolean(staff && Number(staff.storeId) === Number(storeId) && ["ADMIN", "MANAGER"].includes(String(staff.role || "").toUpperCase()));
}

async function canReceiveTransfer(req, transfer) {
  if (Number(req.storeId || req.user?.storeId || 0) === Number(transfer.toStoreId) && await hasStoreAdminAccess(req.user.id, transfer.toStoreId)) {
    return true;
  }
  const membership = await loadCompanyMembership(req.user.id, transfer.companyId);
  return Boolean(membership && HQ_WRITE_ROLES.includes(membership.role));
}

async function loadTransfer(transferId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        st.id,
        st.company_id AS companyId,
        st.from_store_id AS fromStoreId,
        st.to_store_id AS toStoreId,
        st.transfer_no AS transferNo,
        st.status,
        st.shipped_at AS shippedAt,
        st.received_at AS receivedAt,
        st.note,
        fs.name AS fromStoreName,
        ts.name AS toStoreName,
        cb.display_name AS createdByName,
        rb.display_name AS receivedByName,
        st.created_at AS createdAt,
        st.updated_at AS updatedAt
      FROM store_transfers st
      INNER JOIN stores fs ON fs.id = st.from_store_id
      INNER JOIN stores ts ON ts.id = st.to_store_id
      LEFT JOIN staff_users cb ON cb.id = st.created_by_staff_id
      LEFT JOIN staff_users rb ON rb.id = st.received_by_staff_id
      WHERE st.id = ?
      LIMIT 1
    `,
    [transferId]
  );
  return rows[0] ? mapTransfer(rows[0]) : null;
}

async function loadTransferItems(transferId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        sti.id,
        sti.transfer_id AS transferId,
        sti.from_product_id AS fromProductId,
        sti.to_product_id AS toProductId,
        sti.sku_snapshot AS sku,
        sti.product_name_snapshot AS productName,
        sti.quantity_shipped AS quantityShipped,
        sti.quantity_received AS quantityReceived,
        sti.unit_cost AS unitCost,
        sti.note,
        fp.stock AS fromStock,
        tp.stock AS toStock
      FROM store_transfer_items sti
      INNER JOIN products fp ON fp.id = sti.from_product_id
      INNER JOIN products tp ON tp.id = sti.to_product_id
      WHERE sti.transfer_id = ?
      ORDER BY sti.id ASC
    `,
    [transferId]
  );
  return rows.map(mapItem);
}

async function insertItems(connection, transferId, companyId, fromStoreId, toStoreId, items = []) {
  if (!Array.isArray(items) || !items.length) {
    throw createError("請至少加入一個出貨商品", 400);
  }

  await assertCompanyStores(companyId, fromStoreId, toStoreId);
  for (const rawItem of items) {
    const fromProductId = Number(rawItem.fromProductId || rawItem.from_product_id || 0);
    const quantity = Number(rawItem.quantity || rawItem.quantityShipped || rawItem.quantity_shipped || 0);
    if (!Number.isSafeInteger(fromProductId) || fromProductId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw createError("出貨商品與數量不正確", 400);
    }

    const [fromRows] = await connection.query(
      "SELECT id, sku, name, stock, cost_price AS costPrice FROM products WHERE id = ? AND store_id = ? LIMIT 1",
      [fromProductId, fromStoreId]
    );
    const fromProduct = fromRows[0];
    if (!fromProduct) {
      throw createError("出貨商品不屬於出貨門市", 400);
    }

    const [toRows] = await connection.query(
      "SELECT id FROM products WHERE sku = ? AND store_id = ? LIMIT 1",
      [fromProduct.sku, toStoreId]
    );
    const toProduct = toRows[0];
    if (!toProduct) {
      throw createError("門市商品未建立，請先於收貨門市建立相同 SKU 商品", 400);
    }

    await connection.query(
      `
        INSERT INTO store_transfer_items
          (transfer_id, from_product_id, to_product_id, sku_snapshot, product_name_snapshot, quantity_shipped, unit_cost, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        transferId,
        fromProduct.id,
        toProduct.id,
        fromProduct.sku,
        fromProduct.name,
        quantity,
        rawItem.unitCost === undefined ? Number(fromProduct.costPrice || 0) : Number(rawItem.unitCost || 0),
        rawItem.note || null
      ]
    );
  }
}

router.use(authenticate);

router.get("/company/:companyId/products/transfer-candidates", requireCompanyRole(HQ_READ_ROLES), async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const fromStoreId = Number(req.query.fromStoreId || 0);
    const toStoreId = Number(req.query.toStoreId || 0);
    const q = String(req.query.q || "").trim();
    await assertCompanyStores(companyId, fromStoreId, toStoreId);

    const params = [toStoreId, fromStoreId];
    let searchSql = "";
    if (q) {
      searchSql = " AND (fp.sku LIKE ? OR fp.name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `
        SELECT
          fp.id AS fromProductId,
          tp.id AS toProductId,
          fp.sku,
          fp.name,
          fp.stock AS fromStock,
          tp.stock AS toStock,
          fp.cost_price AS unitCost
        FROM products fp
        LEFT JOIN products tp ON tp.store_id = ? AND tp.sku = fp.sku
        WHERE fp.store_id = ?
          ${searchSql}
        ORDER BY fp.sku ASC
        LIMIT 50
      `,
      params
    );
    return res.json({ ok: true, products: rows.map((row) => ({ ...row, mapped: Boolean(row.toProductId) })) });
  } catch (error) {
    return next(error);
  }
});

router.get("/company/:companyId", requireCompanyRole(HQ_READ_ROLES), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          st.id,
          st.company_id AS companyId,
          st.from_store_id AS fromStoreId,
          st.to_store_id AS toStoreId,
          st.transfer_no AS transferNo,
          st.status,
          st.shipped_at AS shippedAt,
          st.received_at AS receivedAt,
          st.note,
          fs.name AS fromStoreName,
          ts.name AS toStoreName,
          cb.display_name AS createdByName,
          rb.display_name AS receivedByName,
          GROUP_CONCAT(CONCAT(sti.sku_snapshot, ' x', sti.quantity_shipped, IF(sti.quantity_received > 0, CONCAT(' / 已入庫 ', sti.quantity_received), '')) ORDER BY sti.id SEPARATOR '；') AS itemSummary,
          st.created_at AS createdAt,
          st.updated_at AS updatedAt
        FROM store_transfers st
        INNER JOIN stores fs ON fs.id = st.from_store_id
        INNER JOIN stores ts ON ts.id = st.to_store_id
        LEFT JOIN staff_users cb ON cb.id = st.created_by_staff_id
        LEFT JOIN staff_users rb ON rb.id = st.received_by_staff_id
        LEFT JOIN store_transfer_items sti ON sti.transfer_id = st.id
        WHERE st.company_id = ?
        GROUP BY
          st.id,
          st.company_id,
          st.from_store_id,
          st.to_store_id,
          st.transfer_no,
          st.status,
          st.shipped_at,
          st.received_at,
          st.note,
          fs.name,
          ts.name,
          cb.display_name,
          rb.display_name,
          st.created_at,
          st.updated_at
        ORDER BY st.id DESC
        LIMIT 200
      `,
      [req.params.companyId]
    );
    return res.json({ ok: true, transfers: rows.map(mapTransfer) });
  } catch (error) {
    return next(error);
  }
});

router.post("/company/:companyId", requireCompanyRole(HQ_WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const fromStoreId = Number(req.body.fromStoreId || 0);
    const toStoreId = Number(req.body.toStoreId || 0);
    const result = await withTransaction(async (connection) => {
      await assertCompanyStores(companyId, fromStoreId, toStoreId);
      const [insertResult] = await connection.query(
        `
          INSERT INTO store_transfers
            (company_id, from_store_id, to_store_id, transfer_no, status, created_by_staff_id, note)
          VALUES (?, ?, ?, ?, 'DRAFT', ?, ?)
        `,
        [companyId, fromStoreId, toStoreId, makeTransferNo(), req.user.id, req.body.note || null]
      );
      await insertItems(connection, insertResult.insertId, companyId, fromStoreId, toStoreId, req.body.items);
      return insertResult.insertId;
    });
    const transfer = await loadTransfer(result);
    transfer.items = await loadTransferItems(result);
    return res.status(201).json({ ok: true, transfer });
  } catch (error) {
    return next(error);
  }
});

router.get("/company/:companyId/:transferId", async (req, res, next) => {
  try {
    const transfer = await loadTransfer(req.params.transferId);
    if (!transfer || transfer.companyId !== Number(req.params.companyId)) {
      return res.status(404).json({ message: "找不到出貨單" });
    }
    const membership = await loadCompanyMembership(req.user.id, transfer.companyId);
    const relatedStoreAdmin = [transfer.fromStoreId, transfer.toStoreId].includes(Number(req.storeId || req.user.storeId || 0)) &&
      await hasStoreAdminAccess(req.user.id, Number(req.storeId || req.user.storeId || 0));
    if (!membership && !relatedStoreAdmin) {
      return res.status(403).json({ message: "沒有出貨單權限" });
    }
    transfer.items = await loadTransferItems(transfer.id);
    return res.json({ ok: true, transfer });
  } catch (error) {
    return next(error);
  }
});

router.patch("/company/:companyId/:transferId", requireCompanyRole(HQ_WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const transferId = Number(req.params.transferId);
    await withTransaction(async (connection) => {
      const [rows] = await connection.query("SELECT * FROM store_transfers WHERE id = ? AND company_id = ? FOR UPDATE", [transferId, companyId]);
      const transfer = rows[0];
      if (!transfer) throw createError("找不到出貨單", 404);
      if (transfer.status !== "DRAFT") throw createError("只有草稿可修改", 409);
      await connection.query("UPDATE store_transfers SET note = ? WHERE id = ?", [req.body.note || null, transferId]);
      if (Array.isArray(req.body.items)) {
        await connection.query("DELETE FROM store_transfer_items WHERE transfer_id = ?", [transferId]);
        await insertItems(connection, transferId, companyId, Number(transfer.from_store_id), Number(transfer.to_store_id), req.body.items);
      }
    });
    const transfer = await loadTransfer(transferId);
    transfer.items = await loadTransferItems(transferId);
    return res.json({ ok: true, transfer });
  } catch (error) {
    return next(error);
  }
});

router.post("/company/:companyId/:transferId/ship", requireCompanyRole(HQ_WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const transferId = Number(req.params.transferId);
    await withTransaction(async (connection) => {
      const [transferRows] = await connection.query("SELECT * FROM store_transfers WHERE id = ? AND company_id = ? FOR UPDATE", [transferId, companyId]);
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
        await connection.query("UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?", [item.quantity_shipped, item.from_product_id, transfer.from_store_id]);
        await connection.query(
          `
            INSERT INTO inventory_movements
              (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
            VALUES (?, ?, 'OUT', ?, 'STORE_TRANSFER', ?, ?, ?)
          `,
          [
            transfer.from_store_id,
            item.from_product_id,
            -Math.abs(Number(item.quantity_shipped || 0)),
            transferId,
            req.user.id,
            `Store transfer ${transfer.transfer_no} to ${toStore?.name || transfer.to_store_id}`
          ]
        );
      }
      await connection.query("UPDATE store_transfers SET status = 'SHIPPED', shipped_at = NOW() WHERE id = ?", [transferId]);
    });
    const transfer = await loadTransfer(transferId);
    transfer.items = await loadTransferItems(transferId);
    return res.json({ ok: true, transfer });
  } catch (error) {
    return next(error);
  }
});

router.post("/company/:companyId/:transferId/cancel", requireCompanyRole(HQ_WRITE_ROLES), async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "UPDATE store_transfers SET status = 'CANCELED' WHERE id = ? AND company_id = ? AND status = 'DRAFT'",
      [req.params.transferId, req.params.companyId]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ message: "只有草稿可取消" });
    }
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/inbound", requireStoreScope(), requireStoreRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          st.id,
          st.company_id AS companyId,
          st.from_store_id AS fromStoreId,
          st.to_store_id AS toStoreId,
          st.transfer_no AS transferNo,
          st.status,
          st.shipped_at AS shippedAt,
          st.received_at AS receivedAt,
          st.note,
          fs.name AS fromStoreName,
          ts.name AS toStoreName,
          GROUP_CONCAT(CONCAT(sti.sku_snapshot, ' x', sti.quantity_shipped, IF(sti.quantity_received > 0, CONCAT(' / 已入庫 ', sti.quantity_received), '')) ORDER BY sti.id SEPARATOR '；') AS itemSummary,
          st.created_at AS createdAt,
          st.updated_at AS updatedAt
        FROM store_transfers st
        INNER JOIN stores fs ON fs.id = st.from_store_id
        INNER JOIN stores ts ON ts.id = st.to_store_id
        LEFT JOIN store_transfer_items sti ON sti.transfer_id = st.id
        WHERE st.to_store_id = ?
          AND st.status IN ('SHIPPED','PARTIALLY_RECEIVED','DISCREPANCY')
        GROUP BY
          st.id,
          st.company_id,
          st.from_store_id,
          st.to_store_id,
          st.transfer_no,
          st.status,
          st.shipped_at,
          st.received_at,
          st.note,
          fs.name,
          ts.name,
          st.created_at,
          st.updated_at
        ORDER BY st.shipped_at DESC, st.id DESC
      `,
      [req.storeId]
    );
    return res.json({ ok: true, transfers: rows.map(mapTransfer) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:transferId/receive", requireStoreScope(), async (req, res, next) => {
  try {
    const transferId = Number(req.params.transferId);
    const transfer = await loadTransfer(transferId);
    if (!transfer) return res.status(404).json({ message: "找不到出貨單" });
    if (!await canReceiveTransfer(req, transfer)) {
      return res.status(403).json({ message: "沒有入庫確認權限" });
    }
    if (transfer.status === "RECEIVED") {
      return res.status(409).json({ message: "此出貨單已完成入庫" });
    }
    if (!OPEN_STATUSES.includes(transfer.status)) {
      return res.status(409).json({ message: "此出貨單目前不可入庫" });
    }

    await withTransaction(async (connection) => {
      const [transferRows] = await connection.query("SELECT * FROM store_transfers WHERE id = ? FOR UPDATE", [transferId]);
      const lockedTransfer = transferRows[0];
      if (!lockedTransfer || lockedTransfer.status === "RECEIVED" || !OPEN_STATUSES.includes(lockedTransfer.status)) {
        throw createError("此出貨單目前不可入庫", 409);
      }

      const receiveItems = Array.isArray(req.body.items) ? req.body.items : [];
      if (!receiveItems.length) throw createError("請輸入入庫數量", 400);
      const receiveById = new Map(receiveItems.map((item) => [Number(item.itemId || item.id), item]));
      const [items] = await connection.query("SELECT * FROM store_transfer_items WHERE transfer_id = ? FOR UPDATE", [transferId]);

      let totalReceived = 0;
      let totalShipped = 0;
      let changed = false;
      for (const item of items) {
        const input = receiveById.get(Number(item.id));
        const shipped = Number(item.quantity_shipped || 0);
        const currentReceived = Number(item.quantity_received || 0);
        let delta = 0;
        if (input) {
          if (input.quantityReceived !== undefined) {
            const nextReceived = Number(input.quantityReceived);
            if (!Number.isSafeInteger(nextReceived) || nextReceived < currentReceived || nextReceived > shipped) {
              throw createError("入庫累計數量不正確", 400);
            }
            delta = nextReceived - currentReceived;
          } else {
            delta = Number(input.receiveQuantity || input.delta || 0);
            if (!Number.isSafeInteger(delta) || delta < 0 || currentReceived + delta > shipped) {
              throw createError("本次入庫數量不正確", 400);
            }
          }
        }

        if (delta > 0) {
          await connection.query("UPDATE store_transfer_items SET quantity_received = quantity_received + ?, note = COALESCE(?, note) WHERE id = ?", [delta, input.note || null, item.id]);
          await connection.query("UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?", [delta, item.to_product_id, lockedTransfer.to_store_id]);
          await connection.query(
            `
              INSERT INTO inventory_movements
                (store_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
              VALUES (?, ?, 'IN', ?, 'STORE_TRANSFER', ?, ?, ?)
            `,
            [
              lockedTransfer.to_store_id,
              item.to_product_id,
              delta,
              transferId,
              req.user.id,
              `Store transfer ${lockedTransfer.transfer_no} received`
            ]
          );
          changed = true;
        }

        totalReceived += currentReceived + delta;
        totalShipped += shipped;
      }

      if (!changed) {
        throw createError("沒有新的入庫數量", 400);
      }

      const discrepancyConfirmed = Boolean(req.body.discrepancyConfirmed);
      const nextStatus = totalReceived >= totalShipped ? "RECEIVED" : (discrepancyConfirmed ? "DISCREPANCY" : "PARTIALLY_RECEIVED");
      await connection.query(
        "UPDATE store_transfers SET status = ?, received_at = IF(? = 'RECEIVED', NOW(), received_at), received_by_staff_id = ?, note = COALESCE(?, note) WHERE id = ?",
        [nextStatus, nextStatus, req.user.id, req.body.note || null, transferId]
      );
    });

    const updated = await loadTransfer(transferId);
    updated.items = await loadTransferItems(transferId);
    return res.json({ ok: true, transfer: updated });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
