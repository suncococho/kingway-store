const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toText(value, fallback = "") {
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

router.get("/stores", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.id,
        s.code,
        s.name,
        s.status,
        s.plan,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS productCount,
        (SELECT COUNT(*) FROM customers c WHERE c.store_id = s.id) AS customerCount,
        (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS orderCount,
        (SELECT COUNT(*) FROM repair_orders r WHERE r.store_id = s.id) AS repairCount
      FROM stores s
      ORDER BY s.id ASC
    `);

    const stores = rows.map((row) => ({
      id: toNumber(row.id),
      code: toText(row.code, "UNKNOWN"),
      name: toText(row.name, ""),
      status: toText(row.status, "unknown"),
      plan: toText(row.plan, "unknown"),
      productCount: toNumber(row.productCount),
      customerCount: toNumber(row.customerCount),
      orderCount: toNumber(row.orderCount),
      repairCount: toNumber(row.repairCount)
    }));

    return res.json({
      ok: true,
      environment: toText(process.env.APP_ENV || process.env.NODE_ENV, "unknown"),
      schemaGuard: getSchemaGuardStatus(),
      totalStores: stores.length,
      stores
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
