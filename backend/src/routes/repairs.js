const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const { BASE_FEE, calculateStorageFee } = require("../services/repairService");
const { assertRepairReservationDateAvailable } = require("../services/repairReservationAvailabilityService");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");
const { mapRepairStatusLabel, mapOrderStatusLabel, mapCategoryLabel } = require("../utils/displayLabels");
const { getTableColumns, hasColumn, selectColumn } = require("../utils/schema");
const {
  applyRepairReservationDecision,
  isLineCustomerType,
  logRepairLineNotifyFailure,
  normalizeCustomerType
} = require("../services/repairReservationService");
const { listRepairAttachments } = require("../services/repairAttachmentService");
const {
  buildStaffPageUrl,
  notifyRepairReservationCreated,
  notifyRepairStaffWorkflowEvent
} = require("../services/staffLineNotify");
const {
  applyRepairEstimateCustomerResponse,
  ensureRepairJobOrder,
  createButtonMessage,
  createConfirmTemplate,
  createPostbackAction,
  buildGroupApprovalMessage,
  buildRepairQuoteConfirmationUrl,
  logWorkflowEvent,
  saveRepairEstimateDraft,
  sendRepairQuoteConfirmationIfNeeded
} = require("../services/lineWorkflowService");
const {
  buildRepairConfirmationLink,
  buildRepairConfirmationPdfUrl,
  createOrReuseRepairConfirmationForCompletedRepair,
  getRepairConfirmationBlockReason
} = require("../services/repairConfirmationService");
const { suppressPickupReminder } = require("../services/repairPickupReminderService");
const {
  assertReplacementConfirmationsComplete,
  crossCheckReplacementConfirmation,
  listReplacementConfirmations,
  syncReplacementConfirmationsFromQuote,
  updateReplacementConfirmation
} = require("../services/repairReplacementConfirmationService");
const {
  readExplicitNullableStaffId,
  resolveStaffAssignment
} = require("../services/staffAssignmentService");
const {
  reconcileOrderSaleIncentivesSafely
} = require("../services/staffIncentiveEarningService");


const router = express.Router();
const REPAIR_ALLOWED_ROLES = ["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "INVENTORY", "USER", "EMPLOYEE"];
const REPAIR_CROSS_CHECK_ALLOWED_ROLES = ["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"];
const REPAIR_CROSS_CHECK_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  NEEDS_REVISION: "NEEDS_REVISION"
};
const INITIAL_DIAGNOSIS_REQUIRED_MESSAGE = "請先填寫並儲存初步診斷內容，才能進行報價。";

function getRequestStaffName(req) {
  return String(req.user?.displayName || req.user?.display_name || req.user?.name || req.user?.username || `staff#${req.user?.id || "-"}`).trim();
}

async function notifyRepairStaffWorkflowSafely(input = {}, options = {}) {
  try {
    return await notifyRepairStaffWorkflowEvent(input, options);
  } catch (error) {
    console.warn("[staff-line] repair workflow notification failed", {
      repairId: input.repairId || null,
      event: input.event || input.eventType || null,
      message: error.message
    });
    return { delivered: 0, skipped: false, error: error.message };
  }
}

function createCodedRepairError(message, statusCode, code) {
  return createError(message, statusCode, code);
}

function normalizeCrossCheckStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === REPAIR_CROSS_CHECK_STATUS.APPROVED || normalized === "確認無誤") {
    return REPAIR_CROSS_CHECK_STATUS.APPROVED;
  }
  if (normalized === REPAIR_CROSS_CHECK_STATUS.NEEDS_REVISION || normalized === "需要修正") {
    return REPAIR_CROSS_CHECK_STATUS.NEEDS_REVISION;
  }
  throw createCodedRepairError("請選擇交叉確認結果", 400, "INVALID_CROSS_CHECK_STATUS");
}

function hasInitialDiagnosis(row = {}) {
  return Boolean(String(row.inspectionNotes || row.inspection_notes || "").trim());
}

function assertCrossCheckColumns(repairColumns) {
  const requiredColumns = [
    "cross_check_status",
    "cross_checked_by_staff_id",
    "cross_checked_at",
    "cross_check_note"
  ];
  const missing = requiredColumns.filter((column) => !hasColumn(repairColumns, column));
  if (missing.length) {
    throw createCodedRepairError("交叉確認欄位尚未建立，請先執行 staging migration。", 503, "REPAIR_CROSS_CHECK_SCHEMA_REQUIRED");
  }
}

async function getCrossCheckStaff(staffUserId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, username, display_name AS displayName, role, is_active AS isActive, store_id AS storeId
      FROM staff_users
      WHERE id = ?
        AND store_id = ?
        AND is_active = 1
        AND role IN (?)
      LIMIT 1
    `,
    [staffUserId, storeId, REPAIR_CROSS_CHECK_ALLOWED_ROLES]
  );
  if (!rows[0]) {
    throw createCodedRepairError("目前帳號沒有交叉確認權限", 403, "CROSS_CHECK_ROLE_FORBIDDEN");
  }
  return {
    id: rows[0].id,
    name: String(rows[0].displayName || rows[0].username || rows[0].id).trim(),
    role: rows[0].role
  };
}

function getRepairAssignmentActorName(req) {
  return String(
    req.user?.displayName ||
    req.user?.display_name ||
    req.user?.name ||
    req.user?.username ||
    `staff#${req.user?.id || "-"}`
  ).trim();
}

function assertRepairStaffColumns(repairColumns) {
  if (
    !hasColumn(repairColumns, "repair_staff_id") ||
    !hasColumn(repairColumns, "repair_staff_name")
  ) {
    throw createError(
      "維修人員欄位尚未建立，請先執行 staging migration。",
      503
    );
  }
}

async function resolveRepairStaffAssignment(
  connection,
  storeId,
  rawStaffId,
  repairColumns
) {
  const assignment = await resolveStaffAssignment(
    connection,
    storeId,
    rawStaffId,
    "維修人員"
  );

  if (assignment === undefined) {
    return undefined;
  }

  assertRepairStaffColumns(repairColumns);
  return assignment;
}

function buildRepairStaffSelects(repairColumns) {
  if (!hasColumn(repairColumns, "repair_staff_id")) {
    return [
      "NULL AS repairStaffId",
      "NULL AS repairStaffName"
    ].join(",\n          ");
  }

  const snapshotSql = hasColumn(
    repairColumns,
    "repair_staff_name"
  )
    ? "NULLIF(TRIM(ro.repair_staff_name), '')"
    : "NULL";

  return [
    "ro.repair_staff_id AS repairStaffId",
    `COALESCE(
      ${snapshotSql},
      repair_staff.display_name,
      repair_staff.username
    ) AS repairStaffName`
  ].join(",\n          ");
}

function buildRepairStaffJoin(repairColumns) {
  if (!hasColumn(repairColumns, "repair_staff_id")) {
    return "";
  }

  return [
    "LEFT JOIN staff_users repair_staff",
    "ON repair_staff.id = ro.repair_staff_id"
  ].join(" ");
}

router.use(authenticate);
router.use(requireStoreScope());
router.use(authorize(REPAIR_ALLOWED_ROLES));
router.use(requireStoreFeature("repairs_enabled"));

function mapReservationStatusLabel(status) {
  const labels = {
    pending_approval: "待群組確認",
    approved: "已確認",
    rejected: "已拒絕"
  };

  return labels[status] || status || "-";
}

function normalizeRepairLifecycleStatus(row) {
  if (!row || row.repairSource === "ORDER") {
    return row?.status || null;
  }

  if (row.reservationStatus === "approved" && row.status === "checking") {
    return "reserved";
  }
  if (row.reservationStatus === "pending_approval" && row.status === "reserved") {
    return "checking";
  }
  if (row.reservationStatus === "rejected" && row.status !== "canceled") {
    return "canceled";
  }

  return row.status;
}

function isRepairQuoteAccepted(row = {}) {
  const customerResponse = String(row.customerEstimateResponse || row.customer_estimate_response || "").trim();
  const quoteStatus = String(row.quoteStatus || row.quote_status || "").trim();
  const status = String(row.status || "").trim();
  return customerResponse === "approved" || quoteStatus === "approved" || quoteStatus === "accepted" || ["estimate_approved", "customer_confirmed", "repair_order_created", "repairing", "completed_waiting_pickup", "picked_up"].includes(status);
}

function canStartRepairAction(row = {}) {
  if (!isRepairQuoteAccepted(row)) return false;
  const status = String(row.status || "").trim();
  return !["repairing", "completed", "completed_waiting_pickup", "picked_up", "canceled", "estimate_rejected"].includes(status)
    && !row.completedAt
    && !row.completed_at
    && !row.pickedUpAt
    && !row.picked_up_at;
}

