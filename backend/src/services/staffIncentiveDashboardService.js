const { createError } = require("../utils/errors");
const {
  EVENT_STATUSES,
  getActiveIncentivePlan,
  getSignedIncentiveAgreement
} = require("./staffIncentiveService");

const REQUIRED_TABLES = Object.freeze([
  "staff_incentive_plan_versions",
  "staff_incentive_agreements",
  "staff_incentive_payouts",
  "staff_incentive_events",
  "staff_incentive_adjustments",
  "staff_incentive_disputes"
]);
const INCENTIVE_TYPES = Object.freeze([
  "BIKE",
  "ACCESSORY",
  "REPAIR_INSPECTION"
]);
const DISPUTE_STATUSES = Object.freeze([
  "OPEN",
  "REVIEWING",
  "RESOLVED",
  "REJECTED"
]);

function normalizePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError(`${label}格式錯誤`, 400);
  }
  return id;
}

function normalizeOptionalEnum(value, allowed, label) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    throw createError(`${label}格式錯誤`, 400);
  }
  return normalized;
}

function taipeiYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function normalizeMonth(value, now = new Date()) {
  const month = String(value || taipeiYearMonth(now)).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw createError("月份格式必須為 YYYY-MM", 400);
  }
  return month;
}

function getMonthRange(value, now = new Date()) {
  const month = normalizeMonth(value, now);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    month,
    start: `${month}-01 00:00:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01 00:00:00`
  };
}

