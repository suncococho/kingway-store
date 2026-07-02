const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { getPendingTaskCounts } = require("../services/taskService");
const { canViewSalesManagement } = require("../utils/roleAccess");

const router = express.Router();

const VALID_STATUS_LIST = "'cancelled', 'canceled', 'deleted', 'CANCELED', 'CANCELLED', 'DELETED'";
const REPAIR_PICKUP_EXCLUDED_STATUSES = "'picked_up', 'completed', 'canceled', 'CANCELED', 'CANCELLED', 'DELETED'";
const INVALID_REPAIR_WORKFLOW_VALUES = "'rejected', 'declined', 'cancelled', 'canceled', 'cancel'";
const VALID_ORDER_WHERE = "deleted_at IS NULL AND status NOT IN (" + VALID_STATUS_LIST + ")";

const VALID_REPAIR_WHERE = VALID_ORDER_WHERE;

let cachedProductFilter = null;

function getOrderWhereClause(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}deleted_at IS NULL AND ${prefix}status NOT IN (${VALID_STATUS_LIST})`;
}

function getRepairWhereClause(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return [
    `${prefix}deleted_at IS NULL`,
    `${prefix}status NOT IN (${VALID_STATUS_LIST})`,
    `LOWER(COALESCE(${prefix}status, '')) NOT IN (${INVALID_REPAIR_WORKFLOW_VALUES})`,
    `LOWER(COALESCE(${prefix}customer_estimate_response, '')) NOT IN (${INVALID_REPAIR_WORKFLOW_VALUES})`
  ].join(" AND ");
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

async function getProductFilterClause() {
  if (cachedProductFilter !== null) {
    return cachedProductFilter;
  }

  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME IN ('deleted_at', 'is_active', 'status')"
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    const parts = [];
    if (columns.has("deleted_at")) {
      parts.push("deleted_at IS NULL");
    }
    if (columns.has("is_active")) {
      parts.push("is_active = 1");
    }
    if (columns.has("status")) {
      parts.push("status NOT IN ('deleted', 'DELETED')");
    }
    cachedProductFilter = parts.length ? ` AND ${parts.join(" AND ")}` : "";
  } catch (error) {
    cachedProductFilter = "";
  }

  return cachedProductFilter;
}

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]));

router.get("/summary", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(403).json({ message: "Store scope required" });
    }

    const productFilterClause = await getProductFilterClause();

    const [[totals]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM customers WHERE store_id = ?) AS customers,
          (SELECT COUNT(*) FROM products WHERE store_id = ?${productFilterClause}) AS products,
          (SELECT COUNT(*) FROM orders WHERE store_id = ? AND ${VALID_ORDER_WHERE}) AS orders,
          (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE store_id = ? AND business_date = CURRENT_DATE() AND ${VALID_ORDER_WHERE}) AS salesToday,
          (SELECT COUNT(*) FROM orders WHERE store_id = ? AND is_reservation_order = 1 AND final_payment_status <> 'PAID' AND ${VALID_ORDER_WHERE}) AS depositOrdersPending,
          (SELECT COUNT(*) FROM products WHERE store_id = ?${productFilterClause} AND stock <= reorder_level) AS lowStockCount,
          (SELECT COUNT(*) FROM supplier_requests WHERE store_id = ? AND status IN ('PENDING_SUPPLIER','APPROVED','PARTIALLY_RECEIVED')) AS supplierRequestsPending
      `,
      [storeId, storeId, storeId, storeId, storeId, storeId, storeId]
    );

    const [pendingBikeDeliveries] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          COALESCE(c.name, o.customer_name, '-') AS customerName,
          COALESCE(c.phone, o.customer_phone, '-') AS customerPhone,
          COALESCE(
            GROUP_CONCAT(DISTINCT oi.product_name_snapshot ORDER BY oi.id SEPARATOR ' / '),
            '-'
          ) AS bikeModel,
          o.total_amount AS totalAmount,
          o.deposit_amount AS depositAmount,
          o.unpaid_balance AS unpaidBalance,
          o.final_payment_status AS finalPaymentStatus,
          o.payment_method AS paymentMethod,
          o.business_date AS businessDate,
          o.handover_confirmed_at AS handoverConfirmedAt
        FROM orders o
        INNER JOIN order_items oi
          ON oi.order_id = o.id
          AND oi.store_id = o.store_id
          AND oi.product_category_snapshot IN ('EB', 'EBIKE')
        LEFT JOIN customers c
          ON c.id = o.customer_id
          AND c.store_id = o.store_id
        WHERE o.store_id = ?
          AND ${getOrderWhereClause("o")}
          AND o.handover_confirmed_at IS NULL
        GROUP BY
          o.id,
          o.order_no,
          c.name,
          c.phone,
          o.customer_name,
          o.customer_phone,
          o.total_amount,
          o.deposit_amount,
          o.unpaid_balance,
          o.final_payment_status,
          o.payment_method,
          o.business_date,
          o.handover_confirmed_at
        ORDER BY o.id DESC
        LIMIT 10
      `,
      [storeId]
    );

    const [[pendingBikeDeliveryAggregate]] = await pool.query(
      `
        SELECT COUNT(DISTINCT o.id) AS pendingBikeDeliveryCount
        FROM orders o
        INNER JOIN order_items oi
          ON oi.order_id = o.id
          AND oi.store_id = o.store_id
          AND oi.product_category_snapshot IN ('EB', 'EBIKE')
        WHERE o.store_id = ?
          AND ${getOrderWhereClause("o")}
          AND o.handover_confirmed_at IS NULL
      `,
      [storeId]
    );

    const [pendingRepairPickups] = await pool.query(
      `
        SELECT
          ro.id,
          COALESCE(c.name, '-') AS customerName,
          COALESCE(c.phone, '-') AS customerPhone,
          ro.bike_model AS bikeModel,
          ro.status,
          ro.reservation_date AS reservationDate,
          ro.completed_at AS completedAt,
          ro.created_at AS createdAt
        FROM repair_orders ro
        INNER JOIN customers c
          ON c.id = ro.customer_id
          AND c.store_id = ro.store_id
        LEFT JOIN orders linked_o
          ON linked_o.id = ro.order_id
          AND linked_o.store_id = ro.store_id
        WHERE ro.store_id = ?
          AND ${getRepairWhereClause("ro")}
          AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
          AND ro.status NOT IN (${REPAIR_PICKUP_EXCLUDED_STATUSES})
          AND ro.picked_up_at IS NULL
        ORDER BY ro.id DESC
        LIMIT 10
      `,
      [storeId]
    );

    const [[pendingRepairPickupAggregate]] = await pool.query(
      `
        SELECT COUNT(*) AS pendingRepairPickupCount
        FROM repair_orders ro
        LEFT JOIN orders linked_o
          ON linked_o.id = ro.order_id
          AND linked_o.store_id = ro.store_id
        WHERE ro.store_id = ?
          AND ${getRepairWhereClause("ro")}
          AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
          AND ro.status NOT IN (${REPAIR_PICKUP_EXCLUDED_STATUSES})
          AND ro.picked_up_at IS NULL
      `,
      [storeId]
    );

    const [pendingPaymentOrders] = await pool.query(
      `
        SELECT
          o.id,
          o.order_no AS orderNo,
          COALESCE(c.name, o.customer_name, '-') AS customerName,
          COALESCE(c.phone, o.customer_phone, '-') AS customerPhone,
          COALESCE(
            GROUP_CONCAT(DISTINCT oi.product_name_snapshot ORDER BY oi.id SEPARATOR ' / '),
            '-'
          ) AS bikeModel,
          o.total_amount AS totalAmount,
          o.deposit_amount AS depositAmount,
          o.unpaid_balance AS unpaidBalance,
          o.final_payment_status AS finalPaymentStatus,
          o.payment_method AS paymentMethod,
          o.business_date AS businessDate
        FROM orders o
        INNER JOIN order_items oi
          ON oi.order_id = o.id
          AND oi.store_id = o.store_id
        LEFT JOIN customers c
          ON c.id = o.customer_id
          AND c.store_id = o.store_id
        WHERE o.store_id = ?
          AND ${getOrderWhereClause("o")}
          ${buildInvalidLinkedRepairOrderClause("o")}
          AND (COALESCE(o.unpaid_balance, 0) > 0 OR COALESCE(o.final_payment_status, 'UNPAID') <> 'PAID')
        GROUP BY
          o.id,
          o.order_no,
          c.name,
          c.phone,
          o.customer_name,
          o.customer_phone,
          o.total_amount,
          o.deposit_amount,
          o.unpaid_balance,
          o.final_payment_status,
          o.payment_method,
          o.business_date
        ORDER BY o.id DESC
        LIMIT 10
      `,
      [storeId]
    );

    const [[pendingPaymentAggregate]] = await pool.query(
      `
        SELECT
          COUNT(*) AS pendingPaymentCount,
          COALESCE(SUM(unpaid_balance), 0) AS pendingPaymentAmount
        FROM orders o
        WHERE o.store_id = ?
          AND ${getOrderWhereClause("o")}
          ${buildInvalidLinkedRepairOrderClause("o")}
          AND (COALESCE(o.unpaid_balance, 0) > 0 OR COALESCE(o.final_payment_status, 'UNPAID') <> 'PAID')
      `,
      [storeId]
    );

    const pendingTasks = await getPendingTaskCounts(storeId);

    const [[visitSummaryRow]] = await pool.query(
      `
        SELECT
          COUNT(*) AS todayVisitRecordsCount,
          COALESCE(SUM(visitor_count), 0) AS todayVisitorCount,
          COALESCE(SUM(CASE WHEN line_friend_added = 1 THEN 1 ELSE 0 END), 0) AS todayLineFriendAddedCount,
          COALESCE(SUM(CASE WHEN follow_up_required = 1 THEN 1 ELSE 0 END), 0) AS todayFollowUpRequiredCount,
          COALESCE(SUM(CASE WHEN visit_result = 'PURCHASED' THEN 1 ELSE 0 END), 0) AS todayPurchasedCount,
          COALESCE(SUM(CASE WHEN visit_result = 'NEED_FOLLOW_UP' THEN 1 ELSE 0 END), 0) AS todayNeedFollowUpCount
        FROM store_visit_records
        WHERE store_id = ?
          AND visit_date = CURRENT_DATE()
      `,
      [storeId]
    );

    const canViewSalesSummary = canViewSalesManagement(req.user || {});

    return res.json({
      totals: {
        customers: Number(totals.customers || 0),
        products: Number(totals.products || 0),
        orders: Number(totals.orders || 0),
        salesToday: canViewSalesSummary ? Number(totals.salesToday || 0) : null,
        canViewSalesSummary,
        depositOrdersPending: Number(totals.depositOrdersPending || 0),
        lowStockCount: Number(totals.lowStockCount || 0),
        supplierRequestsPending: Number(totals.supplierRequestsPending || 0)
      },
      pendingTasks,
      visitSummary: {
        todayVisitRecordsCount: Number(visitSummaryRow?.todayVisitRecordsCount || 0),
        todayVisitorCount: Number(visitSummaryRow?.todayVisitorCount || 0),
        todayLineFriendAddedCount: Number(visitSummaryRow?.todayLineFriendAddedCount || 0),
        todayFollowUpRequiredCount: Number(visitSummaryRow?.todayFollowUpRequiredCount || 0),
        todayPurchasedCount: Number(visitSummaryRow?.todayPurchasedCount || 0),
        todayNeedFollowUpCount: Number(visitSummaryRow?.todayNeedFollowUpCount || 0)
      },
      pendingBikeDeliveries: pendingBikeDeliveries.map((row) => ({
        ...row,
        totalAmount: Number(row.totalAmount || 0),
        depositAmount: Number(row.depositAmount || 0),
        unpaidBalance: Number(row.unpaidBalance || 0)
      })),
      pendingRepairPickups,
      pendingPaymentOrders: pendingPaymentOrders.map((row) => ({
        ...row,
        totalAmount: Number(row.totalAmount || 0),
        depositAmount: Number(row.depositAmount || 0),
        unpaidBalance: Number(row.unpaidBalance || 0)
      })),
      pendingBikeDeliveryCount: Number(pendingBikeDeliveryAggregate?.pendingBikeDeliveryCount || 0),
      pendingRepairPickupCount: Number(pendingRepairPickupAggregate?.pendingRepairPickupCount || 0),
      pendingPaymentCount: Number(pendingPaymentAggregate?.pendingPaymentCount || 0),
      pendingPaymentAmount: Number(pendingPaymentAggregate?.pendingPaymentAmount || 0)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
