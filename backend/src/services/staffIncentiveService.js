const { createError } = require("../utils/errors");

const EVENT_STATUSES = Object.freeze([
  "PENDING",
  "EARNED",
  "APPROVED",
  "PAID",
  "VOID",
  "DISPUTED"
]);

const WRITABLE_EVENT_STATUSES = new Set([
  "PENDING",
  "EARNED"
]);

const LOCKED_EVENT_STATUSES = new Set([
  "APPROVED",
  "PAID",
  "VOID",
  "DISPUTED"
]);

const INCENTIVE_TYPES = new Set([
  "BIKE",
  "ACCESSORY",
  "REPAIR_INSPECTION"
]);

const EARNING_STAGES = new Set([
  "ALL_STAGES",
  "SALE",
  "HANDOVER",
  "FOLLOWUP",
  "ITEM",
  "INSPECTION"
]);

const SOURCE_TYPES = new Set([
  "ORDER",
  "ORDER_ITEM",
  "REPAIR"
]);

function normalizePositiveId(value, label) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError(`${label}格式錯誤`, 400);
  }

  return id;
}

function normalizeOptionalPositiveId(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizePositiveId(value, label);
}

function normalizeEnum(value, allowedValues, label) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!allowedValues.has(normalized)) {
    throw createError(`${label}格式錯誤`, 400);
  }

  return normalized;
}

function normalizeMoney(value, label) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw createError(`${label}格式錯誤`, 400);
  }

  if (amount < 0) {
    throw createError(`${label}不可為負數`, 400);
  }

  return Number(amount.toFixed(2));
}

function normalizeRatio(value, label) {
  const ratio = Number(value);

  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw createError(`${label}必須介於 0 與 1 之間`, 400);
  }

  return Number(ratio.toFixed(6));
}

function normalizePositiveInteger(value, label, defaultValue = 1) {
  const normalized =
    value === undefined || value === null || value === ""
      ? defaultValue
      : Number(value);

  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw createError(`${label}格式錯誤`, 400);
  }

  return normalized;
}

function normalizeNonNegativeInteger(
  value,
  label,
  defaultValue = 0
) {
  const normalized =
    value === undefined || value === null || value === ""
      ? defaultValue
      : Number(value);

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw createError(`${label}格式錯誤`, 400);
  }

  return normalized;
}

function serializeMetadata(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function mapPlanRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    version: row.version,
    status: row.status,
    bikeTotalAmount: Number(row.bikeTotalAmount ?? 600),
    payoutMode: row.payoutMode || "ALL_STAGES_COMPLETED",
    bikeSaleAmount: Number(row.bikeSaleAmount),
    bikeHandoverAmount: Number(row.bikeHandoverAmount),
    bikeFollowupAmount: Number(row.bikeFollowupAmount),
    accessoryRate: Number(row.accessoryRate),
    repairInspectionAmount: Number(row.repairInspectionAmount),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    agreementText: row.agreementText || null
  };
}

function mapEventRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    staffUserId: Number(row.staffUserId),
    staffDisplayName: row.staffDisplayName || null,
    planVersionId:
      row.planVersionId === null || row.planVersionId === undefined
        ? null
        : Number(row.planVersionId),
    payoutId:
      row.payoutId === null || row.payoutId === undefined
        ? null
        : Number(row.payoutId),
    incentiveType: row.incentiveType,
    earningStage: row.earningStage,
    sourceType: row.sourceType,
    sourceId: Number(row.sourceId),
    sourceLineId: Number(row.sourceLineId || 0),
    sourceUnitKey: row.sourceUnitKey || "",
    productId:
      row.productId === null || row.productId === undefined
        ? null
        : Number(row.productId),
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
    metadataJson: row.metadataJson || null,
    earnedAt: row.earnedAt || null,
    approvedByStaffId:
      row.approvedByStaffId === null ||
      row.approvedByStaffId === undefined
        ? null
        : Number(row.approvedByStaffId),
    approvedAt: row.approvedAt || null,
    payrollMonth: row.payrollMonth || null,
    paidAt: row.paidAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function getActiveIncentivePlan(
  connection,
  storeId,
  effectiveAt = new Date()
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");

  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        version,
        status,
        bike_total_amount AS bikeTotalAmount,
        payout_mode AS payoutMode,
        bike_sale_amount AS bikeSaleAmount,
        bike_handover_amount AS bikeHandoverAmount,
        bike_followup_amount AS bikeFollowupAmount,
        accessory_rate AS accessoryRate,
        repair_inspection_amount AS repairInspectionAmount,
        effective_from AS effectiveFrom,
        effective_to AS effectiveTo,
        agreement_text AS agreementText
      FROM staff_incentive_plan_versions
      WHERE store_id = ?
        AND status = 'ACTIVE'
        AND effective_from <= ?
        AND (
          effective_to IS NULL
          OR effective_to >= ?
        )
      ORDER BY effective_from DESC, id DESC
      LIMIT 1
    `,
    [
      normalizedStoreId,
      effectiveAt,
      effectiveAt
    ]
  );

  return mapPlanRow(rows[0]);
}

async function getSignedIncentiveAgreement(
  connection,
  {
    storeId,
    staffUserId,
    planVersionId
  }
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");
  const normalizedStaffUserId = normalizePositiveId(
    staffUserId,
    "員工"
  );
  const normalizedPlanVersionId = normalizePositiveId(
    planVersionId,
    "績效辦法版本"
  );

  const [rows] = await connection.query(
    `
      SELECT
        id,
        agreement_number AS agreementNumber,
        status,
        signed_at AS signedAt,
        document_hash AS documentHash,
        pdf_path AS pdfPath
      FROM staff_incentive_agreements
      WHERE store_id = ?
        AND staff_user_id = ?
        AND plan_version_id = ?
        AND status = 'SIGNED'
      LIMIT 1
    `,
    [
      normalizedStoreId,
      normalizedStaffUserId,
      normalizedPlanVersionId
    ]
  );

  return rows[0] || null;
}

async function readIncentiveEventById(
  connection,
  eventId,
  storeId
) {
  const [rows] = await connection.query(
    `
      SELECT
        e.id,
        e.store_id AS storeId,
        e.staff_user_id AS staffUserId,
        COALESCE(
          NULLIF(TRIM(su.display_name), ''),
          su.username
        ) AS staffDisplayName,
        e.plan_version_id AS planVersionId,
        e.payout_id AS payoutId,
        e.incentive_type AS incentiveType,
        e.earning_stage AS earningStage,
        e.source_type AS sourceType,
        e.source_id AS sourceId,
        e.source_line_id AS sourceLineId,
        e.source_unit_key AS sourceUnitKey,
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
        e.metadata_json AS metadataJson,
        e.earned_at AS earnedAt,
        e.approved_by_staff_id AS approvedByStaffId,
        e.approved_at AS approvedAt,
        e.payroll_month AS payrollMonth,
        e.paid_at AS paidAt,
        e.created_at AS createdAt,
        e.updated_at AS updatedAt
      FROM staff_incentive_events e
      LEFT JOIN staff_users su
        ON su.id = e.staff_user_id
      WHERE e.id = ?
        AND e.store_id = ?
      LIMIT 1
    `,
    [eventId, storeId]
  );

  return mapEventRow(rows[0]);
}

function normalizeEventPayload(input) {
  const status = normalizeEnum(
    input.status || "PENDING",
    WRITABLE_EVENT_STATUSES,
    "績效狀態"
  );

  return {
    storeId: normalizePositiveId(input.storeId, "門市"),
    staffUserId: normalizePositiveId(
      input.staffUserId,
      "員工"
    ),
    planVersionId: normalizeOptionalPositiveId(
      input.planVersionId,
      "績效辦法版本"
    ),
    incentiveType: normalizeEnum(
      input.incentiveType,
      INCENTIVE_TYPES,
      "績效類型"
    ),
    earningStage: normalizeEnum(
      input.earningStage,
      EARNING_STAGES,
      "績效階段"
    ),
    sourceType: normalizeEnum(
      input.sourceType,
      SOURCE_TYPES,
      "來源類型"
    ),
    sourceId: normalizePositiveId(
      input.sourceId,
      "來源資料"
    ),
    sourceLineId: normalizeNonNegativeInteger(
      input.sourceLineId,
      "來源明細",
      0
    ),
    sourceUnitKey: String(input.sourceUnitKey || "").trim().slice(0, 191),
    productId: normalizeOptionalPositiveId(
      input.productId,
      "商品"
    ),
    productNameSnapshot: input.productNameSnapshot
      ? String(input.productNameSnapshot).trim().slice(0, 200)
      : null,
    quantity: normalizePositiveInteger(
      input.quantity,
      "數量",
      1
    ),
    actualSaleAmount: normalizeMoney(
      input.actualSaleAmount || 0,
      "實際成交金額"
    ),
    rate: normalizeRatio(input.rate || 0, "績效比例"),
    calculatedAmount: normalizeMoney(
      input.calculatedAmount || 0,
      "計算金額"
    ),
    assignedRatio: normalizeRatio(
      input.assignedRatio === undefined
        ? 1
        : input.assignedRatio,
      "分配比例"
    ),
    finalAmount: normalizeMoney(
      input.finalAmount || 0,
      "最終績效金額"
    ),
    status,
    pendingReason: input.pendingReason
      ? String(input.pendingReason).trim().slice(0, 255)
      : null,
    metadataJson: serializeMetadata(input.metadata),
    earnedAt:
      status === "EARNED"
        ? input.earnedAt || new Date()
        : null
  };
}

async function upsertIncentiveEvent(connection, input) {
  const event = normalizeEventPayload(input);

  const [existingRows] = await connection.query(
    `
      SELECT id, status, plan_version_id AS planVersionId
      FROM staff_incentive_events
      WHERE store_id = ?
        AND staff_user_id = ?
        AND incentive_type = ?
        AND earning_stage = ?
        AND source_type = ?
        AND source_id = ?
        AND source_line_id = ?
        AND source_unit_key = ?
      LIMIT 1
      FOR UPDATE
    `,
    [
      event.storeId,
      event.staffUserId,
      event.incentiveType,
      event.earningStage,
      event.sourceType,
      event.sourceId,
      event.sourceLineId,
      event.sourceUnitKey
    ]
  );

  const existing = existingRows[0];

  if (existing && Number(existing.planVersionId || 0) > 0 && Number(event.planVersionId || 0) > 0 && Number(existing.planVersionId) !== Number(event.planVersionId)) {
    return {
      action: "UNCHANGED_PLAN_TRANSITION_REQUIRES_REVIEW",
      event: await readIncentiveEventById(connection, existing.id, event.storeId)
    };
  }

  if (existing && LOCKED_EVENT_STATUSES.has(existing.status)) {
    return {
      action: "UNCHANGED_LOCKED",
      event: await readIncentiveEventById(
        connection,
        existing.id,
        event.storeId
      )
    };
  }

  if (existing) {
    await connection.query(
      `
        UPDATE staff_incentive_events
        SET plan_version_id = ?,
            product_id = ?,
            product_name_snapshot = ?,
            quantity = ?,
            actual_sale_amount = ?,
            rate = ?,
            calculated_amount = ?,
            assigned_ratio = ?,
            final_amount = ?,
            status = ?,
            pending_reason = ?,
            metadata_json = ?,
            earned_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND store_id = ?
      `,
      [
        event.planVersionId,
        event.productId,
        event.productNameSnapshot,
        event.quantity,
        event.actualSaleAmount,
        event.rate,
        event.calculatedAmount,
        event.assignedRatio,
        event.finalAmount,
        event.status,
        event.pendingReason,
        event.metadataJson,
        event.earnedAt,
        existing.id,
        event.storeId
      ]
    );

    return {
      action: "UPDATED",
      event: await readIncentiveEventById(
        connection,
        existing.id,
        event.storeId
      )
    };
  }

  const [result] = await connection.query(
    `
      INSERT INTO staff_incentive_events (
        store_id,
        staff_user_id,
        plan_version_id,
        incentive_type,
        earning_stage,
        source_type,
        source_id,
        source_line_id,
        source_unit_key,
        product_id,
        product_name_snapshot,
        quantity,
        actual_sale_amount,
        rate,
        calculated_amount,
        assigned_ratio,
        final_amount,
        status,
        pending_reason,
        metadata_json,
        earned_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      event.storeId,
      event.staffUserId,
      event.planVersionId,
      event.incentiveType,
      event.earningStage,
      event.sourceType,
      event.sourceId,
      event.sourceLineId,
      event.sourceUnitKey,
      event.productId,
      event.productNameSnapshot,
      event.quantity,
      event.actualSaleAmount,
      event.rate,
      event.calculatedAmount,
      event.assignedRatio,
      event.finalAmount,
      event.status,
      event.pendingReason,
      event.metadataJson,
      event.earnedAt
    ]
  );

  return {
    action: "CREATED",
    event: await readIncentiveEventById(
      connection,
      result.insertId,
      event.storeId
    )
  };
}

