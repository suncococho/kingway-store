const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { getPendingTaskCounts } = require("../services/taskService");

const router = express.Router();

router.use(authenticate, requireStoreScope(), authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]));

router.get("/summary", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(403).json({ message: "Store scope required" });
    }

    const [[totals]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM customers WHERE store_id = ?) AS customers,
          (SELECT COUNT(*) FROM products WHERE store_id = ?) AS products,
          (SELECT COUNT(*) FROM orders WHERE store_id = ?) AS orders,
          (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE store_id = ? AND business_date = CURRENT_DATE()) AS salesToday,
          (SELECT COUNT(*) FROM orders WHERE store_id = ? AND is_reservation_order = 1 AND final_payment_status <> 'PAID') AS depositOrdersPending,
          (SELECT COUNT(*) FROM products WHERE store_id = ? AND stock <= reorder_level) AS lowStockCount,
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
          AND o.deleted_at IS NULL
          AND o.status NOT IN ('CANCELED', 'CANCELLED')
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
          AND o.deleted_at IS NULL
          AND o.status NOT IN ('CANCELED', 'CANCELLED')
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
        WHERE ro.store_id = ?
          AND ro.deleted_at IS NULL
          AND ro.picked_up_at IS NULL
          AND ro.status NOT IN ('picked_up', 'completed', 'canceled', 'CANCELED')
        ORDER BY ro.id DESC
        LIMIT 10
      `,
      [storeId]
    );

    const [[pendingRepairPickupAggregate]] = await pool.query(
      `
        SELECT COUNT(*) AS pendingRepairPickupCount
        FROM repair_orders ro
        WHERE ro.store_id = ?
          AND ro.deleted_at IS NULL
          AND ro.picked_up_at IS NULL
          AND ro.status NOT IN ('picked_up', 'completed', 'canceled', 'CANCELED')
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
          AND o.deleted_at IS NULL
          AND o.status NOT IN ('CANCELED', 'CANCELLED')
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
        FROM orders
        WHERE store_id = ?
          AND deleted_at IS NULL
          AND status NOT IN ('CANCELED', 'CANCELLED')
          AND (COALESCE(unpaid_balance, 0) > 0 OR COALESCE(final_payment_status, 'UNPAID') <> 'PAID')
      `,
      [storeId]
    );

    const pendingTasks = await getPendingTaskCounts(storeId);

    return res.json({
      totals: {
        customers: Number(totals.customers || 0),
        products: Number(totals.products || 0),
        orders: Number(totals.orders || 0),
        salesToday: Number(totals.salesToday || 0),
        depositOrdersPending: Number(totals.depositOrdersPending || 0),
        lowStockCount: Number(totals.lowStockCount || 0),
        supplierRequestsPending: Number(totals.supplierRequestsPending || 0)
      },
      pendingTasks,
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