async function assertIncentiveTablesReady(connection) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT TABLE_NAME AS tableName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})
    `,
    REQUIRED_TABLES
  );
  const existing = new Set(rows.map((row) => row.tableName));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
  if (missing.length) {
    throw createError(
      `績效資料表尚未完成 migration：${missing.join(", ")}`,
      503
    );
  }
  return true;
}

function mapEventRow(row) {
  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName || null,
    incentiveType: row.incentiveType,
    earningStage: row.earningStage,
    sourceType: row.sourceType,
    sourceId: Number(row.sourceId),
    sourceLineId: Number(row.sourceLineId || 0),
    productId: row.productId == null ? null : Number(row.productId),
    productNameSnapshot: row.productNameSnapshot || null,
    quantity: Number(row.quantity || 0),
    actualSaleAmount: Number(row.actualSaleAmount || 0),
    rate: Number(row.rate || 0),
    calculatedAmount: Number(row.calculatedAmount || 0),
    assignedRatio: Number(row.assignedRatio || 0),
    finalAmount: Number(row.finalAmount || 0),
    status: row.status,
    pendingReason: row.pendingReason || null,
    voidReason: row.voidReason || null,
    earnedAt: row.earnedAt || null,
    approvedAt: row.approvedAt || null,
    payrollMonth: row.payrollMonth || null,
    paidAt: row.paidAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function emptyAmountBucket() {
  return { count: 0, amount: 0 };
}

function summarizeEvents(events = []) {
  const statusCounts = Object.fromEntries(
    EVENT_STATUSES.map((status) => [status, emptyAmountBucket()])
  );
  const typeCounts = Object.fromEntries(
    INCENTIVE_TYPES.map((type) => [type, emptyAmountBucket()])
  );
  const summary = {
    totalAmount: 0,
    pendingAmount: 0,
    earnedAmount: 0,
    approvedAmount: 0,
    paidAmount: 0,
    disputedAmount: 0,
    bikeAmount: 0,
    accessoryAmount: 0,
    repairInspectionAmount: 0,
    saleAmount: 0,
    handoverAmount: 0,
    followupAmount: 0
  };

  for (const event of events) {
    const amount = Number(event.finalAmount || 0);
    const status = String(event.status || "").toUpperCase();
    const type = String(event.incentiveType || "").toUpperCase();
    const stage = String(event.earningStage || "").toUpperCase();

    if (statusCounts[status]) {
      statusCounts[status].count += 1;
      statusCounts[status].amount += amount;
    }
    if (typeCounts[type]) {
      typeCounts[type].count += 1;
      if (status !== "VOID") typeCounts[type].amount += amount;
    }
    if (status === "VOID") continue;

    summary.totalAmount += amount;
    if (status === "PENDING") summary.pendingAmount += amount;
    if (status === "EARNED") summary.earnedAmount += amount;
    if (status === "APPROVED") summary.approvedAmount += amount;
    if (status === "PAID") summary.paidAmount += amount;
    if (status === "DISPUTED") summary.disputedAmount += amount;
    if (type === "BIKE") summary.bikeAmount += amount;
    if (type === "ACCESSORY") summary.accessoryAmount += amount;
    if (type === "REPAIR_INSPECTION") summary.repairInspectionAmount += amount;
    if (stage === "SALE") summary.saleAmount += amount;
    if (stage === "HANDOVER") summary.handoverAmount += amount;
    if (stage === "FOLLOWUP") summary.followupAmount += amount;
  }

  for (const bucket of Object.values(statusCounts)) {
    bucket.amount = Number(bucket.amount.toFixed(2));
  }
  for (const bucket of Object.values(typeCounts)) {
    bucket.amount = Number(bucket.amount.toFixed(2));
  }
  for (const key of Object.keys(summary)) {
    summary[key] = Number(summary[key].toFixed(2));
  }

  return { summary, statusCounts, typeCounts };
}

async function loadStaffProfile(connection, storeId, staffUserId) {
  const [rows] = await connection.query(
    `
      SELECT
        su.id,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS displayName,
        su.username,
        su.role,
        sm.role AS storeRole
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.id = ?
        AND su.is_active = 1
      LIMIT 1
    `,
    [storeId, staffUserId]
  );
  if (!rows[0]) throw createError("找不到目前門市的員工資料", 404);
  return {
    id: Number(rows[0].id),
    displayName: rows[0].displayName,
    username: rows[0].username,
    role: rows[0].role,
    storeRole: rows[0].storeRole
  };
}

async function loadIncentiveEvents(
  connection,
  { storeId, month, staffUserId = null, status = null, type = null, limit = 500 }
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const range = getMonthRange(month);
  const where = [
    "e.store_id = ?",
    "COALESCE(e.earned_at, e.created_at) >= ?",
    "COALESCE(e.earned_at, e.created_at) < ?"
  ];
  const params = [normalizedStoreId, range.start, range.end];

  if (staffUserId !== null && staffUserId !== undefined && staffUserId !== "") {
    where.push("e.staff_user_id = ?");
    params.push(normalizePositiveId(staffUserId, "員工"));
  }
  const normalizedStatus = normalizeOptionalEnum(status, EVENT_STATUSES, "績效狀態");
  if (normalizedStatus) {
    where.push("e.status = ?");
    params.push(normalizedStatus);
  }
  const normalizedType = normalizeOptionalEnum(type, INCENTIVE_TYPES, "績效類型");
  if (normalizedType) {
    where.push("e.incentive_type = ?");
    params.push(normalizedType);
  }
  const normalizedLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
  params.push(Math.trunc(normalizedLimit));

  const [rows] = await connection.query(
    `
      SELECT
        e.id,
        e.store_id AS storeId,
        e.staff_user_id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        e.incentive_type AS incentiveType,
        e.earning_stage AS earningStage,
        e.source_type AS sourceType,
        e.source_id AS sourceId,
        e.source_line_id AS sourceLineId,
        e.product_id AS productId,
        e.product_name_snapshot AS productNameSnapshot,
        e.quantity,
        e.actual_sale_amount AS actualSaleAmount,
        e.rate,
        e.calculated_amount AS calculatedAmount,
        e.assigned_ratio AS assignedRatio,
        e.final_amount AS finalAmount,
        e.status,
        e.pending_reason AS pendingReason,
        e.void_reason AS voidReason,
        e.earned_at AS earnedAt,
        e.approved_at AS approvedAt,
        e.payroll_month AS payrollMonth,
        e.paid_at AS paidAt,
        e.created_at AS createdAt,
        e.updated_at AS updatedAt
      FROM staff_incentive_events e
      LEFT JOIN staff_users su ON su.id = e.staff_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(e.earned_at, e.created_at) DESC, e.id DESC
      LIMIT ?
    `,
    params
  );
  return rows.map(mapEventRow);
}

async function getSelfDashboard(connection, { storeId, staffUserId, month }) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStaffUserId = normalizePositiveId(staffUserId, "員工");
  const range = getMonthRange(month);
  const effectiveAt = new Date();
  const [staff, plan, events] = await Promise.all([
    loadStaffProfile(connection, normalizedStoreId, normalizedStaffUserId),
    getActiveIncentivePlan(connection, normalizedStoreId, effectiveAt),
    loadIncentiveEvents(connection, {
      storeId: normalizedStoreId,
      staffUserId: normalizedStaffUserId,
      month: range.month
    })
  ]);
  const agreement = plan
    ? await getSignedIncentiveAgreement(connection, {
        storeId: normalizedStoreId,
        staffUserId: normalizedStaffUserId,
        planVersionId: plan.id
      })
    : null;
  return {
    month: range.month,
    staff,
    plan,
    agreement,
    ...summarizeEvents(events),
    events
  };
}

async function getPlanForStaff(connection, { storeId, staffUserId, month }) {
  await assertIncentiveTablesReady(connection);
  const range = getMonthRange(month);
  const plan = await getActiveIncentivePlan(
    connection,
    normalizePositiveId(storeId, "門市"),
    new Date()
  );
  const agreement = plan
    ? await getSignedIncentiveAgreement(connection, {
        storeId,
        staffUserId,
        planVersionId: plan.id
      })
    : null;
  return { month: range.month, plan, agreement };
}

async function getAdminOverview(connection, { storeId, month }) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const range = getMonthRange(month);
  const [staffRows] = await connection.query(
    `
      SELECT
        su.id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        su.role
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      WHERE su.is_active = 1
      ORDER BY su.id ASC
    `,
    [normalizedStoreId]
  );
  const events = await loadIncentiveEvents(connection, {
    storeId: normalizedStoreId,
    month: range.month
  });
  const [disputeRows] = await connection.query(
    `
      SELECT staff_user_id AS staffUserId, COUNT(*) AS openDisputeCount
      FROM staff_incentive_disputes
      WHERE store_id = ?
        AND status IN ('OPEN', 'REVIEWING')
      GROUP BY staff_user_id
    `,
    [normalizedStoreId]
  );
  const disputesByStaff = new Map(
    disputeRows.map((row) => [Number(row.staffUserId), Number(row.openDisputeCount || 0)])
  );
  const eventsByStaff = new Map();
  for (const event of events) {
    if (!eventsByStaff.has(event.staffUserId)) eventsByStaff.set(event.staffUserId, []);
    eventsByStaff.get(event.staffUserId).push(event);
  }
  return {
    month: range.month,
    staff: staffRows.map((row) => {
      const staffEvents = eventsByStaff.get(Number(row.staffUserId)) || [];
      const aggregate = summarizeEvents(staffEvents);
      return {
        staffUserId: Number(row.staffUserId),
        staffDisplayName: row.staffDisplayName,
        role: row.role,
        eventCount: staffEvents.length,
        openDisputeCount: disputesByStaff.get(Number(row.staffUserId)) || 0,
        ...aggregate.summary,
        statusCounts: aggregate.statusCounts,
        typeCounts: aggregate.typeCounts
      };
    })
  };
}

async function listAdminAgreements(connection, { storeId }) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const [rows] = await connection.query(
    `
      SELECT
        su.id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        su.role,
        p.id AS planVersionId,
        p.version AS planVersion,
        p.effective_from AS effectiveFrom,
        a.id AS agreementId,
        a.agreement_number AS agreementNumber,
        a.status AS agreementStatus,
        a.pdf_path AS pdfPath,
        a.document_hash AS documentHash,
        a.authentication_method AS authenticationMethod,
        a.signed_at AS signedAt
      FROM staff_users su
      INNER JOIN store_memberships sm
        ON sm.staff_user_id = su.id
       AND sm.store_id = ?
       AND sm.status = 'active'
      LEFT JOIN staff_incentive_plan_versions p
        ON p.id = (
          SELECT active_plan.id
          FROM staff_incentive_plan_versions active_plan
          WHERE active_plan.store_id = sm.store_id
            AND active_plan.status = 'ACTIVE'
            AND active_plan.effective_from <= NOW()
            AND (
              active_plan.effective_to IS NULL
              OR active_plan.effective_to >= NOW()
            )
          ORDER BY active_plan.effective_from DESC, active_plan.id DESC
          LIMIT 1
        )
      LEFT JOIN staff_incentive_agreements a
        ON a.store_id = sm.store_id
       AND a.staff_user_id = su.id
       AND a.plan_version_id = p.id
       AND a.status = 'SIGNED'
      WHERE su.is_active = 1
      ORDER BY su.id ASC
    `,
    [normalizedStoreId]
  );
  return rows.map((row) => ({
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName,
    role: row.role,
    planVersionId: row.planVersionId == null ? null : Number(row.planVersionId),
    planVersion: row.planVersion || null,
    effectiveFrom: row.effectiveFrom || null,
    agreementId: row.agreementId == null ? null : Number(row.agreementId),
    agreementNumber: row.agreementNumber || null,
    agreementStatus: row.agreementStatus || "UNSIGNED",
    pdfPath: row.pdfPath || null,
    documentHash: row.documentHash || null,
    authenticationMethod: row.authenticationMethod || null,
    signedAt: row.signedAt || null
  }));
}

async function createDispute(
  connection,
  { storeId, staffUserId, eventId, reason }
) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStaffUserId = normalizePositiveId(staffUserId, "員工");
  const normalizedEventId = normalizePositiveId(eventId, "績效紀錄");
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 1000) {
    throw createError("異議原因需為 3 至 1000 字", 400);
  }
  const [eventRows] = await connection.query(
    `
      SELECT id, status, final_amount AS finalAmount
      FROM staff_incentive_events
      WHERE id = ? AND store_id = ? AND staff_user_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [normalizedEventId, normalizedStoreId, normalizedStaffUserId]
  );
  if (!eventRows[0]) throw createError("找不到可提出異議的本人績效紀錄", 404);
  const [existingRows] = await connection.query(
    `
      SELECT id
      FROM staff_incentive_disputes
      WHERE store_id = ?
        AND staff_user_id = ?
        AND incentive_event_id = ?
        AND status IN ('OPEN', 'REVIEWING')
      LIMIT 1
    `,
    [normalizedStoreId, normalizedStaffUserId, normalizedEventId]
  );
  if (existingRows[0]) throw createError("此績效紀錄已有待處理異議", 409);
  const [result] = await connection.query(
    `
      INSERT INTO staff_incentive_disputes (
        store_id, staff_user_id, incentive_event_id, reason, status
      ) VALUES (?, ?, ?, ?, 'OPEN')
    `,
    [normalizedStoreId, normalizedStaffUserId, normalizedEventId, normalizedReason]
  );
  return {
    id: Number(result.insertId),
    eventId: normalizedEventId,
    status: "OPEN",
    reason: normalizedReason,
    eventStatus: eventRows[0].status,
    eventAmount: Number(eventRows[0].finalAmount || 0)
  };
}

