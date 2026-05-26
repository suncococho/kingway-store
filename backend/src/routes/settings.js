const express = require("express");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { pool } = require("../db");
const { getPublicStoreSettings, getSettingsSnapshot, saveSettingsScope } = require("../services/settingsService");
const {
  SOURCE,
  createPublicStoreContextMiddleware
} = require("../utils/publicStoreResolver");

const router = express.Router();

const resolvePublicStoreContext = createPublicStoreContextMiddleware({
  db: pool,
  legacyFallbackMode: SOURCE.LEGACY_KINGWAY_FALLBACK,
  legacyFallbackStoreId: 1,
  legacyFallbackAllowUnverifiedStore: true
});

router.get("/public", resolvePublicStoreContext, async (req, res, next) => {
  try {
    const storeId = req.publicStoreContext?.storeId || null;
    if (!storeId) {
      return res.status(404).json({ message: "目前無法取得門市公開設定" });
    }

    const store = await getPublicStoreSettings(storeId);
    return res.json(store);
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate, authorize(["ADMIN", "MANAGER"]));

router.get("/", requireStoreScope(), async (req, res, next) => {
  try {
    const snapshot = await getSettingsSnapshot(req.storeId);
    return res.json(snapshot);
  } catch (error) {
    return next(error);
  }
});

router.patch("/store", requireStoreScope(), requireStoreRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const settings = await saveSettingsScope(req.storeId, "STORE", req.body || {}, req.user?.id || null);
    return res.json({ store: settings });
  } catch (error) {
    return next(error);
  }
});

router.patch("/system", requireStoreScope(), requireStoreRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const settings = await saveSettingsScope(req.storeId, "SYSTEM", req.body || {}, req.user?.id || null);
    return res.json({ system: settings });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
