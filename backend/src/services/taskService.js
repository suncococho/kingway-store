const { pool } = require("../db");

const INVALID_STATUS_LIST = "'cancelled', 'canceled', 'deleted', 'CANCELED', 'CANCELLED', 'DELETED'";
const PICKUP_PENDING_REPAIR_STATES = "'picked_up', 'completed', 'canceled', 'CANCELED', 'CANCELLED', 'DELETED'";
const INVALID_REPAIR_WORKFLOW_VALUES = "'rejected', 'declined', 'cancelled', 'canceled', 'cancel'";

function getValidOrderWhereClause(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}deleted_at IS NULL AND ${prefix}status NOT IN (${INVALID_STATUS_LIST})`;
}

function buildInvalidLinkedRepairOrderClause(orderAlias = "o") {
  return `AND NOT EXISTS (
    SELECT 1
    FROM repair_orders ro_invalid
    WHERE ro_invalid.store_id = ${orderAlias}.store_id
      AND (ro_invalid.order_id = ${orderAlias}.id OR ro_invalid.id = ${orderAlias}.repair_order_id)
      AND (
        ro_invalid.deleted_at IS NOT NULL
        OR LOWER(COALESCE(ro_invalid.status, '')) IN (${INVALID_REPAIR_WORKFLOW_VALUES})
        OR LOWER(COALESCE(ro_invalid.customer_estimate_response, '')) IN (${INVALID_REPAIR_WORKFLOW_VALUES})
      )
  )`;
}

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
      FROM purchase_confirmations pc
      LEFT JOIN orders o
        ON o.id = pc.order_id
       AND o.store_id = pc.store_id
      WHERE pc.store_id = ?
        AND pc.status = 'PENDING'
        AND (
          pc.order_id IS NULL
          OR (o.id IS NOT NULL AND ${getValidOrderWhereClause("o")} ${buildInvalidLinkedRepairOrderClause("o")})
        )
    `,
    [normalizedStoreId]
  );

  const [[repairReservations]] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM repair_orders ro
      LEFT JOIN orders linked_o
        ON linked_o.id = ro.order_id
       AND linked_o.store_id = ro.store_id
      WHERE ro.store_id = ?
        AND ro.deleted_at IS NULL
        AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
        AND LOWER(COALESCE(ro.status, '')) NOT IN (${INVALID_REPAIR_WORKFLOW_VALUES})
        AND LOWER(COALESCE(ro.customer_estimate_response, '')) NOT IN (${INVALID_REPAIR_WORKFLOW_VALUES})
        AND ro.status NOT IN (${PICKUP_PENDING_REPAIR_STATES})
        AND ro.picked_up_at IS NULL
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
