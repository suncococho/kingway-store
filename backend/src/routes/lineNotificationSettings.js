const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  disableStoreNotificationSetting,
  disableSupplierNotificationSetting,
  dryRunStoreNotification,
  dryRunSupplierNotification,
  getStoreNotificationSettings,
  getSupplierNotificationSettings,
  resolveLineNotificationContext,
  upsertStoreNotificationSetting,
  upsertSupplierNotificationSetting
} = require("../services/lineNotificationSettingsService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/store", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const settings = await getStoreNotificationSettings(context);
    res.json({ settings, canManageSettings: context.canManageSettings });
  } catch (error) {
    next(error);
  }
});

router.patch("/store", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const setting = await upsertStoreNotificationSetting(context, req.body || {});
    res.json({ setting });
  } catch (error) {
    next(error);
  }
});

router.post("/store/:id/disable", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    await disableStoreNotificationSetting(context, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const settings = await getSupplierNotificationSettings(context, req.query);
    res.json({ settings, canManageSettings: context.canManageSettings });
  } catch (error) {
    next(error);
  }
});

router.patch("/suppliers/:supplierId", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const setting = await upsertSupplierNotificationSetting(context, req.params.supplierId, req.body || {});
    res.json({ setting });
  } catch (error) {
    next(error);
  }
});

router.post("/suppliers/:supplierId/disable", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    await disableSupplierNotificationSetting(context, req.params.supplierId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/test-store", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const result = await dryRunStoreNotification(context, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/test-supplier/:supplierId", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const result = await dryRunSupplierNotification(context, req.params.supplierId, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