function resolveVisibleStaffId({
  requesterRole,
  requesterStaffUserId,
  requestedStaffUserId
}) {
  const requesterId = normalizePositiveId(
    requesterStaffUserId,
    "登入員工"
  );

  if (String(requesterRole || "").toUpperCase() !== "ADMIN") {
    return requesterId;
  }

  if (
    requestedStaffUserId === undefined ||
    requestedStaffUserId === null ||
    requestedStaffUserId === ""
  ) {
    return null;
  }

  return normalizePositiveId(
    requestedStaffUserId,
    "查詢員工"
  );
}

async function listIncentiveEvents(
  connection,
  {
    storeId,
    requesterRole,
    requesterStaffUserId,
    staffUserId,
    statuses,
    limit = 100,
    offset = 0
  }
) {
  const normalizedStoreId = normalizePositiveId(storeId, "門市");

  const visibleStaffId = resolveVisibleStaffId({
    requesterRole,
    requesterStaffUserId,
    requestedStaffUserId: staffUserId
  });

  const where = ["e.store_id = ?"];
  const params = [normalizedStoreId];

  if (visibleStaffId) {
    where.push("e.staff_user_id = ?");
    params.push(visibleStaffId);
  }

  const normalizedStatuses = Array.isArray(statuses)
    ? statuses
        .map((status) => String(status || "").trim().toUpperCase())
        .filter((status) => EVENT_STATUSES.includes(status))
    : [];

  if (normalizedStatuses.length) {
    where.push("e.status IN (?)");
    params.push(normalizedStatuses);
  }

  const normalizedLimit = Math.min(
    Math.max(Math.trunc(Number(limit) || 100), 1),
    500
  );

  const normalizedOffset = Math.max(
    Math.trunc(Number(offset) || 0),
    0
  );

  params.push(normalizedLimit, normalizedOffset);

  const [rows] = await connection.query(
    `
      SELECT
        e.id,
        e.store_id AS storeId,
        e.staff_user_id AS staffUserId,
        COALESCE(
          NULLIF(TRIM(su.display_name), ''),
          su.username
        ) AS staffDisplayName,
        e.plan_version_id AS planVersionId,
        e.payout_id AS payoutId,
        e.incentive_type AS incentiveType,
        e.earning_stage AS earningStage,
        e.source_type AS sourceType,
        e.source_id AS sourceId,
        e.source_line_id AS sourceLineId,
        e.source_unit_key AS sourceUnitKey,
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
        e.metadata_json AS metadataJson,
        e.earned_at AS earnedAt,
        e.approved_by_staff_id AS approvedByStaffId,
        e.approved_at AS approvedAt,
        e.payroll_month AS payrollMonth,
        e.paid_at AS paidAt,
        e.created_at AS createdAt,
        e.updated_at AS updatedAt
      FROM staff_incentive_events e
      LEFT JOIN staff_users su
        ON su.id = e.staff_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        COALESCE(e.earned_at, e.created_at) DESC,
        e.id DESC
      LIMIT ?
      OFFSET ?
    `,
    params
  );

  return rows.map(mapEventRow);
}

module.exports = {
  EVENT_STATUSES,
  WRITABLE_EVENT_STATUSES,
  LOCKED_EVENT_STATUSES,
  getActiveIncentivePlan,
  getSignedIncentiveAgreement,
  readIncentiveEventById,
  upsertIncentiveEvent,
  resolveVisibleStaffId,
  listIncentiveEvents
};
