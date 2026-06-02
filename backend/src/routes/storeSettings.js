const express = require("express");
const { authenticate, requireStoreScope } = require("../middleware/auth");
const {
  getStoreProfileSettings,
  saveStoreProfileSettings
} = require("../services/storeProfileSettingsService");

const router = express.Router();

function requireStoreProfileWriteRole(req, res, next) {
  const role = String(req.user?.role || "").toUpperCase().trim();
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return res.status(403).json({ message: "Insufficient store role" });
  }
  return next();
}

router.use(authenticate, requireStoreScope());

router.get("/settings", async (req, res, next) => {
  try {
    const store = await getStoreProfileSettings(req.storeId);
    return res.json({ store });
  } catch (error) {
    return next(error);
  }
});

router.patch("/settings", requireStoreProfileWriteRole, async (req, res, next) => {
  try {
    const store = await saveStoreProfileSettings(req.storeId, req.body || {}, req.user?.id || null);
    return res.json({ store });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
