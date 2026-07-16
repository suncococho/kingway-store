const crypto = require("crypto");
const config = require("../config");
const { pool, withTransaction } = require("../db");
const { sendLineMessage } = require("../utils/line");
const { resolveStoreLineCredentials } = require("./storeLineSettingsService");
const {
  createButtonMessage,
  createUriAction
} = require("./lineWorkflowService");
const repairConfirmationContent = require("../content/repairConfirmationContent.json");
const { getReplacementConfirmationBlockReason } = require("./repairReplacementConfirmationService");
const { getTableColumns, selectColumn } = require("../utils/schema");

const COMPLETED_REPAIR_STATUSES = new Set(["completed_waiting_pickup", "picked_up", "completed"]);

function buildRepairConfirmationLink(token) {
  return `${config.frontendBaseUrl}/repair-confirm/${encodeURIComponent(token)}`;
}

function buildRepairConfirmationPdfUrl(token) {
  return `${config.frontendBaseUrl}/api/repair-confirmations/public/${encodeURIComponent(token)}/pdf`;
}

function isRepairCompleted(row) {
  const status = String(row?.status || "").trim();
  return COMPLETED_REPAIR_STATUSES.has(status) || Boolean(row?.completedAt || row?.pickedUpAt);
}

function isRepairPaymentCompleted(row) {
  if (!row?.orderId) {
    return false;
  }
  return String(row.finalPaymentStatus || "").trim() === "PAID" || Number(row.unpaidBalance || 0) <= 0;
}

function getRepairConfirmationBlockReason(row, options = {}) {
  if (!row) {
    return "找不到維修工單";
  }
  if (!isRepairCompleted(row)) {
    return "維修完成後可發送確認書";
  }
  const allowCompletionDocumentBeforePayment = Boolean(options.allowCompletionDocumentBeforePayment)
    && String(row.status || "").trim() === "completed_waiting_pickup";
  if (!allowCompletionDocumentBeforePayment && !isRepairPaymentCompleted(row)) {
    return "完成付款後自動發送維修確認書";
  }
  return "";
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

function mapConfirmation(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    repairOrderId: row.repairOrderId,
    storeId: row.storeId,
    status: row.status,
    completed: row.status === "COMPLETED",
    sentAt: row.sentAt,
    submittedAt: row.submittedAt,
    pdfPath: row.pdfPath,
    pdfUrl: row.pdfPath ? buildRepairConfirmationPdfUrl(row.token) : row.pdfUrl,
    link: row.token ? buildRepairConfirmationLink(row.token) : null
  };
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
        o.unpaid_balance AS unpaidBalance,
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

async function fetchConfirmationByRepair(repairOrderId, storeId, connection = pool, options = {}) {
  const lockClause = options.forUpdate ? "FOR UPDATE" : "";
  const [rows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        repair_order_id AS repairOrderId,
        token,
        status,
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

async function findRepairIdForPaidOrder(orderId, storeId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT ro.id AS repairOrderId
      FROM repair_orders ro
      LEFT JOIN orders o ON o.id = ? AND o.store_id = ?
      WHERE ro.store_id = ?
        AND ro.deleted_at IS NULL
        AND o.id IS NOT NULL
        AND o.deleted_at IS NULL
        AND (
          ro.order_id = ?
          OR ro.id = o.repair_order_id
        )
      ORDER BY ro.id DESC
      LIMIT 1
    `,
    [orderId, storeId, storeId, orderId]
  );
  return rows[0]?.repairOrderId || null;
}

async function sendRepairConfirmationLineMessage(repair, confirmation, options = {}) {
  if (!repair?.lineUserId || !confirmation?.link) {
    return { delivered: false, skipped: true, reason: "missing_line_user_id" };
  }

  try {
    const credentials = await resolveStoreLineCredentials({
      storeId: repair.storeId,
      purpose: options.purpose || "repair_confirmation_auto_send"
    });
    await sendLineMessage(config, repair.lineUserId, [
      createButtonMessage(
        "您的車輛維修已完成",
        [
          `維修單：#${repair.id}`,
          repair.bikeModel ? `車型：${repair.bikeModel}` : null,
          `維修金額：NT$${Number(getAmountTotal(repair) || 0).toLocaleString("zh-TW")}`,
          "您的車輛已完成維修，歡迎與門市聯絡安排取車。"
        ].filter(Boolean).join("\n"),
        [
          createUriAction("查看維修完工確認書", confirmation.link),
          createUriAction("聯絡門市", `${config.frontendBaseUrl}/store-info`)
        ]
      )
    ], {
      channelAccessToken: credentials.channelAccessToken,
      allowConfigFallback: true,
      context: {
        storeId: repair.storeId,
        storeCode: credentials.storeCode,
        purpose: options.purpose || "repair_confirmation_auto_send"
      }
    });
    return { delivered: true, skipped: false, reason: null };
  } catch (error) {
    return {
      delivered: false,
      skipped: false,
      reason: error.safeDetails || error.message || "LINE 發送失敗"
    };
  }
}

