const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  createStoreLineChannel,
  dryRunStoreLineChannel,
  getStoreLineChannel,
  getWebhookPreview,
  listStoreLineChannels,
  resolveStoreLineChannelContext,
  updateStoreLineChannel
} = require("../services/storeLineChannelService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const result = await listStoreLineChannels(context, req.query || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/webhook-preview", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const preview = getWebhookPreview(context, req.query || {});
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const result = await getStoreLineChannel(context, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const result = await createStoreLineChannel(context, req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const result = await updateStoreLineChannel(context, req.params.id, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/dry-run-test", async (req, res, next) => {
  try {
    const context = await resolveStoreLineChannelContext(req);
    const result = await dryRunStoreLineChannel(context, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
