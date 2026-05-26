const crypto = require("crypto");
const config = require("../config");

const SOURCE = {
  SIGNED_TOKEN: "signed_token",
  LINE_CHANNEL: "line_channel",
  LIFF_ID: "liff_id",
  STORE_SLUG: "store_slug",
  HOSTNAME: "hostname",
  LEGACY_KINGWAY_FALLBACK: "legacy_kingway_fallback",
  UNRESOLVED: "unresolved"
};

const RESOLVER_SOURCE_PRIORITY = [
  SOURCE.SIGNED_TOKEN,
  SOURCE.LINE_CHANNEL,
  SOURCE.LIFF_ID,
  SOURCE.STORE_SLUG,
  SOURCE.HOSTNAME,
  SOURCE.LEGACY_KINGWAY_FALLBACK
];

const TRUST_BOUNDARY_RULES = [
  "Do not trust public req.body.store_id, req.body.storeId, req.query.store_id, or req.query.storeId.",
  "Store authority must come from signed token, LINE channel, LIFF ID, slug, hostname, or explicit legacy fallback mode with a configured fallback store id.",
  "Legacy KINGWAY fallback is staging compatibility only, must log warning metadata when used, and must keep sourceResolved=false.",
  "Resolver context may be attached to req.publicStoreContext; public routes should not mutate it."
];

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "auth",
  "customers",
  "dashboard",
  "line",
  "login",
  "orders",
  "products",
  "repairs",
  "settings",
  "staff",
  "static",
  "support"
]);

const tableExistsCache = new Map();
const columnExistsCache = new Map();

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeHostname(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  return raw.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
}

function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/.test(slug)) {
    return "";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return "";
  }
  return slug;
}

function createEmptyContext(req, options = {}) {
  return {
    storeId: null,
    tenantId: null,
    source: SOURCE.UNRESOLVED,
    sourceResolved: false,
    confidence: "none",
    hostname: normalizeHostname(req.headers?.["x-forwarded-host"] || req.headers?.host || ""),
    slug: null,
    liffId: null,
    lineChannelId: null,
    tokenPurpose: options.purpose || null,
    signedTokenId: null,
    legacyFallbackUsed: false,
    resolved: false,
    warnings: [],
    warningMetadata: [],
    audit: {
      route: req.originalUrl || req.url || "",
      method: req.method || "",
      source: SOURCE.UNRESOLVED,
      sourceResolved: false,
      confidence: "none",
      storeId: null,
      tenantId: null,
      legacyFallbackUsed: false,
      warningMetadata: [],
      attempts: [],
      ignoredClientStoreId: getClientProvidedStoreId(req)
    }
  };
}

function getClientProvidedStoreId(req) {
  return {
    bodyStoreId: req.body?.storeId ?? req.body?.store_id ?? null,
    queryStoreId: req.query?.storeId ?? req.query?.store_id ?? null
  };
}

function hasClientProvidedStoreId(req) {
  const provided = getClientProvidedStoreId(req);
  return provided.bodyStoreId !== null || provided.queryStoreId !== null;
}

function recordAttempt(context, source, status, detail = {}) {
  context.audit.attempts.push({
    source,
    status,
    ...detail
  });
}

function finalizeContext(context, patch) {
  const next = {
    ...context,
    ...patch,
    resolved: Boolean(patch.storeId)
  };
  next.sourceResolved = patch.sourceResolved ?? Boolean(
    patch.storeId && patch.source !== SOURCE.LEGACY_KINGWAY_FALLBACK
  );
  next.audit = {
    ...context.audit,
    source: next.source,
    sourceResolved: next.sourceResolved,
    confidence: next.confidence,
    storeId: next.storeId,
    tenantId: next.tenantId,
    legacyFallbackUsed: next.legacyFallbackUsed,
    warnings: next.warnings,
    warningMetadata: next.warningMetadata,
    attempts: context.audit.attempts
  };
  return next;
}

