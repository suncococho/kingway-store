const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

const STORE_STAFF_FEATURE_KEYS = [
  "sales_dashboard_enabled",
  "coupons_enabled",
  "suppliers_enabled",
  "inventory_enabled",
  "purchase_confirmations_enabled",
  "repairs_enabled",
  "staff_management_enabled"
];

function resolveStoreId(req) {
  const rawStoreId = req.storeId ?? req.user?.store_id ?? req.user?.storeId ?? 1;
  const storeId = Number(rawStoreId);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 1;
}

function buildFeatureResponse(row) {
  return STORE_STAFF_FEATURE_KEYS.reduce((features, key) => {
    features[key] = row?.[key] === undefined || row?.[key] === null ? true : Boolean(row[key]);
    return features;
  }, {});
}

router.use(authenticate, authorize());

router.get("/me", async (req, res, next) => {
  try {
    const storeId = resolveStoreId(req);
    req.storeId = storeId;
    req.store_id = storeId;

    const [rows] = await pool.query(
      "SELECT " + STORE_STAFF_FEATURE_KEYS.join(", ") + " FROM store_features WHERE store_id = ? LIMIT 1",
      [storeId]
    );

    return res.json({
      ok: true,
      features: buildFeatureResponse(rows[0] || null)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