async function listAdminDisputes(connection, { storeId, status = null }) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStatus = normalizeOptionalEnum(status, DISPUTE_STATUSES, "異議狀態");
  const where = ["d.store_id = ?"];
  const params = [normalizedStoreId];
  if (normalizedStatus) {
    where.push("d.status = ?");
    params.push(normalizedStatus);
  }
  const [rows] = await connection.query(
    `
      SELECT
        d.id,
        d.staff_user_id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        d.incentive_event_id AS eventId,
        e.incentive_type AS incentiveType,
        e.earning_stage AS earningStage,
        e.final_amount AS finalAmount,
        e.status AS eventStatus,
        d.reason,
        d.status,
        d.admin_response AS adminResponse,
        d.resolved_by_staff_id AS resolvedByStaffId,
        d.resolved_at AS resolvedAt,
        d.created_at AS createdAt,
        d.updated_at AS updatedAt
      FROM staff_incentive_disputes d
      INNER JOIN staff_incentive_events e
        ON e.id = d.incentive_event_id AND e.store_id = d.store_id
      LEFT JOIN staff_users su ON su.id = d.staff_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 500
    `,
    params
  );
  return rows.map((row) => ({
    id: Number(row.id),
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName,
    eventId: Number(row.eventId),
    incentiveType: row.incentiveType,
    earningStage: row.earningStage,
    finalAmount: Number(row.finalAmount || 0),
    eventStatus: row.eventStatus,
    reason: row.reason,
    status: row.status,
    adminResponse: row.adminResponse || null,
    resolvedByStaffId: row.resolvedByStaffId == null ? null : Number(row.resolvedByStaffId),
    resolvedAt: row.resolvedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

async function updateAdminDispute(
  connection,
  { storeId, disputeId, adminStaffUserId, status, adminResponse }
) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedDisputeId = normalizePositiveId(disputeId, "異議");
  const normalizedAdminId = normalizePositiveId(adminStaffUserId, "管理員");
  const normalizedStatus = normalizeOptionalEnum(status, DISPUTE_STATUSES, "異議狀態");
  if (!normalizedStatus) throw createError("請選擇異議狀態", 400);
  const normalizedResponse = String(adminResponse || "").trim();
  if (["RESOLVED", "REJECTED"].includes(normalizedStatus) && !normalizedResponse) {
    throw createError("結案或駁回時必須填寫管理員回覆", 400);
  }
  const [existingRows] = await connection.query(
    `SELECT id FROM staff_incentive_disputes WHERE id = ? AND store_id = ? LIMIT 1 FOR UPDATE`,
    [normalizedDisputeId, normalizedStoreId]
  );
  if (!existingRows[0]) throw createError("找不到異議紀錄", 404);
  const resolved = ["RESOLVED", "REJECTED"].includes(normalizedStatus);
  await connection.query(
    `
      UPDATE staff_incentive_disputes
      SET status = ?,
          admin_response = ?,
          resolved_by_staff_id = ?,
          resolved_at = ?
      WHERE id = ? AND store_id = ?
    `,
    [
      normalizedStatus,
      normalizedResponse || null,
      resolved ? normalizedAdminId : null,
      resolved ? new Date() : null,
      normalizedDisputeId,
      normalizedStoreId
    ]
  );
  return { id: normalizedDisputeId, status: normalizedStatus, adminResponse: normalizedResponse || null };
}

async function listAdminAdjustments(connection, { storeId }) {
  await assertIncentiveTablesReady(connection);
  const [rows] = await connection.query(
    `
      SELECT
        a.id,
        a.incentive_event_id AS eventId,
        e.staff_user_id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        e.incentive_type AS incentiveType,
        e.earning_stage AS earningStage,
        a.previous_amount AS previousAmount,
        a.adjustment_amount AS adjustmentAmount,
        a.final_amount AS finalAmount,
        a.reason,
        a.requested_by_staff_id AS requestedByStaffId,
        a.approved_by_staff_id AS approvedByStaffId,
        a.created_at AS createdAt
      FROM staff_incentive_adjustments a
      INNER JOIN staff_incentive_events e
        ON e.id = a.incentive_event_id AND e.store_id = a.store_id
      LEFT JOIN staff_users su ON su.id = e.staff_user_id
      WHERE a.store_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 500
    `,
    [normalizePositiveId(storeId, "門市")]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    eventId: Number(row.eventId),
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName,
    incentiveType: row.incentiveType,
    earningStage: row.earningStage,
    previousAmount: Number(row.previousAmount || 0),
    adjustmentAmount: Number(row.adjustmentAmount || 0),
    finalAmount: Number(row.finalAmount || 0),
    reason: row.reason,
    requestedByStaffId: row.requestedByStaffId == null ? null : Number(row.requestedByStaffId),
    approvedByStaffId: Number(row.approvedByStaffId),
    createdAt: row.createdAt
  }));
}

