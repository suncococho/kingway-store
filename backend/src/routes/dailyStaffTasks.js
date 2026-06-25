const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  createTaskSetting,
  getTaskInstances,
  getTaskSettings,
  getTodayTasks,
  resolveDailyTaskContext,
  seedDefaultTasks,
  updateInstanceStatus,
  updateTaskSetting
} = require("../services/dailyStaffTaskService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/today", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const result = await getTodayTasks(context);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const tasks = await getTaskInstances(context, req.query);
    res.json({ tasks });
  } catch (error) {
    next(error);
  }
});

router.post("/:instanceId/done", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const task = await updateInstanceStatus(req.params.instanceId, context, "done", req.body?.note || null);
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

router.post("/:instanceId/skip", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const task = await updateInstanceStatus(req.params.instanceId, context, "skip", req.body?.note || null);
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const settings = await getTaskSettings(context);
    res.json({ settings, canManageSettings: context.canManageSettings });
  } catch (error) {
    next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const setting = await createTaskSetting(context, req.body || {});
    res.status(201).json({ setting });
  } catch (error) {
    next(error);
  }
});

router.patch("/settings/:id", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const setting = await updateTaskSetting(req.params.id, context, req.body || {});
    res.json({ setting });
  } catch (error) {
    next(error);
  }
});

router.post("/settings/seed-defaults", async (req, res, next) => {
  try {
    const context = await resolveDailyTaskContext(req);
    const result = await seedDefaultTasks(context);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
