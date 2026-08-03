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
  "staff_management_enabled",
  "staff_workday_selection_enabled"
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

      const [rows] = await pool.query(
        "SELECT " + featureKey + " AS enabled FROM store_features WHERE store_id = ? LIMIT 1",
        [storeId]
      );

      if (!rows[0]) {
        await pool.query(
          `
            INSERT IGNORE INTO store_features (store_id)
            VALUES (?)
          `,
          [storeId]
        );
        if (featureKey === "staff_workday_selection_enabled") return res.status(403).json({ message: "員工工作日申請功能尚未啟用。", errorCode: "FEATURE_DISABLED" });
        return next();
      }

      if (rows[0].enabled === null || rows[0].enabled === undefined) {
        if (featureKey === "staff_workday_selection_enabled") return res.status(403).json({ message: "員工工作日申請功能尚未啟用。", errorCode: "FEATURE_DISABLED" });
        return next();
      }

      if (!Boolean(rows[0].enabled)) {
        return res.status(403).json({ message: "此功能未啟用，請聯絡平台管理員。", errorCode: "FEATURE_DISABLED" });
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
