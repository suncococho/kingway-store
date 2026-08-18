"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  WRITE_BLOCK_CODE,
  assertReadOnlySqlAllowed,
  assertRuntimeWriteAllowed,
  isAllowedValidationHttpMethod,
  isReadOnlySql,
  isReadOnlyValidationMode,
  resolveValidationMode
} = require("../src/runtime/validationMode");
const { readOnlyValidationMiddleware } = require("../src/middleware/readOnlyValidation");
const { prepareRuntime } = require("../src/server");
const config = require("../src/config");
const { runRoleGetValidation } = require("../scripts/validateReadOnlyRoleGets");

const repo = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(repo, relativePath), "utf8");

function setValidationMode(value) {
  if (value === undefined) delete process.env.BACKEND_VALIDATION_MODE;
  else process.env.BACKEND_VALIDATION_MODE = value;
}

function invokeMiddleware(method, mode) {
  const previous = process.env.BACKEND_VALIDATION_MODE;
  setValidationMode(mode);
  let nextCalled = false;
  let responseStatus = null;
  let responseBody = null;
  const res = {
    status(status) { responseStatus = status; return this; },
    json(body) { responseBody = body; return body; }
  };
  readOnlyValidationMiddleware({ method }, res, () => { nextCalled = true; });
  setValidationMode(previous);
  return { nextCalled, responseStatus, responseBody };
}

