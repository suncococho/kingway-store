const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  createVisitRecord,
  getVisitRecord,
  getVisitRecords,
  getVisitRecordSummary,
  resolveVisitRecordContext,
  updateVisitRecord
} = require("../services/storeVisitRecordService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/", async (req, res, next) => {
  try {
    const context = await resolveVisitRecordContext(req);
    const result = await getVisitRecords(context, req.query || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/summary", async (req, res, next) => {
  try {
    const context = await resolveVisitRecordContext(req);
    const summary = await getVisitRecordSummary(context, req.query || {});
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const context = await resolveVisitRecordContext(req);
    const result = await getVisitRecord(context, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const context = await resolveVisitRecordContext(req);
    const result = await createVisitRecord(context, req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const context = await resolveVisitRecordContext(req);
    const result = await updateVisitRecord(context, req.params.id, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
