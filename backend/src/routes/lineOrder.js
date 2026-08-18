const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { pool, withTransaction } = require("../db");
const { BOT_NOTIFY, sendTelegramMessage } = require("../services/telegramService");
const { logWorkflowEvent } = require("../services/lineWorkflowService");
const config = require("../config");
const { notifyOrderReservationCreated, buildOrderDetailLink } = require("../services/staffLineNotify");
const { notifyLineOrderCreated } = require("../services/notificationEventService");
const {
  getLineOrderOptionConfig,
  validateLineOrderOptionSelections
} = require("../services/lineOrderOptionService");
const {
  SOURCE,
  createPublicStoreContextMiddleware,
  getStoreCodeFromRequest
} = require("../utils/publicStoreResolver");

const router = express.Router();
const LINE_ORDER_DUPLICATE_WINDOW_MINUTES = 10;
const resolvePublicStoreContext = createPublicStoreContextMiddleware({
  db: pool,
  allowQueryStoreCode: true,
  allowBodyStoreCode: true,
  legacyFallbackMode: SOURCE.LEGACY_KINGWAY_FALLBACK,
  legacyFallbackStoreId: 1,
  legacyFallbackAllowUnverifiedStore: true
});

function getRequestedStoreCode(req) {
  return getStoreCodeFromRequest(req, {
    allowQueryStoreCode: true,
    allowBodyStoreCode: true
  });
}

