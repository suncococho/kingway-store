const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  archiveMessage,
  createMessage,
  getMessages,
  getPendingMessages,
  getRecipients,
  getUnreadSummary,
  markRead,
  resolveMessageContext
} = require("../services/internalMessageService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/recipients", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const recipients = await getRecipients(context);
    res.json(recipients);
  } catch (error) {
    next(error);
  }
});

router.get("/pending", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const messages = await getPendingMessages(context, { limit: req.query.limit });
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

router.get("/unread-count", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    res.json(await getUnreadSummary(context));
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const messages = await getMessages(context, req.query);
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const message = await createMessage(req.body || {}, context);
    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/read", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const message = await markRead(req.params.id, context);
    res.json({ message });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/archive", async (req, res, next) => {
  try {
    const context = await resolveMessageContext(req);
    const message = await archiveMessage(req.params.id, context);
    res.json({ message });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
