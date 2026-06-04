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
      pendingTasks
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
