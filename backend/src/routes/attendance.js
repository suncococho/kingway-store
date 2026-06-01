const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");

const router = express.Router();

router.use(
  authenticate,
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]),
  requireStoreFeature("staff_management_enabled")
);

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
      throw createError("目前已有尚未退勤的出勤紀錄", 409);
    }

    const [result] = await pool.query(
      `
        INSERT INTO staff_attendance (staff_user_id, check_in_at)
        VALUES (?, NOW())
      `,
      [req.user.id]
    );

    await logKpi(req.user.id, "CHECK_IN", "ATTENDANCE", result.insertId, 1);
    return res.status(201).json({ id: result.insertId, message: "已完成上班打卡" });
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
      throw createError("找不到尚未退勤的出勤紀錄", 404);
    }

    await pool.query(
      `
        UPDATE staff_attendance
        SET check_out_at = NOW()
        WHERE id = ?
      `,
      [rows[0].id]
    );

    return res.json({ message: "已完成下班打卡" });
  } catch (error) {
    return next(error);
  }
});

router.get("/checklist/today", async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await ensureTodayChecklist(req.user.id, today);
    const [rows] = await pool.query(
      `
        SELECT id, item_key AS itemKey, item_label AS itemLabel, is_done AS isDone, completed_at AS completedAt
        FROM operational_checklists
        WHERE staff_user_id = ? AND checklist_date = ?
        ORDER BY id ASC
      `,
      [req.user.id, today]
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/checklist/:id/toggle", async (req, res, next) => {
  try {
    const done = req.body.done === undefined ? true : Boolean(req.body.done);
    await pool.query(
      `
        UPDATE operational_checklists
        SET is_done = ?,
            completed_at = CASE WHEN ? = 1 THEN NOW() ELSE NULL END
        WHERE id = ? AND staff_user_id = ?
      `,
      [done ? 1 : 0, done ? 1 : 0, req.params.id, req.user.id]
    );
    if (done) {
      await logKpi(req.user.id, "CHECKLIST_DONE", "OPERATIONAL_CHECKLIST", req.params.id, 1);
    }
    return res.json({ message: done ? "已完成確認事項" : "已取消確認" });
  } catch (error) {
    return next(error);
  }
});

async function ensureTodayChecklist(staffUserId, date) {
  const items = [
    ["today_tasks", "今日工作確認"],
    ["pending_follow_up", "客戶追蹤確認"],
    ["repair_purchase_status", "維修 / 購買狀態確認"],
    ["closing_check", "關店前事項確認"]
  ];

  for (const [key, label] of items) {
    await pool.query(
      `
        INSERT IGNORE INTO operational_checklists (staff_user_id, checklist_date, item_key, item_label)
        VALUES (?, ?, ?, ?)
      `,
      [staffUserId, date, key, label]
    );
  }
}

module.exports = router;
