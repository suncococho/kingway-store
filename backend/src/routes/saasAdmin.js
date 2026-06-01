const express = require("express");
const { pool } = require("../db");
const { authenticatePlatformAdmin } = require("../middleware/platformAuth");

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

router.use(authenticatePlatformAdmin);

router.get("/stores", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CAST(s.id AS UNSIGNED) AS id,
        s.code,
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
      name: t(row.code, "UNKNOWN"),
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
