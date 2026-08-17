const config = require("./config");
const { ensureDefaultAdmin, ensureDefaultStaff, ensureStorageDirectories, ensureV2Schema } = require("./bootstrap");
const { runSchemaGuard } = require("./services/schemaGuardService");
const { validateTelegramConfig } = require("./services/telegramService");
const { isReadOnlyValidationMode } = require("./runtime/validationMode");

async function prepareRuntime(dependencies = {}) {
  const runtimeConfig = dependencies.config || config;
  const runtimeEnv = dependencies.env || process.env;
  const logger = dependencies.logger || console;
  const schemaGuard = dependencies.runSchemaGuard || runSchemaGuard;
  const createStorageDirectories = dependencies.ensureStorageDirectories || ensureStorageDirectories;
  const schemaBootstrap = dependencies.ensureV2Schema || ensureV2Schema;
  const checkTelegramConfig = dependencies.validateTelegramConfig || validateTelegramConfig;
  const createDefaultAdmin = dependencies.ensureDefaultAdmin || ensureDefaultAdmin;
  const createDefaultStaff = dependencies.ensureDefaultStaff || ensureDefaultStaff;
  const readOnlyValidation = isReadOnlyValidationMode(runtimeEnv);

  await schemaGuard();

  if (readOnlyValidation) {
    logger.log("[ValidationMode] read-only startup: bootstrap, default accounts, storage initialization and outbound initialization skipped.");
    return {
      validationMode: "read-only",
      skipped: ["storage", "schema-bootstrap", "default-admin", "default-staff", "telegram-initialization"]
    };
  }

  createStorageDirectories();
  if (runtimeConfig.runSchemaBootstrap) {
    logger.warn("[SchemaBootstrap] Schema bootstrap enabled. Startup may run DDL/data backfill checks.");
    await schemaBootstrap();
  } else {
    logger.log("[SchemaBootstrap] Schema bootstrap skipped. Set RUN_SCHEMA_BOOTSTRAP=true to run explicit schema bootstrap.");
  }
  checkTelegramConfig();
  const created = await createDefaultAdmin();
  if (created) {
    logger.log("Default admin account created.");
  }
  const staffResult = await createDefaultStaff();
  if (staffResult.created) {
    logger.log("Default staff account created.");
  } else if (staffResult.updated) {
    logger.log("Default staff account updated.");
  } else if (staffResult.skipped) {
    logger.warn(`Default staff account skipped: ${staffResult.reason}.`);
  }

  return { validationMode: "off", skipped: [] };
}

async function start() {
  await prepareRuntime();

  const app = require("./app");
  return app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start backend:", error);
    process.exit(1);
  });
}

module.exports = { prepareRuntime, start };