function getRepairSourceLabel(source, customerType) {
  if (source === "LINE" && isLineCustomerType(customerType)) {
    return "LINE預約";
  }
  return "現場客戶";
}

function normalizeRepairProductImageUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/") || value.startsWith("/files/")) {
    return value;
  }
  if (value.startsWith("files/")) {
    return `/${value}`;
  }
  if (value.startsWith("storage/products/")) {
    return `/files/products/${value.slice("storage/products/".length)}`;
  }
  if (value.startsWith("products/")) {
    return `/files/${value}`;
  }
  return value;
}

function mapRepairProductRow(row) {
  return {
    ...row,
    imageUrl: normalizeRepairProductImageUrl(row.imageUrl),
    categoryLabel: mapCategoryLabel(row.category)
  };
}

function isFinalizedRepairRow(row) {
  const status = String(row?.status || "").trim();
  return (
    ["picked_up", "completed", "completed_waiting_pickup"].includes(status) ||
    Boolean(row?.completedAt || row?.completed_at) ||
    Boolean(row?.pickedUpAt || row?.picked_up_at)
  );
}

function assertRepairEditable(row) {
  if (isFinalizedRepairRow(row)) {
    throw createError("已完成或已取車的維修單無法再次操作", 400);
  }
}

function normalizeMileageKm(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  if (!/^\d+$/.test(String(value).trim())) {
    throw createError("目前行駛里程請填寫 0 以上整數", 400);
  }
  const mileage = Number(String(value).trim());
  if (!Number.isSafeInteger(mileage) || mileage < 0) {
    throw createError("目前行駛里程請填寫 0 以上整數", 400);
  }
  return mileage;
}

async function assertRepairBelongsToStore(repairId, storeId, connection = pool) {
  if (!storeId) {
    throw createError("缺少門市範圍", 403);
  }

  const [rows] = await connection.query(
    `
      SELECT ro.id
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?
      LEFT JOIN orders linked_o ON linked_o.id = ro.order_id AND linked_o.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
        AND ro.deleted_at IS NULL
        AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
      LIMIT 1
    `,
    [storeId, repairId, storeId]
  );

  if (!rows[0]) {
    throw createError("找不到維修工單", 404);
  }
}

router.get("/",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    const customerColumns = await getTableColumns(pool, "customers");
    // REPAIRS_APPROVE_STORE_SCOPE_V1
    const orderColumns = await getTableColumns(pool, "orders");
    const orderItemColumns = await getTableColumns(pool, "order_items");
    const canClassifyOrderRepairs = hasColumn(orderItemColumns, "product_category_snapshot");
    const repairListSql = `
        SELECT
          ${selectColumn(repairColumns, "ro", "id", "id")},
          'REPAIR_ORDER' AS repairSource,
          ${selectColumn(repairColumns, "ro", "customer_id", "customerId")},
          ${selectColumn(customerColumns, "c", "name", "customerName")},
          ${selectColumn(customerColumns, "c", "phone", "customerPhone")},
          ${selectColumn(customerColumns, "c", "line_user_id", "lineUserId")},
          COALESCE(${selectColumn(repairColumns, "ro", "customer_type", "repairCustomerType", "NULL").replace(" AS `repairCustomerType`", "")}, ${selectColumn(customerColumns, "c", "customer_type", "customerCustomerType", "'LINE'").replace(" AS `customerCustomerType`", "")}) AS customerType,
          ${selectColumn(repairColumns, "ro", "source", "source", "'WEB'")},
          ${selectColumn(repairColumns, "ro", "bike_model", "bikeModel")},
          ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
          ${selectColumn(repairColumns, "ro", "issue_description", "issueDescription")},
          ${selectColumn(repairColumns, "ro", "reservation_date", "reservationDate")},
          ${selectColumn(repairColumns, "ro", "reservation_day", "reservationDay")},
          ${selectColumn(repairColumns, "ro", "reservation_time", "reservationTime")},
          ${selectColumn(repairColumns, "ro", "reservation_status", "reservationStatus", "'approved'")},
          ${selectColumn(repairColumns, "ro", "group_confirmed", "groupConfirmed", "0")},
          ${selectColumn(repairColumns, "ro", "group_confirmed_at", "groupConfirmedAt")},
          ${selectColumn(repairColumns, "ro", "group_confirmed_by", "groupConfirmedBy")},
          ${buildRepairStaffSelects(repairColumns)},
          ${selectColumn(repairColumns, "ro", "inspection_notes", "inspectionNotes")},
          ${selectColumn(repairColumns, "ro", "cross_check_status", "crossCheckStatus", "'PENDING'")},
          ${selectColumn(repairColumns, "ro", "cross_checked_by_staff_id", "crossCheckedByStaffId", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_checked_at", "crossCheckedAt", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_check_note", "crossCheckNote", "NULL")},
          ${selectColumn(repairColumns, "ro", "customer_estimate_response", "customerEstimateResponse", "'pending'")},
          ${selectColumn(repairColumns, "ro", "customer_estimate_responded_at", "customerEstimateRespondedAt")},
          ${selectColumn(repairColumns, "ro", "survey_id", "surveyId")},
          ${selectColumn(repairColumns, "ro", "order_id", "orderId", "NULL")},
          ${selectColumn(repairColumns, "ro", "status", "status", "'reserved'")},
          ${selectColumn(repairColumns, "ro", "estimate_amount", "estimateAmount", "0")},
          ${selectColumn(repairColumns, "ro", "estimate_details", "estimateDetails")},
          ${selectColumn(repairColumns, "ro", "base_fee", "baseFee", "0")},
          ${selectColumn(repairColumns, "ro", "storage_fee", "storageFee", "0")},
          ${selectColumn(repairColumns, "ro", "completed_at", "completedAt")},
          ${selectColumn(repairColumns, "ro", "picked_up_at", "pickedUpAt")},
          ${selectColumn(repairColumns, "ro", "order_id", "orderIdForConfirmation", "NULL")},
          linked_o.final_payment_status AS repairFinalPaymentStatus,
          linked_o.unpaid_balance AS repairUnpaidBalance,
          rc.id AS repairConfirmationId,
          rc.token AS repairConfirmationToken,
          rc.status AS repairConfirmationStatus,
          rc.sent_at AS repairConfirmationSentAt,
          rc.submitted_at AS repairConfirmationSubmittedAt,
          rc.pdf_path AS repairConfirmationPdfPath,
          qcs.created_at AS quoteConfirmationSentAt,
          qcf.created_at AS quoteConfirmationFailedAt,
          COALESCE(ra.attachment_count, 0) AS attachmentCount,
          ${selectColumn(repairColumns, "ro", "created_at", "createdAt")}
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?
        LEFT JOIN orders linked_o ON linked_o.id = ro.order_id AND linked_o.store_id = ro.store_id
        LEFT JOIN repair_confirmations rc ON rc.repair_order_id = ro.id AND rc.store_id = ro.store_id
        LEFT JOIN (
          SELECT repair_order_id, MAX(created_at) AS created_at
          FROM repair_logs
          WHERE action = 'quote_confirmation_sent'
          GROUP BY repair_order_id
        ) qcs ON qcs.repair_order_id = ro.id
        LEFT JOIN (
          SELECT repair_order_id, MAX(created_at) AS created_at
          FROM repair_logs
          WHERE action = 'quote_confirmation_send_failed'
          GROUP BY repair_order_id
        ) qcf ON qcf.repair_order_id = ro.id
        ${buildRepairStaffJoin(repairColumns)}
        LEFT JOIN (
          SELECT store_id, repair_order_id, COUNT(*) AS attachment_count
          FROM repair_order_attachments
          GROUP BY store_id, repair_order_id
        ) ra ON ra.repair_order_id = ro.id AND ra.store_id = ro.store_id
        WHERE ro.deleted_at IS NULL
          AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
        ORDER BY ro.id DESC
      `;
    const repairListParams = [storeId];
    const [repairRows] = await pool.query(repairListSql, repairListParams);

    let repairOrderRows = [];
    let orderRepairListSql = null;
    const orderRepairListParams = [];
    if (canClassifyOrderRepairs) {
      orderRepairListSql = `
          SELECT
            ${selectColumn(orderColumns, "o", "id", "id")},
            'ORDER' AS repairSource,
            ${selectColumn(orderColumns, "o", "customer_id", "customerId")},
            COALESCE(${hasColumn(customerColumns, "name") ? "c.name" : "NULL"}, ${hasColumn(orderColumns, "customer_name") ? "o.customer_name" : "NULL"}) AS customerName,
            COALESCE(${hasColumn(customerColumns, "phone") ? "c.phone" : "NULL"}, ${hasColumn(orderColumns, "customer_phone") ? "o.customer_phone" : "NULL"}) AS customerPhone,
            ${selectColumn(customerColumns, "c", "line_user_id", "lineUserId")},
            COALESCE(${hasColumn(orderColumns, "customer_type") ? "o.customer_type" : "NULL"}, ${hasColumn(customerColumns, "customer_type") ? "c.customer_type" : "'LINE'"}) AS customerType,
            'POS' AS source,
            GROUP_CONCAT(DISTINCT ${hasColumn(orderItemColumns, "product_name_snapshot") ? "oi.product_name_snapshot" : "oi.id"} ORDER BY oi.id SEPARATOR ' / ') AS bikeModel,
            NULL AS mileageKm,
            ${selectColumn(orderColumns, "o", "notes", "issueDescription")},
            ${selectColumn(orderColumns, "o", "business_date", "reservationDate")},
            NULL AS reservationDay,
            NULL AS reservationTime,
            'approved' AS reservationStatus,
            1 AS groupConfirmed,
            NULL AS groupConfirmedAt,
            NULL AS groupConfirmedBy,
            NULL AS repairStaffId,
            NULL AS repairStaffName,
            NULL AS customerEstimateResponse,
            NULL AS customerEstimateRespondedAt,
            NULL AS surveyId,
            ${selectColumn(orderColumns, "o", "status", "status", "'COMPLETED'")},
            NULL AS estimateAmount,
            NULL AS estimateDetails,
            NULL AS baseFee,
            0 AS storageFee,
            NULL AS completedAt,
            NULL AS pickedUpAt,
            ${selectColumn(orderColumns, "o", "created_at", "createdAt")}
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id AND c.store_id = ?
          INNER JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = ?
          WHERE oi.product_category_snapshot IN ('RP', 'REPAIR')
            AND o.store_id = ?
            AND o.deleted_at IS NULL
          GROUP BY o.id
          ORDER BY o.id DESC
        `;
      orderRepairListParams.push(storeId, storeId, storeId);
      [repairOrderRows] = await pool.query(orderRepairListSql, orderRepairListParams);
    }

    const combinedRows = [...repairRows, ...repairOrderRows]
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((row) => {
        const normalizedStatus = normalizeRepairLifecycleStatus(row);
        const repairConfirmationBlockReason = getRepairConfirmationBlockReason({
          ...row,
          status: normalizedStatus,
          orderId: row.orderIdForConfirmation || row.orderId || null,
          finalPaymentStatus: row.repairFinalPaymentStatus,
          unpaidBalance: row.repairUnpaidBalance,
          completedAt: row.completedAt,
          pickedUpAt: row.pickedUpAt
        });
        const quoteAccepted = isRepairQuoteAccepted({ ...row, status: normalizedStatus, });
        const canStartRepair = canStartRepairAction({ ...row, status: normalizedStatus, });
        return {
          ...row,
          rawStatus: row.status,
          status: normalizedStatus,
          quoteAccepted,
          canStartRepair,
          repairConfirmationLink: row.repairConfirmationToken ? buildRepairConfirmationLink(row.repairConfirmationToken) : null,
          repairConfirmationPdfUrl: row.repairConfirmationToken && row.repairConfirmationPdfPath ? buildRepairConfirmationPdfUrl(row.repairConfirmationToken) : null,
          canSendRepairConfirmation: !repairConfirmationBlockReason,
          repairConfirmationBlockReason,
          quoteConfirmationLink: row.repairSource === "REPAIR_ORDER" ? buildRepairQuoteConfirmationUrl(row.id) : null,
          quoteConfirmationStatus: row.quoteConfirmationSentAt ? "SENT" : row.quoteConfirmationFailedAt ? "FAILED" : "NOT_SENT",
          quoteConfirmationSentAt: row.quoteConfirmationSentAt || null,
          quoteConfirmationFailedAt: row.quoteConfirmationFailedAt || null,
          quoteConfirmationWarning: !row.lineUserId ? "顧客未綁定 LINE，請複製連結提供給顧客確認報價" : "",
          repairSourceLabel: row.repairSource === "ORDER" ? "訂單維修" : "維修工單",
          sourceLabel: getRepairSourceLabel(row.source, row.customerType),
          reservationStatusLabel: mapReservationStatusLabel(row.reservationStatus),
          customerEstimateResponseLabel:
            row.customerEstimateResponse === "approved"
              ? "客戶已同意報價"
              : row.customerEstimateResponse === "rejected"
                ? "客戶已拒絕報價"
                : row.customerEstimateResponse === "pending"
                  ? "待客戶回覆報價"
                  : "尚未送出報價",
          statusLabel:
            row.repairSource === "ORDER" ? mapOrderStatusLabel(normalizedStatus) : mapRepairStatusLabel(normalizedStatus),
          storageFee:
            row.repairSource === "ORDER"
              ? 0
              : calculateStorageFee(row.completedAt, row.pickedUpAt)
        };
      });

    const debugPayload = {
      userId: req.user?.id || null,
      userRole: req.user?.role || null,
      username: req.user?.username || null,
      authHeaderPresent: Boolean(req.headers.authorization),
      routeFile: "backend/src/routes/repairs.js",
      sql: {
        repairListSql,
        orderRepairListSql
      },
      params: {
        repairListParams,
        orderRepairListParams
      },
      count: combinedRows.length
    };

    console.log("[repairs:list]", debugPayload);

    res.setHeader("X-Repairs-Debug-Role", String(debugPayload.userRole || ""));
    res.setHeader("X-Repairs-Debug-Account", String(debugPayload.username || ""));
    res.setHeader("X-Repairs-Debug-Route", debugPayload.routeFile);
    res.setHeader("X-Repairs-Debug-Params", JSON.stringify(debugPayload.params));
    res.setHeader("X-Repairs-Debug-Count", String(debugPayload.count));

    return res.json(combinedRows);
  } catch (error) {
    return next(error);
  }
});

