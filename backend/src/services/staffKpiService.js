const { pool } = require("../db");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const COMPANY_ADMIN_ROLES = new Set(["company_owner", "hq_admin", "inventory_manager", "finance"]);

const SCORE_BY_EVENT = {
  DAILY_TASK_DONE: 1,
  DAILY_TASK_DONE_ON_TIME: 2,
  DAILY_TASK_SKIPPED: 0,
  NOTIFICATION_DONE: 0.5,
  INTERNAL_MESSAGE_READ: 0.2,
  STORE_TRANSFER_SHIPPED: 1,
  STORE_TRANSFER_RECEIVED: 1,
  SUPPLIER_PO_CREATED: 1,
  SUPPLIER_RETURN_CREATED: 1,
  SUPPLIER_RETURN_SHIPPED: 1,
  LINE_REPAIR_HANDLED: 1,
  LINE_ORDER_HANDLED: 1
};

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEventType(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRefType(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function normalizeDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function calculateBasicScore(eventType, options = {}) {
  const normalized = normalizeEventType(eventType);
  if (normalized === "DAILY_TASK_DONE") {
    return options.isLate ? SCORE_BY_EVENT.DAILY_TASK_DONE : SCORE_BY_EVENT.DAILY_TASK_DONE_ON_TIME;
  }
  return SCORE_BY_EVENT[normalized] ?? 0;
}

async function resolveStaffKpiContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) throw createError("Store scope required", 403);

  const [relations] = await connection.query(
    `
      SELECT
        cs.company_id AS companyId,
        cs.store_id AS storeId,
        cs.relationship_type AS relationshipType,
        cm.role AS companyRole
      FROM company_stores cs
      LEFT JOIN company_memberships cm
        ON cm.company_id = cs.company_id
       AND cm.staff_user_id = ?
       AND cm.status = 'ACTIVE'
      WHERE cs.status = 'ACTIVE'
        AND (cs.store_id = ? OR cm.id IS NOT NULL)
    `,
    [staffUserId, storeId]
  );

  const currentRelations = relations.filter((row) => Number(row.storeId) === storeId);
  const companyIds = [...new Set(relations.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const currentCompanyIds = [...new Set(currentRelations.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const hqCompanyIds = [...new Set(currentRelations
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(String(row.relationshipType || "").trim().toUpperCase()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const writableCompanyIds = [...new Set(relations
    .filter((row) => COMPANY_ADMIN_ROLES.has(String(row.companyRole || "").trim()))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];
  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);

  return {
    staffUserId,
    storeId,
    companyIds,
    currentCompanyIds,
    hqCompanyIds,
    writableCompanyIds,
    isHqStore: hqCompanyIds.length > 0,
    isManager: MANAGER_ROLES.has(role) || STORE_MANAGER_ROLES.has(storeRole),
    canReadCompanyKpi: hqCompanyIds.length > 0 || writableCompanyIds.length > 0
  };
}

function buildKpiAccessWhere(context, query = {}, alias = "ske") {
  const clauses = [];
  const params = [];
  const requestedStaffUserId = toPositiveInteger(query.staffUserId);
  const requestedStoreId = toPositiveInteger(query.storeId);

  if (context.canReadCompanyKpi) {
    const companyIds = context.hqCompanyIds.length ? context.hqCompanyIds : context.writableCompanyIds;
    if (companyIds.length) {
      clauses.push(`(${alias}.company_id IN (${companyIds.map(() => "?").join(",")}) OR ${alias}.store_id = ?)`);
      params.push(...companyIds, context.storeId);
    } else {
      clauses.push(`${alias}.store_id = ?`);
      params.push(context.storeId);
    }
  } else if (context.isManager) {
    clauses.push(`${alias}.store_id = ?`);
    params.push(context.storeId);
  } else {
    clauses.push(`${alias}.staff_user_id = ?`);
    params.push(context.staffUserId);
  }

  if (requestedStoreId && (context.canReadCompanyKpi || requestedStoreId === context.storeId)) {
    clauses.push(`${alias}.store_id = ?`);
    params.push(requestedStoreId);
  }
  if (requestedStaffUserId && (context.canReadCompanyKpi || context.isManager || requestedStaffUserId === context.staffUserId)) {
    clauses.push(`${alias}.staff_user_id = ?`);
    params.push(requestedStaffUserId);
  }

  const startDate = normalizeDate(query.startDate, null);
  const endDate = normalizeDate(query.endDate, null);
  if (startDate) {
    clauses.push(`DATE(${alias}.occurred_at) >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    clauses.push(`DATE(${alias}.occurred_at) <= ?`);
    params.push(endDate);
  }
  const eventType = normalizeEventType(query.eventType);
  if (eventType) {
    clauses.push(`${alias}.event_type = ?`);
    params.push(eventType);
  }

  return {
    where: clauses.join(" AND "),
    params
  };
}

async function createKpiEvent(input = {}, connection = pool) {
  const staffUserId = toPositiveInteger(input.staffUserId);
  const eventType = normalizeEventType(input.eventType);
  const title = String(input.title || "").trim();
  if (!staffUserId || !eventType || !title) {
    const error = new Error("staffUserId, eventType 與 title 為必填");
    error.statusCode = 400;
    throw error;
  }

  const refType = normalizeRefType(input.refType);
  const refId = toPositiveInteger(input.refId);
  const score = Number(input.score ?? calculateBasicScore(eventType, input));
  const metadata = input.metadata == null ? null : JSON.stringify(input.metadata);

  const [existing] = refType && refId
    ? await connection.query(
      `
        SELECT *
        FROM staff_kpi_events
        WHERE event_type = ?
          AND ref_type = ?
          AND ref_id = ?
          AND staff_user_id = ?
        LIMIT 1
      `,
      [eventType, refType, refId, staffUserId]
    )
    : [[]];
  if (existing[0]) return normalizeKpiEvent(existing[0]);

  const [result] = await connection.query(
    `
      INSERT INTO staff_kpi_events (
        company_id,
        store_id,
        staff_user_id,
        event_type,
        ref_type,
        ref_id,
        title,
        score,
        occurred_at,
        due_at,
        completed_at,
        is_late,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)
    `,
    [
      toPositiveInteger(input.companyId),
      toPositiveInteger(input.storeId),
      staffUserId,
      eventType,
      refType,
      refId,
      title,
      Number.isFinite(score) ? score : 0,
      input.occurredAt || null,
      input.dueAt || null,
      input.completedAt || null,
      input.isLate ? 1 : 0,
      metadata
    ]
  );

  const [rows] = await connection.query("SELECT * FROM staff_kpi_events WHERE id = ? LIMIT 1", [result.insertId]);
  return normalizeKpiEvent(rows[0]);
}

function createKpiEventOnce(input = {}, connection = pool) {
  return createKpiEvent(input, connection);
}

function normalizeKpiEvent(row = {}) {
  return {
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    storeId: row.store_id == null ? null : Number(row.store_id),
    staffUserId: Number(row.staff_user_id),
    eventType: row.event_type,
    refType: row.ref_type,
    refId: row.ref_id == null ? null : Number(row.ref_id),
    title: row.title,
    score: Number(row.score || 0),
    occurredAt: row.occurred_at,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    isLate: Boolean(row.is_late),
    metadata: row.metadata_json || null,
    createdAt: row.created_at
  };
}

async function getKpiSummary({ context, query = {}, connection = pool }) {
  const access = buildKpiAccessWhere(context, query, "ske");
  const [rows] = await connection.query(
    `
      SELECT
        ske.staff_user_id AS staffUserId,
        su.username,
        su.display_name AS displayName,
        su.role,
        COALESCE(ske.store_id, su.store_id) AS storeId,
        st.name AS storeName,
        COUNT(*) AS totalEvents,
        COALESCE(SUM(ske.score), 0) AS totalScore,
        SUM(CASE WHEN ske.event_type = 'DAILY_TASK_DONE' THEN 1 ELSE 0 END) AS dailyTaskDoneCount,
        SUM(CASE WHEN ske.event_type = 'NOTIFICATION_DONE' THEN 1 ELSE 0 END) AS notificationDoneCount,
        SUM(CASE WHEN ske.event_type IN ('STORE_TRANSFER_SHIPPED', 'STORE_TRANSFER_RECEIVED') THEN 1 ELSE 0 END) AS transferCount,
        SUM(CASE WHEN ske.event_type IN ('SUPPLIER_PO_CREATED', 'SUPPLIER_RETURN_CREATED', 'SUPPLIER_RETURN_SHIPPED') THEN 1 ELSE 0 END) AS supplierCount,
        SUM(CASE WHEN ske.event_type = 'INTERNAL_MESSAGE_READ' THEN 1 ELSE 0 END) AS messageReadCount,
        SUM(CASE WHEN ske.is_late = 1 THEN 1 ELSE 0 END) AS lateCount
      FROM staff_kpi_events ske
      LEFT JOIN staff_users su ON su.id = ske.staff_user_id
      LEFT JOIN stores st ON st.id = COALESCE(ske.store_id, su.store_id)
      WHERE ${access.where}
      GROUP BY ske.staff_user_id, su.username, su.display_name, su.role, COALESCE(ske.store_id, su.store_id), st.name
      ORDER BY totalScore DESC, totalEvents DESC, displayName ASC
      LIMIT 200
    `,
    access.params
  );

  return rows.map((row) => ({
    staffUserId: Number(row.staffUserId),
    username: row.username || "",
    displayName: row.displayName || row.username || `#${row.staffUserId}`,
    role: row.role || "",
    storeId: row.storeId == null ? null : Number(row.storeId),
    storeName: row.storeName || "",
    totalEvents: Number(row.totalEvents || 0),
    totalScore: Number(row.totalScore || 0),
    dailyTaskDoneCount: Number(row.dailyTaskDoneCount || 0),
    notificationDoneCount: Number(row.notificationDoneCount || 0),
    transferCount: Number(row.transferCount || 0),
    supplierCount: Number(row.supplierCount || 0),
    messageReadCount: Number(row.messageReadCount || 0),
    lateCount: Number(row.lateCount || 0)
  }));
}

async function getKpiEvents({ context, query = {}, connection = pool }) {
  const access = buildKpiAccessWhere(context, query, "ske");
  const limit = Math.min(Math.max(toPositiveInteger(query.limit, 100), 1), 300);
  const [rows] = await connection.query(
    `
      SELECT
        ske.*,
        su.username,
        su.display_name AS displayName,
        st.name AS storeName
      FROM staff_kpi_events ske
      LEFT JOIN staff_users su ON su.id = ske.staff_user_id
      LEFT JOIN stores st ON st.id = ske.store_id
      WHERE ${access.where}
      ORDER BY ske.occurred_at DESC, ske.id DESC
      LIMIT ?
    `,
    [...access.params, limit]
  );
  return rows.map((row) => ({
    ...normalizeKpiEvent(row),
    username: row.username || "",
    displayName: row.displayName || row.username || "",
    storeName: row.storeName || ""
  }));
}

module.exports = {
  calculateBasicScore,
  createKpiEvent,
  createKpiEventOnce,
  getKpiEvents,
  getKpiSummary,
  resolveStaffKpiContext
};
