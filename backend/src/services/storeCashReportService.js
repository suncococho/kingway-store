const { pool } = require("../db");
const { verifyPassword } = require("../utils/passwords");

const HQ_RELATIONSHIP_TYPES = new Set(["HEADQUARTERS", "WAREHOUSE"]);
const MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const CASH_COUNT_FIELDS = [
  ["count1000", "count_1000", 1000],
  ["count100", "count_100", 100],
  ["count50", "count_50", 50],
  ["count10", "count_10", 10],
  ["count1", "count_1", 1]
];
const MONEY_FIELDS = [
  ["orderCashAmount", "order_cash_amount"],
  ["reservationDepositCashAmount", "reservation_deposit_cash_amount"],
  ["cashReceivableAmount", "cash_receivable_amount"],
  ["sameDayFullCashAmount", "same_day_full_cash_amount"]
];
const DIRECT_EDIT_WINDOW_MINUTES = 60;

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStoreRole(value) {
  return String(value || "").trim().toLowerCase();
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDate(value, fieldName = "reportDate") {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} 格式需為 YYYY-MM-DD`, 400);
  }
  return text;
}

function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function formatDateTimeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return String(value).replace("T", " ").slice(0, 19);
}

function getTaipeiToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function parseCount(value, fieldName) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createError(`${fieldName} 必須為 0 以上整數`, 400);
  }
  return parsed;
}

function parseMoneyToCents(value, fieldName) {
  if (value === undefined || value === null || value === "") return 0;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw createError(`${fieldName} 必須為 0 以上金額，最多兩位小數`, 400);
  }
  const [whole, decimal = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw createError(`${fieldName} 金額不正確`, 400);
  }
  return cents;
}

function centsToDecimal(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function normalizePayload(payload = {}) {
  const reportDate = normalizeDate(payload.reportDate || payload.report_date);
  const counts = {};
  for (const [camelKey, snakeKey] of CASH_COUNT_FIELDS) {
    counts[camelKey] = parseCount(payload[camelKey] ?? payload[snakeKey], camelKey);
  }

  const moneyCents = {};
  for (const [camelKey, snakeKey] of MONEY_FIELDS) {
    moneyCents[camelKey] = parseMoneyToCents(payload[camelKey] ?? payload[snakeKey], camelKey);
  }

  const note = String(payload.note || "").trim().slice(0, 5000) || null;
  const editReason = String(payload.editReason || payload.lateEditReason || "").trim().slice(0, 5000);

  const operatingCashTotal = calculateOperatingCashTotal(counts);
  const totalCashInflowCents = calculateTotalCashInflowCents(moneyCents);

  return {
    reportDate,
    counts,
    moneyCents,
    note,
    editReason,
    editPassword: payload.editPassword || payload.managerPassword || "",
    operatingCashTotal,
    totalCashInflow: centsToDecimal(totalCashInflowCents)
  };
}

function calculateOperatingCashTotal(payload = {}) {
  return CASH_COUNT_FIELDS.reduce((sum, [camelKey, _snakeKey, unit]) => {
    return sum + parseCount(payload[camelKey], camelKey) * unit;
  }, 0).toFixed(2);
}

function calculateTotalCashInflowCents(moneyCents = {}) {
  return Number(moneyCents.orderCashAmount || 0) +
    Number(moneyCents.reservationDepositCashAmount || 0) +
    Number(moneyCents.sameDayFullCashAmount || 0);
}

async function resolveCashReportContext(req, connection = pool) {
  const staffUserId = toPositiveInteger(req.user?.id);
  const storeId = toPositiveInteger(req.storeId ?? req.user?.storeId);
  if (!staffUserId || !storeId) {
    throw createError("Store scope required", 403);
  }

  const [relations] = await connection.query(
    `
      SELECT company_id AS companyId, store_id AS storeId, relationship_type AS relationshipType
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
    `,
    [storeId]
  );

  const currentCompanyIds = [...new Set(relations.map((row) => toPositiveInteger(row.companyId)).filter(Boolean))];
  const relationshipTypes = [...new Set(relations.map((row) => normalizeRole(row.relationshipType)).filter(Boolean))];
  const hqCompanyIds = [...new Set(relations
    .filter((row) => HQ_RELATIONSHIP_TYPES.has(normalizeRole(row.relationshipType)))
    .map((row) => toPositiveInteger(row.companyId))
    .filter(Boolean))];

  let accessibleStoreIds = [storeId];
  if (hqCompanyIds.length) {
    const [storeRows] = await connection.query(
      `
        SELECT DISTINCT store_id AS storeId
        FROM company_stores
        WHERE status = 'ACTIVE'
          AND company_id IN (${hqCompanyIds.map(() => "?").join(",")})
      `,
      hqCompanyIds
    );
    accessibleStoreIds = [...new Set(storeRows.map((row) => toPositiveInteger(row.storeId)).filter(Boolean))];
  }

  const role = normalizeRole(req.user?.role);
  const storeRole = normalizeStoreRole(req.user?.storeRole || req.user?.store_role);
  const canApproveLateEdit = MANAGER_ROLES.has(role) || STORE_MANAGER_ROLES.has(storeRole);
  const canViewAllStores = hqCompanyIds.length > 0 && canApproveLateEdit;

  return {
    staffUserId,
    storeId,
    role,
    storeRole,
    currentCompanyIds,
    relationshipTypes,
    hqCompanyIds,
    accessibleStoreIds: canViewAllStores ? accessibleStoreIds : [storeId],
    isHqStore: hqCompanyIds.length > 0,
    canViewAllStores,
    canApproveLateEdit
  };
}

function resolveReadableStoreId(context, requestedStoreId = null) {
  const requested = toPositiveInteger(requestedStoreId);
  if (!requested) return null;
  if (requested === context.storeId) return requested;
  if (context.canViewAllStores && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限查看其他門市現金日報", 403);
}

function resolveWritableStoreId(context, requestedStoreId = null) {
  const requested = toPositiveInteger(requestedStoreId, context.storeId);
  if (requested === context.storeId) return requested;
  if (context.canViewAllStores && context.accessibleStoreIds.includes(requested)) return requested;
  throw createError("無權限修改其他門市現金日報", 403);
}

async function getCompanyIdForStore(storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT company_id AS companyId
      FROM company_stores
      WHERE store_id = ?
        AND status = 'ACTIVE'
      ORDER BY FIELD(relationship_type, 'HEADQUARTERS', 'WAREHOUSE', 'DIRECT_STORE', 'FRANCHISE_STORE') ASC, company_id ASC
      LIMIT 1
    `,
    [storeId]
  );
  return rows[0]?.companyId || null;
}

