const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  getCashReportByDate,
  getCashReports,
  getCashReportSummary,
  getTaipeiToday,
  resolveCashReportContext,
  upsertCashReport
} = require("../services/storeCashReportService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveCashReportContext(req);
    const result = await getCashReports(context, req.query || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/today", async (req, res, next) => {
  try {
    const context = await resolveCashReportContext(req);
    const result = await getCashReportByDate(
      context,
      req.query?.storeId || context.storeId,
      req.query?.reportDate || getTaipeiToday()
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/summary", async (req, res, next) => {
  try {
    const context = await resolveCashReportContext(req);
    const summary = await getCashReportSummary(context, req.query || {});
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const context = await resolveCashReportContext(req);
    const result = await upsertCashReport(context, req.body || {});
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