router.get("/products",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
    const productColumns = await getTableColumns(pool, "products");
    let sql = `
      SELECT
        ${selectColumn(productColumns, "products", "id", "id")},
        ${selectColumn(productColumns, "products", "sku", "sku")},
        ${selectColumn(productColumns, "products", "name", "name")},
        ${selectColumn(productColumns, "products", "category", "category", "'OTHER'")},
        ${selectColumn(productColumns, "products", "description", "description")},
        ${selectColumn(productColumns, "products", "image_url", "imageUrl")},
        ${selectColumn(productColumns, "products", "price", "price", "0")},
        ${selectColumn(productColumns, "products", "stock", "stock", "0")},
        ${selectColumn(productColumns, "products", "reorder_level", "reorderLevel", "0")},
        ${selectColumn(productColumns, "products", "is_active", "isActive", "1")},
        ${selectColumn(productColumns, "products", "created_at", "createdAt")},
        ${selectColumn(productColumns, "products", "updated_at", "updatedAt")}
      FROM products
      WHERE products.store_id = ?
    `;
    const params = [storeId];
    sql += " AND products.is_active = 1";

    if (search) {
      const searchFields = ["sku", "name"].filter((column) => hasColumn(productColumns, column));
      if (searchFields.length) {
        sql += ` AND (${searchFields.map((column) => `${column} LIKE ?`).join(" OR ")}) `;
        params.push(...searchFields.map(() => search));
      }
    }

    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows.map(mapRepairProductRow));
  } catch (error) {
    return next(error);
  }
});


router.get("/trash/list", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(`
      SELECT
        ro.id,
        c.name AS customerName,
        c.phone AS customerPhone,
        ro.bike_model AS bikeModel,
        ro.issue_description AS issueDescription,
        ro.inspection_notes AS inspectionNotes,
        ro.status,
        ro.created_at AS createdAt,
        ro.deleted_at AS deletedAt,
        s.display_name AS deletedByName
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?
      LEFT JOIN staff_users s ON s.id = ro.deleted_by
      WHERE ro.deleted_at IS NOT NULL
      ORDER BY ro.deleted_at DESC, ro.id DESC
      LIMIT 200
    `, [storeId]);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});