async function getAccessibleStores(context, connection = pool) {
  const storeIds = context.canViewAllStores ? context.accessibleStoreIds : [context.storeId];
  if (!storeIds.length) return [];
  const [rows] = await connection.query(
    `
      SELECT id, name, code
      FROM stores
      WHERE id IN (${storeIds.map(() => "?").join(",")})
      ORDER BY id ASC
    `,
    storeIds
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    code: row.code || null
  }));
}

function buildEditState(row = {}) {
  const secondsSinceCreated = Number(row.secondsSinceCreated ?? row.seconds_since_created ?? 0);
  const secondsUntilLocked = Math.max(0, DIRECT_EDIT_WINDOW_MINUTES * 60 - secondsSinceCreated);
  const canEditDirectly = secondsSinceCreated <= DIRECT_EDIT_WINDOW_MINUTES * 60;
  return {
    canEditDirectly,
    requiresPassword: !canEditDirectly,
    lockedForDirectEdit: !canEditDirectly,
    editDeadlineAt: row.editDeadlineAt || row.edit_deadline_at || null,
    minutesUntilLocked: Math.ceil(secondsUntilLocked / 60)
  };
}

function normalizeReport(row = {}) {
  const editState = buildEditState(row);
  return {
    id: row.id == null ? null : Number(row.id),
    companyId: row.companyId == null && row.company_id == null ? null : Number(row.companyId ?? row.company_id),
    storeId: row.storeId == null && row.store_id == null ? null : Number(row.storeId ?? row.store_id),
    storeName: row.storeName || row.store_name || "",
    storeCode: row.storeCode || row.store_code || "",
    reportDate: formatDateValue(row.reportDate || row.report_date),
    count1000: Number(row.count1000 ?? row.count_1000 ?? 0),
    count100: Number(row.count100 ?? row.count_100 ?? 0),
    count50: Number(row.count50 ?? row.count_50 ?? 0),
    count10: Number(row.count10 ?? row.count_10 ?? 0),
    count1: Number(row.count1 ?? row.count_1 ?? 0),
    operatingCashTotal: String(row.operatingCashTotal ?? row.operating_cash_total ?? "0.00"),
    orderCashAmount: String(row.orderCashAmount ?? row.order_cash_amount ?? "0.00"),
    reservationDepositCashAmount: String(row.reservationDepositCashAmount ?? row.reservation_deposit_cash_amount ?? "0.00"),
    cashReceivableAmount: String(row.cashReceivableAmount ?? row.cash_receivable_amount ?? "0.00"),
    sameDayFullCashAmount: String(row.sameDayFullCashAmount ?? row.same_day_full_cash_amount ?? "0.00"),
    totalCashInflow: String(row.totalCashInflow ?? row.total_cash_inflow ?? "0.00"),
    note: row.note || "",
    createdByStaffUserId: row.createdByStaffUserId == null && row.created_by_staff_user_id == null ? null : Number(row.createdByStaffUserId ?? row.created_by_staff_user_id),
    updatedByStaffUserId: row.updatedByStaffUserId == null && row.updated_by_staff_user_id == null ? null : Number(row.updatedByStaffUserId ?? row.updated_by_staff_user_id),
    lateEditApprovedByStaffUserId: row.lateEditApprovedByStaffUserId == null && row.late_edit_approved_by_staff_user_id == null ? null : Number(row.lateEditApprovedByStaffUserId ?? row.late_edit_approved_by_staff_user_id),
    lateEditApprovedAt: formatDateTimeValue(row.lateEditApprovedAt || row.late_edit_approved_at),
    lateEditReason: row.lateEditReason || row.late_edit_reason || "",
    editCount: Number(row.editCount ?? row.edit_count ?? 0),
    createdAt: formatDateTimeValue(row.createdAt || row.created_at),
    updatedAt: formatDateTimeValue(row.updatedAt || row.updated_at),
    createdByName: row.createdByName || row.created_by_name || row.createdByUsername || row.created_by_username || "",
    updatedByName: row.updatedByName || row.updated_by_name || row.updatedByUsername || row.updated_by_username || "",
    lateEditApprovedByName: row.lateEditApprovedByName || row.late_edit_approved_by_name || row.lateEditApprovedByUsername || row.late_edit_approved_by_username || "",
    ...editState
  };
}

