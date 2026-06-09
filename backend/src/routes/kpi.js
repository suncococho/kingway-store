const express = require("express");
const { pool } = require("../db");
const { createError } = require("../utils/errors");
const { authenticate, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");

const router = express.Router();

router.use(authenticate, requireStoreScope(), requireStoreFeature("staff_management_enabled"));

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
        INNER JOIN store_memberships sm
          ON sm.staff_user_id = su.id
         AND sm.store_id = ?
         AND sm.status IN ('active', 'disabled')
        LEFT JOIN staff_kpi_logs skl ON skl.staff_user_id = su.id
        GROUP BY su.id, su.display_name, su.role
        ORDER BY totalScore DESC, staffName ASC
      `,
      [req.storeId]
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/manual-log", requireStoreRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const { staffUserId, actionType, refType, refId, score } = req.body;

    if (!staffUserId || !actionType) {
      throw createError("staffUserId 與 actionType 為必填欄位", 400);
    }

    const [staffRows] = await pool.query(
      `
        SELECT su.id
        FROM staff_users su
        INNER JOIN store_memberships sm
          ON sm.staff_user_id = su.id
         AND sm.store_id = ?
         AND sm.status IN ('active', 'disabled')
        WHERE su.id = ?
        LIMIT 1
      `,
      [req.storeId, staffUserId]
    );

    if (!staffRows[0]) {
      throw createError("找不到員工", 404);
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
