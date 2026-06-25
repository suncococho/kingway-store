const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  createNotification,
  getNotifications,
  getPendingNotifications,
  getUnreadSummary,
  resolveNotificationContext,
  updateNotificationStatus
} = require("../services/staffNotificationService");
const {
  getUnreadSummary: getMessageUnreadSummary,
  resolveMessageContext
} = require("../services/internalMessageService");
const {
  getDailyTaskSummary,
  resolveDailyTaskContext
} = require("../services/dailyStaffTaskService");

const staffNotificationsRouter = express.Router();
const staffDashboardRouter = express.Router();
const staffAuth = [
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
];

staffNotificationsRouter.use(...staffAuth);
staffDashboardRouter.use(...staffAuth);

staffNotificationsRouter.get("/pending", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notifications = await getPendingNotifications(context, { limit: req.query.limit });
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.get("/", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notifications = await getNotifications(context, req.query);
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.post("/:id/read", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notification = await updateNotificationStatus(req.params.id, context, "read");
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.post("/:id/done", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notification = await updateNotificationStatus(req.params.id, context, "done");
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.post("/:id/dismiss", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notification = await updateNotificationStatus(req.params.id, context, "dismiss");
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.post("/:id/snooze", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notification = await updateNotificationStatus(req.params.id, context, "snooze", {
      minutes: req.body?.minutes
    });
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

staffNotificationsRouter.post("/test", async (req, res, next) => {
  try {
    if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    const context = await resolveNotificationContext(req);
    const notification = await createNotification({
      storeId: context.storeId,
      staffUserId: req.body?.staffUserId || null,
      type: "TEST_NOTIFICATION",
      title: req.body?.title || "測試通知",
      message: req.body?.message || "這是 POS 中央彈窗測試",
      targetUrl: req.body?.targetUrl || "/notifications",
      priority: req.body?.priority || "IMPORTANT"
    });
    res.status(201).json({ notification });
  } catch (error) {
    next(error);
  }
});

staffDashboardRouter.get("/unread-summary", async (req, res, next) => {
  try {
    const context = await resolveNotificationContext(req);
    const notificationSummary = await getUnreadSummary(context);
    let messageSummary = { messages: 0, urgentMessages: 0 };
    let dailyTaskSummary = { dailyTasks: 0, overdueDailyTasks: 0 };
    try {
      const messageContext = await resolveMessageContext(req);
      messageSummary = await getMessageUnreadSummary(messageContext);
    } catch (messageError) {
      if (messageError?.code !== "ER_NO_SUCH_TABLE") {
        throw messageError;
      }
    }
    try {
      const dailyTaskContext = await resolveDailyTaskContext(req);
      dailyTaskSummary = await getDailyTaskSummary(dailyTaskContext, { createNotifications: true });
    } catch (dailyTaskError) {
      if (dailyTaskError?.code !== "ER_NO_SUCH_TABLE") {
        throw dailyTaskError;
      }
    }
    res.json({
      notifications: notificationSummary.notifications,
      messages: messageSummary.messages,
      dailyTasks: dailyTaskSummary.dailyTasks,
      overdueDailyTasks: dailyTaskSummary.overdueDailyTasks,
      urgent: notificationSummary.urgent + messageSummary.urgentMessages + dailyTaskSummary.overdueDailyTasks,
      urgentNotifications: notificationSummary.urgent,
      urgentMessages: messageSummary.urgentMessages
    });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  staffNotificationsRouter,
  staffDashboardRouter
};
