const express = require("express");
const { authenticate, authorize } = require("../middleware/auth");
const { getPublicStoreSettings, getSettingsSnapshot, saveSettingsScope } = require("../services/settingsService");

const router = express.Router();

router.get("/public", async (req, res, next) => {
  try {
    const store = await getPublicStoreSettings();
    return res.json(store);
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate, authorize(["ADMIN", "MANAGER"]));

router.get("/", async (req, res, next) => {
  try {
    const snapshot = await getSettingsSnapshot();
    return res.json(snapshot);
  } catch (error) {
    return next(error);
  }
});

router.patch("/store", async (req, res, next) => {
  try {
    const settings = await saveSettingsScope("STORE", req.body || {}, req.user?.id || null);
    return res.json({ store: settings });
  } catch (error) {
    return next(error);
  }
});

router.patch("/system", async (req, res, next) => {
  try {
    const settings = await saveSettingsScope("SYSTEM", req.body || {}, req.user?.id || null);
    return res.json({ system: settings });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
