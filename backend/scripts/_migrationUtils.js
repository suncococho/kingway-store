"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("../src/db");

const CATEGORY_ENUM = ["EBIKE", "REPAIR", "ACCESSORY", "OTHER"];
const PAYMENT_METHODS = new Set(["CASH", "CARD", "LINE_PAY", "TRANSFER", "OTHER"]);
const ORDER_STATUSES = new Set(["PENDING", "COMPLETED", "CANCELED"]);

function fail(message) {
  const error = new Error(message);
  error.isMigrationError = true;
  throw error;
}

function requireFilePath(argvPath) {
  if (!argvPath) {
    fail("File path is required.");
  }

  const resolvedPath = path.resolve(process.cwd(), argvPath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`File not found: ${resolvedPath}`);
  }

  return resolvedPath;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeSku(value) {
  return normalizeWhitespace(value).toUpperCase();
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = normalizeWhitespace(value).toLowerCase();
  if (["1", "true", "yes", "y", "active", "publish", "published", "instock"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "inactive", "draft", "private", "trash", "outofstock"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return fallback;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback = 0) {
  const parsed = parseNumber(value, fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseDateOnly(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return new Date().toISOString().slice(0, 10);
  }

  const isoLike = normalized.replace(/\//g, "-");
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function mapCategory(input) {
  const normalized = normalizeWhitespace(input).toUpperCase();
  if (CATEGORY_ENUM.includes(normalized)) {
    return normalized;
  }

  const probe = normalizeWhitespace(input).toLowerCase();
  if (!probe) {
    return "OTHER";
  }

  if (/(repair|service|maint|fix|labor|labour|workshop|維修|保養|工資|換貨)/.test(probe)) {
    return "REPAIR";
  }
  if (/(ebike|e-bike|electric bike|electric bicycle|bike|bicycle|cycle|電動車|電動輔助|自行車|單車)/.test(probe)) {
    return "EBIKE";
  }
  if (
    /(accessor|part|helmet|battery|charger|lock|bag|basket|tire|tyre|tube|light|seat|pedal|brake|mirror|pump|phone|零件|輪胎|燈|鎖|包|水壺架|椅|避震|前叉|煞車|電池|充電|快充|腳踏|握把|後視鏡|夾具|套件)/.test(
      probe
    )
  ) {
    return "ACCESSORY";
  }
  if (/(玩具|載具)/.test(probe)) {
    return "OTHER";
  }

  return "OTHER";
}

function mapPaymentMethod(input) {
  const normalized = normalizeWhitespace(input).toUpperCase().replace(/[\s-]+/g, "_");
  if (PAYMENT_METHODS.has(normalized)) {
    return normalized;
  }
  if (["LINEPAY"].includes(normalized)) {
    return "LINE_PAY";
  }
  if (["BANK", "BANK_TRANSFER", "WIRE"].includes(normalized)) {
    return "TRANSFER";
  }
  return "OTHER";
}

function mapOrderStatus(input) {
  const normalized = normalizeWhitespace(input).toUpperCase();
  if (ORDER_STATUSES.has(normalized)) {
    return normalized;
  }
  if (["PAID", "DONE", "SUCCESS"].includes(normalized)) {
    return "COMPLETED";
  }
  if (["VOID", "CANCELLED", "REFUND", "REFUNDED"].includes(normalized)) {
    return "CANCELED";
  }
  return "COMPLETED";
}

function pickField(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] !== undefined && record[alias] !== null && record[alias] !== "") {
      return record[alias];
    }
  }
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => normalizeWhitespace(cell) !== ""));
}

function csvRowsToRecords(rows) {
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header, index) => normalizeHeader(header) || `column${index + 1}`);
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = normalizeWhitespace(row[index] || "");
    });
    return record;
  });
}

function buildOrderNo(seed, fallbackSeed) {
  const normalized = normalizeWhitespace(seed).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (normalized) {
    return `CSV-${normalized}`.slice(0, 50);
  }

  const hash = crypto.createHash("sha1").update(fallbackSeed).digest("hex").slice(0, 16);
  return `CSV-${hash}`;
}

function buildPlaceholderSku(name, extraSeed = "") {
  const slug = normalizeWhitespace(name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const hash = crypto.createHash("sha1").update(`${name}|${extraSeed}`).digest("hex").slice(0, 8).toUpperCase();
  const base = slug ? slug.slice(0, 32) : "MIGRATED";
  return `MIG-${base}-${hash}`.slice(0, 100);
}

function parseSqlValueTuples(sqlChunk) {
  const tuples = [];
  let tuple = [];
  let value = "";
  let inQuotes = false;
  let escaped = false;
  let depth = 0;

  for (let i = 0; i < sqlChunk.length; i += 1) {
    const char = sqlChunk[i];

    if (inQuotes) {
      value += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "'") {
        inQuotes = false;
      }
      continue;
    }

    if (char === "'") {
      inQuotes = true;
      value += char;
      continue;
    }

    if (char === "(") {
      if (depth === 0) {
        tuple = [];
        value = "";
      } else {
        value += char;
      }
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        tuple.push(parseSqlScalar(value));
        tuples.push(tuple);
        value = "";
      } else {
        value += char;
      }
      continue;
    }

    if (char === "," && depth === 1) {
      tuple.push(parseSqlScalar(value));
      value = "";
      continue;
    }

    if (depth >= 1) {
      value += char;
    }
  }

  return tuples;
}

function parseSqlScalar(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.toUpperCase() === "NULL" || trimmed === "") {
    return null;
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

async function printProductSummary(connection = pool) {
  const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM products");
  const [categoryRows] = await connection.query(
    `
      SELECT category, COUNT(*) AS total
      FROM products
      GROUP BY category
      ORDER BY category
    `
  );

  console.log(`Total products: ${countRows[0].total}`);
  console.log("Category counts:");
  for (const row of categoryRows) {
    console.log(`- ${row.category}: ${row.total}`);
  }
}

module.exports = {
  buildOrderNo,
  buildPlaceholderSku,
  csvRowsToRecords,
  fail,
  mapCategory,
  mapOrderStatus,
  mapPaymentMethod,
  normalizeHeader,
  normalizeSku,
  normalizeWhitespace,
  parseBoolean,
  parseCsv,
  parseDateOnly,
  parseInteger,
  parseNumber,
  parseSqlValueTuples,
  pickField,
  printProductSummary,
  requireFilePath,
  pool
};
