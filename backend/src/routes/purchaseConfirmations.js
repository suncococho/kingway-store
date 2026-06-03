const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { requireStoreFeature } = require("../middleware/storeFeature");
const {
  SOURCE,
  createPublicStoreContextMiddleware,
  resolvePublicStoreContext: resolvePublicStoreContextHelper
} = require("../utils/publicStoreResolver");
const {
  PURCHASE_CONFIRMATION_PDF_PUBLIC_PREFIX,
  writePurchaseConfirmationPdf
} = require("../services/pdfService");
const config = require("../config");
const purchaseConfirmationContent = require("../content/purchaseConfirmationContent.json");
const { sendLineMessage } = require("../utils/line");
const { createError } = require("../utils/errors");
const { logKpi } = require("../services/kpiService");
const {
  createButtonMessage,
  createConfirmTemplate,
  createFlexMessage,
  createPostbackAction,
  createUriAction,
  createPurchaseConfirmationForOrder,
  logWorkflowEvent,
  sendToGroups
} = require("../services/lineWorkflowService");

const router = express.Router();
const resolvePublicStoreContext = createPublicStoreContextMiddleware({
  db: pool,
  legacyFallbackMode: SOURCE.LEGACY_KINGWAY_FALLBACK,
  legacyFallbackStoreId: 1,
  legacyFallbackAllowUnverifiedStore: true
});
const storageRoot = path.join(__dirname, "..", "..", "storage");
const PURCHASE_CONFIRMATION_DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function getRequestedPublicStoreCode(req) {
  return String(req.query?.store || req.query?.storeCode || req.query?.store_code || "").trim();
}

function appendStoreQuery(url, storeCode) {
  const normalizedUrl = String(url || "").trim();
  const normalizedStoreCode = String(storeCode || "").trim();
  if (!normalizedUrl || !normalizedStoreCode) {
    return normalizedUrl;
  }

  const separator = normalizedUrl.includes("?") ? "&" : "?";
  return `${normalizedUrl}${separator}store=${encodeURIComponent(normalizedStoreCode)}`;
}

async function resolveRequestedPublicStoreContext(req) {
  const requestedStoreCode = getRequestedPublicStoreCode(req);
  if (!requestedStoreCode) {
    return null;
  }

  return resolvePublicStoreContextHelper(req, {
    db: pool,
    allowQueryStoreCode: true,
    legacyFallbackMode: null,
    logResolved: false,
    logUnresolved: false,
    purpose: "purchase_confirmation_public"
  });
}

async function assertPurchaseConfirmationStoreMatch(req, tokenRow) {
  const requestedStoreCode = getRequestedPublicStoreCode(req);
  if (!requestedStoreCode) {
    return null;
  }

  const storeContext = await resolveRequestedPublicStoreContext(req);
  if (!storeContext?.storeId) {
    throw createError("找不到有效的門市資訊", 404);
  }

  if (Number(storeContext.storeId) !== Number(tokenRow?.storeId)) {
    throw createError("找不到購買確認連結", 404);
  }

  return storeContext;
}

function createPurchaseConfirmationPdfAccessToken({ confirmationId, storeId, scope = "staff_download" }) {
  const normalizedConfirmationId = Number(confirmationId);
  const normalizedStoreId = Number(storeId);
  if (!Number.isSafeInteger(normalizedConfirmationId) || normalizedConfirmationId <= 0) {
    throw new Error("Invalid purchase confirmation id for PDF download token");
  }
  if (!Number.isSafeInteger(normalizedStoreId) || normalizedStoreId <= 0) {
    throw new Error("Invalid store id for PDF download token");
  }

  return jwt.sign(
    {
      type: "purchase_confirmation_pdf_download",
      confirmationId: normalizedConfirmationId,
      storeId: normalizedStoreId,
      scope
    },
    config.jwtSecret,
    { expiresIn: PURCHASE_CONFIRMATION_DOWNLOAD_TOKEN_TTL_SECONDS }
  );
}

function verifyPurchaseConfirmationPdfAccessToken(token, options = {}) {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const confirmationId = Number(decoded?.confirmationId);
    const storeId = Number(decoded?.storeId);
    const scope = String(decoded?.scope || "").trim();
    const allowedScopes = Array.isArray(options.allowedScopes) && options.allowedScopes.length
      ? options.allowedScopes.map((value) => String(value || "").trim())
      : null;

    if (decoded?.type !== "purchase_confirmation_pdf_download") {
      return null;
    }
    if (!Number.isSafeInteger(confirmationId) || confirmationId <= 0) {
      return null;
    }
    if (!Number.isSafeInteger(storeId) || storeId <= 0) {
      return null;
    }
    if (!scope) {
      return null;
    }
    if (allowedScopes && !allowedScopes.includes(scope)) {
      return null;
    }
    if (options.expectedConfirmationId && confirmationId !== Number(options.expectedConfirmationId)) {
      return null;
    }
    if (options.expectedStoreId && storeId !== Number(options.expectedStoreId)) {
      return null;
    }

    return { confirmationId, storeId, scope };
  } catch (error) {
    return null;
  }
}

function buildPurchaseConfirmationPdfUrl(token) {
  return `${config.frontendBaseUrl}/api/purchase-confirmations/public/${token}/pdf`;
}