router.patch("/:id/inspection", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    const { inspectionFee = 0, inspectionNotes = "" } = req.body || {};
    const notes = String(inspectionNotes || "").trim();

    if (!notes) {
      throw createCodedRepairError(INITIAL_DIAGNOSIS_REQUIRED_MESSAGE, 400, "INITIAL_DIAGNOSIS_REQUIRED");
    }

    await assertRepairBelongsToStore(req.params.id, storeId);
    const [stateRows] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt, inspection_notes AS inspectionNotes
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );
    if (!stateRows[0]) {
      throw createError("找不到維修工單", 404);
    }
    assertRepairEditable(stateRows[0]);

    const updates = ["inspection_fee = ?", "inspection_notes = ?", "updated_at = NOW()"];
    const params = [Number(inspectionFee || 0), notes];
    const diagnosisChanged = String(stateRows[0].inspectionNotes || "").trim() !== notes;
    if (hasColumn(repairColumns, "diagnosis_updated_by_staff_id")) {
      updates.push("diagnosis_updated_by_staff_id = ?");
      params.push(req.user?.id || null);
    }
    if (hasColumn(repairColumns, "diagnosis_updated_at")) {
      updates.push("diagnosis_updated_at = NOW()");
    }
    if (diagnosisChanged && hasColumn(repairColumns, "cross_check_status")) {
      updates.push("cross_check_status = 'PENDING'");
    }
    if (diagnosisChanged && hasColumn(repairColumns, "cross_checked_by_staff_id")) {
      updates.push("cross_checked_by_staff_id = NULL");
    }
    if (diagnosisChanged && hasColumn(repairColumns, "cross_checked_at")) {
      updates.push("cross_checked_at = NULL");
    }
    if (diagnosisChanged && hasColumn(repairColumns, "cross_check_note")) {
      updates.push("cross_check_note = NULL");
    }
    params.push(req.params.id, storeId);

    await pool.query(
      `
        UPDATE repair_orders
        SET ${updates.join(", ")}
        WHERE id = ?
          AND store_id = ?
      `,
      params
    );

    const [repairRows] = await pool.query(
      `SELECT order_id AS orderId FROM repair_orders WHERE id = ? AND store_id = ? LIMIT 1`,
      [req.params.id, storeId]
    );
    if (repairRows[0]?.orderId) {
      await reconcileOrderSaleIncentivesSafely({
        connection: pool,
        storeId,
        orderId: repairRows[0].orderId,
        triggerSource: "REPAIR_INSPECTION_UPDATED"
      });
    }

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'initial_diagnosis_saved', ?)
      `,
      [req.params.id, diagnosisChanged ? "已儲存初步診斷，交叉確認重設為待確認" : "已儲存初步診斷"]
    );

    await notifyRepairStaffWorkflowSafely({
      event: "diagnosis_saved",
      repairId: req.params.id,
      storeId,
      staffName: getRequestStaffName(req),
      diagnosisSummary: notes,
      diagnosisUpdatedAt: new Date().toISOString(),
      source: "web_admin"
    });

    return res.json({ ok: true, inspectionNotes: notes, crossCheckStatus: diagnosisChanged ? "PENDING" : undefined });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/mileage", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    if (!hasColumn(repairColumns, "mileage_km")) {
      throw createError("目前行駛里程欄位尚未建立，請先執行 staging migration。", 503);
    }

    await assertRepairBelongsToStore(req.params.id, storeId);
    const mileageKm = normalizeMileageKm(req.body?.mileageKm ?? req.body?.mileage_km);
    await pool.query(
      `
        UPDATE repair_orders
        SET mileage_km = ?,
            updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
      `,
      [mileageKm, req.params.id, storeId]
    );

    return res.json({
      ok: true,
      mileage_km: mileageKm,
      mileageKm
    });
  } catch (error) {
    return next(error);
  }
});


router.patch("/:id/repair-staff", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairId = Number(req.params.id);

    if (!Number.isSafeInteger(repairId) || repairId <= 0) {
      throw createError("找不到維修工單", 404);
    }

    const repairColumns = await getTableColumns(pool, "repair_orders");
    const assignment = await resolveRepairStaffAssignment(
      pool,
      storeId,
      readExplicitNullableStaffId(req.body, "repairStaffId"),
      repairColumns
    );
    if (assignment === undefined) {
      throw createError("請選擇維修人員", 400);
    }

    await assertRepairBelongsToStore(repairId, storeId);

    const [currentRows] = await pool.query(
      `
        SELECT
          id,
          repair_staff_id AS repairStaffId,
          repair_staff_name AS repairStaffName
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [repairId, storeId]
    );

    if (!currentRows[0]) {
      throw createError("找不到維修工單", 404);
    }

    const previousAssignment = {
      id: currentRows[0].repairStaffId
        ? Number(currentRows[0].repairStaffId)
        : null,
      name: currentRows[0].repairStaffName || null
    };

    const [result] = await pool.query(
      `
        UPDATE repair_orders
        SET repair_staff_id = ?,
            repair_staff_name = ?,
            updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
          AND deleted_at IS NULL
      `,
      [
        assignment.id,
        assignment.name,
        repairId,
        storeId
      ]
    );

    if (!result.affectedRows) {
      throw createError("找不到維修工單", 404);
    }

    await pool.query(
      `
        INSERT INTO repair_logs (
          repair_order_id,
          action,
          note
        )
        VALUES (?, 'repair_staff_assigned', ?)
      `,
      [
        repairId,
        [
          `維修人員：${previousAssignment.name || "尚未指定"}`,
          `→ ${assignment.name || "尚未指定"}`,
          `；操作人員：${getRepairAssignmentActorName(req)}`
        ].join(" ")
      ]
    );

    await logWorkflowEvent(
      "repair_staff_changed",
      "REPAIR_ORDER",
      repairId,
      {
        repairId,
        previousRepairStaff: previousAssignment,
        newRepairStaff: {
          id: assignment.id,
          name: assignment.name || null
        },
        changedBy: {
          id: req.user?.id || null,
          name: getRepairAssignmentActorName(req)
        },
        changedAt: new Date().toISOString()
      },
      req.user?.id || null
    );

    const [linkedRows] = await pool.query(
      `SELECT order_id AS orderId FROM repair_orders WHERE id = ? AND store_id = ? LIMIT 1`,
      [repairId, storeId]
    );
    if (linkedRows[0]?.orderId) {
      await reconcileOrderSaleIncentivesSafely({
        connection: pool,
        storeId,
        orderId: linkedRows[0].orderId,
        triggerSource: "REPAIR_STAFF_ASSIGNED"
      });
    }

    return res.json({
      ok: true,
      repairStaffId: assignment.id,
      repairStaffName: assignment.name || "尚未指定"
    });
  } catch (error) {
    return next(error);
  }
});


