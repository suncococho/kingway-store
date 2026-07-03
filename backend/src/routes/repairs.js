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
const { applyRepairReservationDecision, isLineCustomerType, normalizeCustomerType } = require("../services/repairReservationService");
const { listRepairAttachments } = require("../services/repairAttachmentService");
const {
  isStaffLineNotifySuppressed,
  notifyRepairReservationCreated
} = require("../services/staffLineNotify");
const {
  applyRepairEstimateCustomerResponse,
  createButtonMessage,
  createConfirmTemplate,
  createPostbackAction,
  buildGroupApprovalMessage,
  buildRepairQuoteConfirmationUrl,
  logWorkflowEvent,
  sendRepairEstimateQuotation,
  sendRepairQuoteConfirmationIfNeeded,
  sendToGroups,
  sendToGroupsWithResult
} = require("../services/lineWorkflowService");
const {
  buildRepairConfirmationLink,
  buildRepairConfirmationPdfUrl,
  createOrReuseRepairConfirmationForCompletedRepair,
  getRepairConfirmationBlockReason
} = require("../services/repairConfirmationService");
const {
  assertReplacementConfirmationsComplete,
  crossCheckReplacementConfirmation,
  listReplacementConfirmations,
  syncReplacementConfirmationsFromQuote,
  updateReplacementConfirmation
} = require("../services/repairReplacementConfirmationService");