function buildStaffPurchaseConfirmationPdfUrl(confirmationId, storeId) {
  const accessToken = createPurchaseConfirmationPdfAccessToken({
    confirmationId,
    storeId,
    scope: "staff_download"
  });
  return `${config.frontendBaseUrl}/api/purchase-confirmations/download/${encodeURIComponent(accessToken)}`;
}

function buildManualPurchaseConfirmationPdfUrl(id, storeId) {
  const accessToken = createPurchaseConfirmationPdfAccessToken({
    confirmationId: id,
    storeId,
    scope: "manual_download"
  });
  return `${config.frontendBaseUrl}/api/purchase-confirmations/manual/${id}/pdf?access=${encodeURIComponent(accessToken)}`;
}

function resolvePublicStoragePath(publicPath) {
  if (!publicPath || !publicPath.startsWith(PURCHASE_CONFIRMATION_PDF_PUBLIC_PREFIX)) {
    return null;
  }

  return path.join(storageRoot, publicPath.replace(/^\/files\//, ""));
}

async function fetchPurchaseConfirmationPdfRecordById(confirmationId, storeId = null, options = {}) {
  const normalizedConfirmationId = Number(confirmationId);
  if (!Number.isSafeInteger(normalizedConfirmationId) || normalizedConfirmationId <= 0) {
    return null;
  }

  const params = [normalizedConfirmationId];
  const whereClauses = ["pc.id = ?"];
  if (options.manualOnly) {
    whereClauses.push("pc.token IS NULL");
  }
  if (storeId !== null && storeId !== undefined) {
    params.push(Number(storeId));
    whereClauses.push("pc.store_id = ?");
  }

  const [rows] = await pool.query(
    `
      SELECT
        pc.id,
        pc.token,
        pc.status,
        pc.store_id AS storeId,
        pc.order_id AS orderId,
        pc.pdf_path AS pdfPath,
        o.order_no AS orderNo
      FROM purchase_confirmations pc
      LEFT JOIN orders o ON o.id = pc.order_id AND o.store_id = pc.store_id
      WHERE ${whereClauses.join(" AND ")}
      LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

async function fetchPurchaseConfirmationPdfRecordByToken(token, storeId) {
  const [rows] = await pool.query(
    `
      SELECT
        pc.id,
        pc.token,
        pc.status,
        pc.store_id AS storeId,
        pc.order_id AS orderId,
        pc.pdf_path AS pdfPath,
        o.order_no AS orderNo
      FROM purchase_confirmations pc
      INNER JOIN orders o ON o.id = pc.order_id AND o.store_id = pc.store_id
      WHERE pc.token = ?
        AND pc.store_id = ?
      LIMIT 1
    `,
    [token, storeId]
  );

  return rows[0] || null;
}

function sendPurchaseConfirmationPdfFile(res, confirmation, fileName) {
  const absolutePath = resolvePublicStoragePath(confirmation?.pdfPath);
  if (!confirmation || confirmation.status !== "COMPLETED" || !absolutePath || !fs.existsSync(absolutePath)) {
    throw createError("找不到 PDF", 404);
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  return res.sendFile(absolutePath);
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateSelectedItems(selectedItems, allowedItems, errorMessage) {
  const normalized = Array.isArray(selectedItems) ? selectedItems.filter((item) => allowedItems.includes(item)) : [];
  if (normalized.length !== allowedItems.length) {
    throw createError(errorMessage, 400);
  }
  return normalized;
}

function stringifyUtf8SafeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("utf8");
}

function toUtf8SafeText(value) {
  return Buffer.from(String(value || ""), "utf8").toString("utf8");
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function optionalStaffStoreContext(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded?.type === "platform_admin") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const storeId = decoded.storeId ?? decoded.store_id ?? null;
    if (!storeId) {
      return next();
    }

    req.user = decoded;
    req.user.role = String(req.user.role || "").toUpperCase().trim();
    req.storeId = storeId;
    req.store_id = storeId;
    req.storeRole = decoded.storeRole ?? null;
    req.store_role = req.storeRole;
    return next();
  } catch (error) {
    return next();
  }
}

function getPurchaseConfirmationStoreId(req) {
  const resolved = Number(req.storeId || req.publicStoreContext?.storeId || 1);
  return Number.isSafeInteger(resolved) && resolved > 0 ? resolved : 1;
}

function normalizePhoneForMatch(value) {
  let phone = String(value || "").replace(/[\s\-.()]/g, "");
  if (phone.startsWith("+886")) {
    phone = `0${phone.slice(4)}`;
  } else if (phone.startsWith("886")) {
    phone = `0${phone.slice(3)}`;
  }
  return phone;
}

function sqlNormalizedPhone(columnName) {
  const withoutFormatting = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${columnName}, ' ', ''), '-', ''), '.', ''), '(', ''), ')', '')`;
  return `
    CASE
      WHEN ${withoutFormatting} LIKE '+886%' THEN CONCAT('0', SUBSTRING(${withoutFormatting}, 5))
      WHEN ${withoutFormatting} LIKE '886%' THEN CONCAT('0', SUBSTRING(${withoutFormatting}, 4))
      ELSE ${withoutFormatting}
    END
  `;
}

function isChecked(value) {
  return value === true || value === "true" || value === "1" || value === "✓" || value === "已確認";
}

function addManualChecklistIfChecked(reqBody, fieldName, checklistValue, selectedItems) {
  if (isChecked(reqBody[fieldName])) {
    selectedItems.push(checklistValue);
  }
}

function normalizeManualPurchaseConfirmationPayload(body) {
  const deliveryChecks = [];
  const staffExplanations = [];

  addManualChecklistIfChecked(body, "外觀無損", "外觀無損", deliveryChecks);
  addManualChecklistIfChecked(body, "功能正常", "功能正常", deliveryChecks);
  addManualChecklistIfChecked(body, "配件齊全", "配件齊全", deliveryChecks);
  addManualChecklistIfChecked(body, "規格相符", "規格相符", deliveryChecks);
  addManualChecklistIfChecked(body, "使用方法", "使用方法", staffExplanations);
  addManualChecklistIfChecked(body, "保固範圍", "保固範圍與期限（1 年）", staffExplanations);
  addManualChecklistIfChecked(body, "保養方法", "日常維護與保養方法", staffExplanations);
  addManualChecklistIfChecked(body, "法規說明", "臺灣電動自行車相關法規及速度限制", staffExplanations);
  addManualChecklistIfChecked(body, "安全事項", "騎乘安全注意事項", staffExplanations);

  return {
    buyerName: String(body["姓名"] || body.buyerName || "").trim(),
    buyerPhone: String(body["電話"] || body.buyerPhone || "").trim(),
    buyerIdNumber: String(body["身份證"] || body.buyerIdNumber || "").trim(),
    deliveryChecks,
    staffExplanations,
    termsAccepted: isChecked(body["條款同意"]),
    finalConfirmationAccepted: isChecked(body["最終確認"]),
    signatureData: body["簽名圖片"] || body.signatureData || ""
  };
}

async function findManualPurchaseConfirmationMatch(phone, storeId) {
  const normalizedPhone = normalizePhoneForMatch(phone);
  if (!normalizedPhone) {
    return { normalizedPhone, customer: null, order: null };
  }

  const normalizedCustomerPhone = sqlNormalizedPhone("c.phone");
  const normalizedOrderCustomerPhone = sqlNormalizedPhone("o.customer_phone");

  const [orders] = await pool.query(
    `
      SELECT
        o.id AS orderId,
        o.order_no AS orderNo,
        COALESCE(o.customer_id, c.id) AS customerId,
        COALESCE(c.name, o.customer_name) AS customerName,
        COALESCE(c.phone, o.customer_phone) AS customerPhone,
        o.store_id AS storeId,
        MAX(CASE WHEN oi.product_category_snapshot = 'EB' THEN 1 ELSE 0 END) AS hasEbike,
        MAX(CASE WHEN oi.product_category_snapshot IS NOT NULL THEN 1 ELSE 0 END) AS hasCategoryData
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
        AND c.store_id = o.store_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
        AND oi.store_id = o.store_id
      WHERE o.store_id = ?
        AND (
          (${normalizedCustomerPhone}) = ?
          OR (${normalizedOrderCustomerPhone}) = ?
        )
      GROUP BY o.id, o.order_no, o.customer_id, c.id, c.name, c.phone, o.customer_name, o.customer_phone, o.store_id, o.created_at
      ORDER BY
        CASE
          WHEN MAX(CASE WHEN oi.product_category_snapshot = 'EB' THEN 1 ELSE 0 END) = 1 THEN 0
          WHEN MAX(CASE WHEN oi.product_category_snapshot IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 1
          ELSE 2
        END,
        o.created_at DESC,
        o.id DESC
      LIMIT 1
    `,
    [storeId, normalizedPhone, normalizedPhone]
  );

  if (orders[0]) {
    return {
      normalizedPhone,
      customer: orders[0].customerId
        ? { id: orders[0].customerId, name: orders[0].customerName, phone: orders[0].customerPhone, storeId: orders[0].storeId }
        : null,
      order: orders[0]
    };
  }

  const normalizedStandaloneCustomerPhone = sqlNormalizedPhone("phone");
  const [customers] = await pool.query(
    `
      SELECT id, name, phone, store_id AS storeId
      FROM customers
      WHERE store_id = ?
        AND (${normalizedStandaloneCustomerPhone}) = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [storeId, normalizedPhone]
  );

  return {
    normalizedPhone,
    customer: customers[0] || null,
    order: null
  };
}

function buildPurchaseConfirmationSnapshot({
  orderNo,
  customerName,
  customerPhone,
  buyerName,
  buyerPhone,
  buyerIdNumber,
  deliveryChecks,
  staffExplanations,
  submittedAt
}) {
  return JSON.stringify({
    title: "KINGWAY 購買確認書",
    orderNo,
    customerName,
    customerPhone,
    buyerName,
    buyerPhone,
    buyerIdNumber,
    deliveryChecks,
    staffExplanations,
    terms: purchaseConfirmationContent.terms,
    finalStatement: purchaseConfirmationContent.finalStatement,
    submittedAt
  });
}

router.get("/public/:token", async (req, res, next) => {
  try {
    const tokenRow = await fetchPurchaseConfirmationToken(req.params.token);
    if (!tokenRow) {
      throw createError("找不到購買確認連結", 404);
    }
    const storeContext = await assertPurchaseConfirmationStoreMatch(req, tokenRow);

    const [items] = await pool.query(
      `
        SELECT product_name_snapshot AS productName, quantity, unit_price AS unitPrice, line_total AS lineTotal
        FROM order_items
        WHERE order_id = ?
          AND store_id = ?
      `,
      [tokenRow.orderId, tokenRow.storeId]
    );

    const [confirmationRows] = await pool.query(
      `
        SELECT
          buyer_name AS buyerName,
          buyer_phone AS buyerPhone,
          buyer_id_number AS buyerIdNumber,
          delivery_checks_json AS deliveryChecksJson,
          staff_explanations_json AS staffExplanationsJson,
          terms_accepted AS termsAccepted,
          final_confirmation_accepted AS finalConfirmationAccepted,
          signature_data AS signatureData,
          html_snapshot AS htmlSnapshot
        FROM purchase_confirmations
        WHERE token = ?
          AND store_id = ?
        LIMIT 1
      `,
      [req.params.token, tokenRow.storeId]
    );

    const existing = confirmationRows[0] || null;

    return res.json({
      orderId: tokenRow.orderId,
      customerId: tokenRow.customerId,
      storeId: tokenRow.storeId,
      storeCode: storeContext?.storeCode || null,
      customerName: tokenRow.customerName,
      customerPhone: tokenRow.customerPhone,
      orderNo: tokenRow.orderNo,
      expiresAt: tokenRow.expiresAt,
      usedAt: tokenRow.usedAt,
      items,
      buyerName: existing?.buyerName || tokenRow.customerName || "",
      buyerPhone: existing?.buyerPhone || tokenRow.customerPhone || "",
      buyerIdNumber: existing?.buyerIdNumber || "",
      deliveryChecks: parseJsonArray(existing?.deliveryChecksJson),
      staffExplanations: parseJsonArray(existing?.staffExplanationsJson),
      termsAccepted: Boolean(existing?.termsAccepted),
      finalConfirmationAccepted: Boolean(existing?.finalConfirmationAccepted),
      signatureData: existing?.signatureData || "",
      htmlSnapshot: existing?.htmlSnapshot || null,
      content: purchaseConfirmationContent
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/public/:token/pdf", async (req, res, next) => {
  try {
    const tokenRow = await fetchPurchaseConfirmationToken(req.params.token);
    if (!tokenRow) {
      throw createError("找不到 PDF", 404);
    }
    await assertPurchaseConfirmationStoreMatch(req, tokenRow);

    const confirmation = await fetchPurchaseConfirmationPdfRecordByToken(req.params.token, tokenRow.storeId);
    return sendPurchaseConfirmationPdfFile(
      res,
      confirmation,
      `purchase-confirmation-${confirmation?.orderNo || confirmation?.id || "document"}.pdf`
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/manual/:id/pdf", optionalStaffStoreContext, async (req, res, next) => {
  try {
    const confirmationId = Number(req.params.id);
    const accessToken = String(req.query.access || "").trim();
    const verifiedAccess = accessToken
      ? verifyPurchaseConfirmationPdfAccessToken(accessToken, {
          expectedConfirmationId: confirmationId,
          allowedScopes: ["manual_download", "staff_download"]
        })
      : null;
    const staffStoreId = Number(req.storeId || 0) || null;

    if (!verifiedAccess && !staffStoreId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scopedStoreId = verifiedAccess?.storeId || staffStoreId;
    const confirmation = await fetchPurchaseConfirmationPdfRecordById(confirmationId, scopedStoreId, {
      manualOnly: true
    });
    return sendPurchaseConfirmationPdfFile(
      res,
      confirmation,
      `purchase-confirmation-manual-${confirmation?.id || confirmationId}.pdf`
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/download/:accessToken", async (req, res, next) => {
  try {
    const verifiedAccess = verifyPurchaseConfirmationPdfAccessToken(req.params.accessToken, {
      allowedScopes: ["staff_download", "manual_download"]
    });
    if (!verifiedAccess) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const confirmation = await fetchPurchaseConfirmationPdfRecordById(
      verifiedAccess.confirmationId,
      verifiedAccess.storeId
    );
    return sendPurchaseConfirmationPdfFile(
      res,
      confirmation,
      `purchase-confirmation-${confirmation?.orderNo || confirmation?.id || verifiedAccess.confirmationId}.pdf`
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/public/:token", async (req, res, next) => {
  try {
    const {
      buyerName,
      buyerPhone,
      buyerIdNumber,
      deliveryChecks,
      staffExplanations,
      termsAccepted,
      finalConfirmationAccepted,
      signatureData
    } = req.body;
    if (!String(buyerName || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerName, 400);
    }
    if (!String(buyerPhone || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerPhone, 400);
    }
    if (!String(buyerIdNumber || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerIdNumber, 400);
    }
    if (!signatureData) {
      throw createError(purchaseConfirmationContent.errors.signatureData, 400);
    }
    const confirmedDeliveryChecks = validateSelectedItems(
      deliveryChecks,
      purchaseConfirmationContent.deliveryChecks,
      purchaseConfirmationContent.errors.deliveryChecks
    );
    const confirmedStaffExplanations = validateSelectedItems(
      staffExplanations,
      purchaseConfirmationContent.staffExplanations,
      purchaseConfirmationContent.errors.staffExplanations
    );
    if (!termsAccepted) {
      throw createError(purchaseConfirmationContent.errors.termsAccepted, 400);
    }
    if (!finalConfirmationAccepted) {
      throw createError(purchaseConfirmationContent.errors.finalConfirmationAccepted, 400);
    }

    const tokenRow = await fetchPurchaseConfirmationToken(req.params.token);
    if (!tokenRow) {
      throw createError("找不到購買確認連結", 404);
    }
    const storeContext = await assertPurchaseConfirmationStoreMatch(req, tokenRow);

    if (tokenRow.usedAt) {
      throw createError("此購買確認連結已使用", 409);
    }

    const submittedAt = new Date().toISOString();
    const snapshot = buildPurchaseConfirmationSnapshot({
      orderNo: tokenRow.orderNo,
      customerName: tokenRow.customerName,
      customerPhone: tokenRow.customerPhone,
      buyerName: String(buyerName).trim(),
      buyerPhone: String(buyerPhone).trim(),
      buyerIdNumber: String(buyerIdNumber).trim(),
      deliveryChecks: confirmedDeliveryChecks,
      staffExplanations: confirmedStaffExplanations,
      submittedAt
    });

    const confirmation = await withTransaction(async (connection) => {
      const [existingRows] = await connection.query(
        `
          SELECT id
          FROM purchase_confirmations
          WHERE token = ?
            AND store_id = ?
          LIMIT 1
        `,
        [req.params.token, tokenRow.storeId]
      );

      let confirmationId;
      if (existingRows[0]) {
        confirmationId = existingRows[0].id;
        await connection.query(
          `
            UPDATE purchase_confirmations
            SET
              buyer_name = ?,
              buyer_phone = ?,
              buyer_id_number = ?,
              delivery_checks_json = ?,
              staff_explanations_json = ?,
              terms_accepted = 1,
              final_confirmation_accepted = 1,
              signature_data = ?,
              html_snapshot = ?,
              confirmed_by_line_user_id = ?,
              submitted_at = NOW(),
              status = 'COMPLETED'
            WHERE id = ?
              AND store_id = ?
          `,
          [
            String(buyerName).trim(),
            String(buyerPhone).trim(),
            String(buyerIdNumber).trim(),
            JSON.stringify(confirmedDeliveryChecks),
            JSON.stringify(confirmedStaffExplanations),
            signatureData,
            snapshot,
            tokenRow.lineUserId || null,
            confirmationId,
            tokenRow.storeId
          ]
        );
      } else {
        const [insertResult] = await connection.query(
          `
            INSERT INTO purchase_confirmations (
              token,
              order_id,
              customer_id,
              buyer_name,
              buyer_phone,
              buyer_id_number,
              status,
              delivery_checks_json,
              staff_explanations_json,
              terms_accepted,
              final_confirmation_accepted,
              signature_data,
              html_snapshot,
              confirmed_by_line_user_id,
              submitted_at,
              store_id
            )
            VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, 1, 1, ?, ?, ?, NOW(), ?)
          `,
          [
            req.params.token,
            tokenRow.orderId,
            tokenRow.customerId,
            String(buyerName).trim(),
            String(buyerPhone).trim(),
            String(buyerIdNumber).trim(),
            JSON.stringify(confirmedDeliveryChecks),
            JSON.stringify(confirmedStaffExplanations),
            signatureData,
            snapshot,
            tokenRow.lineUserId || null,
            tokenRow.storeId
          ]
        );
        confirmationId = insertResult.insertId;
      }

      await connection.query(
        `
          UPDATE purchase_confirmation_tokens
          SET used_at = NOW()
          WHERE id = ?
        `,
        [tokenRow.id]
      );

      await connection.query(
        `
          UPDATE purchase_confirmations
          SET status = 'CANCELED'
          WHERE order_id = ?
            AND id <> ?
            AND status = 'PENDING'
            AND store_id = ?
        `,
        [tokenRow.orderId, confirmationId, tokenRow.storeId]
      );

      return {
        id: confirmationId,
        orderId: tokenRow.orderId,
        customerId: tokenRow.customerId,
        orderNo: tokenRow.orderNo,
        customerName: String(buyerName).trim(),
        customerPhone: String(buyerPhone).trim(),
        buyerIdNumber: String(buyerIdNumber).trim(),
        deliveryChecks: confirmedDeliveryChecks,
        staffExplanations: confirmedStaffExplanations,
        htmlSnapshot: snapshot
      };
    });

    const pdf = await writePurchaseConfirmationPdf({
      confirmationId: confirmation.id,
      orderNo: confirmation.orderNo,
      customerName: confirmation.customerName,
      customerPhone: confirmation.customerPhone,
      buyerIdNumber: confirmation.buyerIdNumber,
      deliveryChecks: confirmation.deliveryChecks,
      staffExplanations: confirmation.staffExplanations,
      submittedAt,
      signatureData
    });

    await pool.query(
      `
        UPDATE purchase_confirmations
        SET pdf_path = ?
        WHERE id = ?
            AND store_id = ?
      `,
      [pdf.publicPath, confirmation.id, tokenRow.storeId]
    );

    await logKpi(null, "PURCHASE_CONFIRMATION_COMPLETED", "PURCHASE_CONFIRMATION", confirmation.id, 5);
    await sendToGroups(["admin", "staff"], [
      createConfirmTemplate(
        "購買確認書已完成",
        `訂單：${confirmation.orderNo}\n客戶：${confirmation.customerName}\n請確認交車或查看 PDF。`,
        [
          createPostbackAction("確認交車", "purchase_handover_confirm", confirmation.orderId),
          createUriAction("查看 PDF", buildPurchaseConfirmationPdfUrl(req.params.token))
        ]
      )
    ]);
    await logWorkflowEvent("purchase_confirmation_completed", "PURCHASE_CONFIRMATION", confirmation.id, {
      orderId: confirmation.orderId
    });

    return res.status(201).json({
      id: confirmation.id,
      pdfPath: pdf.publicPath,
      pdfUrl: appendStoreQuery(buildPurchaseConfirmationPdfUrl(req.params.token), storeContext?.storeCode),
      htmlSnapshot: confirmation.htmlSnapshot,
      message: "購買確認書已送出"
    });
  } catch (error) {
    return next(error);
  }
});


router.post("/line/latest-order", optionalStaffStoreContext, resolvePublicStoreContext, async (req, res, next) => {
  try {
    const crypto = require("crypto");
    const storeId = getPurchaseConfirmationStoreId(req);
    const lineUserId = String(req.body.lineUserId || "").trim();
    const displayName = String(req.body.displayName || "").trim();

    if (!lineUserId) {
      return res.status(400).json({ message: "缺少 LINE 使用者資料" });
    }

    const [[customer]] = await pool.query(
      `
        SELECT id, name, phone, line_user_id AS lineUserId
        FROM customers
        WHERE line_user_id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [lineUserId, storeId]
    );

    if (!customer || !customer.phone) {
      return res.status(404).json({ message: "尚未完成電話綁定，請先回 LINE 完成電話綁定。" });
    }

    if (displayName && (!customer.name || customer.name === "LINE 客戶" || customer.name === "LINE ??")) {
      await pool.query(
        "UPDATE customers SET name = ? WHERE id = ? AND store_id = ?",
        [displayName, customer.id, storeId]
      );
      customer.name = displayName;
    }

    const [[order]] = await pool.query(
      `
        SELECT id, customer_id AS customerId, customer_phone AS customerPhone
        FROM orders
        WHERE store_id = ?
          AND (customer_id = ? OR customer_phone = ?)
        ORDER BY id DESC
        LIMIT 1
      `,
      [storeId, customer.id, customer.phone]
    );

    if (!order) {
      return res.status(404).json({ message: "尚未找到可建立購買確認書的訂單。" });
    }

    await createPurchaseConfirmationForOrder(order.id, pool, { storeId });

    let [[tokenRow]] = await pool.query(
      `
        SELECT pct.token
        FROM purchase_confirmation_tokens pct
        INNER JOIN orders o ON o.id = pct.order_id
        WHERE pct.order_id = ?
          AND o.store_id = ?
          AND pct.used_at IS NULL
          AND pct.expires_at >= NOW()
        ORDER BY pct.id DESC
        LIMIT 1
      `,
      [order.id, storeId]
    );

    if (!tokenRow?.token) {
      const token = crypto.randomBytes(24).toString("hex");

      await pool.query(
        `
          INSERT INTO purchase_confirmation_tokens (token, order_id, customer_id, expires_at)
          VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
        `,
        [token, order.id, order.customerId || customer.id]
      );

      await pool.query(
        `
          UPDATE purchase_confirmations
          SET token = ?
          WHERE order_id = ?
            AND store_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
        [token, order.id, storeId]
      );

      tokenRow = { token };
    }

    return res.json({
      ok: true,
      orderId: order.id,
      token: tokenRow.token,
      url: `/purchase-confirm/${tokenRow.token}`
    });
  } catch (error) {
    return next(error);
  }
});



router.post("/manual", optionalStaffStoreContext, resolvePublicStoreContext, async (req, res, next) => {
  try {
    const {
      buyerName,
      buyerPhone,
      buyerIdNumber,
      deliveryChecks,
      staffExplanations,
      termsAccepted,
      finalConfirmationAccepted,
      signatureData
    } = normalizeManualPurchaseConfirmationPayload(req.body);

    if (!String(buyerName || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerName, 400);
    }
    if (!String(buyerPhone || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerPhone, 400);
    }
    if (!String(buyerIdNumber || "").trim()) {
      throw createError(purchaseConfirmationContent.errors.buyerIdNumber, 400);
    }
    if (!signatureData) {
      throw createError(purchaseConfirmationContent.errors.signatureData, 400);
    }

    const confirmedDeliveryChecks = validateSelectedItems(
      deliveryChecks,
      purchaseConfirmationContent.deliveryChecks,
      purchaseConfirmationContent.errors.deliveryChecks
    );
    const confirmedStaffExplanations = validateSelectedItems(
      staffExplanations,
      purchaseConfirmationContent.staffExplanations,
      purchaseConfirmationContent.errors.staffExplanations
    );
    if (!termsAccepted) {
      throw createError(purchaseConfirmationContent.errors.termsAccepted, 400);
    }
    if (!finalConfirmationAccepted) {
      throw createError(purchaseConfirmationContent.errors.finalConfirmationAccepted, 400);
    }

    const storeId = getPurchaseConfirmationStoreId(req);
    const match = await findManualPurchaseConfirmationMatch(buyerPhone, storeId);
    const matchedOrder = match.order;
    const matchedCustomer = match.customer;
    const matchedOrderNo = matchedOrder?.orderNo || null;
    const matchedCustomerName = matchedCustomer?.name || buyerName;
    const matchedCustomerPhone = matchedCustomer?.phone || buyerPhone;

    const submittedAt = new Date().toISOString();
    const snapshot = toUtf8SafeText(buildPurchaseConfirmationSnapshot({
      orderNo: matchedOrderNo || "MANUAL",
      customerName: matchedCustomerName,
      customerPhone: matchedCustomerPhone,
      buyerName: String(buyerName).trim(),
      buyerPhone: String(buyerPhone).trim(),
      buyerIdNumber: String(buyerIdNumber).trim(),
      deliveryChecks: confirmedDeliveryChecks,
      staffExplanations: confirmedStaffExplanations,
      submittedAt
    }));

    const [insertResult] = await pool.query(
      `
        INSERT INTO purchase_confirmations (
          token,
          order_id,
          customer_id,
          buyer_name,
          buyer_phone,
          buyer_id_number,
          status,
          delivery_checks_json,
          staff_explanations_json,
          terms_accepted,
          final_confirmation_accepted,
          signature_data,
          html_snapshot,
          submitted_at,
          store_id
        )
        VALUES (NULL, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, 1, 1, ?, ?, NOW(), ?)
      `,
      [
        matchedOrder?.orderId || null,
        matchedCustomer?.id || null,
        String(buyerName).trim(),
        String(buyerPhone).trim(),
        String(buyerIdNumber).trim(),
        stringifyUtf8SafeJson(confirmedDeliveryChecks),
        stringifyUtf8SafeJson(confirmedStaffExplanations),
        signatureData,
        snapshot,
        storeId
      ]
    );

    const pdf = await writePurchaseConfirmationPdf({
      confirmationId: insertResult.insertId,
      orderNo: matchedOrderNo || "MANUAL",
      customerName: String(buyerName).trim(),
      customerPhone: String(buyerPhone).trim(),
      buyerIdNumber: String(buyerIdNumber).trim(),
      deliveryChecks: confirmedDeliveryChecks,
      staffExplanations: confirmedStaffExplanations,
      submittedAt,
      signatureData
    });

    await pool.query(
      `
        UPDATE purchase_confirmations
        SET pdf_path = ?
        WHERE id = ?
          AND store_id = ?
      `,
      [pdf.publicPath, insertResult.insertId, storeId]
    );

    await logWorkflowEvent("manual_purchase_confirmation_completed", "PURCHASE_CONFIRMATION", insertResult.insertId, {
      source: "manual_public_page",
      matched: Boolean(matchedOrder || matchedCustomer),
      matchedOrderId: matchedOrder?.orderId || null,
      matchedCustomerId: matchedCustomer?.id || null,
      normalizedPhone: match.normalizedPhone
    });

    return res.status(201).json({
      id: insertResult.insertId,
      matched: Boolean(matchedOrder || matchedCustomer),
      matchStatus: matchedOrder ? "matched_order" : matchedCustomer ? "matched_customer" : "unmatched",
      orderId: matchedOrder?.orderId || null,
      customerId: matchedCustomer?.id || null,
      pdfPath: pdf.publicPath,
      pdfUrl: buildManualPurchaseConfirmationPdfUrl(insertResult.insertId, storeId),
      htmlSnapshot: snapshot,
      message: "購買確認書已送出"
    });
  } catch (error) {
    return next(error);
  }
});

router.use(
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER"]),
  requireStoreFeature("purchase_confirmations_enabled")
);

router.get("/", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [rows] = await pool.query(
      `
        SELECT
          pc.id,
          pc.token,
          pc.status,
          pc.store_id AS storeId,
          pc.order_id AS orderId,
          pc.customer_id AS customerId,
          pc.buyer_name AS buyerName,
          pc.buyer_phone AS buyerPhone,
          pc.buyer_id_number AS buyerIdNumber,
          pc.delivery_checks_json AS deliveryChecksJson,
          pc.staff_explanations_json AS staffExplanationsJson,
          pc.terms_accepted AS termsAccepted,
          pc.final_confirmation_accepted AS finalConfirmationAccepted,
          pc.signature_data AS signatureData,
          pc.html_snapshot AS htmlSnapshot,
          pc.pdf_path AS pdfPath,
          pc.submitted_at AS submittedAt,
          pc.created_at AS createdAt,
          pc.confirmed_by_line_user_id AS confirmedByLineUserId,
          COALESCE(c.name, pc.buyer_name) AS customerName,
          COALESCE(c.phone, pc.buyer_phone) AS customerPhone,
          COALESCE(o.order_no, 'MANUAL') AS orderNo
        FROM purchase_confirmations pc
        LEFT JOIN customers c ON c.id = pc.customer_id AND c.store_id = ?
        LEFT JOIN orders o ON o.id = pc.order_id AND o.store_id = ?
        WHERE (pc.store_id = ? OR o.store_id = ? OR c.store_id = ?)
        ORDER BY pc.id DESC
      `,
      [storeId, storeId, storeId, storeId, storeId]
    );

    return res.json(
      rows.map((row) => ({
        ...row,
        deliveryChecks: parseJsonArray(row.deliveryChecksJson),
        staffExplanations: parseJsonArray(row.staffExplanationsJson),
        pdfUrl: row.pdfPath ? (row.token ? buildPurchaseConfirmationPdfUrl(row.token) : buildStaffPurchaseConfirmationPdfUrl(row.id, row.storeId)) : null
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/pending-links", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const [pendingRows] = await pool.query(
      `
        SELECT
          pc.id,
          pc.token,
          pc.status,
          pc.order_id AS order_id,
          pc.customer_id AS customer_id,
          pc.created_at AS created_at,
          pc.submitted_at AS submitted_at,
          pct.expires_at AS expires_at,
          c.name AS customer_name
        FROM purchase_confirmations pc
        LEFT JOIN customers c ON c.id = pc.customer_id AND c.store_id = ?
        LEFT JOIN orders o ON o.id = pc.order_id AND o.store_id = ?
        LEFT JOIN purchase_confirmation_tokens pct ON pct.token = pc.token
        WHERE pc.status = 'PENDING'
          AND (pc.store_id = ? OR o.store_id = ? OR c.store_id = ?)
        ORDER BY pc.created_at DESC
      `,
      [storeId, storeId, storeId, storeId, storeId]
    );

    const pending = pendingRows.map((row) => ({
      ...row,
      orderId: row.order_id,
      customerId: row.customer_id,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      expiresAt: row.expires_at,
      customerName: row.customer_name,
      link: row.token ? `${config.frontendBaseUrl}/purchase-confirm/${row.token}` : null
    }));

    return res.json({ pending });
  } catch (error) {
    return next(error);
  }
});

router.post("/generate-link", async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const customerId = Number(req.body.customerId);
    if (!customerId) {
      throw createError("customerId 為必填欄位", 400);
    }

    const [rows] = await pool.query(
      `
        SELECT
          o.id AS orderId,
          o.order_no AS orderNo,
          c.id AS customerId,
          c.name AS customerName,
          c.phone AS customerPhone,
          c.line_user_id AS lineUserId,
          GROUP_CONCAT(DISTINCT p.id ORDER BY p.id) AS matchedProductIds,
          GROUP_CONCAT(DISTINCT p.category ORDER BY p.category) AS matchedProductCategories
        FROM orders o
        INNER JOIN customers c ON c.id = o.customer_id AND c.store_id = ?
        INNER JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = ?
        INNER JOIN products p ON p.id = oi.product_id AND p.store_id = ?
        WHERE c.id = ?
          AND o.store_id = ?
          AND o.status = 'COMPLETED'
          AND o.final_payment_status = 'PAID'
          AND (oi.product_category_snapshot IN ('EB', 'EBIKE') OR p.category IN ('EB', 'EBIKE'))
        GROUP BY o.id, o.order_no, c.id, c.name, c.phone, c.line_user_id
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 1
      `,
      [storeId, storeId, storeId, customerId, storeId]
    );

    const order = rows[0];
    if (!order) {
      throw createError("找不到已完款的電動自行車訂單", 404);
    }
    const confirmation = await createPurchaseConfirmationForOrder(order.orderId, pool, { storeId });
    if (!confirmation) {
      throw createError("找不到可用的購買確認書連結", 404);
    }

    if (confirmation.lineUserId && confirmation.link && config.line.channelAccessToken) {
      await sendLineMessage(config, confirmation.lineUserId, [
        {
          type: "text",
          text: [
            "您的電動自行車購買確認書已建立。",
            "請點擊下方連結完成確認與簽名：",
            confirmation.link
          ].join("\n")
        }
      ]);
      await pool.query(
        `
          UPDATE orders
          SET purchase_confirmation_sent_at = COALESCE(purchase_confirmation_sent_at, NOW())
          WHERE id = ?
            AND store_id = ?
        `,
        [confirmation.orderId, storeId]
      );
    }

    return res.status(201).json({
      token: confirmation.token,
      link: confirmation.link,
      orderId: order.orderId,
      customerId: order.customerId,
      status: "PENDING",
      debug: {
        matchedOrderId: order.orderId,
        matchedProductIds: order.matchedProductIds ? order.matchedProductIds.split(",").map((value) => Number(value)) : [],
        matchedProductCategories: order.matchedProductCategories ? order.matchedProductCategories.split(",") : []
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const confirmationId = Number(req.params.id);
    const confirmation = await fetchPurchaseConfirmationPdfRecordById(confirmationId, req.storeId);
    return sendPurchaseConfirmationPdfFile(
      res,
      confirmation,
      `purchase-confirmation-${confirmation?.orderNo || confirmation?.id || confirmationId}.pdf`
    );
  } catch (error) {
    return next(error);
  }
});

async function fetchPurchaseConfirmationToken(token) {
  const [rows] = await pool.query(
    `
      SELECT
        pct.id,
        pct.token,
        pct.order_id AS orderId,
        pct.customer_id AS customerId,
        pct.expires_at AS expiresAt,
        pct.used_at AS usedAt,
        o.store_id AS storeId,
        c.name AS customerName,
        c.phone AS customerPhone,
        c.line_user_id AS lineUserId,
        o.order_no AS orderNo
      FROM purchase_confirmation_tokens pct
      INNER JOIN orders o ON o.id = pct.order_id
      INNER JOIN customers c ON c.id = pct.customer_id AND c.store_id = o.store_id
      WHERE pct.token = ?
      LIMIT 1
    `,
    [token]
  );

  return rows[0];
}

module.exports = router;