router.delete("/:id", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const adminPin = req.headers["x-admin-pin"] || req.body?.adminPin;
    if (String(adminPin || "") !== "1144") {
      return res.status(403).json({ message: "管理員 PIN 錯誤" });
    }

    const [result] = await pool.query(
      "UPDATE repair_orders SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)",
      [req.user?.id || null, req.params.id, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到維修單或已刪除" });
    }
    return res.json({ message: "維修單已移至已刪除資料" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/restore", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [result] = await pool.query(
      "UPDATE repair_orders SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)",
      [req.params.id, storeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到已刪除維修單" });
    }
    return res.json({ message: "維修單已復原" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/permanent", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      "SELECT ro.id FROM repair_orders ro INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ? WHERE ro.id = ? AND ro.deleted_at IS NOT NULL LIMIT 1",
      [storeId, req.params.id]
    );
    if (!rows[0]) {
      throw createError("找不到已刪除維修單", 404);
    }

    await pool.query("DELETE FROM repair_logs WHERE repair_order_id = ?", [req.params.id]);
    await pool.query("DELETE FROM surveys WHERE repair_order_id = ?", [req.params.id]);
    await pool.query("DELETE FROM repair_orders WHERE id = ? AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)", [req.params.id, storeId]);

    return res.json({ message: "維修單已永久刪除" });
  } catch (error) {
    return next(error);
  }
});


router.get("/:id",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    const [rows] = await pool.query(
      `
        SELECT
          ro.*,
          ro.inspection_notes AS inspectionNotes,
          ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
          ${buildRepairStaffSelects(repairColumns)},
          ${selectColumn(repairColumns, "ro", "cross_check_status", "crossCheckStatus", "'PENDING'")},
          ${selectColumn(repairColumns, "ro", "cross_checked_by_staff_id", "crossCheckedByStaffId", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_checked_at", "crossCheckedAt", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_check_note", "crossCheckNote", "NULL")},
          ${selectColumn(repairColumns, "ro", "diagnosis_updated_by_staff_id", "diagnosisUpdatedByStaffId", "NULL")},
          ${selectColumn(repairColumns, "ro", "diagnosis_updated_at", "diagnosisUpdatedAt", "NULL")},
          cross_staff.display_name AS crossCheckedByStaffName,
          diagnosis_staff.display_name AS diagnosisUpdatedByStaffName,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?
        LEFT JOIN orders linked_o ON linked_o.id = ro.order_id AND linked_o.store_id = ro.store_id
        ${buildRepairStaffJoin(repairColumns)}
        LEFT JOIN staff_users cross_staff ON cross_staff.id = ro.cross_checked_by_staff_id
        LEFT JOIN staff_users diagnosis_staff ON diagnosis_staff.id = ro.diagnosis_updated_by_staff_id
        WHERE ro.id = ?
          AND ro.deleted_at IS NULL
          AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
      `,
      [storeId, req.params.id]
    );

    if (!rows[0]) {
      throw createError("找不到維修工單", 404);
    }

    const [logs] = await pool.query(
      `
        SELECT id, action, note, created_at AS createdAt
        FROM repair_logs
        WHERE repair_order_id = ?
        ORDER BY id DESC
      `,
      [req.params.id]
    );

    const [surveys] = await pool.query(
      `
        SELECT id, rating, feedback, submitted_at AS submittedAt
        FROM surveys
        WHERE repair_order_id = ?
        ORDER BY id DESC
      `,
      [req.params.id]
    );

    const attachments = await listRepairAttachments(req.params.id, storeId);
    const normalizedStatus = normalizeRepairLifecycleStatus({
      repairSource: "REPAIR_ORDER",
      reservationStatus: rows[0].reservation_status,
      status: rows[0].status
    });
    const latestQuoteSentLog = logs.find((log) => log.action === "quote_confirmation_sent");
    const latestQuoteFailedLog = logs.find((log) => log.action === "quote_confirmation_send_failed");
    const quoteConfirmationStatus = latestQuoteSentLog ? "SENT" : latestQuoteFailedLog ? "FAILED" : "NOT_SENT";

    const quoteAccepted = isRepairQuoteAccepted({ ...rows[0], status: normalizedStatus, });
    const canStartRepair = canStartRepairAction({ ...rows[0], status: normalizedStatus, });

    return res.json({
      ...rows[0],
      raw_status: rows[0].status,
      status: normalizedStatus,
      quoteAccepted,
      canStartRepair,
      quoteConfirmationLink: buildRepairQuoteConfirmationUrl(rows[0].id),
      quoteConfirmationStatus,
      quoteConfirmationSentAt: latestQuoteSentLog?.createdAt || null,
      quoteConfirmationFailedAt: latestQuoteFailedLog?.createdAt || null,
      quoteConfirmationWarning: !rows[0].lineUserId ? "顧客未綁定 LINE，請複製連結提供給顧客確認報價" : "",
      reservationStatusLabel: mapReservationStatusLabel(rows[0].reservation_status),
      repairStatusLabel: mapRepairStatusLabel(normalizedStatus),
      storageFee: calculateStorageFee(rows[0].completed_at, rows[0].picked_up_at),
      customerEstimateResponseLabel:
        rows[0].customer_estimate_response === "approved"
          ? "客戶已同意報價"
          : rows[0].customer_estimate_response === "rejected"
            ? "客戶已拒絕報價"
            : rows[0].customer_estimate_response === "pending"
              ? "客戶尚未回覆"
              : "尚未送出報價",
      logs,
      surveys,
      attachments,
      attachmentCount: attachments.length
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const {
      customerId,
      bikeModel,
      issueDescription,
      reservationDate,
      reservationTime,
      fromLine,
      customerType,
      repairStaffId
    } = req.body;
    if (!customerId || !bikeModel || !issueDescription || !reservationDate) {
      throw createError("customerId、bikeModel、issueDescription 與 reservationDate 為必填欄位", 400);
    }

    const [customerRows] = await pool.query(
      `
        SELECT name, phone, line_user_id AS lineUserId, customer_type AS customerType
        FROM customers
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [customerId, storeId]
    );
    const customer = customerRows[0] || {};
    const normalizedCustomerType = normalizeCustomerType(
      customerType || customer.customerType || (customer.lineUserId ? "LINE" : customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")
    );
    const reservationAvailability = await assertRepairReservationDateAvailable(storeId, reservationDate);
    const reservationDay = reservationAvailability.weekdayName;
    const repairColumns = await getTableColumns(
      pool,
      "repair_orders"
    );
    const repairStaffAssignment = await resolveRepairStaffAssignment(
      pool,
      storeId,
      repairStaffId,
      repairColumns
    );

    const insertColumns = [
      "store_id",
      "customer_id",
      "customer_type",
      "source",
      "bike_model",
      "issue_description",
      "reservation_date",
      "reservation_day",
      "reservation_time",
      "base_fee",
      "reservation_status",
      "status"
    ];

    const insertValues = [
      storeId,
      customerId,
      normalizedCustomerType,
      fromLine ? "LINE" : "WEB",
      bikeModel,
      issueDescription,
      reservationDate,
      reservationDay,
      reservationTime || null,
      BASE_FEE,
      fromLine ? "pending_approval" : "approved",
      fromLine ? "checking" : "reserved"
    ];

    if (repairStaffAssignment !== undefined) {
      insertColumns.push(
        "repair_staff_id",
        "repair_staff_name"
      );
      insertValues.push(
        repairStaffAssignment.id,
        repairStaffAssignment.name
      );
    }

    const [result] = await pool.query(
      `
        INSERT INTO repair_orders (
          ${insertColumns.join(", ")}
        )
        VALUES (
          ${insertColumns.map(() => "?").join(", ")}
        )
      `,
      insertValues
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'reserved', ?)
      `,
      [
        result.insertId,
        fromLine
          ? "已建立 LINE 維修預約，待員工確認"
          : !isLineCustomerType(normalizedCustomerType)
            ? "已建立一般客戶維修預約"
            : "已建立維修預約"
      ]
    );

    let notificationResult = { delivered: 0, targetGroupIds: [], skipped: true, reason: "not_attempted" };
    try {
      notificationResult = await notifyRepairReservationCreated({
        repairId: result.insertId,
        reservationDate,
        reservationTime,
        bikeModel,
        issueDescription,
        storeId,
        sourceLabel: fromLine ? "LINE 維修預約" : "後台維修預約",
        adminUrl: `${config.frontendBaseUrl}/repairs/${result.insertId}`
      });
    } catch (staffLineError) {
      notificationResult = { delivered: 0, targetGroupIds: [], skipped: false, error: staffLineError.message };
      console.warn("[staff-line] repair reservation notification failed after creation", {
        repairId: result.insertId,
        message: staffLineError.message
      });
    }

    await logWorkflowEvent(
      "repair_reservation_group_notified",
      "REPAIR_ORDER",
      result.insertId,
      {
        delivered: notificationResult.delivered || 0,
        targetGroupIds: notificationResult.targetGroupIds || [],
        fromLine: Boolean(fromLine),
        customerType: normalizedCustomerType,
        skipped: Boolean(notificationResult.skipped),
        reason: notificationResult.reason || null
      },
      req.user.id
    );

    if (!notificationResult.skipped && Number(notificationResult.delivered || 0) === 0) {
      console.error(
        `[LINE][repair_reservation] no active staff group delivered for repair #${result.insertId}`
      );
    }

    return res.status(201).json({
      id: result.insertId,
      customerType: normalizedCustomerType,
      reservationDay,
      baseFee: BASE_FEE
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reservation/respond",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const approved = Boolean(req.body.approved);
    const [stateRows] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
        LIMIT 1
      `,
      [req.params.id]
    );
    if (!stateRows[0]) {
      throw createError("找不到維修工單", 404);
    }
    assertRepairEditable(stateRows[0]);
    const result = await applyRepairReservationDecision(req.params.id, approved, req.user.id, "web_admin", pool, {
      logWorkflowEvent,
      actorLabel: `後台 staff#${req.user.id}`
    });
    if (!result) {
      throw createError("找不到維修工單", 404);
    }

    let warning = null;
    if (!result.alreadyProcessed && isLineCustomerType(result.customerType) && result.lineUserId) {
      try {
        await sendLineMessage(config, result.lineUserId, [
          {
            type: "text",
            text: result.customerMessage
          }
        ]);
      } catch (lineError) {
        warning = {
          customerNotifyFailed: true,
          message: "고객 LINE 알림 발송 실패, 수동 연락 필요"
        };
        console.warn("[repair-reservation] customer decision notification failed", {
          repairId: req.params.id,
          message: lineError.message
        });
        try {
          await logRepairLineNotifyFailure(
            req.params.id,
            "repair_reservation_notify_failed",
            lineError,
            {
              source: "web_admin",
              context: approved ? "reservation_approved" : "reservation_rejected",
              lineUserId: result.lineUserId
            }
          );
        } catch (notifyLogError) {
          console.warn("[repair-reservation] log customer decision notification failure failed", {
            repairId: req.params.id,
            message: notifyLogError.message
          });
        }
      }
    }

    if (approved && !result.alreadyProcessed) {
      await notifyRepairStaffWorkflowSafely({
        event: "reservation_confirmed",
        repairId: req.params.id,
        storeId,
        staffName: getRequestStaffName(req),
        source: "web_admin"
      });
    }

    return res.json({
      message: result.alreadyProcessed ? `維修預約原本就是${approved ? "已確認" : "已拒絕"}狀態` : approved ? "已確認維修預約" : "已拒絕維修預約",
      repairId: Number(req.params.id),
      reservationStatus: approved ? "approved" : "rejected",
      status: approved ? "reserved" : "canceled",
      warning
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/estimate",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const { estimateAmount, note, details, items, inspectionFee, inspectionNotes, partsFee, laborFee, totalAmount, notes } = req.body;
    const result = await saveRepairEstimateDraft(
      req.params.id,
      {
        items: Array.isArray(items) ? items : [],
        inspectionFee: inspectionFee !== undefined ? inspectionFee : 0,
        partsFee: partsFee !== undefined ? partsFee : 0,
        laborFee: laborFee !== undefined ? laborFee : 0,
        notes: notes || details || note || "",
        totalAmount: totalAmount !== undefined ? totalAmount : estimateAmount
      },
      req.user.id,
      "web_admin",
      pool,
      { storeId }
    );
    await syncReplacementConfirmationsFromQuote(req.params.id, storeId);
    await notifyRepairStaffWorkflowSafely({
      event: "quote_draft_saved",
      repairId: req.params.id,
      storeId,
      amount: result?.totalAmount || Number(totalAmount || estimateAmount || 0),
      updatedAt: new Date().toISOString(),
      source: "web_admin"
    });
    return res.json({
      message: result?.quoteCoreChanged ? "報價草稿已儲存，交叉確認已重設為待確認" : "報價草稿已儲存",
      quoteStatus: "pending",
      totalAmount: result?.totalAmount || Number(totalAmount || estimateAmount || 0),
      crossCheckStatus: result?.crossCheckStatus || "PENDING",
      quoteConfirmationStatus: "NOT_SENT",
      quoteConfirmationLink: buildRepairQuoteConfirmationUrl(req.params.id),
      lineSent: false
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/send-quote-confirmation", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const result = await sendRepairQuoteConfirmationIfNeeded(req.params.id, storeId, req.user.id, {
      source: "manual_resend"
    });
    const quoteConfirmationStatus = result.sent || result.reused ? "SENT" : result.warning ? "FAILED" : "NOT_SENT";
    if (result.sent) {
      await notifyRepairStaffWorkflowSafely({
        event: "quote_sent_to_customer",
        repairId: req.params.id,
        storeId,
        amount: result.estimateAmount || 0,
        updatedAt: new Date().toISOString(),
        source: "web_admin"
      });
    }
    return res.json({
      message: result.sent ? "維修報價已成功發送給客戶" : result.message || "相同報價已發送給客戶，未重複發送",
      quoteConfirmation: {
        ...result,
        quoteConfirmationStatus,
        lineSent: Boolean(result.sent)
      },
      quoteConfirmationStatus,
      quoteConfirmationWarning: result.warning || null,
      quoteConfirmationLink: result.link || buildRepairQuoteConfirmationUrl(req.params.id),
      lineSent: Boolean(result.sent)
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/work-order", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    const [rows] = await pool.query(
      `
        SELECT
          ro.*,
          ro.inspection_notes AS inspectionNotes,
          ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_check_status", "crossCheckStatus", "'PENDING'")},
          ${selectColumn(repairColumns, "ro", "cross_checked_by_staff_id", "crossCheckedByStaffId", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_checked_at", "crossCheckedAt", "NULL")},
          ${selectColumn(repairColumns, "ro", "cross_check_note", "crossCheckNote", "NULL")},
          ${selectColumn(repairColumns, "ro", "diagnosis_updated_by_staff_id", "diagnosisUpdatedByStaffId", "NULL")},
          ${selectColumn(repairColumns, "ro", "diagnosis_updated_at", "diagnosisUpdatedAt", "NULL")},
          cross_staff.display_name AS crossCheckedByStaffName,
          diagnosis_staff.display_name AS diagnosisUpdatedByStaffName,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType,
          s.name AS storeName,
          s.code AS storeCode
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
        INNER JOIN stores s ON s.id = ro.store_id
        LEFT JOIN orders linked_o ON linked_o.id = ro.order_id AND linked_o.store_id = ro.store_id
        LEFT JOIN staff_users cross_staff ON cross_staff.id = ro.cross_checked_by_staff_id
        LEFT JOIN staff_users diagnosis_staff ON diagnosis_staff.id = ro.diagnosis_updated_by_staff_id
        WHERE ro.id = ?
          AND ro.store_id = ?
          AND ro.deleted_at IS NULL
          AND (ro.order_id IS NULL OR (linked_o.id IS NOT NULL AND linked_o.deleted_at IS NULL))
        LIMIT 1
      `,
      [req.params.id, storeId]
    );

    const repair = rows[0] || null;
    if (!repair) {
      throw createError("找不到維修工單", 404);
    }

    const [logs] = await pool.query(
      `
        SELECT id, action, note, created_at AS createdAt
        FROM repair_logs
        WHERE repair_order_id = ?
        ORDER BY id DESC
      `,
      [req.params.id]
    );
    const attachments = await listRepairAttachments(req.params.id, storeId);
    const latestAcceptedLog = logs.find((log) => (
      log.action === "customer_estimate_approved" ||
      log.action === "quote_approved_by_customer_from_progress"
    ));

    return res.json({
      repair: {
        ...repair,
        raw_status: repair.status,
        status: normalizeRepairLifecycleStatus({
          repairSource: "REPAIR_ORDER",
          reservationStatus: repair.reservation_status,
          status: repair.status
        }),
        repairStatusLabel: mapRepairStatusLabel(repair.status),
        customerEstimateResponseLabel:
          repair.customer_estimate_response === "approved"
            ? "客戶已同意報價"
            : repair.customer_estimate_response === "rejected"
              ? "客戶已拒絕報價"
              : repair.customer_estimate_response === "pending"
                ? "客戶尚未回覆"
                : "尚未送出報價",
        quoteAcceptedAt: repair.customer_estimate_responded_at || repair.customer_confirmed_at || latestAcceptedLog?.createdAt || null
      },
      store: {
        id: repair.store_id,
        name: repair.storeName,
        code: repair.storeCode
      },
      customer: {
        id: repair.customer_id,
        name: repair.customerName,
        phone: repair.customerPhone,
        lineUserId: repair.lineUserId,
        customerType: repair.customerType
      },
      quoteItemsJson: repair.quote_items_json || null,
      logs,
      attachments,
      mediaSummary: {
        total: attachments.length,
        images: attachments.filter((item) => String(item.fileType || "").toLowerCase() === "image").length,
        videos: attachments.filter((item) => String(item.fileType || "").toLowerCase() === "video").length,
        thumbnails: attachments.filter((item) => String(item.fileType || "").toLowerCase() === "image").slice(0, 4)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/replacement-confirmations", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const result = await listReplacementConfirmations(req.params.id, storeId);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/replacement-confirmations/:replacementId", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const result = await updateReplacementConfirmation(
      req.params.id,
      req.params.replacementId,
      storeId,
      req.body || {},
      req.user?.id || null
    );
    return res.json({
      message: "更換項目確認已更新",
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/replacement-confirmations/:replacementId/cross-check", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const result = await crossCheckReplacementConfirmation(
      req.params.id,
      req.params.replacementId,
      storeId,
      req.user?.id || null,
      req.user || {}
    );
    return res.json({
      message: "交叉確認已完成",
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cross-check", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const repairColumns = await getTableColumns(pool, "repair_orders");
    assertCrossCheckColumns(repairColumns);
    await assertRepairBelongsToStore(req.params.id, storeId);

    const crossCheckStatus = normalizeCrossCheckStatus(req.body?.status || req.body?.crossCheckStatus || req.body?.result);
    const note = String(req.body?.note || req.body?.crossCheckNote || "").trim() || null;
    const staff = await getCrossCheckStaff(req.user?.id, storeId);

    const [rows] = await pool.query(
      `
        SELECT reservation_status AS reservationStatus, status, inspection_notes AS inspectionNotes, estimate_amount AS estimateAmount, estimate_details AS estimateDetails, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );
    const repair = rows[0];
    if (!repair) {
      throw createError("找不到維修工單", 404);
    }
    assertRepairEditable(repair);
    if (String(repair.reservationStatus || "").trim() !== "approved") {
      throw createCodedRepairError("需先確認預約後才能交叉確認", 400, "RESERVATION_CONFIRMATION_REQUIRED");
    }
    if (!hasInitialDiagnosis(repair)) {
      throw createCodedRepairError(INITIAL_DIAGNOSIS_REQUIRED_MESSAGE, 400, "INITIAL_DIAGNOSIS_REQUIRED");
    }
    if (Number(repair.estimateAmount || 0) <= 0 && !String(repair.estimateDetails || "").trim()) {
      throw createCodedRepairError("請先儲存維修報價草稿，才能進行交叉確認。", 400, "QUOTE_DRAFT_REQUIRED");
    }

    await pool.query(
      `
        UPDATE repair_orders
        SET cross_check_status = ?,
            cross_checked_by_staff_id = ?,
            cross_checked_at = NOW(),
            cross_check_note = ?,
            updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
      `,
      [crossCheckStatus, staff.id, note, req.params.id, storeId]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'repair_quote_cross_check', ?)
      `,
      [
        req.params.id,
        `${crossCheckStatus === REPAIR_CROSS_CHECK_STATUS.APPROVED ? "確認無誤" : "需要修正"}：${staff.name}${note ? `；${note}` : ""}`
      ]
    );

    await notifyRepairStaffWorkflowSafely({
      event: crossCheckStatus === REPAIR_CROSS_CHECK_STATUS.APPROVED ? "cross_check_approved" : "cross_check_needs_revision",
      repairId: req.params.id,
      storeId,
      staffName: staff.name,
      note,
      crossCheckedAt: new Date().toISOString(),
      source: "web_admin"
    });

    return res.json({
      message: crossCheckStatus === REPAIR_CROSS_CHECK_STATUS.APPROVED ? "交叉確認已完成" : "已標記需要修正",
      crossCheckStatus,
      crossCheckedByStaffId: staff.id,
      crossCheckedByStaffName: staff.name,
      crossCheckedAt: new Date().toISOString(),
      crossCheckNote: note
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/customer-response",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const approved = Boolean(req.body.approved);
    const [stateRows] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );
    if (!stateRows[0]) {
      throw createError("找不到維修工單", 404);
    }
    assertRepairEditable(stateRows[0]);
    const result = await applyRepairEstimateCustomerResponse(req.params.id, approved, req.user.id, pool, "web_admin", {
      storeId
    });
    return res.json({
      message: approved ? "已標記客戶同意報價" : "已標記客戶拒絕報價",
      orderId: result?.linkedOrder?.orderId || null,
      orderNo: result?.linkedOrder?.orderNo || null,
      alreadyProcessed: Boolean(result?.alreadyProcessed)
    });
  } catch (error) {
    return next(error);
  }
});



router.post("/:id/offline-complete", async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const storeId = req.storeId;
    const { estimateAmount, note, details } = req.body;
    const amount = Number(estimateAmount || 0);

    if (!Number.isFinite(amount) || amount < 0) {
      throw createError("維修金額不正確", 400);
    }

    await connection.beginTransaction();

    await assertRepairBelongsToStore(req.params.id, storeId, connection);
    await assertReplacementConfirmationsComplete(req.params.id, storeId, connection);
    // REPAIRS_OFFLINE_COMPLETE_STORE_SCOPE_V1

    await connection.query(
      `
        UPDATE repair_orders
        SET
          estimate_amount = ?,
          estimate_details = ?,
          inspection_notes = ?,
          quote_status = 'approved',
          customer_estimate_response = 'approved',
          status = 'completed_waiting_pickup',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
        WHERE id = ?
          AND store_id = ?
      `,
      [
        amount,
        details || note || "現場已完成維修，略過 LINE 報價流程",
        req.params.id,
        storeId
      ]
    );

    await connection.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'offline_complete', ?)
      `,
      [
        req.params.id,
        `現場已完成維修登錄，金額 NT$${amount}。略過 LINE 報價流程。${note ? " " + note : ""}`
      ]
    );

    await connection.commit();

    let repairConfirmation = null;
    let repairConfirmationWarning = null;
    try {
      const confirmationResult = await createOrReuseRepairConfirmationForCompletedRepair(
        req.params.id,
        storeId,
        req.user?.id || null,
        {
          source: "offline_complete",
          purpose: "repair_confirmation_auto_after_offline_complete"
        }
      );
      if (confirmationResult.ok) {
        repairConfirmation = confirmationResult.confirmation || null;
      } else if (confirmationResult.reason !== "完成付款後自動發送維修確認書") {
        repairConfirmationWarning = confirmationResult.reason || "維修完成確認書尚未自動建立";
      }
    } catch (confirmationError) {
      repairConfirmationWarning = confirmationError.message || "維修完成確認書自動建立失敗";
    }

    res.json({
      success: true,
      id: Number(req.params.id),
      status: "completed_waiting_pickup",
      estimateAmount: amount,
      repairConfirmation,
      repairConfirmationWarning
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});


router.post("/:id/approve", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [repairs] = await pool.query(
      `
        SELECT
          customer_estimate_response AS customerEstimateResponse,
          quote_status AS quoteStatus,
          status,
          completed_at AS completedAt,
          picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    assertRepairEditable(repairs[0]);

    if (!canStartRepairAction(repairs[0])) {
      throw createError("客戶尚未同意報價，無法開始維修", 400);
    }

    const linkedOrder = await ensureRepairJobOrder(req.params.id, req.user.id, pool, { storeId });

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'repairing',
            approved_by_staff_id = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [req.user.id, req.params.id, storeId]
    );

    const orderColumns = await getTableColumns(pool, "orders");
    const [statusTypeRows] = await pool.query(
      `
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'orders'
          AND COLUMN_NAME = 'status'
        LIMIT 1
      `
    );
    const orderStatusType = String(statusTypeRows[0]?.COLUMN_TYPE || "");
    const orderStatus = orderStatusType.includes("'REPAIRING'") ? "REPAIRING" : "PENDING";
    const updates = ["status = ?"];
    const params = [orderStatus];
    if (hasColumn(orderColumns, "order_type")) {
      updates.push("order_type = 'REPAIR'");
    }
    if (hasColumn(orderColumns, "source")) {
      updates.push("source = 'repair_quote'");
    }
    params.push(req.params.id, storeId, req.params.id, storeId);
    await pool.query(
      `
        UPDATE orders
        SET ${updates.join(", ")}
        WHERE store_id = ?
          AND (
            repair_order_id = ?
            OR id = (SELECT order_id FROM repair_orders WHERE id = ? AND store_id = ?)
          )
      `,
      params
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'repairing', ?)
      `,
      [req.params.id, "已開始維修"]
    );

    await logKpi(req.user.id, "REPAIR_ESTIMATE_APPROVED", "REPAIR_ORDER", req.params.id, 3);
    await logWorkflowEvent("repair_started", "REPAIR_ORDER", req.params.id, null, req.user.id);
    await notifyRepairStaffWorkflowSafely({
      event: "repair_started",
      repairId: req.params.id,
      storeId,
      staffName: getRequestStaffName(req),
      source: "web_admin"
    });
    return res.json({
      message: "已開始維修",
      orderId: linkedOrder?.orderId || null,
      itemSync: linkedOrder?.itemSync
        ? {
            synced: Boolean(linkedOrder.itemSync.synced),
            reason: linkedOrder.itemSync.reason || null,
            insertedCount: Number(linkedOrder.itemSync.insertedCount || 0),
            existingItemCount: Number(linkedOrder.itemSync.existingItemCount || 0)
          }
        : null
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reject",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [stateRows] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );
    if (!stateRows[0]) {
      throw createError("找不到維修工單", 404);
    }
    assertRepairEditable(stateRows[0]);

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'estimate_rejected',
            customer_estimate_response = 'rejected',
            customer_estimate_responded_at = NOW(),
            approved_by_staff_id = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [req.user.id, req.params.id, storeId]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'estimate_rejected', ?)
      `,
      [req.params.id, req.body.note || "報價已拒絕"]
    );

    return res.json({ message: "報價已拒絕" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/complete",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [repairs] = await pool.query(
      `
        SELECT ro.id, ro.customer_id AS customerId, ro.order_id AS orderId, ro.bike_model AS bikeModel, ro.estimate_amount AS estimateAmount, ro.completed_at AS completedAt, c.name AS customerName, COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType, c.line_user_id AS lineUserId
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id
        WHERE ro.id = ?
          AND ro.store_id = ?
      `,
      [req.params.id, storeId]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    assertRepairEditable(repairs[0]);
    const [repairStateRows] = await pool.query(
      `
        SELECT status
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );
    if (String(repairStateRows[0]?.status || "").trim() === "repairing") {
      // OK
    } else {
      throw createError("維修尚未開始，無法標記完修", 400);
    }

    await assertReplacementConfirmationsComplete(req.params.id, storeId);

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'completed_waiting_pickup',
            completed_at = NOW()
        WHERE id = ?
          AND store_id = ?
      `,
      [req.params.id, storeId]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'completed_waiting_pickup', ?)
      `,
      [req.params.id, "維修完成，待取車"]
    );


    await notifyRepairStaffWorkflowSafely({
      event: "repair_completed",
      repairId: req.params.id,
      storeId,
      source: "web_admin"
    });

    let warning = null;
    if (isLineCustomerType(repairs[0].customerType) && repairs[0].lineUserId) {
      const surveyToken = require("crypto").randomBytes(20).toString("hex");
      const [surveyResult] = await pool.query(
        `
          INSERT INTO surveys (customer_id, order_id, repair_order_id, rating, feedback, token)
          VALUES (?, ?, ?, 0, NULL, ?)
        `,
        [repairs[0].customerId, repairs[0].orderId || null, req.params.id, surveyToken]
      );
      await pool.query(
        "UPDATE repair_orders SET survey_id = ? WHERE id = ? AND store_id = ?",
        [surveyResult.insertId, req.params.id, storeId]
      );
      const surveyLink = `${config.frontendBaseUrl}/surveys/${surveyToken}`;
      try {
        await sendLineMessage(config, repairs[0].lineUserId, [
          {
            type: "text",
            text: [
              "您的自行車維修已完成。",
              "請到店付款 / 取車。",
              "通知後超過 3 日未取車，每日將收取保管費 NT$80。",
              `維修問卷：${surveyLink}`
            ].join("\n")
          }
        ]);
      } catch (lineError) {
        warning = {
          customerNotifyFailed: true,
          message: "고객 LINE 알림 발송 실패, 수동 연락 필요"
        };
        console.warn("[repair-completed] customer notification failed", {
          repairId: req.params.id,
          message: lineError.message
        });
        try {
          await logRepairLineNotifyFailure(
            req.params.id,
            "repair_completed_notify_failed",
            lineError,
            {
              source: "web_admin",
              context: "repair_completed",
              lineUserId: repairs[0].lineUserId
            }
          );
        } catch (notifyLogError) {
          console.warn("[repair-completed] log customer notification failure failed", {
            repairId: req.params.id,
            message: notifyLogError.message
          });
        }
      }
    }

    await logWorkflowEvent("repair_completed", "REPAIR_ORDER", req.params.id, null, req.user.id);

    let repairConfirmation = null;
    let repairConfirmationWarning = null;
    try {
      const confirmationResult = await createOrReuseRepairConfirmationForCompletedRepair(
        req.params.id,
        storeId,
        req.user?.id || null,
        {
          source: "repair_completed",
          purpose: "repair_confirmation_auto_after_repair_complete"
        }
      );
      if (confirmationResult.ok) {
        repairConfirmation = confirmationResult.confirmation || null;
      } else if (confirmationResult.reason !== "完成付款後自動發送維修確認書") {
        repairConfirmationWarning = confirmationResult.reason || "維修完成確認書尚未自動建立";
      }
    } catch (confirmationError) {
      repairConfirmationWarning = confirmationError.message || "維修完成確認書自動建立失敗";
    }

    return res.json({
      message: "已標記為完修待取車",
      repairConfirmation,
      repairConfirmationWarning,
      warning
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/phone-notified",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [repairs] = await pool.query(
      `
        SELECT ro.id, ro.status, ro.completed_at AS completedAt, ro.picked_up_at AS pickedUpAt, COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id
        WHERE ro.id = ?
        LIMIT 1
      `,
      [req.params.id]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    const currentStatus = String(repairs[0].status || "").trim();
    if (["picked_up", "completed"].includes(currentStatus) || repairs[0].completedAt || repairs[0].pickedUpAt) {
      throw createError("已完成或已取車的維修單無法再次通知", 400);
    }
    if (currentStatus !== "completed_waiting_pickup") {
      throw createError("需先完成維修後才能電話通知", 400);
    }

    if (isLineCustomerType(repairs[0].customerType)) {
      throw createError("LINE 客戶請使用 LINE 通知流程", 400);
    }

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'phone_notified', ?)
      `,
      [req.params.id, req.body.note || "已電話通知客戶"]
    );
    await logWorkflowEvent("repair_phone_notified", "REPAIR_ORDER", req.params.id, null, req.user.id);
    return res.json({ message: "已記錄電話通知" });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/pickup",  async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [repairs] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
      `,
      [req.params.id, storeId]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    const currentStatus = String(repairs[0].status || "").trim();
    if (["picked_up", "completed"].includes(currentStatus) || repairs[0].pickedUpAt) {
      throw createError("已取車的維修單無法重複取車", 400);
    }
    if (currentStatus !== "completed_waiting_pickup") {
      throw createError("需先完成維修後才能取車", 400);
    }

    const storageFee = calculateStorageFee(repairs[0].completedAt, new Date());
    const pickupColumns = await getTableColumns(pool, "repair_orders");
    const pickupUpdates = [
      "status = 'picked_up'",
      "picked_up_at = NOW()",
      "storage_fee = ?"
    ];
    if (hasColumn(pickupColumns, "pickup_reminder_suppressed")) {
      pickupUpdates.push("pickup_reminder_suppressed = 1");
    }
    if (hasColumn(pickupColumns, "pickup_reminder_suppressed_at")) {
      pickupUpdates.push("pickup_reminder_suppressed_at = COALESCE(pickup_reminder_suppressed_at, NOW())");
    }
    if (hasColumn(pickupColumns, "updated_at")) {
      pickupUpdates.push("updated_at = NOW()");
    }

    await pool.query(
      `
        UPDATE repair_orders
        SET ${pickupUpdates.join(", ")}
        WHERE id = ?
          AND store_id = ?
      `,
      [storageFee, req.params.id, storeId]
    );

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'picked_up', ?)
      `,
      [req.params.id, `已取車，保管費 NT$${storageFee}`]
    );

    await pool.query(
      `
        UPDATE orders
        SET status = 'COMPLETED'
        WHERE store_id = ?
          AND (
            repair_order_id = ?
            OR id = (
              SELECT order_id
              FROM repair_orders
              WHERE id = ?
                AND store_id = ?
            )
          )
      `,
      [storeId, req.params.id, req.params.id, storeId]
    );

    await logKpi(req.user.id, "REPAIR_PICKED_UP", "REPAIR_ORDER", req.params.id, 4);
    await notifyRepairStaffWorkflowSafely({
      event: "picked_up",
      repairId: req.params.id,
      storeId,
      source: "web_admin"
    });
    return res.json({ message: "已完成取車", storageFee });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/suppress-pickup-reminder", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    await assertRepairBelongsToStore(req.params.id, storeId);
    const [repairs] = await pool.query(
      `
        SELECT status, completed_at AS completedAt, picked_up_at AS pickedUpAt
        FROM repair_orders
        WHERE id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.id, storeId]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    const currentStatus = String(repairs[0].status || "").trim();
    if (currentStatus === "picked_up" || currentStatus === "completed" || repairs[0].pickedUpAt) {
      throw createError("已完成或已取車的維修單無法停止提醒", 400);
    }
    if (currentStatus !== "completed_waiting_pickup") {
      throw createError("需先完成維修後才能停止提醒", 400);
    }

    await suppressPickupReminder(req.params.id, pool, { storeId, suppressedBy: String(req.user?.id || "") });

    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'pickup_reminder_suppressed', ?)
      `,
      [req.params.id, "已停止保管提醒"]
    );

    await logWorkflowEvent("repair_pickup_reminder_suppressed", "REPAIR_ORDER", req.params.id, null, req.user.id);
    return res.json({ message: "已停止保管提醒" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
