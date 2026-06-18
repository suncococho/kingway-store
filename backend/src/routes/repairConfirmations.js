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
const repairConfirmationContent = require("../content/repairConfirmationContent.json");

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
  const [rows] = await connection.query(
    `
      SELECT
        ro.id,
        ro.store_id AS storeId,
        ro.customer_id AS customerId,
        ro.status,
        ro.bike_model AS bikeModel,
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
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        repair_order_id AS repairOrderId,
        customer_id AS customerId,
        token,
        status,
        customer_name_snapshot AS customerNameSnapshot,
        customer_phone_snapshot AS customerPhoneSnapshot,
        vehicle_model_snapshot AS vehicleModelSnapshot,
        issue_snapshot AS issueSnapshot,
        repair_summary_snapshot AS repairSummarySnapshot,
        amount_total_snapshot AS amountTotalSnapshot,
        payment_status_snapshot AS paymentStatusSnapshot,
        terms_version AS termsVersion,
        confirmation_payload_json AS confirmationPayloadJson,
        signature_image_path AS signatureImagePath,
        pdf_path AS pdfPath,
        pdf_url AS pdfUrl,
        sent_at AS sentAt,
        submitted_at AS submittedAt
      FROM repair_confirmations
      WHERE repair_order_id = ?
        AND store_id = ?
      LIMIT 1
      ${lockClause}
    `,
    [repairOrderId, storeId]
  );
  return rows[0] || null;
}

async function fetchConfirmationByToken(token, connection = pool, options = {}) {
  const lockClause = options.forUpdate ? "FOR UPDATE" : "";
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        repair_order_id AS repairOrderId,
        customer_id AS customerId,
        token,
        status,
        customer_name_snapshot AS customerNameSnapshot,
        customer_phone_snapshot AS customerPhoneSnapshot,
        vehicle_model_snapshot AS vehicleModelSnapshot,
        issue_snapshot AS issueSnapshot,
        repair_summary_snapshot AS repairSummarySnapshot,
        amount_total_snapshot AS amountTotalSnapshot,
        payment_status_snapshot AS paymentStatusSnapshot,
        terms_version AS termsVersion,
        confirmation_payload_json AS confirmationPayloadJson,
        signature_image_path AS signatureImagePath,
        pdf_path AS pdfPath,
        pdf_url AS pdfUrl,
        sent_at AS sentAt,
        submitted_at AS submittedAt
      FROM repair_confirmations
      WHERE token = ?
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
    const repair = await fetchRepairForConfirmation(repairOrderId, req.storeId);
    if (!repair) {
      throw createError("找不到維修工單", 404);
    }
    const confirmation = await fetchConfirmationByRepair(repairOrderId, req.storeId);
    return res.json({
      repairOrderId,
      canSend: isRepairCompleted(repair),
      status: confirmation?.status || "NOT_SENT",
      confirmation: mapConfirmation(confirmation)
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/repairs/:repairOrderId/send", async (req, res, next) => {
  try {
    const repairOrderId = Number(req.params.repairOrderId);
    let createdOrExisting = null;
    let repairForLine = null;

    const confirmation = await withTransaction(async (connection) => {
      const repair = await fetchRepairForConfirmation(repairOrderId, req.storeId, connection, { forUpdate: true });
      if (!repair) {
        throw createError("找不到維修工單", 404);
      }
      if (!isRepairCompleted(repair)) {
        throw createError("維修完成後可發送確認書", 400);
      }
      repairForLine = repair;

      const existing = await fetchConfirmationByRepair(repairOrderId, req.storeId, connection, { forUpdate: true });
      if (existing?.status === "COMPLETED") {
        return existing;
      }
      if (existing?.status === "PENDING") {
        await connection.query(
          "UPDATE repair_confirmations SET sent_at = NOW() WHERE id = ?",
          [existing.id]
        );
        await connection.query(
          `
            INSERT INTO repair_logs (repair_order_id, action, note)
            VALUES (?, 'repair_confirmation_sent', ?)
          `,
          [repairOrderId, "已重新發送維修完成確認書連結"]
        );
        return { ...existing, sentAt: new Date() };
      }

      const token = crypto.randomBytes(32).toString("hex");
      const repairSummary = getRepairSummary(repair);
      const amountTotal = getAmountTotal(repair);
      const paymentStatus = getPaymentStatus(repair);
      const [insertResult] = await connection.query(
        `
          INSERT INTO repair_confirmations (
            store_id,
            repair_order_id,
            customer_id,
            token,
            status,
            customer_name_snapshot,
            customer_phone_snapshot,
            vehicle_model_snapshot,
            issue_snapshot,
            repair_summary_snapshot,
            amount_total_snapshot,
            payment_status_snapshot,
            terms_version,
            sent_at,
            created_by_staff_id
          )
          VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
        `,
        [
          req.storeId,
          repairOrderId,
          repair.customerId,
          token,
          repair.customerName,
          repair.customerPhone,
          repair.bikeModel,
          repair.issueDescription,
          repairSummary,
          amountTotal,
          paymentStatus,
          repairConfirmationContent.termsVersion,
          req.user?.id || null
        ]
      );

      await connection.query(
        `
          INSERT INTO repair_logs (repair_order_id, action, note)
          VALUES (?, 'repair_confirmation_sent', ?)
        `,
        [repairOrderId, "已發送維修完成確認書連結"]
      );

      return {
        id: insertResult.insertId,
        storeId: req.storeId,
        repairOrderId,
        customerId: repair.customerId,
        token,
        status: "PENDING",
        customerNameSnapshot: repair.customerName,
        customerPhoneSnapshot: repair.customerPhone,
        vehicleModelSnapshot: repair.bikeModel,
        issueSnapshot: repair.issueDescription,
        repairSummarySnapshot: repairSummary,
        amountTotalSnapshot: amountTotal,
        paymentStatusSnapshot: paymentStatus,
        termsVersion: repairConfirmationContent.termsVersion,
        sentAt: new Date()
      };
    });

    createdOrExisting = mapConfirmation(confirmation);

    let lineDelivered = false;
    let lineError = null;
    if (confirmation.status !== "COMPLETED" && repairForLine?.lineUserId) {
      try {
        const credentials = await resolveStoreLineCredentials({
          storeId: req.storeId,
          purpose: "repair_confirmation_send"
        });
        await sendLineMessage(config, repairForLine.lineUserId, [
          createButtonMessage(
            "維修完成確認書",
            "您好，您的車輛維修已完成。請點選下方連結確認本次維修內容並完成簽名。",
            [createUriAction("簽署維修確認書", createdOrExisting.link)]
          )
        ], {
          channelAccessToken: credentials.channelAccessToken,
          allowConfigFallback: true,
          context: {
            storeId: req.storeId,
            storeCode: credentials.storeCode,
            purpose: "repair_confirmation_send"
          }
        });
        lineDelivered = true;
      } catch (sendError) {
        lineError = sendError.safeDetails || sendError.message || "LINE 發送失敗";
      }
    }

    return res.json({
      confirmation: createdOrExisting,
      status: confirmation.status,
      link: createdOrExisting?.link || null,
      lineDelivered,
      lineError,
      message:
        confirmation.status === "COMPLETED"
          ? "此維修確認書已完成簽署"
          : lineDelivered
            ? "已發送維修完成確認書"
            : "已產生維修完成確認書連結"
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
