const config = require("../config");
const { pool } = require("../db");

const REQUIRED_TABLES = ["stores"];

const REQUIRED_STORE_ID_COLUMNS = [
  "staff_users",
  "customers",
  "orders",
  "order_items",
  "products",
  "repair_orders",
  "coupons",
  "inventory_movements",
  "supplier_requests",
  "purchase_confirmations"
].map((tableName) => ({ tableName, columnName: "store_id" }));

function formatValue(value) {
  if (value === undefined || value === null || value === "") {
    return "(unset)";
  }
  return String(value);
}

function buildInPlaceholders(values) {
  return values.map(() => "?").join(", ");
}

function compareExpectedDbTarget() {
  const mismatches = [];

  if (config.expectedDbHost && config.mysql.host !== config.expectedDbHost) {
    mismatches.push(`MYSQL_HOST expected=${config.expectedDbHost} actual=${config.mysql.host}`);
  }

  if (config.expectedDbPort && String(config.mysql.port) !== config.expectedDbPort) {
    mismatches.push(`MYSQL_PORT expected=${config.expectedDbPort} actual=${config.mysql.port}`);
  }

  if (config.expectedDbName && config.mysql.database !== config.expectedDbName) {
    mismatches.push(`MYSQL_DATABASE expected=${config.expectedDbName} actual=${config.mysql.database}`);
  }

  return mismatches;
}

async function readDbIdentity() {
  const [[identity]] = await pool.query(
    `
      SELECT
        DATABASE() AS databaseName,
        @@hostname AS hostname,
        @@port AS port
    `
  );

  return {
    databaseName: identity?.databaseName || null,
    hostname: identity?.hostname || null,
    port: identity?.port || null
  };
}

async function findMissingTables(tableNames) {
  const [rows] = await pool.query(
    `
      SELECT TABLE_NAME AS tableName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${buildInPlaceholders(tableNames)})
    `,
    tableNames
  );

  const found = new Set(rows.map((row) => row.tableName));
  return tableNames.filter((tableName) => !found.has(tableName));
}

async function findMissingStoreIdColumns(requiredColumns) {
  const tableNames = requiredColumns.map((column) => column.tableName);
  const [rows] = await pool.query(
    `
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME = 'store_id'
        AND TABLE_NAME IN (${buildInPlaceholders(tableNames)})
    `,
    tableNames
  );

  const found = new Set(rows.map((row) => `${row.tableName}.${row.columnName}`));
  return requiredColumns
    .filter((column) => !found.has(`${column.tableName}.${column.columnName}`))
    .map((column) => `${column.tableName}.${column.columnName}`);
}

function logStartupTarget(identity, expectedMismatches) {
  console.log(
    `[SchemaGuard] nodeEnv=${formatValue(config.nodeEnv)} appEnv=${formatValue(config.appEnv)} requireStoreIdSchema=${config.requireStoreIdSchema}`
  );

  if (config.logDbIdentity) {
    console.log(
      `[SchemaGuard] configuredDb host=${formatValue(config.mysql.host)} port=${formatValue(config.mysql.port)} database=${formatValue(config.mysql.database)}`
    );
    console.log(
      `[SchemaGuard] observedDb database=${formatValue(identity.databaseName)} hostname=${formatValue(identity.hostname)} port=${formatValue(identity.port)}`
    );
  }

  if (expectedMismatches.length) {
    console.warn(`[SchemaGuard][WARN] DB target mismatch: ${expectedMismatches.join("; ")}`);
  }
}

function logSchemaResult(missingTables, missingColumns) {
  if (!missingTables.length && !missingColumns.length) {
    console.log("[SchemaGuard] store_id schema ready: stores table and required store_id columns found.");
    return;
  }

  if (missingTables.length) {
    console.warn(`[SchemaGuard][WARN] Missing required tables: ${missingTables.join(", ")}`);
  }

  if (missingColumns.length) {
    console.warn(`[SchemaGuard][WARN] Missing required store_id columns: ${missingColumns.join(", ")}`);
  }
}

function buildFailureMessage(summary) {
  const details = [];

  if (summary.expectedMismatches.length) {
    details.push(`DB target mismatch: ${summary.expectedMismatches.join("; ")}`);
  }

  if (summary.missingTables.length) {
    details.push(`missing tables: ${summary.missingTables.join(", ")}`);
  }

  if (summary.missingColumns.length) {
    details.push(`missing store_id columns: ${summary.missingColumns.join(", ")}`);
  }

  return `Schema guard failed: ${details.join("; ")}`;
}

async function runSchemaGuard() {
  const expectedMismatches = compareExpectedDbTarget();
  let summary;

  try {
    const identity = await readDbIdentity();
    const missingTables = await findMissingTables(REQUIRED_TABLES);
    const missingColumns = await findMissingStoreIdColumns(REQUIRED_STORE_ID_COLUMNS);
    summary = {
      requireStoreIdSchema: config.requireStoreIdSchema,
      expectedMismatches,
      identity,
      missingTables,
      missingColumns,
      ready: expectedMismatches.length === 0 && missingTables.length === 0 && missingColumns.length === 0
    };

    logStartupTarget(identity, expectedMismatches);
    logSchemaResult(missingTables, missingColumns);
  } catch (error) {
    const identity = { databaseName: null, hostname: null, port: null };
    summary = {
      requireStoreIdSchema: config.requireStoreIdSchema,
      expectedMismatches,
      identity,
      missingTables: [],
      missingColumns: [],
      guardError: error.message,
      ready: false
    };

    logStartupTarget(identity, expectedMismatches);
    console.warn("[SchemaGuard][WARN] Read-only schema guard check failed: " + error.message);

    if (!config.requireStoreIdSchema) {
      console.warn("[SchemaGuard][WARN] REQUIRE_STORE_ID_SCHEMA=false; backend startup will continue.");
      return summary;
    }

    throw new Error("Schema guard failed: " + error.message);
  }

  if (!summary.ready && !config.requireStoreIdSchema) {
    console.warn("[SchemaGuard][WARN] REQUIRE_STORE_ID_SCHEMA=false; backend startup will continue.");
  }

  if (!summary.ready && config.requireStoreIdSchema) {
    throw new Error(buildFailureMessage(summary));
  }

  return summary;
}

module.exports = {
  REQUIRED_STORE_ID_COLUMNS,
  REQUIRED_TABLES,
  runSchemaGuard
};