async function listAdminPayouts(connection, { storeId, month }) {
  await assertIncentiveTablesReady(connection);
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedMonth = normalizeMonth(month);
  const [rows] = await connection.query(
    `
      SELECT
        p.id,
        p.staff_user_id AS staffUserId,
        COALESCE(NULLIF(TRIM(su.display_name), ''), su.username) AS staffDisplayName,
        p.payroll_month AS payrollMonth,
        p.earned_amount AS earnedAmount,
        p.adjustment_amount AS adjustmentAmount,
        p.final_amount AS finalAmount,
        p.status,
        p.approved_by_staff_id AS approvedByStaffId,
        p.approved_at AS approvedAt,
        p.paid_at AS paidAt,
        p.note,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt
      FROM staff_incentive_payouts p
      LEFT JOIN staff_users su ON su.id = p.staff_user_id
      WHERE p.store_id = ? AND p.payroll_month = ?
      ORDER BY p.staff_user_id ASC
      LIMIT 500
    `,
    [normalizedStoreId, normalizedMonth]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName,
    payrollMonth: row.payrollMonth,
    earnedAmount: Number(row.earnedAmount || 0),
    adjustmentAmount: Number(row.adjustmentAmount || 0),
    finalAmount: Number(row.finalAmount || 0),
    status: row.status,
    approvedByStaffId: row.approvedByStaffId == null ? null : Number(row.approvedByStaffId),
    approvedAt: row.approvedAt || null,
    paidAt: row.paidAt || null,
    note: row.note || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

module.exports = {
  REQUIRED_TABLES,
  INCENTIVE_TYPES,
  DISPUTE_STATUSES,
  normalizeMonth,
  getMonthRange,
  summarizeEvents,
  assertIncentiveTablesReady,
  loadIncentiveEvents,
  getSelfDashboard,
  getPlanForStaff,
  getAdminOverview,
  listAdminAgreements,
  createDispute,
  listAdminDisputes,
  updateAdminDispute,
  listAdminAdjustments,
  listAdminPayouts
};
