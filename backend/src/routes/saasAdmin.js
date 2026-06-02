const express = require("express");
const { pool } = require("../db");
const { authenticatePlatformAdmin, requirePlatformRole } = require("../middleware/platformAuth");
const {
  FEATURE_KEYS,
  ProvisioningError,
  deriveSlugFromCode,
  provisionStore
} = require("../services/storeProvisioningService");

const router = express.Router();

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function t(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function getSchemaGuardStatus() {
  const requireStoreIdSchema = String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true";
  return {
    requireStoreIdSchema,
    status: requireStoreIdSchema ? "STRICT_ON" : "WARN_ONLY"
  };
}

const FEATURE_CONFIG = [
  { key: "pos_enabled", label: "POS 銷售", description: "門市 POS 開單與收款流程。" },
  { key: "orders_enabled", label: "訂單管理", description: "訂單查詢、狀態追蹤與訂金尾款管理。" },
  { key: "repairs_enabled", label: "維修管理", description: "維修預約、報價、完修與問卷流程。" },
  { key: "inventory_enabled", label: "庫存管理", description: "商品庫存、異動與低庫存檢視。" },
  { key: "suppliers_enabled", label: "供應商管理", description: "發注、退貨與供應商確認流程。" },
  { key: "coupons_enabled", label: "優惠券管理", description: "新好友與 Google 評論優惠券管理。" },
  { key: "purchase_confirmations_enabled", label: "購買確認書", description: "購買確認書送出、簽名與 PDF 留存。" },
  { key: "line_enabled", label: "LINE 流程", description: "客戶 LINE 綁定、通知與確認按鈕流程。" },
  { key: "telegram_enabled", label: "Telegram 通知", description: "舊通知相容開關；不修改 token 設定。" },
  { key: "sales_dashboard_enabled", label: "銷售儀表板", description: "銷售統計、營運數據與管理報表。" },
  { key: "staff_management_enabled", label: "員工管理", description: "出勤、KPI、薪資與營運檢查事項。" }
];

function rowToFeatures(row) {
  return FEATURE_CONFIG.map((feature) => ({
    ...feature,
    enabled: Boolean(row?.[feature.key])
  }));
}

async function getStore(storeId) {
  const [rows] = await pool.query(
    `
      SELECT id, code, name, status, plan
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );

  const store = rows[0];
  if (!store) return null;

  return {
    id: n(store.id),
    code: t(store.code, "UNKNOWN"),
    name: t(store.name, t(store.code, "UNKNOWN")),
    slug: deriveSlugFromCode(store.code),
    status: t(store.status, "unknown"),
    plan: t(store.plan, "unknown")
  };
}

async function ensureStoreFeatureRow(storeId) {
  const [rows] = await pool.query(
    "SELECT id FROM store_features WHERE store_id = ? LIMIT 1",
    [storeId]
  );

  if (rows[0]) {
    return;
  }

  await pool.query(
    `
      INSERT IGNORE INTO store_features (store_id)
      VALUES (?)
    `,
    [storeId]
  );
}

async function getStoreFeatureRow(storeId) {
  await ensureStoreFeatureRow(storeId);
  const [rows] = await pool.query(
    "SELECT " + FEATURE_KEYS.join(", ") + " FROM store_features WHERE store_id = ? LIMIT 1",
    [storeId]
  );
  return rows[0] || null;
}

function buildStoreFeatureResponse(store, featureRow) {
  return {
    ok: true,
    readOnly: false,
    store,
    features: rowToFeatures(featureRow)
  };
}

router.use(authenticatePlatformAdmin);
router.use(requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN", "SUPPORT"]));

router.post("/stores", requirePlatformRole(["PLATFORM_OWNER", "PLATFORM_ADMIN"]), async (req, res, next) => {
  try {
    const result = await provisionStore(req.body, req.platformAdmin);
    return res.status(201).json({
      ok: true,
      store: result.store,
      owner: {
        username: result.owner.username
      },
      temporaryPassword: result.temporaryPassword
    });
  } catch (error) {
    if (error instanceof ProvisioningError) {
      return res.status(error.status).json({
        message: error.message,
        details: error.details || undefined
      });
    }

    console.error("[saasAdmin/stores:create] failed", error);
    return next(error);
  }
});

router.get("/stores/:id/features", async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    const featureRow = await getStoreFeatureRow(storeId);
    return res.json(buildStoreFeatureResponse(store, featureRow));
  } catch (error) {
    console.error("[saasAdmin/storeFeatures:get] failed", error);
    return next(error);
  }
});

router.patch("/stores/:id/features", async (req, res, next) => {
  try {
    const storeId = n(req.params.id, 0);
    if (!storeId) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = await getStore(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    await ensureStoreFeatureRow(storeId);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = [];
    const values = [];

    for (const key of FEATURE_KEYS) {
      if (typeof body[key] === "boolean") {
        updates.push(key + " = ?");
        values.push(body[key] ? 1 : 0);
      }
    }

    if (updates.length) {
      values.push(storeId);
      await pool.query("UPDATE store_features SET " + updates.join(", ") + " WHERE store_id = ?", values);
    }

    const featureRow = await getStoreFeatureRow(storeId);
    return res.json(buildStoreFeatureResponse(store, featureRow));
  } catch (error) {
    console.error("[saasAdmin/storeFeatures:patch] failed", error);
    return next(error);
  }
});

router.get("/stores", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CAST(s.id AS UNSIGNED) AS id,
        s.code,
        s.name,
        s.status,
        s.plan,
        CAST((SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS UNSIGNED) AS productCount,
        CAST((SELECT COUNT(*) FROM customers c WHERE c.store_id = s.id) AS UNSIGNED) AS customerCount,
        CAST((SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS UNSIGNED) AS orderCount,
        CAST((SELECT COUNT(*) FROM repair_orders r WHERE r.store_id = s.id) AS UNSIGNED) AS repairCount
      FROM stores s
      ORDER BY s.id ASC
    `);

    const stores = rows.map((row) => ({
      id: n(row.id),
      code: t(row.code, "UNKNOWN"),
      name: t(row.name, t(row.code, "UNKNOWN")),
      slug: deriveSlugFromCode(row.code),
      status: t(row.status, "unknown"),
      plan: t(row.plan, "unknown"),
      productCount: n(row.productCount),
      customerCount: n(row.customerCount),
      orderCount: n(row.orderCount),
      repairCount: n(row.repairCount)
    }));

    return res.json({
      ok: true,
      environment: t(process.env.APP_ENV || process.env.NODE_ENV, "unknown"),
      schemaGuard: getSchemaGuardStatus(),
      totalStores: stores.length,
      totals: stores.reduce((acc, store) => {
        acc.productCount += store.productCount;
        acc.customerCount += store.customerCount;
        acc.orderCount += store.orderCount;
        acc.repairCount += store.repairCount;
        return acc;
      }, { productCount: 0, customerCount: 0, orderCount: 0, repairCount: 0 }),
      stores
    });
  } catch (error) {
    console.error("[saasAdmin/stores] failed", error);
    return next(error);
  }
});

module.exports = router;
