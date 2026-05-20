const { ensureV2Schema } = require("../src/bootstrap");
const { pool } = require("../src/db");

async function main() {
  await ensureV2Schema();
  console.log("v2 schema checks completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
