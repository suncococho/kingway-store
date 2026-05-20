const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate, authorize(["ADMIN", "MANAGER"]));

router.get("/summary", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          su.id AS staffUserId,
          su.display_name AS staffName,
          COUNT(sa.id) AS totalDaysWorked,
          COUNT(CASE WHEN sa.check_out_at IS NOT NULL THEN 1 END) AS completedShifts,
          MIN(sa.check_in_at) AS firstCheckIn,
          MAX(sa.check_out_at) AS lastCheckOut
        FROM staff_users su
        LEFT JOIN staff_attendance sa ON sa.staff_user_id = su.id
        GROUP BY su.id, su.display_name
        ORDER BY su.display_name ASC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