function buildDefaultReport(context, storeId, reportDate) {
  return normalizeReport({
    id: null,
    companyId: null,
    storeId,
    reportDate,
    editDeadlineAt: null,
    secondsSinceCreated: 0,
    canEditDirectly: true,
    requiresPassword: false,
    lockedForDirectEdit: false,
    minutesUntilLocked: DIRECT_EDIT_WINDOW_MINUTES
  });
}

function selectReportSql(whereClause) {
  return `
    SELECT r.id,
           r.company_id AS companyId,
           r.store_id AS storeId,
           s.name AS storeName,
           s.code AS storeCode,
           r.report_date AS reportDate,
           r.count_1000 AS count1000,
           r.count_100 AS count100,
           r.count_50 AS count50,
           r.count_10 AS count10,
           r.count_1 AS count1,
           r.operating_cash_total AS operatingCashTotal,
           r.order_cash_amount AS orderCashAmount,
           r.reservation_deposit_cash_amount AS reservationDepositCashAmount,
           r.cash_receivable_amount AS cashReceivableAmount,
           r.same_day_full_cash_amount AS sameDayFullCashAmount,
           r.total_cash_inflow AS totalCashInflow,
           r.note,
           r.created_by_staff_user_id AS createdByStaffUserId,
           r.updated_by_staff_user_id AS updatedByStaffUserId,
           r.late_edit_approved_by_staff_user_id AS lateEditApprovedByStaffUserId,
           r.late_edit_approved_at AS lateEditApprovedAt,
           r.late_edit_reason AS lateEditReason,
           r.edit_count AS editCount,
           r.created_at AS createdAt,
           r.updated_at AS updatedAt,
           DATE_ADD(r.created_at, INTERVAL ${DIRECT_EDIT_WINDOW_MINUTES} MINUTE) AS editDeadlineAt,
           TIMESTAMPDIFF(SECOND, r.created_at, NOW()) AS secondsSinceCreated,
           created_staff.username AS createdByUsername,
           created_staff.display_name AS createdByName,
           updated_staff.username AS updatedByUsername,
           updated_staff.display_name AS updatedByName,
           approved_staff.username AS lateEditApprovedByUsername,
           approved_staff.display_name AS lateEditApprovedByName
    FROM store_cash_reports r
    LEFT JOIN stores s ON s.id = r.store_id
    LEFT JOIN staff_users created_staff ON created_staff.id = r.created_by_staff_user_id
    LEFT JOIN staff_users updated_staff ON updated_staff.id = r.updated_by_staff_user_id
    LEFT JOIN staff_users approved_staff ON approved_staff.id = r.late_edit_approved_by_staff_user_id
    ${whereClause}
  `;
}

