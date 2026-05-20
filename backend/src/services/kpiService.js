const { pool } = require("../db");

async function logKpi(staffUserId, actionType, refType, refId, score) {
  if (!staffUserId) {
    return;
  }

  await pool.query(
    `
      INSERT INTO staff_kpi_logs (staff_user_id, action_type, ref_type, ref_id, score)
      VALUES (?, ?, ?, ?, ?)
    `,
    [staffUserId, actionType, refType || null, refId || null, score || 0]
  );
}

module.exports = {
  logKpi
};
