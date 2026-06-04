const { pool } = require("../db");

async function getPendingTaskCounts(storeId) {
  const normalizedStoreId = Number(storeId);
  if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
    const error = new Error("Store scope required");
    error.status = 403;
    throw error;
  }

  const [[purchaseConfirmations]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM purchase_confirmations
      WHERE store_id = ?
        AND status = 'PENDING'
    `,
    [normalizedStoreId]
  );

  const [[repairReservations]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM repair_orders
      WHERE store_id = ?
        AND status IN ('checking', 'reserved', 'estimate_pending_approval', 'estimate_approved', 'completed_waiting_pickup')
    `,
    [normalizedStoreId]
  );

  const [[reviewApprovals]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM coupons
      WHERE store_id = ?
        AND coupon_type = 'google_review'
        AND approved_by_staff_id IS NULL
    `,
    [normalizedStoreId]
  );

  const [[surveyPending]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM surveys s
      INNER JOIN customers c ON c.id = s.customer_id
      WHERE c.store_id = ?
        AND s.rating = 0
    `,
    [normalizedStoreId]
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
