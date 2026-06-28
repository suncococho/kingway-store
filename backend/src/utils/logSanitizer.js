const SENSITIVE_KEY_PATTERNS = [
  /line[_-]?user[_-]?id/i,
  /line[_-]?group[_-]?id/i,
  /line[_-]?room[_-]?id/i,
  /^user[_-]?id$/i,
  /^group[_-]?id$/i,
  /^room[_-]?id$/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /password/i,
  /cookie/i,
  /signature/i
];

const TOKEN_LIKE_PATTERNS = [
  /^Bearer\s+\S+/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /channel[_-]?access[_-]?token/i,
  /channel[_-]?secret/i
];

function maskIdentifier(value, options = {}) {
  if (value === null || value === undefined) return value;
  const normalized = String(value);
  if (!normalized) return normalized;
  const head = Number.isInteger(options.head) ? options.head : 6;
  const tail = Number.isInteger(options.tail) ? options.tail : 4;
  if (normalized.length <= head + tail + 3) return "[masked]";
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function maskLineUserId(value) {
  return maskIdentifier(value, { head: 6, tail: 4 });
}

function maskLineGroupId(value) {
  return maskIdentifier(value, { head: 6, tail: 4 });
}

function maskToken(value) {
  if (value === null || value === undefined) return value;
  const normalized = String(value);
  if (!normalized) return normalized;
  return "[masked]";
}

function isSensitiveKey(key) {
  const normalized = String(key || "").trim();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeToken(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (TOKEN_LIKE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return normalized.length >= 80 && /^[A-Za-z0-9._~+/=-]+$/.test(normalized);
}

function sanitizeRouteForLog(value) {
  const raw = String(value || "");
  if (!raw || !raw.includes("?")) return raw;
  const [path, query] = raw.split("?", 2);
  const params = new URLSearchParams(query || "");
  for (const key of Array.from(params.keys())) {
    if (isSensitiveKey(key)) {
      params.set(key, "[masked]");
    }
  }
  const sanitized = params.toString();
  return sanitized ? `${path}?${sanitized}` : path;
}

function sanitizeLogValue(value, key = "") {
  if (value === null || value === undefined) return value;
  if (isSensitiveKey(key)) return maskToken(value);
  if (typeof value === "string") {
    if (looksLikeToken(value)) return maskToken(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (typeof value === "object") {
    return sanitizeLogObject(value);
  }
  return value;
}

function sanitizeLogObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeLogValue(item));
  if (typeof obj !== "object") return sanitizeLogValue(obj);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = maskToken(value);
    } else if (key === "route" || key === "url" || key === "path") {
      sanitized[key] = sanitizeRouteForLog(value);
    } else {
      sanitized[key] = sanitizeLogValue(value, key);
    }
  }
  return sanitized;
}

module.exports = {
  maskIdentifier,
  maskLineUserId,
  maskLineGroupId,
  maskToken,
  sanitizeRouteForLog,
  sanitizeLogValue,
  sanitizeLogObject
};