async function tableExists(db, tableName) {
  if (tableExistsCache.has(tableName)) {
    return tableExistsCache.get(tableName);
  }

  const [rows] = await db.query(
    `
      SELECT COUNT(*) AS tableCount
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );
  const exists = Number(rows[0]?.tableCount || 0) > 0;
  tableExistsCache.set(tableName, exists);
  return exists;
}

async function columnExists(db, tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistsCache.has(cacheKey)) {
    return columnExistsCache.get(cacheKey);
  }

  const [rows] = await db.query(
    `
      SELECT COUNT(*) AS columnCount
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  const exists = Number(rows[0]?.columnCount || 0) > 0;
  columnExistsCache.set(cacheKey, exists);
  return exists;
}

async function getStoreTenantIdSelect(db, tableAlias = "s") {
  return (await columnExists(db, "stores", "tenant_id"))
    ? `${tableAlias}.tenant_id AS tenantId`
    : "NULL AS tenantId";
}

async function fetchActiveStore(db, storeId) {
  if (!storeId || !(await tableExists(db, "stores"))) {
    return null;
  }

  const tenantIdSelect = await getStoreTenantIdSelect(db);
  const [rows] = await db.query(
    `
      SELECT s.id, ${tenantIdSelect}
      FROM stores s
      WHERE s.id = ?
        AND s.status = 'active'
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0] || null;
}

function getSignedContextToken(req, options) {
  const headerToken = req.headers?.["x-public-store-token"] || req.headers?.["x-store-context-token"];
  const queryToken = req.query?.publicStoreToken || req.query?.storeContextToken || req.query?.contextToken;
  const bodyToken = options.allowBodyToken ? req.body?.publicStoreToken || req.body?.storeContextToken : null;
  return String(headerToken || queryToken || bodyToken || "").trim();
}

function verifySignedContextToken(token, options = {}) {
  if (!token) {
    return null;
  }

  const parts = String(token).split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadPart, signaturePart] = parts;
  const secret = options.secret || config.jwtSecret;
  const expectedSignature = toBase64Url(crypto.createHmac("sha256", secret).update(payloadPart).digest());
  if (!timingSafeEqualString(signaturePart, expectedSignature)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadPart));
  } catch (error) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) {
    return null;
  }

  if (options.purpose && payload.purpose !== options.purpose) {
    return null;
  }

  return payload;
}

async function resolveBySignedToken(req, options, context) {
  const token = getSignedContextToken(req, options);
  if (!token) {
    recordAttempt(context, SOURCE.SIGNED_TOKEN, "missing");
    return null;
  }

  const payload = verifySignedContextToken(token, options);
  if (!payload?.storeId) {
    recordAttempt(context, SOURCE.SIGNED_TOKEN, "invalid");
    return null;
  }

  const store = await fetchActiveStore(options.db, payload.storeId);
  if (!store) {
    recordAttempt(context, SOURCE.SIGNED_TOKEN, "store_not_found", { storeId: payload.storeId });
    return null;
  }

  recordAttempt(context, SOURCE.SIGNED_TOKEN, "resolved", { storeId: store.id });
  return finalizeContext(context, {
    storeId: store.id,
    tenantId: store.tenantId || payload.tenantId || null,
    source: SOURCE.SIGNED_TOKEN,
    confidence: "high",
    tokenPurpose: payload.purpose || options.purpose || null,
    signedTokenId: payload.jti || null
  });
}

async function resolveByLineChannel(req, options, context) {
  const pathToken = String(
    options.webhookPathToken ||
      req.params?.webhookPathToken ||
      req.params?.lineWebhookToken ||
      req.query?.webhookPathToken ||
      ""
  ).trim();

  if (!pathToken) {
    recordAttempt(context, SOURCE.LINE_CHANNEL, "missing");
    return null;
  }

  if (!(await tableExists(options.db, "store_line_channels"))) {
    recordAttempt(context, SOURCE.LINE_CHANNEL, "table_missing");
    return null;
  }

  const tenantIdSelect = await getStoreTenantIdSelect(options.db);
  const [rows] = await options.db.query(
    `
      SELECT
        slc.store_id AS storeId,
        slc.channel_id AS lineChannelId,
        ${tenantIdSelect}
      FROM store_line_channels slc
      INNER JOIN stores s ON s.id = slc.store_id
      WHERE slc.webhook_path_token = ?
        AND slc.status = 'ACTIVE'
        AND s.status = 'active'
      LIMIT 1
    `,
    [pathToken]
  );

  if (!rows[0]) {
    recordAttempt(context, SOURCE.LINE_CHANNEL, "not_found");
    return null;
  }

  recordAttempt(context, SOURCE.LINE_CHANNEL, "resolved", { storeId: rows[0].storeId });
  return finalizeContext(context, {
    storeId: rows[0].storeId,
    tenantId: rows[0].tenantId || null,
    source: SOURCE.LINE_CHANNEL,
    confidence: "high",
    lineChannelId: rows[0].lineChannelId || null
  });
}

function getLiffId(req, options) {
  return String(
    options.liffId ||
      req.headers?.["x-liff-id"] ||
      req.query?.liffId ||
      req.query?.liff_id ||
      ""
  ).trim();
}

async function resolveByLiffId(req, options, context) {
  const liffId = getLiffId(req, options);
  if (!liffId) {
    recordAttempt(context, SOURCE.LIFF_ID, "missing");
    return null;
  }

  if (!(await tableExists(options.db, "store_liff_apps"))) {
    recordAttempt(context, SOURCE.LIFF_ID, "table_missing", { liffId });
    return null;
  }

  const routeScope = options.routeScope || null;
  const tenantIdSelect = await getStoreTenantIdSelect(options.db);
  const [rows] = await options.db.query(
    `
      SELECT
        sla.store_id AS storeId,
        sla.route_scope AS routeScope,
        ${tenantIdSelect}
      FROM store_liff_apps sla
      INNER JOIN stores s ON s.id = sla.store_id
      WHERE sla.liff_id = ?
        AND sla.status = 'ACTIVE'
        AND s.status = 'active'
        AND (? IS NULL OR sla.route_scope IN (?, 'GENERAL'))
      LIMIT 1
    `,
    [liffId, routeScope, routeScope]
  );

  if (!rows[0]) {
    recordAttempt(context, SOURCE.LIFF_ID, "not_found_or_scope_mismatch", { liffId, routeScope });
    return null;
  }

  recordAttempt(context, SOURCE.LIFF_ID, "resolved", { storeId: rows[0].storeId, liffId });
  return finalizeContext(context, {
    storeId: rows[0].storeId,
    tenantId: rows[0].tenantId || null,
    source: SOURCE.LIFF_ID,
    confidence: "high",
    liffId
  });
}

function getSlugFromRequest(req, options = {}) {
  const paramSlug = req.params?.storeSlug || req.params?.slug;
  if (paramSlug) {
    return normalizeSlug(paramSlug);
  }

  const match = String(req.originalUrl || req.url || "").match(/^\/s\/([^/?#]+)/);
  if (match) {
    return normalizeSlug(match[1]);
  }

  if (options.allowQuerySlug) {
    return normalizeSlug(req.query?.storeSlug || req.query?.slug);
  }

  return "";
}

async function resolveBySlug(req, options, context) {
  const slug = getSlugFromRequest(req, options);
  if (!slug) {
    recordAttempt(context, SOURCE.STORE_SLUG, "missing_or_reserved");
    return null;
  }

  if (!(await tableExists(options.db, "stores"))) {
    recordAttempt(context, SOURCE.STORE_SLUG, "stores_table_missing", { slug });
    return null;
  }

  const tenantIdSelect = await getStoreTenantIdSelect(options.db);
  const [rows] = await options.db.query(
    `
      SELECT s.id, ${tenantIdSelect}
      FROM stores s
      WHERE s.slug = ?
        AND s.status = 'active'
      LIMIT 1
    `,
    [slug]
  );

  if (!rows[0]) {
    recordAttempt(context, SOURCE.STORE_SLUG, "not_found", { slug });
    return null;
  }

  recordAttempt(context, SOURCE.STORE_SLUG, "resolved", { storeId: rows[0].id, slug });
  return finalizeContext(context, {
    storeId: rows[0].id,
    tenantId: rows[0].tenantId || null,
    source: SOURCE.STORE_SLUG,
    confidence: "medium",
    slug
  });
}

async function resolveByHostname(req, options, context) {
  const hostname = normalizeHostname(
    options.hostname ||
      req.headers?.["x-forwarded-host"] ||
      req.headers?.host ||
      ""
  );

  if (!hostname) {
    recordAttempt(context, SOURCE.HOSTNAME, "missing");
    return null;
  }

  if (!(await tableExists(options.db, "store_hostnames"))) {
    recordAttempt(context, SOURCE.HOSTNAME, "table_missing", { hostname });
    return null;
  }

  const tenantIdSelect = await getStoreTenantIdSelect(options.db);
  const [rows] = await options.db.query(
    `
      SELECT
        sh.store_id AS storeId,
        ${tenantIdSelect}
      FROM store_hostnames sh
      INNER JOIN stores s ON s.id = sh.store_id
      WHERE sh.hostname = ?
        AND sh.status = 'ACTIVE'
        AND s.status = 'active'
      LIMIT 1
    `,
    [hostname]
  );

  if (!rows[0]) {
    recordAttempt(context, SOURCE.HOSTNAME, "not_found", { hostname });
    return null;
  }

  recordAttempt(context, SOURCE.HOSTNAME, "resolved", { storeId: rows[0].storeId, hostname });
  return finalizeContext(context, {
    storeId: rows[0].storeId,
    tenantId: rows[0].tenantId || null,
    source: SOURCE.HOSTNAME,
    confidence: "medium",
    hostname
  });
}

function isExplicitLegacyFallbackMode(options = {}) {
  return options.legacyFallbackMode === SOURCE.LEGACY_KINGWAY_FALLBACK ||
    options.legacyFallbackMode === "legacy_kingway";
}

function getExplicitLegacyFallbackStoreId(options = {}) {
  const rawStoreId = options.legacyFallbackStoreId ?? null;
  const storeId = Number(rawStoreId);
  if (!Number.isSafeInteger(storeId) || storeId <= 0) {
    return null;
  }
  return storeId;
}

async function resolveByLegacyKingwayFallback(req, options, context) {
  if (!isExplicitLegacyFallbackMode(options)) {
    recordAttempt(context, SOURCE.LEGACY_KINGWAY_FALLBACK, "disabled");
    return null;
  }

  const storeId = getExplicitLegacyFallbackStoreId(options);
  if (!storeId) {
    recordAttempt(context, SOURCE.LEGACY_KINGWAY_FALLBACK, "missing_explicit_store_id");
    return null;
  }

  const store = await fetchActiveStore(options.db, storeId);
  const allowUnverifiedFallback = options.legacyFallbackAllowUnverifiedStore === true;
  if (!store && !allowUnverifiedFallback) {
    recordAttempt(context, SOURCE.LEGACY_KINGWAY_FALLBACK, "store_not_found", { storeId });
    return null;
  }

  const fallbackStoreId = store?.id || storeId;
  const warningMetadata = {
    code: "legacy_kingway_fallback_used",
    source: SOURCE.LEGACY_KINGWAY_FALLBACK,
    storeId: fallbackStoreId,
    sourceResolved: false,
    unverifiedStore: !store,
    ignoredClientStoreId: context.audit.ignoredClientStoreId
  };

  recordAttempt(context, SOURCE.LEGACY_KINGWAY_FALLBACK, store ? "resolved" : "resolved_unverified", { storeId: fallbackStoreId });
  const resolved = finalizeContext(context, {
    storeId: fallbackStoreId,
    tenantId: store?.tenantId || options.legacyTenantId || null,
    source: SOURCE.LEGACY_KINGWAY_FALLBACK,
    sourceResolved: false,
    confidence: "legacy",
    legacyFallbackUsed: true,
    warnings: [
      ...context.warnings,
      "legacy_kingway_fallback_used"
    ],
    warningMetadata: [
      ...context.warningMetadata,
      warningMetadata
    ]
  });

  console.warn("[public-store-resolver] legacy KINGWAY fallback used", {
    route: req.originalUrl || req.url || "",
    method: req.method || "",
    storeId: fallbackStoreId,
    sourceResolved: resolved.sourceResolved,
    warning: warningMetadata,
    ignoredClientStoreId: resolved.audit.ignoredClientStoreId
  });

  return resolved;
}

function logResolvedContext(context, options = {}) {
  const logger = options.logger || console;
  const payload = {
    route: context.audit.route,
    method: context.audit.method,
    source: context.source,
    sourceResolved: context.sourceResolved,
    confidence: context.confidence,
    storeId: context.storeId,
    tenantId: context.tenantId,
    legacyFallbackUsed: context.legacyFallbackUsed,
    warningMetadata: context.warningMetadata,
    ignoredClientStoreId: context.audit.ignoredClientStoreId
  };

  if (context.legacyFallbackUsed) {
    logger.warn?.("[public-store-resolver] resolved with fallback", payload);
    return;
  }

  if (options.logResolved !== false) {
    logger.info?.("[public-store-resolver] resolved", payload);
  }
}

async function resolvePublicStoreContext(req, options = {}) {
  if (!options.db) {
    throw new Error("resolvePublicStoreContext requires options.db");
  }

  let context = createEmptyContext(req, options);
  if (hasClientProvidedStoreId(req)) {
    context.warnings.push("client_store_id_ignored");
  }

  const resolvers = [
    resolveBySignedToken,
    resolveByLineChannel,
    resolveByLiffId,
    resolveBySlug,
    resolveByHostname
  ];

  for (const resolver of resolvers) {
    const resolved = await resolver(req, options, context);
    if (resolved) {
      logResolvedContext(resolved, options);
      return resolved;
    }
  }

  const fallback = await resolveByLegacyKingwayFallback(req, options, context);
  if (fallback) {
    logResolvedContext(fallback, options);
    return fallback;
  }

  context = finalizeContext(context, {
    source: SOURCE.UNRESOLVED,
    sourceResolved: false,
    confidence: "none",
    storeId: null,
    tenantId: null,
    legacyFallbackUsed: false
  });
  if (options.logUnresolved !== false) {
    (options.logger || console).warn?.("[public-store-resolver] unresolved", context.audit);
  }
  return context;
}

function createPublicStoreContextMiddleware(options = {}) {
  return async function publicStoreContextMiddleware(req, res, next) {
    try {
      const context = await resolvePublicStoreContext(req, options);
      req.publicStoreContext = context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  SOURCE,
  RESOLVER_SOURCE_PRIORITY,
  TRUST_BOUNDARY_RULES,
  RESERVED_SLUGS,
  normalizeHostname,
  normalizeSlug,
  createPublicStoreContextMiddleware,
  resolvePublicStoreContext,
  verifySignedContextToken
};

