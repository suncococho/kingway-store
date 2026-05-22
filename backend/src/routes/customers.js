const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { sendLineMessage } = require("../utils/line");
const config = require("../config");
const { logWorkflowEvent } = require("../services/lineWorkflowService");

const router = express.Router();

function normalizeCustomerType(value, lineUserId, phone) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OFFLINE_WITH_PHONE" || normalized === "OFFLINE_NO_PHONE") {
    return normalized;
  }
  if (normalized === "OFFLINE") {
    return phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE";
  }
  if (normalized === "LINE") {
    return "LINE";
  }
  return lineUserId ? "LINE" : phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE";
}

function buildPurchaseConfirmationPdfUrl(token) {
  return token ? `${config.frontendBaseUrl}/api/purchase-confirmations/public/${token}/pdf` : null;
}

function safeParseJsonArray(value) {
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

router.use(authenticate, requireStoreScope());

router.get("/", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const search = req.query.search ? `%${req.query.search}%` : null;
    let sql = `
      SELECT
        id,
        name,
        phone,
        line_user_id AS lineUserId,
        customer_type AS customerType,
        crm_stage AS crmStage,
        budget,
        purchase_timing AS purchaseTiming,
        usage_purpose AS usagePurpose,
        interested_model AS interestedModel,
        last_contact_at AS lastContactAt,
        follow_up_due_at AS followUpDueAt,
        notes,
        (
          SELECT COUNT(*)
          FROM orders o
          WHERE o.customer_id = customers.id
            AND o.store_id = ?
        ) AS orderCount,
        (
          SELECT COUNT(*)
          FROM repair_orders ro
          WHERE ro.customer_id = customers.id
            AND ro.store_id = ?
        ) AS repairCount,
        (
          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.id AND o.store_id = ?)
          +
          (SELECT COUNT(*) FROM repair_orders ro WHERE ro.customer_id = customers.id AND ro.store_id = ?)
        ) AS visitCount,
        COALESCE((
          SELECT SUM(o.total_amount)
          FROM orders o
          WHERE o.customer_id = customers.id
            AND o.store_id = ?
            AND o.status <> 'CANCELED'
        ), 0) AS totalSpent,
        GREATEST(
          COALESCE((SELECT MAX(created_at) FROM orders o WHERE o.customer_id = customers.id AND o.store_id = ?), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(created_at) FROM repair_orders ro WHERE ro.customer_id = customers.id AND ro.store_id = ?), '1970-01-01 00:00:00')
        ) AS lastVisit,
        EXISTS(
          SELECT 1
          FROM follow_up_tasks ft
          WHERE ft.customer_id = customers.id
            AND ft.status IN ('pending', 'sent')
        ) AS hasPendingFollowUp,
        EXISTS(
          SELECT 1
          FROM purchase_confirmations pc
          WHERE pc.customer_id = customers.id
            AND pc.status = 'PENDING'
        ) AS hasPendingPurchaseConfirmation,
        EXISTS(
          SELECT 1
          FROM surveys s
          WHERE s.customer_id = customers.id
        ) AS hasSurveyResult,
        GREATEST(
          COALESCE(last_contact_at, '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(created_at) FROM orders o WHERE o.customer_id = customers.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(created_at) FROM repair_orders ro WHERE ro.customer_id = customers.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(created_at) FROM follow_up_tasks ft WHERE ft.customer_id = customers.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(created_at) FROM purchase_confirmations pc WHERE pc.customer_id = customers.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(submitted_at) FROM surveys s WHERE s.customer_id = customers.id), '1970-01-01 00:00:00')
        ) AS lastInteractionAt,
        created_at AS createdAt
      FROM customers
      WHERE customers.store_id = ?
        AND COALESCE(crm_stage, '') <> 'deleted'
    `;
    const params = [storeId, storeId, storeId, storeId, storeId, storeId, storeId, storeId];

    if (search) {
      sql += " AND (name LIKE ? OR phone LIKE ? OR line_user_id LIKE ?) ";
      params.push(search, search, search);
    }

    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { name, phone, lineUserId, customerType, notes, crmStage, budget, purchaseTiming, usagePurpose, interestedModel } = req.body;

    if (!name) {
      return res.status(400).json({ message: "姓名為必填欄位" });
    }

    const normalizedCustomerType = normalizeCustomerType(customerType, lineUserId, phone);

    if (phone && normalizedCustomerType !== "OFFLINE_NO_PHONE") {
      const [existingCustomers] = await pool.query(
        `
          SELECT
            id,
            name,
            phone,
            line_user_id AS lineUserId,
            customer_type AS customerType,
            crm_stage AS crmStage
          FROM customers
          WHERE phone = ?
            AND store_id = ?
          LIMIT 1
        `,
        [phone, storeId]
      );

      if (existingCustomers.length > 0) {
        return res.json(existingCustomers[0]);
      }
    }
    const [result] = await pool.query(
      `
        INSERT INTO customers (
          name, phone, line_user_id, customer_type, notes, crm_stage, budget, purchase_timing, usage_purpose, interested_model, store_id, last_contact_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        name,
        normalizedCustomerType === "OFFLINE_NO_PHONE" ? null : phone || null,
        normalizedCustomerType === "LINE" ? lineUserId || null : null,
        normalizedCustomerType,
        notes || null,
        crmStage || null,
        budget || null,
        purchaseTiming || null,
        usagePurpose || null,
        interestedModel || null,
        storeId
      ]
    );

    await pool.query(
      `
        INSERT INTO customer_crm_events (customer_id, event_type, stage, note, created_by_staff_id)
        VALUES (?, 'customer_created', ?, ?, ?)
      `,
      [result.insertId, crmStage || null, notes || null, req.user.id]
    );

    return res.status(201).json({
      id: result.insertId,
      name,
      phone: normalizedCustomerType === "OFFLINE_NO_PHONE" ? null : phone || null,
      lineUserId: normalizedCustomerType === "LINE" ? lineUserId || null : null,
      customerType: normalizedCustomerType,
      notes: notes || null,
      crmStage: crmStage || null,
      budget: budget || null,
      purchaseTiming: purchaseTiming || null,
      usagePurpose: usagePurpose || null,
      interestedModel: interestedModel || null
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "lineUserId already bound";
    }
    return next(error);
  }
});

router.patch("/:id", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const storeId = req.storeId;
    const { name, phone, lineUserId, customerType, notes, crmStage, budget, purchaseTiming, usagePurpose, interestedModel } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }

    if (phone !== undefined) {
      updates.push("phone = ?");
      values.push(phone);
    }

    if (lineUserId !== undefined) {
      updates.push("line_user_id = ?");
      values.push(lineUserId || null);
    }

    if (customerType !== undefined) {
      const normalizedCustomerType = normalizeCustomerType(customerType, lineUserId, phone);
      updates.push("customer_type = ?");
      values.push(normalizedCustomerType);
      if (normalizedCustomerType !== "LINE" && lineUserId === undefined) {
        updates.push("line_user_id = NULL");
      }
      if (normalizedCustomerType === "OFFLINE_NO_PHONE" && phone === undefined) {
        updates.push("phone = NULL");
      }
    }

    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }

    if (crmStage !== undefined) {
      updates.push("crm_stage = ?");
      values.push(crmStage);
    }

    if (budget !== undefined) {
      updates.push("budget = ?");
      values.push(budget);
    }

    if (purchaseTiming !== undefined) {
      updates.push("purchase_timing = ?");
      values.push(purchaseTiming);
    }

    if (usagePurpose !== undefined) {
      updates.push("usage_purpose = ?");
      values.push(usagePurpose);
    }

    if (interestedModel !== undefined) {
      updates.push("interested_model = ?");
      values.push(interestedModel);
    }

    if (updates.length > 0) {
      updates.push("last_contact_at = NOW()");
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "沒有提供可更新欄位" });
    }

    values.push(id, storeId);
    await pool.query(`UPDATE customers SET ${updates.join(", ")} WHERE id = ? AND store_id = ?`, values);

    const [rows] = await pool.query(
      `
        SELECT
          id,
          name,
          phone,
          line_user_id AS lineUserId,
          customer_type AS customerType,
          crm_stage AS crmStage,
          budget,
          purchase_timing AS purchaseTiming,
          usage_purpose AS usagePurpose,
          interested_model AS interestedModel,
          last_contact_at AS lastContactAt,
          follow_up_due_at AS followUpDueAt,
          (
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.id AND o.store_id = ?)
            +
            (SELECT COUNT(*) FROM repair_orders ro WHERE ro.customer_id = customers.id AND ro.store_id = ?)
          ) AS visitCount,
          COALESCE((
            SELECT SUM(o.total_amount)
            FROM orders o
            WHERE o.customer_id = customers.id
              AND o.store_id = ?
              AND o.status <> 'CANCELED'
          ), 0) AS totalSpent,
          GREATEST(
            COALESCE((SELECT MAX(created_at) FROM orders o WHERE o.customer_id = customers.id AND o.store_id = ?), '1970-01-01 00:00:00'),
            COALESCE((SELECT MAX(created_at) FROM repair_orders ro WHERE ro.customer_id = customers.id AND ro.store_id = ?), '1970-01-01 00:00:00')
          ) AS lastVisit,
          notes,
          created_at AS createdAt
        FROM customers
        WHERE id = ?
          AND store_id = ?
      `,
      [storeId, storeId, storeId, storeId, storeId, id, storeId]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "找不到客戶" });
    }

    return res.json(rows[0]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      error.statusCode = 409;
      error.message = "LINE 綁定 ID 已存在";
    }
    return next(error);
  }
});

router.get("/:id/detail", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[customer]] = await pool.query(
      `
        SELECT
          id, name, phone, line_user_id AS lineUserId, customer_type AS customerType, notes,
          crm_stage AS crmStage, budget, purchase_timing AS purchaseTiming,
          usage_purpose AS usagePurpose, interested_model AS interestedModel,
          last_contact_at AS lastContactAt, follow_up_due_at AS followUpDueAt,
          (
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.id)
            +
            (SELECT COUNT(*) FROM repair_orders ro WHERE ro.customer_id = customers.id)
          ) AS visitCount,
          COALESCE((
            SELECT SUM(o.total_amount)
            FROM orders o
            WHERE o.customer_id = customers.id
              AND o.status <> 'CANCELED'
          ), 0) AS totalSpent,
          GREATEST(
            COALESCE((SELECT MAX(created_at) FROM orders o WHERE o.customer_id = customers.id), '1970-01-01 00:00:00'),
            COALESCE((SELECT MAX(created_at) FROM repair_orders ro WHERE ro.customer_id = customers.id), '1970-01-01 00:00:00')
          ) AS lastVisit,
          created_at AS createdAt
        FROM customers
        WHERE id = ?
      `,
      [id]
    );

    if (!customer) {
      return res.status(404).json({ message: "找不到客戶" });
    }

    const [orders] = await pool.query(
      `
        SELECT id, order_no AS orderNo, total_amount AS totalAmount, final_payment_status AS finalPaymentStatus, business_date AS businessDate
        FROM orders
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [repairs] = await pool.query(
      `
        SELECT id, bike_model AS bikeModel, issue_description AS issueDescription, status, reservation_date AS reservationDate
        FROM repair_orders
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [coupons] = await pool.query(
      `
        SELECT id, code, coupon_type AS couponType, status, amount, is_used AS isUsed, issued_at AS issuedAt
        FROM coupons
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [surveys] = await pool.query(
      `
        SELECT id, order_id AS orderId, repair_order_id AS repairOrderId, rating, feedback, submitted_at AS submittedAt
        FROM surveys
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [confirmations] = await pool.query(
      `
        SELECT
          id,
          token,
          order_id AS orderId,
          status,
          buyer_name AS buyerName,
          buyer_phone AS buyerPhone,
          buyer_id_number AS buyerIdNumber,
          delivery_checks_json AS deliveryChecksJson,
          staff_explanations_json AS staffExplanationsJson,
          terms_accepted AS termsAccepted,
          final_confirmation_accepted AS finalConfirmationAccepted,
          html_snapshot AS htmlSnapshot,
          pdf_path AS pdfPath,
          submitted_at AS submittedAt,
          handover_confirmed_at AS handoverConfirmedAt
        FROM purchase_confirmations
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [crmEvents] = await pool.query(
      `
        SELECT id, event_type AS eventType, stage, note, created_at AS createdAt
        FROM customer_crm_events
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [followUps] = await pool.query(
      `
        SELECT id, action_type AS actionType, status, message, sent_at AS sentAt, completed_at AS completedAt, created_at AS createdAt
        FROM follow_up_tasks
        WHERE customer_id = ?
        ORDER BY id DESC
      `,
      [id]
    );
    const [timeline] = await pool.query(
      `
        SELECT
          id,
          event_type AS eventType,
          ref_type AS refType,
          ref_id AS refId,
          payload,
          created_by_staff_id AS createdByStaffId,
          created_at AS createdAt
        FROM v2_workflow_events
        WHERE ref_type = 'CUSTOMER'
          AND ref_id = ?
        ORDER BY id DESC
        LIMIT 100
      `,
      [id]
    );

    return res.json({
      customer,
      orders,
      repairs,
      coupons,
      surveys,
      confirmations: confirmations.map((item) => ({
        ...item,
        deliveryChecks: safeParseJsonArray(item.deliveryChecksJson),
        staffExplanations: safeParseJsonArray(item.staffExplanationsJson),
        pdfUrl: item.pdfPath ? buildPurchaseConfirmationPdfUrl(item.token) : null
      })),
      crmEvents,
      followUps,
      timeline: timeline.map((item) => ({
        ...item,
        payload: item.payload ? (() => {
          try { return JSON.parse(item.payload); } catch { return item.payload; }
        })() : null
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/follow-up", authorize(["ADMIN", "MANAGER", "CASHIER"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const actionTypeMap = {
      "3日追蹤": "3_day",
      "7日追蹤": "7_day",
      "14日追蹤": "14_day",
      "手動發送": "manual",
      "manual": "manual"
    };
    const actionType = actionTypeMap[req.body.action] || req.body.action || "manual";
    const message = req.body.message || "您好，KINGWAY 台南關心您的購車需求，如需協助歡迎直接回覆 LINE。";

    const [[customer]] = await pool.query(
      `
        SELECT id, line_user_id AS lineUserId
        FROM customers
        WHERE id = ?
      `,
      [id]
    );
    if (!customer) {
      return res.status(404).json({ message: "找不到客戶" });
    }

    const [result] = await pool.query(
      `
        INSERT INTO follow_up_tasks (customer_id, action_type, status, message, created_by_staff_id)
        VALUES (?, ?, 'pending', ?, ?)
      `,
      [id, actionType, message, req.user.id]
    );

    let sent = false;
    if (customer.lineUserId && config.line.channelAccessToken) {
      await sendLineMessage(config, customer.lineUserId, [{ type: "text", text: message }]);
      await pool.query("UPDATE follow_up_tasks SET status = 'sent', sent_at = NOW() WHERE id = ?", [result.insertId]);
      sent = true;
    }

    await pool.query(
      `
        INSERT INTO customer_crm_events (customer_id, event_type, stage, note, created_by_staff_id)
        VALUES (?, 'follow_up', NULL, ?, ?)
      `,
      [id, `${actionType}：${sent ? "已發送 LINE" : "已建立待辦"}`, req.user.id]
    );
    await logWorkflowEvent("customer_follow_up", "CUSTOMER", id, { actionType, sent }, req.user.id);

    return res.status(201).json({ id: result.insertId, sent });
  } catch (error) {
    return next(error);
  }
});


router.delete("/:id", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const { adminPin } = req.body || {};

    if (String(adminPin || "") !== "1144") {
      return res.status(403).json({ message: "管理員 PIN 錯誤" });
    }

    await pool.query(
      `
        UPDATE customers
        SET name = CONCAT('[已刪除] ', COALESCE(name, '')),
            phone = NULL,
            line_user_id = NULL,
            crm_stage = 'deleted',
            updated_at = NOW()
        WHERE id = ?
      `,
      [req.params.id]
    );

    return res.json({ success: true, message: "客戶已隱藏，歷史訂單與維修紀錄已保留" });
  } catch (error) {
    return next(error);
  }
});



module.exports = router;
