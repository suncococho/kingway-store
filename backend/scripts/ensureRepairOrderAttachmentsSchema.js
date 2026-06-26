const { pool } = require("../src/db");
const { ensureRepairOrderAttachmentsSchema } = require("../src/services/repairAttachmentService");

async function main() {
  await ensureRepairOrderAttachmentsSchema();
  console.log("repair_order_attachments schema ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
