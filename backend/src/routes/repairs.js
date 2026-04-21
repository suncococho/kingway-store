const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { BASE_FEE, calculateStorageFee, validateRepairReservationDate } = require("../services/repairService");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "REPAIR"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          ro.id,
          ro.customer_id AS customerId,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          ro.bike_model AS bikeModel,
          ro.issue_description AS issueDescription,
          ro.reservation_date AS reservationDate,
          ro.reservation_day AS reservationDay,
          ro.status,
          ro.estimate_amount AS estimateAmount,
          ro.base_fee AS baseFee,
          ro.storage_fee AS storageFee,
          ro.completed_at AS completedAt,
          ro.picked_up_at AS pickedUpAt,
          ro.created_at AS createdAt
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id
        ORDER BY ro.id DESC
      `
    );

    return res.json(
      rows.map((row) => ({
        ...row,
        storageFee: calculateStorageFee(row.completedAt, row.pickedUpAt)
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          ro.*,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id
        WHERE ro.id = ?
      `,
      [req.params.id]
    );

    if (!rows[0]) {
      throw createError("Repair order not found", 404);
    }

    const [logs] = await pool.query(
      `
        SELECT id, action, note, created_at AS createdAt
        FROM repair_logs
        WHERE repair_order_id = ?
        ORDER BY id DESC
      `,
      [req.params.id]
    );

    return res.json({
      ...rows[0],
      storageFee: calculateStorageFee(rows[0].completed_at, rows[0].picked_up_at),
      logs
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { customerId, bikeModel, issueDescription, reservationDate } = req.body;
    if (!customerId || !bikeModel || !issueDescription || !reservationDate) {
      throw createError("customerId, bikeModel, issueDescription, and reservationDate are required", 400);
    }

    const reservationDay = validateRepairReservationDate(reservationDate);
    const [result] = await pool.query(
      `
        INSERT INTO repair_orders (customer_id, bike_model, issue_description, reservation_date, reservation_day, base_fee)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [customerId, bikeModel, issueDescription, reservationDate, reservationDay, BASE_FEE]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'reserved', ?)
      `,
      [result.insertId, "Repair reservation created"]
    );

    return res.status(201).json({
      id: result.insertId,
      reservationDay,
      baseFee: BASE_FEE
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/estimate", async (req, res, next) => {
  try {
    const { estimateAmount, note } = req.body;
    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'estimate_pending_approval',
            estimate_amount = ?
        WHERE id = ?
      `,
      [Number(estimateAmount || 0), req.params.id]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'estimate_pending_approval', ?)
      `,
      [req.params.id, note || "Estimate pending approval"]
    );

    const [repairGroups] = await pool.query(
      `
        SELECT line_group_id
        FROM line_group_registrations
        WHERE is_active = 1 AND registration_type = 'repair'
      `
    );

    for (const group of repairGroups) {
      if (config.line.channelAccessToken) {
        await sendLineMessage(config, group.line_group_id, [
          {
            type: "text",
            text: `Repair #${req.params.id} estimate pending approval. Amount NT$${Number(estimateAmount || 0)}`
          }
        ]);
      }
    }

    return res.json({ message: "Estimate submitted for approval" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/approve", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'estimate_approved',
            approved_by_staff_id = ?
        WHERE id = ?
      `,
      [req.user.id, req.params.id]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'estimate_approved', ?)
      `,
      [req.params.id, "Estimate approved"]
    );

    await logKpi(req.user.id, "REPAIR_ESTIMATE_APPROVED", "REPAIR_ORDER", req.params.id, 3);
    return res.json({ message: "Estimate approved" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reject", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'estimate_rejected',
            approved_by_staff_id = ?
        WHERE id = ?
      `,
      [req.user.id, req.params.id]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'estimate_rejected', ?)
      `,
      [req.params.id, req.body.note || "Estimate rejected"]
    );

    return res.json({ message: "Estimate rejected" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/complete", async (req, res, next) => {
  try {
    const [repairs] = await pool.query(
      `
        SELECT ro.id, c.line_user_id AS lineUserId
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id
        WHERE ro.id = ?
      `,
      [req.params.id]
    );

    if (!repairs[0]) {
      throw createError("Repair order not found", 404);
    }

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'completed_waiting_pickup',
            completed_at = NOW()
        WHERE id = ?
      `,
      [req.params.id]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'completed_waiting_pickup', ?)
      `,
      [req.params.id, "Repair completed, waiting for pickup"]
    );

    if (repairs[0].lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, repairs[0].lineUserId, [
        {
          type: "text",
          text:
            "\u60A8\u7684\u7DAD\u4FEE\u5DF2\u5B8C\u6210\uFF0C\u8ACB\u5B89\u6392\u53D6\u8ECA\u3002\u901A\u77E5\u5F8C\u8D85\u904E 3 \u65E5\u672A\u53D6\u8ECA\uFF0C\u6BCF\u65E5\u5C07\u6536\u53D6\u4FDD\u7BA1\u8CBB NT$80\u3002"
        }
      ]);
    }

    return res.json({ message: "Repair marked as completed" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/pickup", async (req, res, next) => {
  try {
    const [repairs] = await pool.query(
      `
        SELECT completed_at AS completedAt
        FROM repair_orders
        WHERE id = ?
      `,
      [req.params.id]
    );

    if (!repairs[0]) {
      throw createError("Repair order not found", 404);
    }

    const storageFee = calculateStorageFee(repairs[0].completedAt, new Date());

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'picked_up',
            picked_up_at = NOW(),
            storage_fee = ?
        WHERE id = ?
      `,
      [storageFee, req.params.id]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'picked_up', ?)
      `,
      [req.params.id, `Picked up. Storage fee NT$${storageFee}`]
    );

    await logKpi(req.user.id, "REPAIR_PICKED_UP", "REPAIR_ORDER", req.params.id, 4);
    return res.json({ message: "Repair picked up", storageFee });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
