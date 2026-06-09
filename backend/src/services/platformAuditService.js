const { pool } = require("../db");

function normalizeLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 500);
}

function stringifyJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function getRequestIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || null;
}

async function recordPlatformAudit(req, { action, targetType, targetId = null, before = null, after = null } = {}) {
  try {
    const admin = req.platformAdmin || {};
    const adminEmail = String(admin.email || "").trim();

    if (!adminEmail || !action || !targetType) {
      console.warn("[platformAudit] skipped missing required fields", {
        hasAdminEmail: Boolean(adminEmail),
        action: action || null,
        targetType: targetType || null
      });
      return { recorded: false, skipped: true };
    }

    await pool.query(
      `
        INSERT INTO platform_admin_audit_logs
          (admin_user_id, admin_email, action, target_type, target_id, before_json, after_json, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        admin.id || null,
        adminEmail,
        action,
        targetType,
        targetId || null,
        stringifyJson(before),
        stringifyJson(after),
        getRequestIp(req),
        String(req.get("user-agent") || "").slice(0, 500) || null
      ]
    );

    return { recorded: true };
  } catch (error) {
    console.warn("[platformAudit] record failed", {
      action: action || null,
      targetType: targetType || null,
      targetId: targetId || null,
      message: error.message
    });
    return { recorded: false, error };
  }
}

async function listPlatformAuditLogs({ targetType, targetId, action, limit } = {}) {
  const where = [];
  const params = [];

  if (targetType) {
    where.push("target_type = ?");
    params.push(String(targetType));
  }

  if (targetId !== undefined && targetId !== null && targetId !== "") {
    where.push("target_id = ?");
    params.push(Number(targetId));
  }

  if (action) {
    where.push("action = ?");
    params.push(String(action));
  }

  const normalizedLimit = normalizeLimit(limit);
  params.push(normalizedLimit);

  const [rows] = await pool.query(
    `
      SELECT
        id,
        admin_user_id AS adminUserId,
        admin_email AS adminEmail,
        action,
        target_type AS targetType,
        target_id AS targetId,
        before_json AS beforeJson,
        after_json AS afterJson,
        ip,
        user_agent AS userAgent,
        created_at AS createdAt
      FROM platform_admin_audit_logs
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?
    `,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    adminUserId: row.adminUserId === null || row.adminUserId === undefined ? null : Number(row.adminUserId),
    adminEmail: row.adminEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId === null || row.targetId === undefined ? null : Number(row.targetId),
    before: parseJson(row.beforeJson),
    after: parseJson(row.afterJson),
    ip: row.ip || null,
    userAgent: row.userAgent || null,
    createdAt: row.createdAt
  }));
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

module.exports = {
  listPlatformAuditLogs,
  recordPlatformAudit
};
