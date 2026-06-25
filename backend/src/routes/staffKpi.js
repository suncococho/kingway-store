const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  getKpiEvents,
  getKpiSummary,
  resolveStaffKpiContext
} = require("../services/staffKpiService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/summary", async (req, res, next) => {
  try {
    const context = await resolveStaffKpiContext(req);
    const summary = await getKpiSummary({ context, query: req.query });
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const context = await resolveStaffKpiContext(req);
    const events = await getKpiEvents({ context, query: req.query });
    res.json({ events });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