function resolveLineOrderStoreContext(req) {
  const requestedStoreCode = getRequestedStoreCode(req);
  const publicContext = req.publicStoreContext || null;

  if (requestedStoreCode) {
    const resolvedStoreId = Number(publicContext?.storeId || 0);
    if (
      Number.isSafeInteger(resolvedStoreId) &&
      resolvedStoreId > 0 &&
      publicContext?.source === SOURCE.STORE_CODE &&
      publicContext?.storeCode === requestedStoreCode &&
      publicContext?.legacyFallbackUsed !== true
    ) {
      return {
        ok: true,
        storeId: resolvedStoreId,
        storeCode: publicContext.storeCode
      };
    }

    return {
      ok: false,
      status: 404,
      message: "找不到有效的門市代碼"
    };
  }

  const resolved = Number(req.publicStoreContext?.storeId || 1);
  return {
    ok: true,
    storeId: Number.isSafeInteger(resolved) && resolved > 0 ? resolved : 1,
    storeCode: null
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

function getDisplayNameOrFallback(profileName, fallbackName = "LINE 客戶") {
  const normalizedProfile = normalizeText(profileName);
  return normalizedProfile || normalizeText(fallbackName) || "LINE 客戶";
}

function buildRepairQuoteConfirmationLink(repairId) {
  return `${config.frontendBaseUrl}/line-progress?tab=repair&repairId=${encodeURIComponent(repairId)}`;
}

function buildRepairConfirmationLink(token) {
  return `${config.frontendBaseUrl}/repair-confirm/${encodeURIComponent(token)}`;
}

function buildRepairConfirmationPdfUrl(token) {
  return `${config.frontendBaseUrl}/api/repair-confirmations/public/${encodeURIComponent(token)}/pdf`;
}

function buildPurchaseConfirmationLink(token) {
  return `/purchase-confirm/${encodeURIComponent(token)}`;
}

function mapLineProgressQuoteStatus(row) {
  const response = String(row?.customerEstimateResponse || "").trim();
  const quoteStatus = String(row?.quoteStatus || "").trim();
  const status = String(row?.status || "").trim();
  const amount = Number(row?.estimateAmount || 0);

  if (response === "approved" || quoteStatus === "approved") return "APPROVED";
  if (response === "rejected" || quoteStatus === "rejected" || status === "estimate_rejected") return "REJECTED";
  if (row?.quoteConfirmationFailedAt) return "FAILED";
  if (response === "pending" && (quoteStatus === "sent" || status === "estimate_pending_approval" || row?.estimateSentAt || amount > 0)) return "PENDING";
  return "NONE";
}

function mapLineProgressRepairConfirmationStatus(row) {
  const status = String(row?.repairConfirmationStatus || row?.repairConfirmationStatusRaw || "").trim().toUpperCase();
  if (status === "PENDING" || status === "COMPLETED" || status === "CANCELED") {
    return status;
  }
  return "NONE";
}

function buildLineCustomerPendingActions({ repairs = [], purchaseConfirmations = [] }) {
  const actions = [];

  repairs.forEach((repair) => {
    if (repair.quoteStatus === "PENDING" || repair.quoteStatus === "FAILED") {
      actions.push({
        type: "REPAIR_QUOTE",
        title: repair.quoteStatus === "FAILED" ? "維修報價通知失敗，請確認報價" : "維修報價待確認",
        description: `維修單 #${repair.id}，報價 NT$ ${Number(repair.estimateAmount || 0).toLocaleString()}`,
        url: `/line-progress?tab=repair&repairId=${encodeURIComponent(repair.id)}`,
        priority: "HIGH",
        buttonLabel: "立即確認",
        refId: repair.id
      });
    }

    if (repair.repairConfirmationStatus === "PENDING" && repair.repairConfirmationLink) {
      actions.push({
        type: "REPAIR_CONFIRMATION",
        title: "維修完成確認書待簽署",
        description: `維修單 #${repair.id}`,
        url: repair.repairConfirmationLink,
        priority: "HIGH",
        buttonLabel: "前往簽署",
        refId: repair.id
      });
    }
  });

  purchaseConfirmations.forEach((confirmation) => {
    if (!confirmation.token) {
      return;
    }
    actions.push({
      type: "PURCHASE_CONFIRMATION",
      title: "購買確認書待簽署",
      description: confirmation.orderNo ? `訂單 ${confirmation.orderNo}` : `確認書 #${confirmation.id}`,
      url: buildPurchaseConfirmationLink(confirmation.token),
      priority: "HIGH",
      buttonLabel: "前往簽署",
      refId: confirmation.orderId || confirmation.id
    });
  });

  return actions.slice(0, 10);
}

function buildMysqlLockName(prefix, parts) {
  const hash = crypto
    .createHash("sha256")
    .update(parts.map((part) => normalizeText(part)).join("|"))
    .digest("hex")
    .slice(0, 40);
  return `${prefix}:${hash}`;
}

async function withMysqlRequestLock(lockName, handler) {
  const connection = await pool.getConnection();
  let locked = false;

  try {
    const [[lockResult]] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    locked = Number(lockResult?.acquired || 0) === 1;
    if (!locked) {
      const error = new Error("請勿重複送出，系統正在處理您的請求");
      error.statusCode = 409;
      throw error;
    }

    return await handler();
  } finally {
    if (locked) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch (releaseError) {
        console.warn("[line-order] release mysql lock failed", {
          lockName,
          message: releaseError.message
        });
      }
    }
    connection.release();
  }
}

async function findRecentDuplicateLineOrder(tx, { storeId, customerId, lineUserId, phone, productId, optionProductIds = [] }) {
  const identityConditions = [];
  const identityParams = [];
  const normalizedLineUserId = normalizeText(lineUserId);
  const normalizedPhone = normalizeText(phone);

  if (normalizedLineUserId) {
    identityConditions.push("c.line_user_id = ?");
    identityParams.push(normalizedLineUserId);
  }

  if (normalizedPhone) {
    identityConditions.push("COALESCE(o.customer_phone, c.phone) = ?");
    identityParams.push(normalizedPhone);
  }

  if (Number.isSafeInteger(Number(customerId)) && Number(customerId) > 0) {
    identityConditions.push("o.customer_id = ?");
    identityParams.push(Number(customerId));
  }

  if (!identityConditions.length) {
    return null;
  }

  const normalizedOptionProductIds = Array.isArray(optionProductIds)
    ? optionProductIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0).sort((a, b) => a - b)
    : [];

  const [rows] = await tx.query(
    `
      SELECT
        o.id AS orderId,
        o.order_no AS orderNo,
        o.total_amount AS totalAmount,
        o.customer_id AS customerId,
        o.customer_name AS customerName,
        COALESCE(o.customer_phone, c.phone) AS customerPhone,
        c.line_user_id AS lineUserId
      FROM orders o
      INNER JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
      LEFT JOIN customers c ON c.id = o.customer_id AND c.store_id = o.store_id
      WHERE o.store_id = ?
        AND o.deleted_at IS NULL
        AND UPPER(COALESCE(o.status, '')) NOT IN ('CANCELED', 'CANCELLED', 'DELETED', 'VOID')
        AND (o.source = 'line_order' OR o.order_no LIKE 'LINE-%' OR o.customer_type = 'LINE')
        AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND oi.product_id = ?
        AND (${identityConditions.join(" OR ")})
      ORDER BY o.id DESC
      LIMIT 5
    `,
    [
      storeId,
      LINE_ORDER_DUPLICATE_WINDOW_MINUTES,
      productId,
      ...identityParams
    ]
  );

  if (!normalizedOptionProductIds.length) {
    return rows[0] || null;
  }

  for (const row of rows) {
    const [optionRows] = await tx.query(
      `
        SELECT product_id AS productId
        FROM order_items
        WHERE store_id = ?
          AND order_id = ?
          AND line_option_group_id IS NOT NULL
        ORDER BY product_id ASC
      `,
      [storeId, row.orderId]
    );
    const existingOptionProductIds = optionRows.map((item) => Number(item.productId)).sort((a, b) => a - b);
    if (JSON.stringify(existingOptionProductIds) === JSON.stringify(normalizedOptionProductIds)) {
      return row;
    }
  }

  return null;
}

