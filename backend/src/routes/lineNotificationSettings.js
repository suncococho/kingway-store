const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  ignoreCandidate,
  linkCandidateToStore,
  linkCandidateToSupplier,
  listCandidates,
  maskLineId
} = require("../services/lineGroupCandidateService");
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

router.get("/group-candidates", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const candidates = await listCandidates(context, req.query || {});
    res.json({ candidates, canManageSettings: context.canManageSettings });
  } catch (error) {
    next(error);
  }
});

router.post("/group-candidates/:id/ignore", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const result = await ignoreCandidate(context, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/group-candidates/:id/link-store", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const result = await linkCandidateToStore(context, req.params.id, req.body || {});
    res.json({
      ok: true,
      candidate: result.candidate,
      setting: result.setting ? {
        ...result.setting,
        targetId: undefined,
        targetIdMasked: maskLineId(result.setting.targetId)
      } : null,
      targetPreview: maskLineId(result.setting?.targetId)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/group-candidates/:id/link-supplier", async (req, res, next) => {
  try {
    const context = await resolveLineNotificationContext(req);
    const result = await linkCandidateToSupplier(context, req.params.id, req.body || {});
    res.json({
      ok: true,
      candidate: result.candidate,
      setting: result.setting ? {
        ...result.setting,
        lineGroupId: undefined,
        lineGroupIdMasked: maskLineId(result.setting.lineGroupId)
      } : null,
      targetPreview: maskLineId(result.setting?.lineGroupId)
    });
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
