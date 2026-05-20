const express = require("express");
const { pool } = require("../db");
const { createError } = require("../utils/errors");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER"]));

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          su.id AS staffUserId,
          su.display_name AS staffName,
          su.role,
          COUNT(skl.id) AS logCount,
          COALESCE(SUM(skl.score), 0) AS totalScore
        FROM staff_users su
        LEFT JOIN staff_kpi_logs skl ON skl.staff_user_id = su.id
        GROUP BY su.id, su.display_name, su.role
        ORDER BY totalScore DESC, staffName ASC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/manual-log", async (req, res, next) => {
  try {
    const { staffUserId, actionType, refType, refId, score } = req.body;

    if (!staffUserId || !actionType) {
      throw createError("staffUserId 與 actionType 為必填欄位", 400);
    }

    const normalizedScore = Number(score || 0);
    await pool.query(
      `
        INSERT INTO staff_kpi_logs (staff_user_id, action_type, ref_type, ref_id, score)
        VALUES (?, ?, ?, ?, ?)
      `,
      [staffUserId, actionType, refType || null, refId || null, normalizedScore]
    );

    return res.status(201).json({ message: "已新增 KPI 紀錄" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