router.use(resolvePublicStoreContext);

router.get("/customer", async (req, res, next) => {
  try {
    const storeContext = resolveLineOrderStoreContext(req);
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const storeId = storeContext.storeId;
    const lineUserId = String(req.query.lineUserId || "").trim();
    const displayName = String(req.query.displayName || "").trim();

    if (!lineUserId) {
      return res.json({ customer: null });
    }

    const [[customer]] = await pool.query(
      `
        SELECT
          id,
          name,
          phone,
          line_user_id AS lineUserId
        FROM customers
        WHERE line_user_id = ?
          AND store_id = ?
        LIMIT 1
      `,
      [lineUserId, storeId]
    );

    if (!customer) {
      const fallbackName = displayName || "LINE 客戶";
      const [created] = await pool.query(
        `
        INSERT INTO customers (name, line_user_id, line_display_name, crm_stage, last_contact_at, store_id)
        VALUES (?, ?, ?, 'new_line_friend', NOW(), ?)
        `,
        [fallbackName, lineUserId, fallbackName, storeId]
      );

      const newCustomer = {
        id: created.insertId,
        name: fallbackName,
        phone: null,
        lineUserId
      };

      return res.json({ customer: newCustomer, orders: [], repairs: [] });
    }

    if (displayName) {
      const resolvedDisplayName = getDisplayNameOrFallback(displayName);
      const updates = ["line_display_name = ?"];
      const params = [resolvedDisplayName];
      if (isPlaceholderCustomerName(customer.name) && resolvedDisplayName !== customer.name) {
        updates.unshift("name = ?");
        params.unshift(resolvedDisplayName);
      }
      await pool.query(
        `
          UPDATE customers
          SET ${updates.join(", ")}
          WHERE id = ? AND store_id = ?
        `,
        [...params, customer.id, storeId]
      );
      if (isPlaceholderCustomerName(customer.name) && customer.name !== resolvedDisplayName) {
        customer.name = resolvedDisplayName;
      }
    }

    const [orders] = await pool.query(
      `SELECT
         id,
         order_no AS orderNo,
         total_amount AS totalAmount,
         deposit_amount AS depositAmount,
         unpaid_balance AS unpaidBalance,
         final_payment_status AS finalPaymentStatus,
         payment_method AS paymentMethod,
         status,
         business_date AS businessDate,
         notes
        FROM orders
       WHERE (customer_id = ? OR customer_phone = ?)
         AND store_id = ?
         AND deleted_at IS NULL
       ORDER BY id DESC
       LIMIT 20`,
      [customer.id, customer.phone, storeId]
    );

    const [repairs] = await pool.query(
      `SELECT
         ro.id,
         ro.bike_model AS bikeModel,
         ro.issue_description AS issueDescription,
         ro.status,
         ro.reservation_date AS reservationDate,
         ro.estimate_amount AS estimateAmount,
         ro.estimate_details AS estimateDescription,
         ro.quote_notes AS estimateNote,
         ro.quote_status AS quoteStatusRaw,
         ro.customer_estimate_response AS customerEstimateResponse,
         ro.customer_estimate_responded_at AS customerEstimateRespondedAt,
         ro.estimate_sent_at AS estimateSentAt,
         ro.inspection_fee AS inspectionFee,
         ro.parts_fee AS partsFee,
         ro.labor_fee AS laborFee,
         ro.storage_fee AS storageFee,
         ro.completed_at AS completedAt,
         ro.picked_up_at AS pickedUpAt,
         o.status AS orderStatus,
         o.final_payment_status AS finalPaymentStatus,
         qcs.created_at AS quoteConfirmationSentAt,
         qcf.created_at AS quoteConfirmationFailedAt,
         qca.created_at AS quoteApprovedAt,
         qcr.created_at AS quoteRejectedAt,
         qca.note AS quoteApprovedNote,
         qcr.note AS quoteRejectedNote,
         rc.status AS repairConfirmationStatusRaw,
         rc.token AS repairConfirmationToken,
         rc.sent_at AS repairConfirmationSentAt,
         rc.submitted_at AS repairConfirmationSubmittedAt,
         rc.pdf_path AS repairConfirmationPdfPath,
         rc.pdf_url AS repairConfirmationPdfUrlRaw
       FROM repair_orders ro
       LEFT JOIN orders o ON o.id = ro.order_id AND o.store_id = ro.store_id
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
         SELECT repair_order_id, MAX(created_at) AS created_at, MAX(note) AS note
         FROM repair_logs
         WHERE action IN ('quote_approved_by_customer_from_progress', 'customer_estimate_approved')
         GROUP BY repair_order_id
       ) qca ON qca.repair_order_id = ro.id
       LEFT JOIN (
         SELECT repair_order_id, MAX(created_at) AS created_at, MAX(note) AS note
         FROM repair_logs
         WHERE action IN ('quote_rejected_by_customer_from_progress', 'customer_estimate_rejected')
         GROUP BY repair_order_id
       ) qcr ON qcr.repair_order_id = ro.id
       LEFT JOIN repair_confirmations rc ON rc.repair_order_id = ro.id AND rc.store_id = ro.store_id
       WHERE ro.customer_id = ?
         AND ro.store_id = ?
         AND ro.deleted_at IS NULL
         AND (ro.order_id IS NULL OR (o.id IS NOT NULL AND o.deleted_at IS NULL))
       ORDER BY ro.id DESC
       LIMIT 20`,
      [customer.id, storeId]
    );

    const mappedRepairs = repairs.map((repair) => {
      const quoteStatus = mapLineProgressQuoteStatus(repair);
      const repairConfirmationStatus = mapLineProgressRepairConfirmationStatus(repair);
      const quoteConfirmationLink = buildRepairQuoteConfirmationLink(repair.id);
      const quoteApprovalSource =
        String(repair.quoteApprovedNote || repair.quoteRejectedNote || "").includes("LINE_CUSTOMER")
          ? "LINE_CUSTOMER"
          : repair.quoteApprovedAt || repair.quoteRejectedAt
            ? "UNKNOWN"
            : null;

      return {
        ...repair,
        quoteStatus,
        quoteConfirmationStatus: repair.quoteConfirmationSentAt ? "SENT" : repair.quoteConfirmationFailedAt ? "FAILED" : "NOT_SENT",
        quoteConfirmationWarning: repair.quoteConfirmationFailedAt ? "LINE 報價通知發送失敗，但您仍可在此確認報價。" : "",
        quoteConfirmationLink,
        quoteApprovedAt: repair.customerEstimateResponse === "approved" ? repair.customerEstimateRespondedAt || repair.quoteApprovedAt : null,
        quoteRejectedAt: repair.customerEstimateResponse === "rejected" ? repair.customerEstimateRespondedAt || repair.quoteRejectedAt : null,
        quoteApprovalSource,
        repairConfirmationStatus,
        repairConfirmationLink: repairConfirmationStatus === "PENDING" && repair.repairConfirmationToken ? buildRepairConfirmationLink(repair.repairConfirmationToken) : null,
        repairConfirmationPdfUrl: repairConfirmationStatus === "COMPLETED" && repair.repairConfirmationToken
          ? repair.repairConfirmationPdfPath
            ? buildRepairConfirmationPdfUrl(repair.repairConfirmationToken)
            : repair.repairConfirmationPdfUrlRaw || null
          : null
      };
    });

    const [pendingPurchaseConfirmations] = await pool.query(
      `
        SELECT
          pc.id,
          pc.order_id AS orderId,
          pc.customer_id AS customerId,
          pc.token,
          pc.status,
          pc.created_at AS createdAt,
          o.order_no AS orderNo
        FROM purchase_confirmations pc
        LEFT JOIN orders o ON o.id = pc.order_id AND o.store_id = pc.store_id
        WHERE pc.store_id = ?
          AND pc.status = 'PENDING'
          AND pc.token IS NOT NULL
          AND (pc.order_id IS NULL OR (o.id IS NOT NULL AND o.deleted_at IS NULL))
          AND (
            pc.customer_id = ?
            OR o.customer_id = ?
            OR o.customer_phone = ?
          )
        ORDER BY pc.id DESC
        LIMIT 10
      `,
      [storeId, customer.id, customer.id, customer.phone]
    );

    const pendingActions = buildLineCustomerPendingActions({
      repairs: mappedRepairs,
      purchaseConfirmations: pendingPurchaseConfirmations
    });

    return res.json({ customer, orders, repairs: mappedRepairs, pendingActions });
  } catch (error) {
    return next(error);
  }
});

