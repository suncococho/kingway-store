#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const migrationPath = path.join(repo, "database/migrations/20260818_fix_line_order_option_defaults_utf8.sql");
const schemaPath = path.join(repo, "database/schema.sql");
const runnerPath = path.join(repo, "scripts/run_staging_line_order_default_correction.sh");
const migration = fs.readFileSync(migrationPath, "utf8");
const schema = fs.readFileSync(schemaPath, "utf8");
const runner = fs.readFileSync(runnerPath, "utf8");

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

const expected = {
  page_title: {
    text: "選擇您需要的配件",
    hex: "E981B8E69387E682A8E99C80E8A681E79A84E9858DE4BBB6"
  },
  page_description: {
    text: "可依照需求選擇配件，也可以略過此步驟",
    hex: "E58FAFE4BE9DE785A7E99C80E6B182E981B8E69387E9858DE4BBB6EFBC8CE4B99FE58FAFE4BBA5E795A5E9818EE6ADA4E6ADA5E9A99F"
  }
};

for (const [column, value] of Object.entries(expected)) {
  if (Buffer.from(value.text, "utf8").toString("hex").toUpperCase() !== value.hex) {
    fail(column + " intended UTF-8 HEX test vector is wrong");
  }
  if (!migration.includes(value.text) || !migration.includes(value.hex)) {
    fail(column + " intended text/HEX evidence missing from migration");
  }
  if (!schema.includes(column + " VARCHAR") || !schema.includes("DEFAULT '" + value.text + "'")) {
    fail(column + " declarative schema default is missing");
  }
}

const executable = migration
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

for (const forbidden of [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\b/i,
  /\bCREATE\s+TABLE\b/i,
  /\bADD\s+(?:COLUMN|INDEX|KEY|CONSTRAINT)\b/i,
  /\bMODIFY\s+COLUMN\b/i,
  /\bCHANGE\s+COLUMN\b/i
]) {
  if (forbidden.test(executable)) fail("destructive or row-writing statement detected: " + forbidden);
}

const alterTableMatches = executable.match(/ALTER TABLE line_order_option_settings/g) || [];
if (alterTableMatches.length !== 1) fail("expected exactly one guarded ALTER TABLE statement");
const alterMatches = [...executable.matchAll(/ALTER COLUMN (page_title|page_description) SET DEFAULT _utf8mb4 0x([0-9A-F]+)/g)];
if (alterMatches.length !== 2) fail("expected exactly two ALTER COLUMN SET DEFAULT clauses");
for (const match of alterMatches) {
  if (match[2] !== expected[match[1]].hex) fail(match[1] + " ALTER HEX mismatch");
}
for (const marker of [
  "SET SESSION lock_wait_timeout = 5",
  "INFORMATION_SCHEMA.COLUMNS",
  "COLUMN_DEFAULT",
  "PREPARE",
  "EXECUTE",
  "SIGNAL SQLSTATE",
  "DATABASE()",
  "ALGORITHM=INSTANT",
  "LOCK=DEFAULT"
]) {
  if (!migration.includes(marker)) fail("migration guard missing " + marker);
}
if (/LOCK\s*=\s*NONE/i.test(executable)) fail("LOCK=NONE is forbidden for this migration");

const runnerMarkers = [
  "539dc44be02dae0a327d11fe57535e44be4c8620a039b3dda2babb518320d781",
  "769e1e1fc9834a1da7a65d7c7ee799e2ea558ffb75532222d6973777d0879e10",
  "/kingway-staging-mysql",
  "kingway-staging-restore_kingway-staging-network",
  "kingway-staging-restore_kingway-staging-mysql-data",
  "kingway-store_default",
  "kingway-store_mysql_data",
  "kingway_store",
  "8.0.45",
  "SELECT DATABASE(), @@hostname, VERSION()",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "with_deploy_lock.sh",
  "KINGWAY_LINE_OPTION_CANONICAL_LOCK_HELD",
  "KINGWAY_DEPLOY_LOCK_PATH",
  "MIGRATION_SHA256",
  "row_count",
  "row_data_sha256",
  "column_structure_sha256",
  "index_structure_sha256",
  "constraint_structure_sha256"
];
for (const marker of runnerMarkers) {
  if (!runner.includes(marker)) fail("exact-target execution guard missing " + marker);
}
if (!runner.includes('[ "$EXPECTED_CONTAINER_ID" != "$PRODUCTION_MYSQL_CONTAINER_ID" ]')) {
  fail("production MySQL container rejection is missing");
}
if (!runner.includes('[ "$actual_id" = "$EXPECTED_CONTAINER_ID" ]')) {
  fail("full exact container ID comparison is missing");
}
if (!runner.includes("for key in row_count row_data_sha256 column_structure_sha256 index_structure_sha256 constraint_structure_sha256")) {
  fail("before/after row and schema invariance comparison is missing");
}
const executionMatches = runner.match(/docker exec -i "\$EXPECTED_CONTAINER_ID"[\s\S]*?< "\$MIGRATION_FILE"/g) || [];
if (executionMatches.length !== 1) fail("runner must execute the migration exactly once");
if (/MYSQL_PWD\s*=\s*[^"'$]/.test(runner)) fail("runner appears to contain a literal password assignment");

console.log("OK: migration is one default-only ALTER and runner enforces exact staging target plus before/after invariants");