const router = express.Router();
const REPAIR_ALLOWED_ROLES = ["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "USER", "EMPLOYEE"];

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
          ${selectColumn(repairColumns, "ro", "issue_description", "issueDescription")},
          ${selectColumn(repairColumns, "ro", "reservation_date", "reservationDate")},
          ${selectColumn(repairColumns, "ro", "reservation_day", "reservationDay")},
          ${selectColumn(repairColumns, "ro", "reservation_time", "reservationTime")},
          ${selectColumn(repairColumns, "ro", "reservation_status", "reservationStatus", "'approved'")},
          ${selectColumn(repairColumns, "ro", "group_confirmed", "groupConfirmed", "0")},
          ${selectColumn(repairColumns, "ro", "group_confirmed_at", "groupConfirmedAt")},
          ${selectColumn(repairColumns, "ro", "group_confirmed_by", "groupConfirmedBy")},
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
            ${selectColumn(orderColumns, "o", "notes", "issueDescription")},
            ${selectColumn(orderColumns, "o", "business_date", "reservationDate")},
            NULL AS reservationDay,
            NULL AS reservationTime,
            'approved' AS reservationStatus,
            1 AS groupConfirmed,
            NULL AS groupConfirmedAt,
            NULL AS groupConfirmedBy,
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
        return {
          ...row,
          rawStatus: row.status,
          status: normalizedStatus,
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
    const { inspectionFee = 0, inspectionNotes = "" } = req.body || {};
    const notes = String(inspectionNotes || "").trim();

    if (!notes) {
      return res.status(400).json({ message: "請先填寫檢查內容" });
    }

    await pool.query(
      `
      UPDATE repair_orders
      SET inspection_fee = ?,
          inspection_notes = ?,
          updated_at = NOW()
      WHERE id = ?
        AND customer_id IN (SELECT id FROM customers WHERE store_id = ?)
      `,
      [Number(inspectionFee || 0), notes, req.params.id, storeId]
    );

    return res.json({ ok: true });
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
    const [rows] = await pool.query(
      `
        SELECT
          ro.*,
          ro.inspection_notes AS inspectionNotes,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType
        FROM repair_orders ro
        INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ?
        LEFT JOIN orders linked_o ON linked_o.id = ro.order_id AND linked_o.store_id = ro.store_id
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

    return res.json({
      ...rows[0],
      raw_status: rows[0].status,
      status: normalizedStatus,
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
    const { customerId, bikeModel, issueDescription, reservationDate, reservationTime, fromLine, customerType } = req.body;
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
    const [result] = await pool.query(
      `
        INSERT INTO repair_orders (
          store_id, customer_id, customer_type, source, bike_model, issue_description, reservation_date, reservation_day, reservation_time, base_fee, reservation_status, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
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
      ]
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

    const notificationResult = !isLineCustomerType(normalizedCustomerType)
      ? { delivered: 0, targetGroupIds: [], skipped: true }
      : await sendToGroupsWithResult(["repair", "admin"], [
          buildGroupApprovalMessage("repair_reservation", {
            id: result.insertId,
            customerName: customer.name || `#${customerId}`,
            customerPhone: customer.phone || null,
            reservationDate,
            reservationTime,
            sourceLabel: fromLine ? "LINE 維修預約" : "後台維修預約"
          })
        ]);

    await logWorkflowEvent(
      "repair_reservation_group_notified",
      "REPAIR_ORDER",
      result.insertId,
      {
        delivered: notificationResult.delivered,
        targetGroupIds: notificationResult.targetGroupIds,
        fromLine: Boolean(fromLine),
        customerType: normalizedCustomerType,
        skipped: Boolean(notificationResult.skipped)
      },
      req.user.id
    );

    if (!notificationResult.skipped && notificationResult.delivered === 0) {
      console.error(
        `[LINE][repair_reservation] no target groups resolved for repair #${result.insertId} (requested: repair,admin)`
      );
    }

    if (isStaffLineNotifySuppressed()) {
      console.info("[staff-line] repair_notify_skipped", {
        repairId: result.insertId,
        storeId
      });
    } else {
      try {
        await notifyRepairReservationCreated({
          repairId: result.insertId,
          customerName: customer.name || `#${customerId}`,
          customerPhone: customer.phone || null,
          reservationDate,
          reservationTime,
          bikeModel,
          issueDescription,
          storeId,
          sourceLabel: fromLine ? "LINE 維修預約" : "後台維修預約",
          adminUrl: `${config.frontendBaseUrl}/repairs/${result.insertId}`
        });
      } catch (staffLineError) {
        console.warn("[staff-line] repair reservation notification failed after creation", {
          repairId: result.insertId,
          message: staffLineError.message
        });
      }
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

    if (!result.alreadyProcessed && isLineCustomerType(result.customerType) && result.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, result.lineUserId, [
        {
          type: "text",
          text: result.customerMessage
        }
      ]);
    }

    if (isLineCustomerType(result.customerType)) {
      await sendToGroups(["repair", "admin"], [
        {
          type: "text",
          text: result.alreadyProcessed
            ? `維修預約 #${req.params.id} 已是${approved ? "已確認" : "已拒絕"}狀態，略過重複通知。`
            : `維修預約 #${req.params.id} 已由後台${approved ? "確認" : "拒絕"}。`
        }
      ]);
    }
    return res.json({
      message: result.alreadyProcessed ? `維修預約原本就是${approved ? "已確認" : "已拒絕"}狀態` : approved ? "已確認維修預約" : "已拒絕維修預約",
      repairId: Number(req.params.id),
      reservationStatus: approved ? "approved" : "rejected",
      status: approved ? "reserved" : "canceled"
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
    const result = await sendRepairEstimateQuotation(
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
    const quoteConfirmation = result?.quoteConfirmation || null;
    const quoteConfirmationStatus = quoteConfirmation?.sent ? "SENT" : quoteConfirmation?.warning ? "FAILED" : null;
    return res.json({
      message: "已送出報價審核",
      quoteStatus: "sent",
      totalAmount: result?.totalAmount || Number(totalAmount || estimateAmount || 0),
      quoteConfirmation: quoteConfirmation
        ? {
            ...quoteConfirmation,
            quoteConfirmationStatus,
            lineSent: Boolean(quoteConfirmation.sent)
          }
        : null,
      quoteConfirmationStatus,
      quoteConfirmationWarning: quoteConfirmation?.warning || null,
      quoteConfirmationLink: quoteConfirmation?.link || buildRepairQuoteConfirmationUrl(req.params.id),
      lineSent: Boolean(quoteConfirmation?.sent)
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
      forceSend: true,
      source: "manual_resend"
    });
    const quoteConfirmationStatus = result.sent ? "SENT" : result.warning ? "FAILED" : "NOT_SENT";
    return res.json({
      message: result.sent ? "已發送報價確認通知" : result.warning || result.message || "已產生報價確認連結",
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
        SELECT customer_estimate_response AS customerEstimateResponse, status
        FROM repair_orders
        WHERE id = ?
        LIMIT 1
      `,
      [req.params.id]
    );

    if (!repairs[0]) {
      throw createError("找不到維修工單", 404);
    }

    assertRepairEditable(repairs[0]);

    if (repairs[0].customerEstimateResponse !== "approved") {
      throw createError("客戶尚未同意報價，無法開始維修", 400);
    }

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
    return res.json({ message: "已開始維修" });
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
        SELECT ro.id, ro.customer_id AS customerId, ro.order_id AS orderId, COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType, c.line_user_id AS lineUserId
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

    if (isLineCustomerType(repairs[0].customerType) && repairs[0].lineUserId && config.line.channelAccessToken) {
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
    }

    if (isLineCustomerType(repairs[0].customerType)) {
      await sendToGroups(["repair", "admin"], [
        {
          type: "text",
          text: `維修單 #${req.params.id} 已標記完修，已通知客戶取車與填寫問卷。`
        }
      ]);
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
      repairConfirmationWarning
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

    await pool.query(
      `
        UPDATE repair_orders
        SET status = 'picked_up',
            picked_up_at = NOW(),
            storage_fee = ?
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
    return res.json({ message: "已完成取車", storageFee });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