async function main() {
  assert.equal(resolveValidationMode({}), "off");
  assert.equal(isReadOnlyValidationMode({}), false);
  assert.equal(isReadOnlyValidationMode({ BACKEND_VALIDATION_MODE: "read-only" }), true);
  assert.equal(isReadOnlyValidationMode({ BACKEND_VALIDATION_MODE: "READ-ONLY" }), true);

  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isAllowedValidationHttpMethod(method), true);
    assert.equal(invokeMiddleware(method, "read-only").nextCalled, true);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const result = invokeMiddleware(method, "read-only");
    assert.equal(result.nextCalled, false);
    assert.equal(result.responseStatus, 503);
    assert.equal(result.responseBody.code, WRITE_BLOCK_CODE);
    assert.equal(JSON.stringify(result.responseBody).includes("password"), false);
    assert.equal(JSON.stringify(result.responseBody).includes("token"), false);
  }
  assert.equal(invokeMiddleware("POST", undefined).nextCalled, true);

  for (const sql of ["SELECT 1", "SHOW TABLES", "DESCRIBE stores", "EXPLAIN SELECT 1", "WITH rows AS (SELECT 1) SELECT * FROM rows"]) {
    assert.equal(isReadOnlySql(sql), true, sql);
    assert.doesNotThrow(() => assertReadOnlySqlAllowed(sql, { BACKEND_VALIDATION_MODE: "read-only" }));
  }
  for (const sql of ["INSERT INTO staff_users(id) VALUES (1)", "UPDATE staff_users SET active = 1", "DELETE FROM staff_users", "CREATE TABLE unsafe(id INT)", "SELECT * FROM staff_users FOR UPDATE"]) {
    assert.equal(isReadOnlySql(sql), false, sql);
    assert.throws(
      () => assertReadOnlySqlAllowed(sql, { BACKEND_VALIDATION_MODE: "read-only" }),
      (error) => error.code === WRITE_BLOCK_CODE && error.statusCode === 503
    );
  }
  assert.doesNotThrow(() => assertRuntimeWriteAllowed("fixture", {}));
  assert.throws(() => assertRuntimeWriteAllowed("fixture", { BACKEND_VALIDATION_MODE: "read-only" }));

  for (const value of [undefined, "", "false", "0", "no", "1", "yes", "on"]) {
    const env = value === undefined ? {} : { RUN_DEFAULT_ACCOUNT_RECONCILIATION: value };
    assert.equal(config.isDefaultAccountReconciliationEnabled(env), false);
  }
  assert.equal(config.isDefaultAccountReconciliationEnabled({ RUN_DEFAULT_ACCOUNT_RECONCILIATION: "true" }), true);

  const readOnlyCalls = [];
  const logger = { log() {}, warn() {} };
  const readOnlyResult = await prepareRuntime({
    env: { BACKEND_VALIDATION_MODE: "read-only", RUN_DEFAULT_ACCOUNT_RECONCILIATION: "true" },
    config: { runSchemaBootstrap: true },
    logger,
    runSchemaGuard: async () => readOnlyCalls.push("schema-select"),
    ensureStorageDirectories: () => readOnlyCalls.push("storage"),
    ensureV2Schema: async () => readOnlyCalls.push("bootstrap"),
    validateTelegramConfig: () => readOnlyCalls.push("telegram-init"),
    ensureDefaultAdmin: async () => readOnlyCalls.push("admin-write"),
    ensureDefaultStaff: async () => readOnlyCalls.push("staff-write")
  });
  assert.deepEqual(readOnlyCalls, ["schema-select"]);
  assert.equal(readOnlyResult.validationMode, "read-only");
  assert.deepEqual(readOnlyResult.skipped, ["storage", "schema-bootstrap", "default-admin", "default-staff", "telegram-initialization"]);

  const defaultCalls = [];
  const defaultResult = await prepareRuntime({
    env: { RUN_DEFAULT_ACCOUNT_RECONCILIATION: "true" },
    config: { runSchemaBootstrap: true },
    logger,
    runSchemaGuard: async () => defaultCalls.push("schema-select"),
    ensureStorageDirectories: () => defaultCalls.push("storage"),
    ensureV2Schema: async () => defaultCalls.push("bootstrap"),
    validateTelegramConfig: () => defaultCalls.push("telegram-init"),
    ensureDefaultAdmin: async () => { defaultCalls.push("admin-write"); return false; },
    ensureDefaultStaff: async () => { defaultCalls.push("staff-write"); return { skipped: true, reason: "fixture" }; }
  });
  assert.deepEqual(defaultCalls, ["schema-select", "storage", "bootstrap", "telegram-init", "admin-write", "staff-write"]);
  assert.equal(defaultResult.validationMode, "off");

  for (const value of [undefined, "false", "0"]) {
    const env = value === undefined ? {} : { RUN_DEFAULT_ACCOUNT_RECONCILIATION: value };
    const calls = [];
    await prepareRuntime({
      env,
      config: { runSchemaBootstrap: false },
      logger,
      runSchemaGuard: async () => calls.push("schema-select"),
      ensureStorageDirectories: () => calls.push("storage"),
      ensureV2Schema: async () => calls.push("bootstrap"),
      validateTelegramConfig: () => calls.push("telegram-init"),
      ensureDefaultAdmin: async () => calls.push("admin-write"),
      ensureDefaultStaff: async () => calls.push("staff-write")
    });
    assert.deepEqual(calls, ["schema-select", "storage", "telegram-init"]);
  }

  let sanitizedStaffUpdates = 0;
  await prepareRuntime({
    env: {},
    config: { runSchemaBootstrap: false },
    logger,
    runSchemaGuard: async () => {},
    ensureStorageDirectories: () => {},
    validateTelegramConfig: () => {},
    ensureDefaultAdmin: async () => false,
    ensureDefaultStaff: async () => {
      sanitizedStaffUpdates += 1;
      return { created: false, updated: true, skipped: false };
    }
  });
  assert.equal(sanitizedStaffUpdates, 0);

  const previousMode = process.env.BACKEND_VALIDATION_MODE;
  const previousFetch = global.fetch;
  setValidationMode("read-only");
  global.fetch = async () => { throw new Error("outbound fetch must not run"); };
  const line = require("../src/utils/line");
  const telegram = require("../src/services/telegramService");
  assert.equal((await line.sendLineMessage({ line: { channelAccessToken: "fixture" } }, "fixture", [])).skipped, true);
  assert.equal((await line.sendLineReply({ line: { channelAccessToken: "fixture" } }, "fixture", [])).skipped, true);
  assert.equal((await telegram.sendTelegramMessage("notify", "fixture", "fixture")).skipped, true);
  global.fetch = previousFetch;
  setValidationMode(previousMode);

  const roleResults = await runRoleGetValidation({
    actors: [{ id: 7, role: "STAFF", storeId: 3, storeRole: "staff" }],
    endpoints: ["/api/staff-incentives/me", "/api/staff-scheduling/periods"],
    env: { BACKEND_VALIDATION_MODE: "read-only" },
    signToken: async () => "fixture-token-not-logged",
    request: async (request) => {
      assert.equal(request.method, "GET");
      assert.match(request.authorization, /^Bearer /);
      return { status: 200 };
    }
  });
  assert.equal(roleResults.length, 2);
  assert.equal(JSON.stringify(roleResults).includes("fixture-token"), false);

  const appSource = read("backend/src/app.js");
  const serverSource = read("backend/src/server.js");
  assert.equal((appSource.match(/cron\.schedule\(/g) || []).length, 4);
  assert.ok(appSource.indexOf("if (isReadOnlyValidationMode())") < appSource.indexOf("cron.schedule("));
  assert.ok(appSource.includes("app.use(readOnlyValidationMiddleware)"));
  assert.ok(appSource.includes('database: "unavailable"'));
  assert.ok(serverSource.includes('skipped: ["storage", "schema-bootstrap", "default-admin", "default-staff", "telegram-initialization"]'));

  console.log("backend read-only validation mode tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