async function fetchReportByStoreDate(connection, storeId, reportDate, forUpdate = false) {
  const [rows] = await connection.query(
    `${selectReportSql("WHERE r.store_id = ? AND r.report_date = ?")} ${forUpdate ? "FOR UPDATE" : ""}`,
    [storeId, reportDate]
  );
  return rows[0] || null;
}

function toAuditSnapshot(row = {}) {
  const report = normalizeReport(row);
  return {
    id: report.id,
    storeId: report.storeId,
    reportDate: report.reportDate,
    count1000: report.count1000,
    count100: report.count100,
    count50: report.count50,
    count10: report.count10,
    count1: report.count1,
    operatingCashTotal: report.operatingCashTotal,
    orderCashAmount: report.orderCashAmount,
    reservationDepositCashAmount: report.reservationDepositCashAmount,
    cashReceivableAmount: report.cashReceivableAmount,
    sameDayFullCashAmount: report.sameDayFullCashAmount,
    totalCashInflow: report.totalCashInflow,
    note: report.note,
    editCount: report.editCount
  };
}

async function verifyLateEditPassword(context, password, connection = pool) {
  if (!context.canApproveLateEdit) {
    throw createError("超過 1 小時後需由管理者重新確認密碼", 403);
  }
  const text = String(password || "");
  if (!text) {
    throw createError("已超過 1 小時，請輸入管理者密碼", 400);
  }
  const [rows] = await connection.query(
    `
      SELECT id, password_hash
      FROM staff_users
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
    `,
    [context.staffUserId]
  );
  const result = await verifyPassword(text, rows[0]?.password_hash || "");
  if (!result.isMatch) {
    throw createError("密碼錯誤，無法修改", 403);
  }
  return Number(rows[0].id);
}

