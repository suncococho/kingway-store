const { pool } = require("../db");
const { createKpiEventOnce } = require("./staffKpiService");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const PRIORITY_ORDER = {
  URGENT: 4,
  IMPORTANT: 3,
  NORMAL: 2,
  LOW: 1
};

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePriority(value) {
  const priority = String(value || "NORMAL").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, priority) ? priority : "NORMAL";
}

function normalizeNotification(row = {}) {
  return {
    id: Number(row.id),
    companyId: row.companyId == null ? null : Number(row.companyId),
    storeId: row.storeId == null ? null : Number(row.storeId),
    staffUserId: row.staffUserId == null ? null : Number(row.staffUserId),
    type: row.type,
    title: row.title,
    message: row.message,
    targetUrl: row.targetUrl,
    refType: row.refType,
    refId: row.refId == null ? null : Number(row.refId),
    priority: row.priority,
    status: row.status,
    dueAt: row.dueAt,
    snoozedUntil: row.snoozedUntil,
    readAt: row.readAt,
    doneAt: row.doneAt,
    dismissedAt: row.dismissedAt,
    readByStaffUserId: row.readByStaffUserId == null ? null : Number(row.readByStaffUserId),
    doneByStaffUserId: row.doneByStaffUserId == null ? null : Number(row.doneByStaffUserId),
    dismissedByStaffUserId: row.dismissedByStaffUserId == null ? null : Number(row.dismissedByStaffUserId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function resolveNotificationContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    const error = new Error("Store scope required");
    error.statusCode = 403;
    throw error;
  }

  const [rows] = await connection.query(
    `
      SELECT company_id AS companyId, relationship_type AS relationshipType
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
    `,
    [storeId]
  );

  const companyIds = [...new Set(rows.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const hqCompanyIds = [...new Set(rows
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(String(row.relationshipType || "").toUpperCase()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];

  return {
    staffUserId,
    storeId,
    companyIds,
    hqCompanyIds,
    canReadCompanyNotifications: hqCompanyIds.length > 0
  };
}

function buildVisibleWhere(context, alias = "sn") {
  const clauses = [
    `${alias}.staff_user_id = ?`,
    `(${alias}.staff_user_id IS NULL AND ${alias}.store_id = ?)`
  ];
  const params = [context.staffUserId, context.storeId];

  if (context.canReadCompanyNotifications && context.hqCompanyIds.length) {
    clauses.push(`(${alias}.staff_user_id IS NULL AND ${alias}.company_id IN (${context.hqCompanyIds.map(() => "?").join(",")}))`);
    params.push(...context.hqCompanyIds);
  }

  return {
    where: `(${clauses.join(" OR ")})`,
    params
  };
}

function selectColumns(alias = "sn") {
  return `
    ${alias}.id,
    ${alias}.company_id AS companyId,
    ${alias}.store_id AS storeId,
    ${alias}.staff_user_id AS staffUserId,
    ${alias}.type,
    ${alias}.title,
    ${alias}.message,
    ${alias}.target_url AS targetUrl,
    ${alias}.ref_type AS refType,
    ${alias}.ref_id AS refId,
    ${alias}.priority,
    ${alias}.status,
    ${alias}.due_at AS dueAt,
    ${alias}.snoozed_until AS snoozedUntil,
    ${alias}.read_at AS readAt,
    ${alias}.done_at AS doneAt,
    ${alias}.dismissed_at AS dismissedAt,
    ${alias}.read_by_staff_user_id AS readByStaffUserId,
    ${alias}.done_by_staff_user_id AS doneByStaffUserId,
    ${alias}.dismissed_by_staff_user_id AS dismissedByStaffUserId,
    ${alias}.created_at AS createdAt,
    ${alias}.updated_at AS updatedAt
  `;
}

async function createNotification(input = {}, connection = pool) {
  const type = String(input.type || "").trim().toUpperCase();
  const title = String(input.title || "").trim();
  if (!type || !title) {
    const error = new Error("通知類型與標題為必填");
    error.statusCode = 400;
    throw error;
  }

  const companyId = toPositiveInteger(input.companyId);
  const storeId = toPositiveInteger(input.storeId);
  const staffUserId = toPositiveInteger(input.staffUserId);
  const refType = input.refType ? String(input.refType).trim().toUpperCase() : null;
  const refId = toPositiveInteger(input.refId);

  if (type && refType && refId && storeId) {
    const [existing] = await connection.query(
      `
        SELECT ${selectColumns("sn")}
        FROM staff_notifications sn
        WHERE sn.type = ?
          AND sn.ref_type = ?
          AND sn.ref_id = ?
          AND sn.store_id = ?
        ORDER BY sn.id DESC
        LIMIT 1
      `,
      [type, refType, refId, storeId]
    );
    if (existing[0]) {
      return normalizeNotification(existing[0]);
    }
  }

  const [result] = await connection.query(
    `
      INSERT INTO staff_notifications (
        company_id,
        store_id,
        staff_user_id,
        type,
        title,
        message,
        target_url,
        ref_type,
        ref_id,
        priority,
        due_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      companyId,
      storeId,
      staffUserId,
      type,
      title,
      input.message == null ? null : String(input.message),
      input.targetUrl == null ? null : String(input.targetUrl),
      refType,
      refId,
      normalizePriority(input.priority),
      input.dueAt || null
    ]
  );

  const [rows] = await connection.query(
    `SELECT ${selectColumns("sn")} FROM staff_notifications sn WHERE sn.id = ? LIMIT 1`,
    [result.insertId]
  );
  return normalizeNotification(rows[0]);
}

function buildListFilters(query = {}) {
  const clauses = [];
  const params = [];
  const status = normalizeStatus(query.status);
  if (status === "PENDING") {
    clauses.push("(sn.status = 'UNREAD' OR (sn.status = 'SNOOZED' AND (sn.snoozed_until IS NULL OR sn.snoozed_until <= NOW())))");
  } else if (["UNREAD", "READ", "DONE", "DISMISSED", "SNOOZED"].includes(status)) {
    clauses.push("sn.status = ?");
    params.push(status);
  }

  const priority = normalizePriority(query.priority || "");
  if (query.priority && priority) {
    clauses.push("sn.priority = ?");
    params.push(priority);
  }

  const type = String(query.type || "").trim().toUpperCase();
  if (type) {
    clauses.push("sn.type = ?");
    params.push(type);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.startDate || ""))) {
    clauses.push("DATE(sn.created_at) >= ?");
    params.push(query.startDate);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.endDate || ""))) {
    clauses.push("DATE(sn.created_at) <= ?");
    params.push(query.endDate);
  }

  return { clauses, params };
}

async function getPendingNotifications(context, options = {}, connection = pool) {
  const visible = buildVisibleWhere(context);
  const limit = Math.min(Math.max(toPositiveInteger(options.limit, 5), 1), 20);
  const [rows] = await connection.query(
    `
      SELECT ${selectColumns("sn")}
      FROM staff_notifications sn
      WHERE ${visible.where}
        AND (sn.status = 'UNREAD' OR (sn.status = 'SNOOZED' AND (sn.snoozed_until IS NULL OR sn.snoozed_until <= NOW())))
      ORDER BY FIELD(sn.priority, 'URGENT', 'IMPORTANT', 'NORMAL', 'LOW'), sn.created_at ASC
      LIMIT ?
    `,
    [...visible.params, limit]
  );
  return rows.map(normalizeNotification);
}

async function getNotifications(context, query = {}, connection = pool) {
  const visible = buildVisibleWhere(context);
  const filters = buildListFilters(query);
  const limit = Math.min(Math.max(toPositiveInteger(query.limit, 50), 1), 100);
  const offset = Math.max(toPositiveInteger(query.offset, 0) || 0, 0);
  const whereParts = [visible.where, ...filters.clauses];
  const [rows] = await connection.query(
    `
      SELECT ${selectColumns("sn")}
      FROM staff_notifications sn
      WHERE ${whereParts.join(" AND ")}
      ORDER BY sn.created_at DESC, sn.id DESC
      LIMIT ? OFFSET ?
    `,
    [...visible.params, ...filters.params, limit, offset]
  );
  return rows.map(normalizeNotification);
}

async function getUnreadSummary(context, connection = pool) {
  const visible = buildVisibleWhere(context);
  const [[summary]] = await connection.query(
    `
      SELECT
        COUNT(*) AS notifications,
        SUM(CASE WHEN sn.priority = 'URGENT' THEN 1 ELSE 0 END) AS urgent
      FROM staff_notifications sn
      WHERE ${visible.where}
        AND (sn.status = 'UNREAD' OR (sn.status = 'SNOOZED' AND (sn.snoozed_until IS NULL OR sn.snoozed_until <= NOW())))
    `,
    visible.params
  );

  return {
    notifications: Number(summary?.notifications || 0),
    urgent: Number(summary?.urgent || 0)
  };
}

async function loadVisibleNotification(id, context, connection = pool) {
  const visible = buildVisibleWhere(context);
  const [rows] = await connection.query(
    `
      SELECT ${selectColumns("sn")}
      FROM staff_notifications sn
      WHERE sn.id = ?
        AND ${visible.where}
      LIMIT 1
    `,
    [id, ...visible.params]
  );
  return rows[0] ? normalizeNotification(rows[0]) : null;
}

async function updateNotificationStatus(id, context, action, options = {}, connection = pool) {
  const notificationId = toPositiveInteger(id);
  if (!notificationId) {
    const error = new Error("通知不存在");
    error.statusCode = 404;
    throw error;
  }

  const notification = await loadVisibleNotification(notificationId, context, connection);
  if (!notification) {
    const error = new Error("找不到通知或沒有權限");
    error.statusCode = 404;
    throw error;
  }

  if (action === "read") {
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'READ',
            read_at = COALESCE(read_at, NOW()),
            read_by_staff_user_id = COALESCE(read_by_staff_user_id, ?),
            snoozed_until = NULL
        WHERE id = ?
          AND status IN ('UNREAD', 'SNOOZED')
      `,
      [context.staffUserId, notificationId]
    );
  } else if (action === "done") {
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'DONE',
            read_at = COALESCE(read_at, NOW()),
            read_by_staff_user_id = COALESCE(read_by_staff_user_id, ?),
            done_at = COALESCE(done_at, NOW()),
            done_by_staff_user_id = COALESCE(done_by_staff_user_id, ?),
            snoozed_until = NULL
        WHERE id = ?
          AND status <> 'DONE'
      `,
      [context.staffUserId, context.staffUserId, notificationId]
    );
  } else if (action === "dismiss") {
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'DISMISSED',
            dismissed_at = COALESCE(dismissed_at, NOW()),
            dismissed_by_staff_user_id = COALESCE(dismissed_by_staff_user_id, ?),
            snoozed_until = NULL
        WHERE id = ?
          AND status NOT IN ('DONE', 'DISMISSED')
      `,
      [context.staffUserId, notificationId]
    );
  } else if (action === "snooze") {
    const minutes = Math.min(Math.max(toPositiveInteger(options.minutes, 10), 1), 1440);
    await connection.query(
      `
        UPDATE staff_notifications
        SET status = 'SNOOZED',
            snoozed_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
        WHERE id = ?
          AND status IN ('UNREAD', 'SNOOZED')
      `,
      [minutes, notificationId]
    );
  }

  const updated = await loadVisibleNotification(notificationId, context, connection);
  if (action === "done" && updated) {
    try {
      await createKpiEventOnce({
        companyId: updated.companyId,
        storeId: updated.storeId || context.storeId,
        staffUserId: context.staffUserId,
        eventType: "NOTIFICATION_DONE",
        refType: "STAFF_NOTIFICATION",
        refId: updated.id,
        title: `系統通知完成：${updated.title}`,
        score: 0.5,
        occurredAt: updated.doneAt,
        completedAt: updated.doneAt,
        metadata: {
          notificationType: updated.type,
          priority: updated.priority,
          sourceRefType: updated.refType,
          sourceRefId: updated.refId
        }
      }, connection);
    } catch (kpiError) {
      console.warn("[staff-kpi] notification KPI event failed", {
        notificationId,
        message: kpiError.message
      });
    }
  }

  return updated;
}

module.exports = {
  createNotification,
  getNotifications,
  getPendingNotifications,
  getUnreadSummary,
  resolveNotificationContext,
  updateNotificationStatus
};
