const { pool } = require("../db");

async function getPendingTaskCounts() {
  const [[purchaseConfirmations]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM purchase_confirmations
      WHERE status = 'PENDING'
    `
  );

  const [[repairReservations]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM repair_orders
      WHERE status IN ('reserved', 'estimate_pending_approval', 'completed_waiting_pickup')
    `
  );

  const [[reviewApprovals]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM coupons
      WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL
    `
  );

  const [[surveyPending]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM surveys
      WHERE rating = 0
    `
  );

  return {
    purchaseConfirmationsPending: Number(purchaseConfirmations.count || 0),
    repairReservationsPending: Number(repairReservations.count || 0),
    repairPickupPending: Number(repairReservations.count || 0),
    googleReviewApprovalsPending: Number(reviewApprovals.count || 0),
    surveyPending: Number(surveyPending.count || 0)
  };
}

module.exports = {
  getPendingTaskCounts
};