async function upsertCashReport(context, payload = {}) {
  const normalized = normalizePayload(payload);
  const targetStoreId = resolveWritableStoreId(context, payload.storeId || payload.store_id);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const existing = await fetchReportByStoreDate(connection, targetStoreId, normalized.reportDate, true);
    const companyId = await getCompanyIdForStore(targetStoreId, connection);

    if (!existing) {
      const [result] = await connection.query(
        `
          INSERT INTO store_cash_reports (
            company_id,
            store_id,
            report_date,
            count_1000,
            count_100,
            count_50,
            count_10,
            count_1,
            operating_cash_total,
            order_cash_amount,
            reservation_deposit_cash_amount,
            cash_receivable_amount,
            same_day_full_cash_amount,
            total_cash_inflow,
            note,
            created_by_staff_user_id,
            updated_by_staff_user_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          companyId,
          targetStoreId,
          normalized.reportDate,
          normalized.counts.count1000,
          normalized.counts.count100,
          normalized.counts.count50,
          normalized.counts.count10,
          normalized.counts.count1,
          normalized.operatingCashTotal,
          centsToDecimal(normalized.moneyCents.orderCashAmount),
          centsToDecimal(normalized.moneyCents.reservationDepositCashAmount),
          centsToDecimal(normalized.moneyCents.cashReceivableAmount),
          centsToDecimal(normalized.moneyCents.sameDayFullCashAmount),
          normalized.totalCashInflow,
          normalized.note,
          context.staffUserId,
          context.staffUserId
        ]
      );
      await connection.commit();
      const created = await fetchReportByStoreDate(pool, targetStoreId, normalized.reportDate);
      return { report: normalizeReport(created), created: true, updated: false, id: Number(result.insertId) };
    }

    const editState = buildEditState(existing);
    let editType = "WITHIN_1_HOUR";
    let approvedByStaffUserId = null;
    let lateEditReason = existing.lateEditReason || existing.late_edit_reason || null;

    if (!editState.canEditDirectly) {
      approvedByStaffUserId = await verifyLateEditPassword(context, normalized.editPassword, connection);
      if (!normalized.editReason) {
        throw createError("已超過 1 小時，請填寫修改原因", 400);
      }
      editType = "PASSWORD_APPROVED";
      lateEditReason = normalized.editReason;
    }

    const beforeSnapshot = toAuditSnapshot(existing);
    await connection.query(
      `
        UPDATE store_cash_reports
        SET company_id = ?,
            count_1000 = ?,
            count_100 = ?,
            count_50 = ?,
            count_10 = ?,
            count_1 = ?,
            operating_cash_total = ?,
            order_cash_amount = ?,
            reservation_deposit_cash_amount = ?,
            cash_receivable_amount = ?,
            same_day_full_cash_amount = ?,
            total_cash_inflow = ?,
            note = ?,
            updated_by_staff_user_id = ?,
            late_edit_approved_by_staff_user_id = ?,
            late_edit_approved_at = CASE WHEN ? IS NULL THEN late_edit_approved_at ELSE NOW() END,
            late_edit_reason = ?,
            edit_count = edit_count + 1
        WHERE id = ?
      `,
      [
        companyId,
        normalized.counts.count1000,
        normalized.counts.count100,
        normalized.counts.count50,
        normalized.counts.count10,
        normalized.counts.count1,
        normalized.operatingCashTotal,
        centsToDecimal(normalized.moneyCents.orderCashAmount),
        centsToDecimal(normalized.moneyCents.reservationDepositCashAmount),
        centsToDecimal(normalized.moneyCents.cashReceivableAmount),
        centsToDecimal(normalized.moneyCents.sameDayFullCashAmount),
        normalized.totalCashInflow,
        normalized.note,
        context.staffUserId,
        approvedByStaffUserId,
        approvedByStaffUserId,
        lateEditReason,
        existing.id
      ]
    );

    const updated = await fetchReportByStoreDate(connection, targetStoreId, normalized.reportDate, false);
    await connection.query(
      `
        INSERT INTO store_cash_report_edit_logs (
          cash_report_id,
          store_id,
          report_date,
          edited_by_staff_user_id,
          approved_by_staff_user_id,
          edit_type,
          before_json,
          after_json,
          reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        existing.id,
        targetStoreId,
        normalized.reportDate,
        context.staffUserId,
        approvedByStaffUserId,
        editType,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(toAuditSnapshot(updated)),
        editType === "PASSWORD_APPROVED" ? normalized.editReason : null
      ]
    );

    await connection.commit();
    return { report: normalizeReport(updated), created: false, updated: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getCashReports(context, filters = {}) {
  const startDate = filters.startDate ? normalizeDate(filters.startDate, "startDate") : null;
  const endDate = filters.endDate ? normalizeDate(filters.endDate, "endDate") : null;
  const requestedStoreId = resolveReadableStoreId(context, filters.storeId);
  const limit = Math.min(toPositiveInteger(filters.limit, 60), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const storeIds = requestedStoreId ? [requestedStoreId] : context.accessibleStoreIds;

  const clauses = [`r.store_id IN (${storeIds.map(() => "?").join(",")})`];
  const params = [...storeIds];
  if (startDate) {
    clauses.push("r.report_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    clauses.push("r.report_date <= ?");
    params.push(endDate);
  }

  const [rows] = await pool.query(
    `${selectReportSql(`WHERE ${clauses.join(" AND ")}`)}
     ORDER BY r.report_date DESC, r.store_id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    reports: rows.map(normalizeReport),
    stores: await getAccessibleStores(context),
    canViewAllStores: context.canViewAllStores,
    currentStoreId: context.storeId
  };
}

async function getCashReportByDate(context, storeId, reportDate) {
  const normalizedDate = normalizeDate(reportDate);
  const targetStoreId = resolveReadableStoreId(context, storeId) || context.storeId;
  const row = await fetchReportByStoreDate(pool, targetStoreId, normalizedDate);
  return {
    report: row ? normalizeReport(row) : buildDefaultReport(context, targetStoreId, normalizedDate),
    stores: await getAccessibleStores(context),
    canViewAllStores: context.canViewAllStores,
    currentStoreId: context.storeId
  };
}

async function getCashReportSummary(context, filters = {}) {
  const startDate = filters.startDate ? normalizeDate(filters.startDate, "startDate") : null;
  const endDate = filters.endDate ? normalizeDate(filters.endDate, "endDate") : null;
  const requestedStoreId = resolveReadableStoreId(context, filters.storeId);
  const storeIds = requestedStoreId ? [requestedStoreId] : context.accessibleStoreIds;

  const clauses = [`store_id IN (${storeIds.map(() => "?").join(",")})`];
  const params = [...storeIds];
  if (startDate) {
    clauses.push("report_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    clauses.push("report_date <= ?");
    params.push(endDate);
  }

  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS reportCount,
             COALESCE(SUM(operating_cash_total), 0) AS operatingCashTotal,
             COALESCE(SUM(order_cash_amount), 0) AS orderCashAmount,
             COALESCE(SUM(reservation_deposit_cash_amount), 0) AS reservationDepositCashAmount,
             COALESCE(SUM(cash_receivable_amount), 0) AS cashReceivableAmount,
             COALESCE(SUM(same_day_full_cash_amount), 0) AS sameDayFullCashAmount,
             COALESCE(SUM(total_cash_inflow), 0) AS totalCashInflow
      FROM store_cash_reports
      WHERE ${clauses.join(" AND ")}
    `,
    params
  );
  return {
    reportCount: Number(rows[0]?.reportCount || 0),
    operatingCashTotal: String(rows[0]?.operatingCashTotal || "0.00"),
    orderCashAmount: String(rows[0]?.orderCashAmount || "0.00"),
    reservationDepositCashAmount: String(rows[0]?.reservationDepositCashAmount || "0.00"),
    cashReceivableAmount: String(rows[0]?.cashReceivableAmount || "0.00"),
    sameDayFullCashAmount: String(rows[0]?.sameDayFullCashAmount || "0.00"),
    totalCashInflow: String(rows[0]?.totalCashInflow || "0.00")
  };
}

module.exports = {
  calculateOperatingCashTotal,
  getCashReportByDate,
  getCashReports,
  getCashReportSummary,
  getTaipeiToday,
  resolveCashReportContext,
  upsertCashReport
};
