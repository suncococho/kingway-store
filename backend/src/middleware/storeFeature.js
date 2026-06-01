const { pool } = require("../db");

const ALLOWED_FEATURE_KEYS = new Set([
  "pos_enabled",
  "orders_enabled",
  "repairs_enabled",
  "inventory_enabled",
  "suppliers_enabled",
  "coupons_enabled",
  "purchase_confirmations_enabled",
  "line_enabled",
  "telegram_enabled",
  "sales_dashboard_enabled",
  "staff_management_enabled"
]);

function resolveStoreId(req) {
  const rawStoreId = req.storeId ?? req.user?.store_id ?? req.user?.storeId ?? 1;
  const storeId = Number(rawStoreId);
  return Number.isFinite(storeId) && storeId > 0 ? storeId : 1;
}

function requireStoreFeature(featureKey) {
  if (!ALLOWED_FEATURE_KEYS.has(featureKey)) {
    throw new Error("Unsupported store feature key: " + featureKey);
  }

  return async (req, res, next) => {
    try {
      const storeId = resolveStoreId(req);
      req.storeId = storeId;
      req.store_id = storeId;

      await pool.query(
        `
          INSERT INTO store_features (store_id)
          VALUES (?)
          ON DUPLICATE KEY UPDATE store_id = VALUES(store_id)
        `,
        [storeId]
      );

      const [rows] = await pool.query(
        "SELECT " + featureKey + " AS enabled FROM store_features WHERE store_id = ? LIMIT 1",
        [storeId]
      );

      if (!rows[0] || rows[0].enabled === null || rows[0].enabled === undefined) {
        return next();
      }

      if (!Boolean(rows[0].enabled)) {
        return res.status(403).json({ message: "此店鋪功能目前已關閉" });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireStoreFeature
};
