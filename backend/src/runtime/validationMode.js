"use strict";

const VALIDATION_MODE_ENV = "BACKEND_VALIDATION_MODE";
const READ_ONLY_VALIDATION_MODE = "read-only";
const WRITE_BLOCK_CODE = "BACKEND_READ_ONLY_VALIDATION_MODE";
const ALLOWED_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function resolveValidationMode(env = process.env) {
  const value = String(env?.[VALIDATION_MODE_ENV] || "").trim().toLowerCase();
  return value === READ_ONLY_VALIDATION_MODE ? READ_ONLY_VALIDATION_MODE : "off";
}

function isReadOnlyValidationMode(env = process.env) {
  return resolveValidationMode(env) === READ_ONLY_VALIDATION_MODE;
}

function createWriteBlockedError(action = "runtime write") {
  const error = new Error(`${action} is disabled in read-only backend validation mode`);
  error.statusCode = 503;
  error.code = WRITE_BLOCK_CODE;
  return error;
}

function assertRuntimeWriteAllowed(action, env = process.env) {
  if (isReadOnlyValidationMode(env)) {
    throw createWriteBlockedError(action);
  }
}

function isAllowedValidationHttpMethod(method) {
  return ALLOWED_HTTP_METHODS.has(String(method || "").trim().toUpperCase());
}

function normalizeSql(sql) {
  const source = typeof sql === "string" ? sql : sql?.sql;
  return String(source || "")
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .trim();
}

function isReadOnlySql(sql) {
  const normalized = normalizeSql(sql);
  if (!normalized) return false;
  if (/;\s*\S/.test(normalized)) return false;
  if (/\b(?:FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|INTO\s+(?:OUTFILE|DUMPFILE))\b/i.test(normalized)) return false;
  if (/^(?:SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(normalized)) return true;
  if (/^WITH\b/i.test(normalized)) {
    return /\bSELECT\b/i.test(normalized)
      && !/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|LOAD|GRANT|REVOKE|LOCK|UNLOCK|SET)\b/i.test(normalized);
  }
  return false;
}

function assertReadOnlySqlAllowed(sql, env = process.env) {
  if (isReadOnlyValidationMode(env) && !isReadOnlySql(sql)) {
    throw createWriteBlockedError("database write or non-SELECT query");
  }
}

function validationSkipResult(reason = "read_only_validation_mode") {
  return { ok: false, delivered: 0, skipped: true, reason };
}

module.exports = {
  ALLOWED_HTTP_METHODS,
  READ_ONLY_VALIDATION_MODE,
  VALIDATION_MODE_ENV,
  WRITE_BLOCK_CODE,
  assertReadOnlySqlAllowed,
  assertRuntimeWriteAllowed,
  createWriteBlockedError,
  isAllowedValidationHttpMethod,
  isReadOnlySql,
  isReadOnlyValidationMode,
  resolveValidationMode,
  validationSkipResult
};
