const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const config = require("../config");
const { createError } = require("../utils/errors");
const { sendLineMessage } = require("../utils/line");
const { resolveStoreLineCredentials } = require("../services/storeLineSettingsService");
const {
  createButtonMessage,
  createUriAction
} = require("../services/lineWorkflowService");
const {
  REPAIR_CONFIRMATION_PDF_PUBLIC_PREFIX,
  writeRepairConfirmationPdf
} = require("../services/pdfService");
const repairConfirmationService = require("../services/repairConfirmationService");
const repairConfirmationContent = require("../content/repairConfirmationContent.json");
const { getReplacementConfirmationBlockReason } = require("../services/repairReplacementConfirmationService");
const { notifyRepairConfirmationSubmitted } = require("../services/notificationEventService");
const { getTableColumns, selectColumn } = require("../utils/schema");

const router = express.Router();
const storageRoot = path.join(__dirname, "..", "..", "storage");
const signatureStorageDir = path.join(storageRoot, "signatures");
const REPAIR_ALLOWED_ROLES = ["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "USER", "EMPLOYEE"];
const COMPLETED_REPAIR_STATUSES = new Set(["completed_waiting_pickup", "picked_up", "completed"]);

function buildRepairConfirmationLink(token) {
  return `${config.frontendBaseUrl}/repair-confirm/${encodeURIComponent(token)}`;
}

function buildRepairConfirmationPdfUrl(token) {
  return `${config.frontendBaseUrl}/api/repair-confirmations/public/${encodeURIComponent(token)}/pdf`;
}

function resolvePublicStoragePath(publicPath) {
  if (!publicPath || !String(publicPath).startsWith(REPAIR_CONFIRMATION_PDF_PUBLIC_PREFIX)) {
    return null;
  }
  return path.join(storageRoot, String(publicPath).replace(/^\/files\//, ""));
}

function parseDataUriImage(dataUri) {
  const matched = String(dataUri || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    return null;
  }
  return {
    mimeType: matched[1],
    extension: matched[1].includes("png") ? "png" : "jpg",
    buffer: Buffer.from(matched[2], "base64")
  };
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getRepairSummary(row) {
  return String(row?.estimateDetails || row?.quoteNotes || row?.inspectionNotes || "").trim();
}

function getAmountTotal(row) {
  const orderTotal = Number(row?.orderTotalAmount || 0);
  if (Number.isFinite(orderTotal) && orderTotal > 0) {
    return orderTotal;
  }
  const estimate = Number(row?.estimateAmount || 0);
  const storage = Number(row?.storageFee || 0);
  return (Number.isFinite(estimate) ? estimate : 0) + (Number.isFinite(storage) ? storage : 0);
}

function getPaymentStatus(row) {
  return String(row?.finalPaymentStatus || row?.orderStatus || "").trim() || "現場確認";
}

async function fetchRepairForConfirmation(repairOrderId, storeId, connection = pool, options = {}) {
  const lockClause = options.forUpdate ? "FOR UPDATE" : "";
  const repairColumns = await getTableColumns(connection, "repair_orders");
  const [rows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.store_id AS storeId,
        ro.customer_id AS customerId,
        ro.status,
        ro.bike_model AS bikeModel,
        ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
        ro.issue_description AS issueDescription,
        ro.estimate_amount AS estimateAmount,
        ro.estimate_details AS estimateDetails,
        ro.inspection_notes AS inspectionNotes,
        ro.quote_notes AS quoteNotes,
        ro.storage_fee AS storageFee,
        ro.completed_at AS completedAt,
        ro.picked_up_at AS pickedUpAt,
        ro.order_id AS orderId,
        c.name AS customerName,
        c.phone AS customerPhone,
        c.line_user_id AS lineUserId,
        COALESCE(ro.customer_type, c.customer_type, 'LINE') AS customerType,
        o.order_no AS orderNo,
        o.status AS orderStatus,
        o.total_amount AS orderTotalAmount,
        o.final_payment_status AS finalPaymentStatus
      FROM repair_orders ro
      INNER JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      LEFT JOIN orders o ON o.id = ro.order_id AND o.store_id = ro.store_id
      WHERE ro.id = ?
        AND ro.store_id = ?
        AND ro.deleted_at IS NULL
        AND (ro.order_id IS NULL OR (o.id IS NOT NULL AND o.deleted_at IS NULL))
      LIMIT 1
      ${lockClause}
    `,
    [repairOrderId, storeId]
  );
  return rows[0] || null;
}

function isRepairCompleted(row) {
  const status = String(row?.status || "").trim();
  return COMPLETED_REPAIR_STATUSES.has(status) || Boolean(row?.completedAt || row?.pickedUpAt);
}

function mapConfirmation(row) {
  if (!row) {
    return null;
  }
  const payload = parseJson(row.confirmationPayloadJson, {});
  return {
    id: row.id,
    repairOrderId: row.repairOrderId,
    storeId: row.storeId,
    status: row.status,
    completed: row.status === "COMPLETED",
    customerName: row.customerNameSnapshot,
    customerPhone: row.customerPhoneSnapshot,
    vehicleModel: row.vehicleModelSnapshot,
    mileageKm: row.mileageKm === undefined || row.mileageKm === null ? null : Number(row.mileageKm),
    issue: row.issueSnapshot,
    repairSummary: row.repairSummarySnapshot,
    amountTotal: Number(row.amountTotalSnapshot || 0),
    paymentStatus: row.paymentStatusSnapshot,
    termsVersion: row.termsVersion,
    confirmationChecks: payload.confirmationChecks || [],
    termsAccepted: Boolean(payload.termsAccepted),
    finalConfirmationAccepted: Boolean(payload.finalConfirmationAccepted),
    submittedAt: row.submittedAt,
    sentAt: row.sentAt,
    pdfPath: row.pdfPath,
    pdfUrl: row.pdfPath ? buildRepairConfirmationPdfUrl(row.token) : row.pdfUrl,
    link: row.token ? buildRepairConfirmationLink(row.token) : null,
    content: repairConfirmationContent
  };
}

async function fetchConfirmationByRepair(repairOrderId, storeId, connection = pool, options = {}) {
  const lockClause = options.forUpdate ? "FOR UPDATE" : "";
  const repairColumns = await getTableColumns(connection, "repair_orders");
  const [rows] = await connection.query(
    `
      SELECT
        rc.id,
        rc.store_id AS storeId,
        rc.repair_order_id AS repairOrderId,
        rc.customer_id AS customerId,
        rc.token,
        rc.status,
        rc.customer_name_snapshot AS customerNameSnapshot,
        rc.customer_phone_snapshot AS customerPhoneSnapshot,
        rc.vehicle_model_snapshot AS vehicleModelSnapshot,
        ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
        rc.issue_snapshot AS issueSnapshot,
        rc.repair_summary_snapshot AS repairSummarySnapshot,
        rc.amount_total_snapshot AS amountTotalSnapshot,
        rc.payment_status_snapshot AS paymentStatusSnapshot,
        rc.terms_version AS termsVersion,
        rc.confirmation_payload_json AS confirmationPayloadJson,
        rc.signature_image_path AS signatureImagePath,
        rc.pdf_path AS pdfPath,
        rc.pdf_url AS pdfUrl,
        rc.sent_at AS sentAt,
        rc.submitted_at AS submittedAt
      FROM repair_confirmations rc
      INNER JOIN repair_orders ro ON ro.id = rc.repair_order_id AND ro.store_id = rc.store_id
      LEFT JOIN orders o ON o.id = ro.order_id AND o.store_id = ro.store_id
      WHERE rc.repair_order_id = ?
        AND rc.store_id = ?
        AND ro.deleted_at IS NULL
        AND (ro.order_id IS NULL OR (o.id IS NOT NULL AND o.deleted_at IS NULL))
      LIMIT 1
      ${lockClause}
    `,
    [repairOrderId, storeId]
  );
  return rows[0] || null;
}

async function fetchConfirmationByToken(token, connection = pool, options = {}) {
  const lockClause = options.forUpdate ? "FOR UPDATE" : "";
  const repairColumns = await getTableColumns(connection, "repair_orders");
  const [rows] = await connection.query(
    `
      SELECT
        rc.id,
        rc.store_id AS storeId,
        rc.repair_order_id AS repairOrderId,
        rc.customer_id AS customerId,
        rc.token,
        rc.status,
        rc.customer_name_snapshot AS customerNameSnapshot,
        rc.customer_phone_snapshot AS customerPhoneSnapshot,
        rc.vehicle_model_snapshot AS vehicleModelSnapshot,
        ${selectColumn(repairColumns, "ro", "mileage_km", "mileageKm", "NULL")},
        rc.issue_snapshot AS issueSnapshot,
        rc.repair_summary_snapshot AS repairSummarySnapshot,
        rc.amount_total_snapshot AS amountTotalSnapshot,
        rc.payment_status_snapshot AS paymentStatusSnapshot,
        rc.terms_version AS termsVersion,
        rc.confirmation_payload_json AS confirmationPayloadJson,
        rc.signature_image_path AS signatureImagePath,
        rc.pdf_path AS pdfPath,
        rc.pdf_url AS pdfUrl,
        rc.sent_at AS sentAt,
        rc.submitted_at AS submittedAt
      FROM repair_confirmations rc
      INNER JOIN repair_orders ro ON ro.id = rc.repair_order_id AND ro.store_id = rc.store_id
      LEFT JOIN orders o ON o.id = ro.order_id AND o.store_id = ro.store_id
      WHERE rc.token = ?
        AND ro.deleted_at IS NULL
        AND (ro.order_id IS NULL OR (o.id IS NOT NULL AND o.deleted_at IS NULL))
      LIMIT 1
      ${lockClause}
    `,
    [token]
  );
  return rows[0] || null;
}

function validateSubmitPayload(body) {
  const selectedChecks = Array.isArray(body?.confirmationChecks) ? body.confirmationChecks : [];
  const selectedSet = new Set(selectedChecks);
  const requiredChecks = repairConfirmationContent.confirmationChecks;
  if (!requiredChecks.every((item) => selectedSet.has(item))) {
    throw createError(repairConfirmationContent.errors.confirmationChecks, 400);
  }
  if (!body?.termsAccepted) {
    throw createError(repairConfirmationContent.errors.termsAccepted, 400);
  }
  if (!body?.finalConfirmationAccepted) {
    throw createError(repairConfirmationContent.errors.finalConfirmationAccepted, 400);
  }
  const signatureData = String(body?.signatureData || "").trim();
  if (!signatureData) {
    throw createError(repairConfirmationContent.errors.signatureData, 400);
  }
  return {
    confirmationChecks: requiredChecks,
    termsAccepted: true,
    finalConfirmationAccepted: true,
    signatureData
  };
}

function writeSignatureImage(confirmationId, signatureData) {
  const image = parseDataUriImage(signatureData);
  if (!image) {
    return null;
  }
  fs.mkdirSync(signatureStorageDir, { recursive: true });
  const fileName = `repair-confirmation-${confirmationId}.${image.extension}`;
  const absolutePath = path.join(signatureStorageDir, fileName);
  fs.writeFileSync(absolutePath, image.buffer);
  return `/files/signatures/${fileName}`;
}

router.get("/content", (req, res) => {
  res.json({ content: repairConfirmationContent });
});

router.get("/public/:token", async (req, res, next) => {
  try {
    const confirmation = await fetchConfirmationByToken(req.params.token);
    if (!confirmation) {
      throw createError("找不到維修確認連結", 404);
    }
    if (confirmation.status === "CANCELED") {
      throw createError("此維修確認連結已失效", 410);
    }
    return res.json(mapConfirmation(confirmation));
  } catch (error) {
    return next(error);
  }
});

router.get("/public/:token/pdf", async (req, res, next) => {
  try {
    const confirmation = await fetchConfirmationByToken(req.params.token);
    const absolutePath = resolvePublicStoragePath(confirmation?.pdfPath);
    if (!confirmation || confirmation.status !== "COMPLETED" || !absolutePath || !fs.existsSync(absolutePath)) {
      throw createError("找不到 PDF", 404);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="repair-confirmation-${confirmation.id}.pdf"`);
    return res.sendFile(absolutePath);
  } catch (error) {
    return next(error);
  }
});

router.post("/public/:token/submit", async (req, res, next) => {
  try {
    const payload = validateSubmitPayload(req.body || {});
    const submittedAt = new Date().toISOString();

    const confirmation = await withTransaction(async (connection) => {
      const row = await fetchConfirmationByToken(req.params.token, connection, { forUpdate: true });
      if (!row) {
        throw createError("找不到維修確認連結", 404);
      }
      if (row.status === "CANCELED") {
        throw createError("此維修確認連結已失效", 410);
      }
      if (row.status === "COMPLETED" || row.submittedAt) {
        return { alreadyCompleted: true, ...row };
      }

      const signaturePath = writeSignatureImage(row.id, payload.signatureData);
      const pdf = await writeRepairConfirmationPdf({
        confirmationId: row.id,
        repairOrderId: row.repairOrderId,
        customerName: row.customerNameSnapshot,
        customerPhone: row.customerPhoneSnapshot,
        vehicleModel: row.vehicleModelSnapshot,
        mileageKm: row.mileageKm,
        issue: row.issueSnapshot,
        repairSummary: row.repairSummarySnapshot,
        amountTotal: row.amountTotalSnapshot,
        paymentStatus: row.paymentStatusSnapshot,
        confirmationChecks: payload.confirmationChecks,
        submittedAt,
        signatureData: payload.signatureData
      });
      const pdfUrl = buildRepairConfirmationPdfUrl(req.params.token);
      const payloadJson = JSON.stringify({
        confirmationChecks: payload.confirmationChecks,
        termsAccepted: true,
        finalConfirmationAccepted: true,
        submittedAt
      });

      await connection.query(
        `
          UPDATE repair_confirmations
          SET status = 'COMPLETED',
              confirmation_payload_json = ?,
              signature_image_path = ?,
              pdf_path = ?,
              pdf_url = ?,
              submitted_at = NOW()
          WHERE id = ?
            AND status = 'PENDING'
        `,
        [payloadJson, signaturePath, pdf.publicPath, pdfUrl, row.id]
      );

      await connection.query(
        `
          INSERT INTO repair_logs (repair_order_id, action, note)
          VALUES (?, 'repair_confirmation_completed', ?)
        `,
        [row.repairOrderId, "顧客已完成維修完成確認書簽署"]
      );

      return {
        ...row,
        status: "COMPLETED",
        confirmationPayloadJson: payloadJson,
        signatureImagePath: signaturePath,
        pdfPath: pdf.publicPath,
        pdfUrl,
        submittedAt
      };
    });

    if (confirmation.alreadyCompleted) {
      return res.json(mapConfirmation(confirmation));
    }

    notifyRepairConfirmationSubmitted({
      confirmationId: confirmation.id,
      repairOrderId: confirmation.repairOrderId,
      storeId: confirmation.storeId,
      customerName: confirmation.customerName
    }).catch((notificationError) => {
      console.warn("[notification-event] REPAIR_CONFIRMATION_SUBMITTED failed", {
        confirmationId: confirmation.id,
        message: notificationError.message
      });
    });

    return res.status(201).json({
      ...mapConfirmation(confirmation),
      message: "維修完成確認書已送出"
    });
  } catch (error) {
    return next(error);
  }
});

router.use(
  authenticate,
  requireStoreScope(),
  authorize(REPAIR_ALLOWED_ROLES),
  requireStoreFeature("repairs_enabled")
);

router.get("/repairs/:repairOrderId", async (req, res, next) => {
  try {
    const repairOrderId = Number(req.params.repairOrderId);
    const repair = await repairConfirmationService.fetchRepairForConfirmation(repairOrderId, req.storeId);
    if (!repair) {
      throw createError("找不到維修工單", 404);
    }
    const confirmation = await repairConfirmationService.fetchConfirmationByRepair(repairOrderId, req.storeId);
    const blockReason =
      repairConfirmationService.getRepairConfirmationBlockReason(repair) ||
      await getReplacementConfirmationBlockReason(repairOrderId, req.storeId);
    return res.json({
      repairOrderId,
      canSend: !blockReason,
      blockReason,
      status: confirmation?.status || "NOT_SENT",
      confirmation: confirmation ? {
        ...mapConfirmation(confirmation),
        link: repairConfirmationService.buildRepairConfirmationLink(confirmation.token),
        pdfUrl: confirmation.pdfPath ? repairConfirmationService.buildRepairConfirmationPdfUrl(confirmation.token) : confirmation.pdfUrl
      } : null
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/repairs/:repairOrderId/send", async (req, res, next) => {
  try {
    const repairOrderId = Number(req.params.repairOrderId);
    const result = await repairConfirmationService.createOrReuseRepairConfirmationForCompletedRepair(
      repairOrderId,
      req.storeId,
      req.user?.id || null,
      {
        source: "manual",
        purpose: "repair_confirmation_manual_send"
      }
    );

    if (!result.ok) {
      throw createError(result.reason || "目前無法發送維修完成確認書", 400);
    }

    return res.json({
      confirmation: result.confirmation,
      status: result.confirmation?.status || "NOT_SENT",
      link: result.confirmation?.link || null,
      lineDelivered: Boolean(result.lineDelivered),
      lineError: result.lineError || null,
      message:
        result.confirmation?.status === "COMPLETED"
          ? "此維修確認書已完成簽署"
          : result.lineDelivered
            ? "已發送維修完成確認書"
            : "已產生維修完成確認書連結"
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
