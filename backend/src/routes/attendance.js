const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          sa.id,
          sa.staff_user_id AS staffUserId,
          su.display_name AS staffName,
          sa.check_in_at AS checkInAt,
          sa.check_out_at AS checkOutAt,
          sa.created_at AS createdAt
        FROM staff_attendance sa
        INNER JOIN staff_users su ON su.id = sa.staff_user_id
        ORDER BY sa.id DESC
        LIMIT 100
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/check-in", async (req, res, next) => {
  try {
    const [openRows] = await pool.query(
      `
        SELECT id
        FROM staff_attendance
        WHERE staff_user_id = ? AND check_out_at IS NULL
        LIMIT 1
      `,
      [req.user.id]
    );

    if (openRows[0]) {
      throw createError("You already have an active check-in", 409);
    }

    const [result] = await pool.query(
      `
        INSERT INTO staff_attendance (staff_user_id, check_in_at)
        VALUES (?, NOW())
      `,
      [req.user.id]
    );

    await logKpi(req.user.id, "CHECK_IN", "ATTENDANCE", result.insertId, 1);
    return res.status(201).json({ id: result.insertId, message: "Checked in" });
  } catch (error) {
    return next(error);
  }
});

router.post("/check-out", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT id
        FROM staff_attendance
        WHERE staff_user_id = ? AND check_out_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows[0]) {
      throw createError("No active check-in found", 404);
    }

    await pool.query(
      `
        UPDATE staff_attendance
        SET check_out_at = NOW()
        WHERE id = ?
      `,
      [rows[0].id]
    );

    return res.json({ message: "Checked out" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