router.get("/ebikes", async (req, res, next) => {
  try {
    const storeContext = resolveLineOrderStoreContext(req);
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const storeId = storeContext.storeId;
    const [rows] = await pool.query(`
      SELECT id, sku, name, price, stock, image_url AS imageUrl
      FROM products
      WHERE category = 'EB'
        AND is_active = 1
        AND store_id = ?
      ORDER BY id DESC
      LIMIT 50
    `, [storeId]);
    return res.json(rows);
  } catch (error) {
    console.error("[line-order/create failed]", error);
    return res.status(500).json({ message: error.message || "LINE order create failed" });
  }
});

router.get("/options", async (req, res, next) => {
  try {
    const storeContext = resolveLineOrderStoreContext(req);
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const config = await getLineOrderOptionConfig(pool, storeContext.storeId, { customerMode: true });
    return res.json(config);
  } catch (error) {
    return next(error);
  }
});

router.post("/create", async (req, res, next) => {
  try {
    const storeContext = resolveLineOrderStoreContext(req);
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const storeId = storeContext.storeId;
    const { lineUserId, productId, name, phone, displayName, optionSelections } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "請選擇商品" });
    }

    const effectiveLineUserId = lineUserId || `WEB-GUEST-${Date.now()}`;
    const lockIdentity = normalizeText(lineUserId) || normalizeText(phone) || effectiveLineUserId;
    const lockName = buildMysqlLockName("line_order", [storeId, lockIdentity]);

    const result = await withMysqlRequestLock(lockName, () => withTransaction(async (tx) => {
      const [customerRows] = await tx.query(
        `SELECT id, name, phone, line_user_id AS lineUserId
         FROM customers
         WHERE line_user_id = ?
           AND store_id = ?
         LIMIT 1
         FOR UPDATE`,
        [effectiveLineUserId, storeId]
      );

      let customer = customerRows[0];

      if (!customer) {
        if (!phone) {
          return { needPhoneBinding: true, message: "請先填寫電話，才能建立訂單" };
        }

        const fallbackName = getDisplayNameOrFallback(displayName || name, "LINE 客戶");
        const [created] = await tx.query(
          `INSERT INTO customers (name, phone, line_user_id, line_display_name, customer_type, store_id)
           VALUES (?, ?, ?, ?, 'LINE', ?)`,
          [fallbackName, phone, effectiveLineUserId, fallbackName, storeId]
        );

        customer = {
          id: created.insertId,
          name: fallbackName,
          phone,
          lineUserId: effectiveLineUserId
        };
      }

      if (!customer.phone && !phone) {
        return { needPhoneBinding: true, message: "請先填寫電話，才能建立訂單" };
      }

      if (phone && customer.phone !== phone) {
        const resolvedDisplayName = getDisplayNameOrFallback(displayName || name, customer.name);
        const shouldUpdateName = displayName && isPlaceholderCustomerName(customer.name) && resolvedDisplayName !== customer.name;

        await tx.query(
          `UPDATE customers SET name = ?, phone = ?, line_display_name = ? WHERE id = ? AND store_id = ?`,
          [
            shouldUpdateName ? resolvedDisplayName : (name || customer.name),
            phone,
            resolvedDisplayName,
            customer.id,
            storeId
          ]
        );
        customer.phone = phone;
        if (shouldUpdateName) {
          customer.name = resolvedDisplayName;
        }
      }

      const [productRows] = await tx.query(
        `SELECT id, sku, name, category, price, stock
         FROM products
         WHERE id = ?
           AND store_id = ?
           AND category IN ('EB', 'EBIKE')
           AND is_active = 1
         LIMIT 1`,
        [productId, storeId]
      );

      const product = productRows[0];
      if (!product) {
        console.error("[line-order] product not found", { productId });
        return { error: true, message: "找不到可購買的電動自行車商品" };
      }

      const optionValidation = await validateLineOrderOptionSelections(tx, storeId, optionSelections);
      const optionItems = optionValidation.items || [];
      const optionTotalAmount = optionItems.reduce((sum, item) => sum + Number(item.unitPrice || 0), 0);

      const duplicateOrder = await findRecentDuplicateLineOrder(tx, {
        storeId,
        customerId: customer.id,
        lineUserId: customer.lineUserId || effectiveLineUserId,
        phone: customer.phone || phone,
        productId: product.id,
        optionProductIds: optionItems.map((item) => item.productId)
      });

      if (duplicateOrder) {
        return {
          ok: true,
          reusedExisting: true,
          duplicate: true,
          message: "預約已建立，請勿重複送出。",
          orderId: duplicateOrder.orderId,
          orderNo: duplicateOrder.orderNo,
          customer: {
            id: duplicateOrder.customerId || customer.id,
            name: duplicateOrder.customerName || customer.name || name || "LINE 客戶",
            phone: duplicateOrder.customerPhone || customer.phone || phone,
            lineUserId: duplicateOrder.lineUserId || customer.lineUserId || effectiveLineUserId
          },
          product,
          totalAmount: duplicateOrder.totalAmount
        };
      }

      const unitPrice = Number(product.price || 0);
      const coupon = null;
      const discount = 0;
      const totalAmount = Math.max(unitPrice + optionTotalAmount - discount, 0);
      const orderNo = `LINE-${dayjs().format("YYYYMMDD-HHmmss-SSS")}`;

      const [staffRows] = await tx.query(
        `SELECT id FROM staff_users WHERE is_active = 1 AND store_id = ? ORDER BY id ASC LIMIT 1`,
        [storeId]
      );
      const staffRow = staffRows[0];
      if (!staffRow) {
        throw Object.assign(new Error("找不到可用店員"), { statusCode: 500 });
      }
      const staffId = staffRow.id;

      const [orderResult] = await tx.query(
        `INSERT INTO orders
         (store_id, order_no, customer_id, customer_name, customer_phone, customer_type,
          total_amount, payment_method, status, is_reservation_order,
          deposit_amount, unpaid_balance, final_payment_status, final_paid_at,
          notes, created_by, business_date, order_type, source)
         VALUES
         (?, ?, ?, ?, ?, 'LINE',
          ?, 'OTHER', 'PENDING_CONFIRM', 1,
          0, ?, 'UNPAID', NULL,
          ?, ?, CURDATE(), 'GENERAL', 'line_order')`,
        [
          storeId,
          orderNo,
          customer.id,
          customer.name || name || "LINE 客戶",
          customer.phone || phone,
          totalAmount,
          totalAmount,
          [`LINE 自助訂車｜商品：${product.name}`, optionValidation.summary ? `選配：${optionValidation.summary}` : null].filter(Boolean).join("｜"),
          staffId
        ]
      );

      await tx.query(
        `INSERT INTO order_items
         (store_id, order_id, product_id, sku_snapshot, product_name_snapshot,
          product_category_snapshot, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          storeId,
          orderResult.insertId,
          product.id,
          product.sku,
          product.name,
          product.category,
          unitPrice,
          unitPrice
        ]
      );

      for (const optionItem of optionItems) {
        await tx.query(
          `INSERT INTO order_items
           (store_id, order_id, product_id, sku_snapshot, product_name_snapshot,
            product_category_snapshot, quantity, unit_price, line_total,
            line_option_group_id, line_option_group_code, line_option_group_label)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [
            storeId,
            orderResult.insertId,
            optionItem.productId,
            optionItem.sku,
            optionItem.name,
            optionItem.category,
            optionItem.unitPrice,
            optionItem.unitPrice,
            optionItem.groupId,
            optionItem.groupCode,
            optionItem.groupLabel
          ]
        );
      }

      return {
        ok: true,
        orderId: orderResult.insertId,
        orderNo,
        customer,
        product,
        options: optionItems,
        coupon,
        discount,
        totalAmount
      };
    }));

    const responsePayload = result;

    if (responsePayload?.ok && !responsePayload.reusedExisting) {
      setImmediate(async () => {
        try {
          await sendTelegramMessage(
            BOT_NOTIFY,
            "-5280460882",
            [
              "🛒 LINE 新訂單",
              `訂單：${responsePayload.orderNo}`,
              `客戶：${responsePayload.customer?.name || "-"}`,
              `電話：${responsePayload.customer?.phone || "-"}`,
              `商品：${responsePayload.product?.name || "-"}`,
              responsePayload.options?.length ? `選配：${responsePayload.options.map((item) => `${item.groupLabel} ${item.name}`).join("、")}` : null,
              `庫存：${Number(responsePayload.product?.stock || 0) > 0 ? "現貨 " + responsePayload.product.stock + " 台" : "缺貨可預約"}`,
              `金額：NT$ ${responsePayload.totalAmount || 0}`,
              "狀態：LINE 預約單 / 待門市確認 / 待付款",
              "",
              `查看 / 編輯訂單：${process.env.FRONTEND_BASE_URL || "https://pos.kingway.tw"}/orders/${responsePayload.orderId}/edit`
            ].filter(Boolean).join("\n"),
            [
              { type: "postback", label: "✅ 確認訂單", data: `line_order:confirm:${responsePayload.orderId}` },
              { type: "postback", label: "❌ 拒絕", data: `line_order:reject:${responsePayload.orderId}` }
            ]
          );
        } catch (error) {
          console.error("[line-order telegram notify failed]", error.message);
        }
      });
    }

    if (responsePayload?.ok && !responsePayload.reusedExisting) {
      setImmediate(async () => {
        await notifyLineOrderCreated({
          orderId: responsePayload.orderId,
          orderNo: responsePayload.orderNo,
          storeId,
          customerName: responsePayload.customer?.name || "LINE 客戶",
          productName: responsePayload.options?.length
            ? `${responsePayload.product?.name || "-"} + ${responsePayload.options.length} 項選配`
            : responsePayload.product?.name || null,
          totalAmount: responsePayload.totalAmount || 0
        });

        try {
          const lineOrderNotificationResult = await notifyOrderReservationCreated({
            customerName: responsePayload.customer?.name || "LINE 客戶",
            phone: responsePayload.customer?.phone || "-",
            orderNo: responsePayload.orderNo || null,
            orderId: responsePayload.orderId || null,
            productName: responsePayload.options?.length
              ? `${responsePayload.product?.name || "LINE訂單車款"} + ${responsePayload.options.length} 項選配`
              : responsePayload.product?.name || "LINE訂單車款",
            storeId
          }, {
            registrationTypes: ["staff", "admin"]
          });
          const orderLinkForEvent = lineOrderNotificationResult.orderLink
            || buildOrderDetailLink(responsePayload.orderId || lineOrderNotificationResult.orderId, { baseUrl: config.frontendBaseUrl });

          try {
            await logWorkflowEvent(
              "order_reservation_line_group_notified",
              "ORDER",
              responsePayload.orderId,
              {
                orderId: responsePayload.orderId || null,
                orderNo: responsePayload.orderNo || null,
                orderLink: orderLinkForEvent || null,
                customerName: responsePayload.customer?.name || "LINE 客戶",
                phone: responsePayload.customer?.phone || null,
                productName: responsePayload.product?.name || null,
                source: "line_order_page",
                delivered: lineOrderNotificationResult.delivered,
                targetGroupIds: lineOrderNotificationResult.targetGroupIds || [],
                lineGroupId: lineOrderNotificationResult.lineGroupId || null,
                reason: lineOrderNotificationResult.reason || null,
                error: lineOrderNotificationResult.error || null
              },
              null
            );
          } catch (eventError) {
            console.warn("[line-order] workflow event logging failed", {
              orderNo: responsePayload.orderNo,
              message: eventError.message
            });
          }
        } catch (lineNotifyError) {
          console.error("[line-order] order reservation notify failed", {
            orderNo: responsePayload.orderNo,
            error: lineNotifyError.message
          });
        }
      });
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
