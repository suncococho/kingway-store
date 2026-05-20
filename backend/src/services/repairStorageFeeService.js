const { pool } = require("../db");
const { calculateStorageFee } = require("./repairService");

async function updateRepairStorageFees() {
  const [rows] = await pool.query(
    `
      SELECT id, completed_at AS completedAt, picked_up_at AS pickedUpAt, storage_fee AS storageFee
      FROM repair_orders
      WHERE status = 'completed_waiting_pickup'
        AND completed_at IS NOT NULL
        AND picked_up_at IS NULL
    `
  );

  let updated = 0;

  for (const row of rows) {
    const nextFee = calculateStorageFee(row.completedAt, row.pickedUpAt);
    const currentFee = Number(row.storageFee || 0);

    if (Number(nextFee) !== currentFee) {
      await pool.query(
        "UPDATE repair_orders SET storage_fee = ? WHERE id = ?",
        [nextFee, row.id]
      );
      updated += 1;
    }
  }

  return { checked: rows.length, updated };
}

module.exports = {
  updateRepairStorageFees
};