async function createOrReuseRepairConfirmationForCompletedRepair(repairOrderId, storeId, staffId = null, options = {}) {
  let repairForLine = null;
  const source = String(options.source || "auto").trim() || "auto";
  // This option only permits creating/reusing the customer-visible repair completion document/link
  // for completed_waiting_pickup repairs before payment. It must not change repair, payment,
  // pickup, order, inventory, or accounting state.
  const allowCompletionDocumentBeforePayment = Boolean(options.allowCompletionDocumentBeforePayment);

  const result = await withTransaction(async (connection) => {
    const repair = await fetchRepairForConfirmation(repairOrderId, storeId, connection, { forUpdate: true });
    repairForLine = repair;
    const blockReason = getRepairConfirmationBlockReason(repair, {
      allowCompletionDocumentBeforePayment
    });
    if (blockReason) {
      return {
        ok: false,
        reason: blockReason,
        confirmation: null,
        repair
      };
    }

    const replacementBlockReason = await getReplacementConfirmationBlockReason(repairOrderId, storeId, connection);
    if (replacementBlockReason) {
      return {
        ok: false,
        reason: replacementBlockReason,
        confirmation: null,
        repair
      };
    }

    const existing = await fetchConfirmationByRepair(repairOrderId, storeId, connection, { forUpdate: true });
    if (existing?.status === "COMPLETED") {
      return {
        ok: true,
        alreadyCompleted: true,
        reused: true,
        shouldSendLine: false,
        confirmation: mapConfirmation(existing),
        repair
      };
    }
    if (existing?.status === "PENDING") {
      const shouldTouchSentAt = !existing.sentAt;
      if (shouldTouchSentAt) {
        await connection.query(
          "UPDATE repair_confirmations SET sent_at = NOW() WHERE id = ?",
          [existing.id]
        );
      }
      await connection.query(
        `
          INSERT INTO repair_logs (repair_order_id, action, note)
          VALUES (?, 'repair_confirmation_sent', ?)
        `,
        [
          repairOrderId,
          "系統已確認維修完成確認書連結"
        ]
      );
      return {
        ok: true,
        reused: true,
        shouldSendLine: !existing.sentAt,
        confirmation: mapConfirmation({ ...existing, sentAt: shouldTouchSentAt ? new Date() : existing.sentAt }),
        repair
      };
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
        storeId,
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
        staffId || null
      ]
    );

    await connection.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'repair_confirmation_auto_created', ?)
      `,
      [repairOrderId, source === "manual" ? "已建立維修完成確認書連結" : "系統自動建立維修完成確認書連結"]
    );

    const confirmation = {
      id: insertResult.insertId,
      storeId,
      repairOrderId,
      token,
      status: "PENDING",
      pdfPath: null,
      pdfUrl: null,
      sentAt: new Date(),
      submittedAt: null,
      link: buildRepairConfirmationLink(token)
    };

    return {
      ok: true,
      created: true,
      shouldSendLine: true,
      confirmation: mapConfirmation(confirmation),
      repair
    };
  });

  if (!result.ok || result.alreadyCompleted || !result.shouldSendLine) {
    return result;
  }

  const lineResult = await sendRepairConfirmationLineMessage(repairForLine, result.confirmation, {
    purpose: options.purpose || (source === "manual" ? "repair_confirmation_manual_send" : "repair_confirmation_auto_send")
  });

  if (lineResult.delivered) {
    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'repair_confirmation_sent', ?)
      `,
      [repairOrderId, source === "manual" ? "已發送維修完成確認書 LINE 連結" : "系統已自動發送維修完成確認書 LINE 連結"]
    );
  } else if (!lineResult.skipped) {
    await pool.query(
      `
        INSERT INTO repair_logs (repair_order_id, action, note)
        VALUES (?, 'repair_confirmation_send_failed', ?)
      `,
      [repairOrderId, lineResult.reason || "LINE 發送失敗"]
    );
  }

  return {
    ...result,
    lineDelivered: lineResult.delivered,
    lineSkipped: lineResult.skipped,
    lineError: lineResult.delivered || lineResult.skipped ? null : lineResult.reason
  };
}

async function createOrReuseRepairConfirmationForPaidOrder(orderId, storeId, staffId = null, options = {}) {
  const repairOrderId = await findRepairIdForPaidOrder(orderId, storeId);
  if (!repairOrderId) {
    return { ok: false, reason: "找不到已連結的維修工單", confirmation: null };
  }
  return createOrReuseRepairConfirmationForCompletedRepair(repairOrderId, storeId, staffId, {
    ...options,
    source: options.source || "payment_completed"
  });
}

module.exports = {
  buildRepairConfirmationLink,
  buildRepairConfirmationPdfUrl,
  createOrReuseRepairConfirmationForCompletedRepair,
  createOrReuseRepairConfirmationForPaidOrder,
  fetchConfirmationByRepair,
  fetchRepairForConfirmation,
  getRepairConfirmationBlockReason,
  isRepairCompleted,
  isRepairPaymentCompleted,
  mapConfirmation
};
