const express = require("express");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { getPublicStoreSettings, getSettingsSnapshot, saveSettingsScope } = require("../services/settingsService");

const router = express.Router();

router.get("/public", async (req, res, next) => {
  try {
    const store = await getPublicStoreSettings(1);
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
