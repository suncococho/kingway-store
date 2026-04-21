const app = require("./app");
const config = require("./config");
const { ensureDefaultAdmin, ensureStorageDirectories } = require("./bootstrap");

async function start() {
  ensureStorageDirectories();
  const created = await ensureDefaultAdmin();
  if (created) {
    console.log("Default admin account created.");
  }

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
