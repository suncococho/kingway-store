const { pool } = require("../db");
const { resolveStaffKpiContext } = require("./staffKpiService");

const VALID_RATINGS = new Set(["EXCELLENT", "GOOD", "NEEDS_ATTENTION", "NOTE"]);

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeRating(value) {
  const text = String(value || "").trim().toUpperCase();
  return VALID_RATINGS.has(text) ? text : null;
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getTargetStaff(staffUserId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        su.username,
        su.display_name AS displayName,
        su.store_id AS primaryStoreId,
        COALESCE(sm.store_id, su.store_id) AS storeId,
        cs.company_id AS companyId
      FROM staff_users su
      LEFT JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.status = 'active'
       AND sm.is_default = 1
      LEFT JOIN company_stores cs
        ON cs.store_id = COALESCE(sm.store_id, su.store_id)
       AND cs.status = 'ACTIVE'
      WHERE su.id = ?
        AND su.is_active = 1
      LIMIT 1
    `,
    [staffUserId]
  );
  return rows[0] || null;
}

async function resolveEvaluationContext(req, connection = pool) {
  return resolveStaffKpiContext(req, connection);
}

function canAccessTarget(context, target) {
  if (!target) return false;
  const targetStoreId = toPositiveInteger(target.storeId || target.primaryStoreId);
  const targetCompanyId = toPositiveInteger(target.companyId);
  if (context.canReadCompanyKpi) {
    const companyIds = context.hqCompanyIds.length ? context.hqCompanyIds : context.writableCompanyIds;
    return (targetCompanyId && companyIds.includes(targetCompanyId)) || targetStoreId === context.storeId;
  }
  if (context.isManager) {
    return targetStoreId === context.storeId;
  }
  return Number(target.id) === context.staffUserId;
}

function canWriteEvaluation(context, target) {
  if (!canAccessTarget(context, target)) return false;
  return context.canReadCompanyKpi || context.isManager;
}

async function validateEvaluationPermission(context, targetStaffUserId, options = {}, connection = pool) {
  const target = await getTargetStaff(targetStaffUserId, connection);
  if (!target) throw createError("找不到員工", 404);
  const canAccess = options.write ? canWriteEvaluation(context, target) : canAccessTarget(context, target);
  if (!canAccess) throw createError("沒有權限查看或編輯此員工評價", 403);
  return target;
}

function normalizeNote(row = {}) {
  return {
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    storeId: row.store_id == null ? null : Number(row.store_id),
    staffUserId: Number(row.staff_user_id),
    evaluatorStaffUserId: Number(row.evaluator_staff_user_id),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    rating: row.rating || "",
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    staffUsername: row.staffUsername || "",
    staffDisplayName: row.staffDisplayName || "",
    evaluatorUsername: row.evaluatorUsername || "",
    evaluatorDisplayName: row.evaluatorDisplayName || "",
    storeName: row.storeName || ""
  };
}

async function createEvaluationNote(input = {}, connection = pool) {
  const context = input.context;
  const staffUserId = toPositiveInteger(input.staffUserId);
  const evaluatorStaffUserId = toPositiveInteger(input.evaluatorStaffUserId || context?.staffUserId);
  const periodStart = normalizeDate(input.periodStart);
  const periodEnd = normalizeDate(input.periodEnd);
  const note = String(input.note || "").trim();
  const rating = normalizeRating(input.rating);

  if (!context || !staffUserId || !evaluatorStaffUserId || !periodStart || !periodEnd || !note) {
    throw createError("staffUserId, periodStart, periodEnd 與 note 為必填");
  }
  if (periodEnd < periodStart) {
    throw createError("期間結束不可早於開始日期");
  }

  const target = await validateEvaluationPermission(context, staffUserId, { write: true }, connection);
  const storeId = toPositiveInteger(target.storeId || target.primaryStoreId);
  const companyId = toPositiveInteger(target.companyId) || context.currentCompanyIds[0] || context.companyIds[0] || null;

  const [result] = await connection.query(
    `
      INSERT INTO staff_evaluation_notes (
        company_id,
        store_id,
        staff_user_id,
        evaluator_staff_user_id,
        period_start,
        period_end,
        rating,
        note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [companyId, storeId, staffUserId, evaluatorStaffUserId, periodStart, periodEnd, rating, note]
  );

  const notes = await getEvaluationNotes({
    context,
    staffUserId,
    periodStart,
    periodEnd,
    id: result.insertId
  }, connection);
  return notes[0] || null;
}

async function getEvaluationNotes(input = {}, connection = pool) {
  const context = input.context;
  if (!context) throw createError("Evaluation context required", 403);

  const staffUserId = toPositiveInteger(input.staffUserId);
  const storeId = toPositiveInteger(input.storeId);
  const id = toPositiveInteger(input.id);
  const periodStart = normalizeDate(input.periodStart);
  const periodEnd = normalizeDate(input.periodEnd);
  const clauses = [];
  const params = [];

  if (context.canReadCompanyKpi) {
    const companyIds = context.hqCompanyIds.length ? context.hqCompanyIds : context.writableCompanyIds;
    if (companyIds.length) {
      clauses.push("(sen.company_id IN (" + companyIds.map(() => "?").join(",") + ") OR sen.store_id = ?)");
      params.push(...companyIds, context.storeId);
    } else {
      clauses.push("sen.store_id = ?");
      params.push(context.storeId);
    }
  } else if (context.isManager) {
    clauses.push("sen.store_id = ?");
    params.push(context.storeId);
  } else {
    clauses.push("sen.staff_user_id = ?");
    params.push(context.staffUserId);
  }

  if (staffUserId) {
    const target = await validateEvaluationPermission(context, staffUserId, { write: false }, connection);
    clauses.push("sen.staff_user_id = ?");
    params.push(Number(target.id));
  }
  if (storeId && (context.canReadCompanyKpi || storeId === context.storeId)) {
    clauses.push("sen.store_id = ?");
    params.push(storeId);
  }
  if (periodStart) {
    clauses.push("sen.period_end >= ?");
    params.push(periodStart);
  }
  if (periodEnd) {
    clauses.push("sen.period_start <= ?");
    params.push(periodEnd);
  }
  if (id) {
    clauses.push("sen.id = ?");
    params.push(id);
  }

  const [rows] = await connection.query(
    `
      SELECT
        sen.*,
        su.username AS staffUsername,
        su.display_name AS staffDisplayName,
        ev.username AS evaluatorUsername,
        ev.display_name AS evaluatorDisplayName,
        st.name AS storeName
      FROM staff_evaluation_notes sen
      LEFT JOIN staff_users su ON su.id = sen.staff_user_id
      LEFT JOIN staff_users ev ON ev.id = sen.evaluator_staff_user_id
      LEFT JOIN stores st ON st.id = sen.store_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY sen.period_start DESC, sen.created_at DESC, sen.id DESC
      LIMIT 300
    `,
    params
  );
  return rows.map(normalizeNote);
}

module.exports = {
  createEvaluationNote,
  getEvaluationNotes,
  resolveEvaluationContext,
  validateEvaluationPermission
};
