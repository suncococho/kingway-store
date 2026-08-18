#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const migrationPath = path.join(repo, "database/migrations/20260818_fix_line_order_option_defaults_utf8.sql");
const schemaPath = path.join(repo, "database/schema.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const schema = fs.readFileSync(schemaPath, "utf8");

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

const alterMatches = [...executable.matchAll(/ALTER TABLE line_order_option_settings ALTER COLUMN (page_title|page_description) SET DEFAULT _utf8mb4 0x([0-9A-F]+)/g)];
if (alterMatches.length !== 2) fail("expected exactly two guarded default-only ALTER statements");
for (const match of alterMatches) {
  if (match[2] !== expected[match[1]].hex) fail(match[1] + " ALTER HEX mismatch");
}
for (const marker of ["INFORMATION_SCHEMA.COLUMNS", "COLUMN_DEFAULT", "PREPARE", "EXECUTE", "SIGNAL SQLSTATE", "DATABASE()"]) {
  if (!migration.includes(marker)) fail("migration guard missing " + marker);
}

console.log("OK: default-only UTF-8 correction migration is forward-only, guarded, and row-data free");
