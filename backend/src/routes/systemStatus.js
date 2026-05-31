const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

router.get("/saas-status", async (req, res, next) => {
  try {
    const storeId = toNumber(req.storeId || req.user?.store_id || req.user?.storeId || 1, 1);

    const [[storeRow]] = await pool.query(
      `
        SELECT id, code, name, status, plan
        FROM stores
        WHERE id = ?
        LIMIT 1
      `,
      [storeId]
    );

    const [[countsRow]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM products WHERE store_id = ?) AS productCount,
          (SELECT COUNT(*) FROM customers WHERE store_id = ?) AS customerCount,
          (SELECT COUNT(*) FROM orders WHERE store_id = ?) AS orderCount,
          (SELECT COUNT(*) FROM repair_orders WHERE store_id = ?) AS repairCount
      `,
      [storeId, storeId, storeId, storeId]
    );

    const store = storeRow
      ? {
          id: toNumber(storeRow.id, storeId),
          code: toText(storeRow.code, "UNKNOWN"),
          name: toText(storeRow.name, "UNKNOWN"),
          status: toText(storeRow.status, "unknown"),
          plan: toText(storeRow.plan, "unknown")
        }
      : {
          id: storeId,
          code: "UNKNOWN",
          name: "UNKNOWN",
          status: "unknown",
          plan: "unknown"
        };

    const counts = {
      productCount: toNumber(countsRow?.productCount, 0),
      customerCount: toNumber(countsRow?.customerCount, 0),
      orderCount: toNumber(countsRow?.orderCount, 0),
      repairCount: toNumber(countsRow?.repairCount, 0)
    };

    return res.json({
      ok: true,
      environment: toText(process.env.APP_ENV || process.env.NODE_ENV, "unknown"),
      schemaGuard: {
        requireStoreIdSchema: String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true",
        status: "STRICT_ON"
      },
      store,
      counts,
      ports: {
        frontend: 5180,
        backend: 3010
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
