const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR"]));

router.get("/repairs-visibility", async (req, res, next) => {
  try {
    const repairColumns = await getTableColumns(pool, "repair_orders");
    const customerColumns = await getTableColumns(pool, "customers");
    const orderColumns = await getTableColumns(pool, "orders");
    const orderItemColumns = await getTableColumns(pool, "order_items");
    const canClassifyOrderRepairs = hasColumn(orderItemColumns, "product_category_snapshot");

    const repairOrdersSql = `
      SELECT
        ${selectColumn(repairColumns, "ro", "id", "id")},
        'REPAIR_ORDER' AS repairSource,
        ${selectColumn(repairColumns, "ro", "customer_id", "customerId")},
        ${selectColumn(customerColumns, "c", "name", "customerName")},
        ${selectColumn(customerColumns, "c", "phone", "customerPhone")},
        ${selectColumn(customerColumns, "c", "line_user_id", "lineUserId")},
        COALESCE(${selectColumn(repairColumns, "ro", "customer_type", "repairCustomerType", "NULL").replace(" AS `repairCustomerType`", "")}, ${selectColumn(customerColumns, "c", "customer_type", "customerCustomerType", "'LINE'").replace(" AS `customerCustomerType`", "")}) AS customerType,
        ${selectColumn(repairColumns, "ro", "source", "source", "'WEB'")},
        ${selectColumn(repairColumns, "ro", "reservation_status", "reservationStatus", "'approved'")},
        ${selectColumn(repairColumns, "ro", "status", "status", "'reserved'")},
        ${selectColumn(repairColumns, "ro", "created_at", "createdAt")}
      FROM repair_orders ro
      LEFT JOIN customers c ON c.id = ro.customer_id
      ORDER BY ro.id DESC
    `;

    const [repairRows] = await pool.query(repairOrdersSql);

    let repairOrderRows = [];
    let orderRepairsSql = null;
    if (canClassifyOrderRepairs) {
      orderRepairsSql = `
        SELECT
          ${selectColumn(orderColumns, "o", "id", "id")},
          'ORDER' AS repairSource,
          ${selectColumn(orderColumns, "o", "customer_id", "customerId")},
          COALESCE(${hasColumn(customerColumns, "name") ? "c.name" : "NULL"}, ${hasColumn(orderColumns, "customer_name") ? "o.customer_name" : "NULL"}) AS customerName,
          COALESCE(${hasColumn(customerColumns, "phone") ? "c.phone" : "NULL"}, ${hasColumn(orderColumns, "customer_phone") ? "o.customer_phone" : "NULL"}) AS customerPhone,
          ${selectColumn(customerColumns, "c", "line_user_id", "lineUserId")},
          COALESCE(${hasColumn(orderColumns, "customer_type") ? "o.customer_type" : "NULL"}, ${hasColumn(customerColumns, "customer_type") ? "c.customer_type" : "'LINE'"}) AS customerType,
          'POS' AS source,
          'approved' AS reservationStatus,
          ${selectColumn(orderColumns, "o", "status", "status", "'COMPLETED'")},
          ${selectColumn(orderColumns, "o", "created_at", "createdAt")}
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        INNER JOIN order_items oi ON oi.order_id = o.id
        WHERE oi.product_category_snapshot = 'REPAIR'
        GROUP BY o.id
        ORDER BY o.id DESC
      `;
      [repairOrderRows] = await pool.query(orderRepairsSql);
    }

    const allRows = [...repairRows, ...repairOrderRows].sort((a, b) => Number(b.id) - Number(a.id));
    const statusCounts = allRows.reduce((accumulator, row) => {
      const key = String(row.status || "UNKNOWN");
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    return res.json({
      currentUser: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        permissions: Array.isArray(req.user.permissions) ? req.user.permissions : []
      },
      apiPathUsedByRepairPage: "/api/repairs",
      sqlFilterUsed: {
        repairOrders: "No WHERE on role, created_by, assigned_to, user_id, staff_id, store_id, branch_id, tenant, owner, permissions.",
        orderRepairs: canClassifyOrderRepairs
          ? "Only WHERE oi.product_category_snapshot = 'REPAIR'. No user/role/staff/store restriction."
          : "Order repair classification disabled because product_category_snapshot column is unavailable."
      },
      repairOrdersTotalCount: repairRows.length,
      visibleRowsTotalCount: allRows.length,
      visibleRowsByStatus: statusCounts,
      visibleRows: allRows.map((row) => ({
        id: row.id,
        repairSource: row.repairSource,
        source: row.source,
        reservationStatus: row.reservationStatus,
        status: row.status,
        customerId: row.customerId,
        customerName: row.customerName,
        createdAt: row.createdAt
      })),
      sql: {
        repairOrdersSql,
        orderRepairsSql
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
