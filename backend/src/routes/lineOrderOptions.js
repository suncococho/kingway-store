const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  getLineOrderOptionConfig,
  upsertLineOrderOptionSettings,
  listLineOrderOptionProductCandidates,
  normalizeGroupPayload,
  normalizeGroupProductPayload
} = require("../services/lineOrderOptionService");

const router = express.Router();

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER"]));

function getRequestStoreId(req) {
  const rawStoreId = req.storeId || req.user?.storeId || req.user?.store_id || 1;
  const storeId = Number(rawStoreId);
  return Number.isSafeInteger(storeId) && storeId > 0 ? storeId : 1;
}

function getRequestStaffId(req) {
  const staffId = Number(req.user?.id || 0);
  return Number.isSafeInteger(staffId) && staffId > 0 ? staffId : null;
}

async function assertGroupCodeAvailable(connection, storeId, code, excludeGroupId = null) {
  const params = [storeId, code];
  let sql = `
    SELECT id
    FROM line_order_option_groups
    WHERE store_id = ?
      AND code = ?
      AND deleted_at IS NULL
  `;
  if (excludeGroupId) {
    sql += " AND id <> ?";
    params.push(excludeGroupId);
  }
  sql += " LIMIT 1";
  const [rows] = await connection.query(sql, params);
  if (rows[0]) {
    throw Object.assign(new Error("同一門市內群組代碼已存在"), { statusCode: 409 });
  }
}

async function assertProductBelongsToStore(connection, storeId, productId) {
  const [rows] = await connection.query(
    `
      SELECT id
      FROM products
      WHERE id = ?
        AND store_id = ?
        AND is_active = 1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [productId, storeId]
  );
  if (!rows[0]) {
    throw Object.assign(new Error("找不到此門市可連結的商品"), { statusCode: 400 });
  }
}

async function assertGroupBelongsToStore(connection, storeId, groupId) {
  const [rows] = await connection.query(
    `
      SELECT id
      FROM line_order_option_groups
      WHERE id = ?
        AND store_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [groupId, storeId]
  );
  if (!rows[0]) {
    throw Object.assign(new Error("找不到選配群組"), { statusCode: 404 });
  }
}

router.get("/", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.get("/products", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const result = await listLineOrderOptionProductCandidates(pool, storeId, {
      q: req.query.q ?? req.query.search,
      category: req.query.category,
      inStock: req.query.inStock,
      excludeGroupId: req.query.excludeGroupId,
      limit: req.query.limit,
      offset: req.query.offset,
      page: req.query.page
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const staffId = getRequestStaffId(req);
    await upsertLineOrderOptionSettings(pool, storeId, req.body || {}, staffId);

    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.post("/groups", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const staffId = getRequestStaffId(req);
    const payload = normalizeGroupPayload(req.body || {});

    await assertGroupCodeAvailable(pool, storeId, payload.code);
    await pool.query(
      `
        INSERT INTO line_order_option_groups
          (store_id, code, label, description, is_required, min_select, max_select, sort_order, is_active, created_by_staff_id, updated_by_staff_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        storeId,
        payload.code,
        payload.label,
        payload.description,
        payload.isRequired ? 1 : 0,
        payload.minSelect,
        payload.maxSelect,
        payload.sortOrder,
        payload.isActive ? 1 : 0,
        staffId,
        staffId
      ]
    );

    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.status(201).json(config);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內群組代碼已存在";
    }
    next(error);
  }
});

router.put("/groups/:id", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const groupId = Number(req.params.id);
    const staffId = getRequestStaffId(req);
    const payload = normalizeGroupPayload(req.body || {});

    await assertGroupBelongsToStore(pool, storeId, groupId);
    await assertGroupCodeAvailable(pool, storeId, payload.code, groupId);
    await pool.query(
      `
        UPDATE line_order_option_groups
        SET code = ?,
            label = ?,
            description = ?,
            is_required = ?,
            min_select = ?,
            max_select = ?,
            sort_order = ?,
            is_active = ?,
            updated_by_staff_id = ?
        WHERE id = ?
          AND store_id = ?
          AND deleted_at IS NULL
      `,
      [
        payload.code,
        payload.label,
        payload.description,
        payload.isRequired ? 1 : 0,
        payload.minSelect,
        payload.maxSelect,
        payload.sortOrder,
        payload.isActive ? 1 : 0,
        staffId,
        groupId,
        storeId
      ]
    );

    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.json(config);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "同一門市內群組代碼已存在";
    }
    next(error);
  }
});

router.delete("/groups/:id", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const groupId = Number(req.params.id);
    await assertGroupBelongsToStore(pool, storeId, groupId);
    await pool.query(
      `
        UPDATE line_order_option_groups
        SET deleted_at = NOW(),
            is_active = 0,
            updated_by_staff_id = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [getRequestStaffId(req), groupId, storeId]
    );
    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.post("/groups/:id/products", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const groupId = Number(req.params.id);
    const payload = normalizeGroupProductPayload(req.body || {});

    const config = await withTransaction(async (tx) => {
      await assertGroupBelongsToStore(tx, storeId, groupId);
      await assertProductBelongsToStore(tx, storeId, payload.productId);
      await tx.query(
        `
          INSERT INTO line_order_option_group_products
            (store_id, option_group_id, product_id, sort_order, custom_display_name, custom_price, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            sort_order = VALUES(sort_order),
            custom_display_name = VALUES(custom_display_name),
            custom_price = VALUES(custom_price),
            is_active = VALUES(is_active)
        `,
        [
          storeId,
          groupId,
          payload.productId,
          payload.sortOrder,
          payload.customDisplayName,
          payload.customPrice,
          payload.isActive ? 1 : 0
        ]
      );
      return getLineOrderOptionConfig(tx, storeId, { includeInactive: true });
    });

    res.status(201).json(config);
  } catch (error) {
    next(error);
  }
});

router.put("/groups/:groupId/products/:linkId", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const groupId = Number(req.params.groupId);
    const linkId = Number(req.params.linkId);
    const payload = normalizeGroupProductPayload(req.body || {});

    const config = await withTransaction(async (tx) => {
      await assertGroupBelongsToStore(tx, storeId, groupId);
      await assertProductBelongsToStore(tx, storeId, payload.productId);
      const [result] = await tx.query(
        `
          UPDATE line_order_option_group_products
          SET product_id = ?,
              sort_order = ?,
              custom_display_name = ?,
              custom_price = ?,
              is_active = ?
          WHERE id = ?
            AND option_group_id = ?
            AND store_id = ?
        `,
        [
          payload.productId,
          payload.sortOrder,
          payload.customDisplayName,
          payload.customPrice,
          payload.isActive ? 1 : 0,
          linkId,
          groupId,
          storeId
        ]
      );
      if (!result.affectedRows) {
        throw Object.assign(new Error("找不到群組商品"), { statusCode: 404 });
      }
      return getLineOrderOptionConfig(tx, storeId, { includeInactive: true });
    });

    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.delete("/groups/:groupId/products/:linkId", async (req, res, next) => {
  try {
    const storeId = getRequestStoreId(req);
    const groupId = Number(req.params.groupId);
    const linkId = Number(req.params.linkId);
    await assertGroupBelongsToStore(pool, storeId, groupId);
    await pool.query(
      `
        DELETE FROM line_order_option_group_products
        WHERE id = ?
          AND option_group_id = ?
          AND store_id = ?
      `,
      [linkId, groupId, storeId]
    );
    const config = await getLineOrderOptionConfig(pool, storeId, { includeInactive: true });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
