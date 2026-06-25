const express = require("express");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const {
  createEvaluationNote,
  getEvaluationNotes,
  resolveEvaluationContext
} = require("../services/staffEvaluationService");

const router = express.Router();

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"])
);

router.get("/notes", async (req, res, next) => {
  try {
    const context = await resolveEvaluationContext(req);
    const notes = await getEvaluationNotes({
      context,
      staffUserId: req.query.staffUserId,
      storeId: req.query.storeId,
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd
    });
    res.json({ notes });
  } catch (error) {
    next(error);
  }
});

router.post("/notes", async (req, res, next) => {
  try {
    const context = await resolveEvaluationContext(req);
    const note = await createEvaluationNote({
      context,
      evaluatorStaffUserId: req.user?.id,
      staffUserId: req.body?.staffUserId,
      periodStart: req.body?.periodStart,
      periodEnd: req.body?.periodEnd,
      rating: req.body?.rating,
      note: req.body?.note
    });
    res.status(201).json({ note });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
