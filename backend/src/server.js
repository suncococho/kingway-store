const app = require("./app");
const config = require("./config");
const { ensureDefaultAdmin, ensureDefaultStaff, ensureStorageDirectories, ensureV2Schema } = require("./bootstrap");
const { validateTelegramConfig } = require("./services/telegramService");

async function start() {
  ensureStorageDirectories();
  await ensureV2Schema();
  validateTelegramConfig();
  const created = await ensureDefaultAdmin();
  if (created) {
    console.log("Default admin account created.");
  }
  const staffResult = await ensureDefaultStaff();
  if (staffResult.created) {
    console.log("Default staff account created.");
  } else if (staffResult.updated) {
    console.log("Default staff account updated.");
  } else if (staffResult.skipped) {
    console.warn(`Default staff account skipped: ${staffResult.reason}.`);
  }

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
