const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { getPendingTaskCounts } = require("../services/taskService");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]));

router.get("/summary", async (req, res, next) => {
  try {
    const [[totals]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM customers) AS customers,
          (SELECT COUNT(*) FROM products) AS products,
          (SELECT COUNT(*) FROM orders) AS orders,
          (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE business_date = CURRENT_DATE()) AS salesToday
      `
    );

    const pendingTasks = await getPendingTaskCounts();

    return res.json({
      totals: {
        customers: Number(totals.customers || 0),
        products: Number(totals.products || 0),
        orders: Number(totals.orders || 0),
        salesToday: Number(totals.salesToday || 0)
      },
      pendingTasks
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
