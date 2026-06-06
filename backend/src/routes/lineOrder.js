const express = require("express");
const dayjs = require("dayjs");
const { pool, withTransaction } = require("../db");
const { BOT_NOTIFY, sendTelegramMessage } = require("../services/telegramService");
const {
  SOURCE,
  createPublicStoreContextMiddleware,
  getStoreCodeFromRequest
} = require("../utils/publicStoreResolver");

const router = express.Router();
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
       ORDER BY id DESC
       LIMIT 20`,
      [customer.id, customer.phone, storeId]
    );

    const [repairs] = await pool.query(
      `SELECT
         id,
         bike_model AS bikeModel,
         issue_description AS issueDescription,
         status,
         reservation_date AS reservationDate,
         estimate_amount AS estimateAmount,
         inspection_fee AS inspectionFee,
         parts_fee AS partsFee,
         labor_fee AS laborFee,
         storage_fee AS storageFee,
         completed_at AS completedAt,
         picked_up_at AS pickedUpAt
       FROM repair_orders
       WHERE customer_id = ?
         AND store_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [customer.id, storeId]
    );

    return res.json({ customer, orders, repairs });
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

router.post("/create", async (req, res, next) => {
  try {
    const storeContext = resolveLineOrderStoreContext(req);
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const storeId = storeContext.storeId;
    const { lineUserId, productId, name, phone, displayName } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "請選擇商品" });
    }

    const effectiveLineUserId = lineUserId || `WEB-GUEST-${Date.now()}`;

    const result = await withTransaction(async (tx) => {
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
        `SELECT id, sku, name, price, stock
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

      let [couponRows] = await tx.query(
        `SELECT id, code, amount, status
         FROM coupons
         WHERE customer_id = ?
           AND coupon_type = 'new_friend'
           AND store_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [customer.id, storeId]
      );

      const newFriendCouponEnabled =
        process.env.COUPON_CAMPAIGN_ENABLED === "true" ||
        process.env.NEW_FRIEND_COUPON_ENABLED === "true";

      let coupon = newFriendCouponEnabled ? couponRows[0] : null;

      if (newFriendCouponEnabled && !coupon) {
        const code = `NEW${customer.id}${Date.now().toString().slice(-5)}`;
        const [couponResult] = await tx.query(
          `INSERT INTO coupons (store_id, code, coupon_type, amount, customer_id, status, eligible_category)
           VALUES (?, ?, 'new_friend', 500, ?, 'issued', 'EBIKE')`,
          [storeId, code, customer.id]
        );
        coupon = { id: couponResult.insertId, code, amount: 500, status: "issued" };
      }

      const unitPrice = Number(product.price || 0);
      const discount = newFriendCouponEnabled && coupon ? Number(coupon.amount || 500) : 0;
      const totalAmount = Math.max(unitPrice - discount, 0);
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
          `LINE 自助訂車｜商品：${product.name}｜新朋友折扣：NT$ ${discount}`,
          staffId
        ]
      );

      await tx.query(
        `INSERT INTO order_items
         (store_id, order_id, product_id, sku_snapshot, product_name_snapshot,
          product_category_snapshot, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, 'EB', 1, ?, ?)`,
        [
          storeId,
          orderResult.insertId,
          product.id,
          product.sku,
          product.name,
          unitPrice,
          unitPrice
        ]
      );

      return {
        ok: true,
        orderId: orderResult.insertId,
        orderNo,
        customer,
        product,
        coupon,
        discount,
        totalAmount
      };
    });

    const responsePayload = result;

    if (responsePayload?.ok) {
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
              `庫存：${Number(responsePayload.product?.stock || 0) > 0 ? "現貨 " + responsePayload.product.stock + " 台" : "缺貨可預約"}`,
              `金額：NT$ ${responsePayload.totalAmount || 0}`,
              "狀態：LINE 預約單 / 待門市確認 / 待付款",
              "",
              `查看 / 編輯訂單：${process.env.FRONTEND_BASE_URL || "https://pos.kingway.tw"}/orders/${responsePayload.orderId}/edit`
            ].join("\n"),
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

    if (responsePayload?.ok) {
      setImmediate(async () => {
        try {
          const { sendLineMessage } = require("../utils/line");
          const config = require("../config");

          if (
            responsePayload.customer?.lineUserId &&
            !String(responsePayload.customer.lineUserId).startsWith("WEB-GUEST-")
          ) {
            await sendLineMessage(
              config,
              responsePayload.customer.lineUserId,
              [
                {
                  type: "text",
                  text:
                    "已收到您的訂單，\n門市將盡快與您聯繫確認。"
                }
              ]
            );
          }
        } catch (error) {
          console.error("[line-order customer notify failed]", error.message);
        }
      });
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
