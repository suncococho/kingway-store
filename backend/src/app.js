const path = require("path");
const express = require("express");
const lineOrderRoutes = require("./routes/lineOrder");
const lineRepairRoutes = require("./routes/lineRepair");
const lineGoogleReviewRoutes = require("./routes/lineGoogleReview");
const lineBindPhoneRoutes = require("./routes/lineBindPhone");
const cors = require("cors");
const cron = require("node-cron");
const { updateRepairStorageFees } = require("./services/repairStorageFeeService");
const { sendRepairPickupReminders } = require("./services/repairReminderService");
const config = require("./config");
const { pool } = require("./db");
const authRoutes = require("./routes/auth");
const storeSignupRoutes = require("./routes/storeSignup");
const platformAuthRoutes = require("./routes/platformAuth");
const staffRoutes = require("./routes/staff");
const customerRoutes = require("./routes/customers");
const productRoutes = require("./routes/products");
const systemStatusRoutes = require("./routes/systemStatus");
const saasAdminRoutes = require("./routes/saasAdmin");
const storeFeatureRoutes = require("./routes/storeFeatures");
const orderRoutes = require("./routes/orders");
const orderItemsEditRoutes = require("./routes/orderItemsEdit");
const lineRoutes = require("./routes/line");
const dashboardRoutes = require("./routes/dashboard");
const inventoryRoutes = require("./routes/inventory");
const purchaseConfirmationRoutes = require("./routes/purchaseConfirmations");
const repairRoutes = require("./routes/repairs");
const couponRoutes = require("./routes/coupons");
const surveyRoutes = require("./routes/surveys");
const supplierRoutes = require("./routes/suppliers");
const salesRoutes = require("./routes/sales");
const attendanceRoutes = require("./routes/attendance");
const kpiRoutes = require("./routes/kpi");
const payrollRoutes = require("./routes/payroll");
const settingsRoutes = require("./routes/settings");
const storeSettingsRoutes = require("./routes/storeSettings");
const storefrontRoutes = require("./routes/storefront");
const debugRoutes = require("./routes/debug");
const { errorHandler } = require("./middleware/errorHandler");
const { sendDailyReport, TAIPEI_TZ } = require("./services/reportService");
const { authenticate, authorize, requireStoreScope } = require("./middleware/auth");
const { logWorkflowEvent } = require("./services/lineWorkflowService");
const { buildOrderDetailLink, notifyPaymentInquiryCreated } = require("./services/staffLineNotify");

const app = express();
const customerStatusStaffAuth = [
  authenticate,
  requireStoreScope(),
  authorize(["ADMIN", "MANAGER", "CASHIER", "REPAIR"])
];
const telegramWebhookRoutes = require("./routes/telegramWebhook");

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    }
  })
);



app.get("/api/coupons/by-phone/:phone", async (req, res, next) => {
  try {
    const phone = String(req.params.phone || "").trim();

    const [[customer]] = await pool.query(
      `SELECT id, name, phone
       FROM customers
       WHERE phone = ?
       LIMIT 1`,
      [phone]
    );

    if (!customer) {
      return res.json({
        customer: null,
        coupons: []
      });
    }

    const [coupons] = await pool.query(
      `SELECT id,
              code,
              coupon_type AS couponType,
              amount,
              status,
              is_used AS isUsed,
              eligible_category AS eligibleCategory
       FROM coupons
       WHERE customer_id = ?
       ORDER BY id DESC`,
      [customer.id]
    );

    res.json({
      customer,
      coupons
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/line-support/create", async (req, res, next) => {
  try {
    const { lineUserId, name, phone, orderNo, type, message } = req.body || {};
    const normalizedMessage = String(message || "").trim();
    const shouldNotifyLineSupport = String(type || "").trim() === "payment" || Boolean(orderNo);

    if (!normalizedMessage) {
      return res.status(400).json({ message: "請輸入需求內容" });
    }

    const text = [
      "📩 LINE 客服協助",
      type === "payment" ? "類型：付款詢問" : "類型：客服協助",
      orderNo ? `訂單：${orderNo}` : null,
      `客戶：${name || "-"}`,
      `電話：${phone || "-"}`,
      lineUserId ? `LINE userId：${lineUserId}` : null,
      "",
      "內容：",
      normalizedMessage
    ].filter(Boolean).join("\n");

    const { BOT_NOTIFY, sendTelegramMessage } = require("./services/telegramService");

    await sendTelegramMessage(
      BOT_NOTIFY,
      "-5280460882",
      text
    );

    if (shouldNotifyLineSupport) {
      setImmediate(async () => {
        try {
          const resolvedOrderNo = String(orderNo || "").trim();
          let resolvedOrderId = null;
          let resolvedStoreId = null;

          if (resolvedOrderNo) {
            const [orders] = await pool.query(
              `
                SELECT id, store_id AS storeId
                FROM orders
                WHERE order_no = ?
                LIMIT 1
              `,
              [resolvedOrderNo]
            );

            if (orders[0]) {
              resolvedOrderId = orders[0].id;
              const normalizedStoreId = Number(orders[0].storeId || 0);
              resolvedStoreId = Number.isSafeInteger(normalizedStoreId) && normalizedStoreId > 0
                ? normalizedStoreId
                : null;
            }
          }

          const lineSupportNotificationResult = await notifyPaymentInquiryCreated({
            customerName: name || "LINE 客戶",
            phone: phone || "-",
            orderNo: resolvedOrderNo || null,
            message: normalizedMessage,
            orderId: resolvedOrderId,
            storeId: resolvedStoreId
          }, {
            registrationTypes: ["staff", "admin"]
          });
          const orderLinkForEvent = lineSupportNotificationResult.orderLink
            || buildOrderDetailLink(resolvedOrderId, { baseUrl: config.frontendBaseUrl });

          try {
            await logWorkflowEvent(
              "payment_inquiry_line_group_notified",
              "ORDER",
              resolvedOrderId,
              {
                type: String(type || "").trim() || "support",
                orderNo: resolvedOrderNo || null,
                orderId: resolvedOrderId,
                orderLink: orderLinkForEvent || null,
                customerName: name || "LINE 客戶",
                phone: phone || null,
                message: normalizedMessage,
                source: "line_support_page",
                delivered: lineSupportNotificationResult.delivered,
                targetGroupIds: lineSupportNotificationResult.targetGroupIds || [],
                lineGroupId: lineSupportNotificationResult.lineGroupId || null,
                reason: lineSupportNotificationResult.reason || null,
                error: lineSupportNotificationResult.error || null
              },
              null
            );
          } catch (eventError) {
            console.warn("[line-support] workflow event logging failed", {
              orderNo: resolvedOrderNo,
              message: eventError.message
            });
          }
        } catch (lineNotifyError) {
          console.error("[line-support] payment inquiry notify failed", {
            orderNo: String(orderNo || ""),
            error: lineNotifyError.message
          });
        }
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/customer-status", ...customerStatusStaffAuth, async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ customer: null, orders: [], repairs: [] });

    const like = `%${q}%`;

    const [customers] = await pool.query(
      "SELECT id, name, phone, line_user_id AS lineUserId FROM customers WHERE store_id = ? AND (phone LIKE ? OR name LIKE ? OR line_user_id = ?) ORDER BY updated_at DESC LIMIT 1",
      [storeId, like, like, q]
    );

    const customer = customers[0] || null;
    if (!customer) return res.json({ customer: null, orders: [], repairs: [] });


    const [orders] = await pool.query(
      `SELECT id, order_no AS orderNo, total_amount AS totalAmount, deposit_amount AS depositAmount,
              unpaid_balance AS unpaidBalance, final_payment_status AS finalPaymentStatus,
              payment_method AS paymentMethod, status, business_date AS businessDate
       FROM orders
       WHERE store_id = ?
         AND (customer_id = ? OR customer_phone = ?)
       ORDER BY id DESC
       LIMIT 20`,
      [storeId, customer.id, customer.phone]
    );

    const [repairs] = await pool.query(
      `SELECT id, bike_model AS bikeModel, issue_description AS issueDescription, status,
              reservation_date AS reservationDate, estimate_amount AS estimateAmount,
              inspection_fee AS inspectionFee, parts_fee AS partsFee, labor_fee AS laborFee,
              storage_fee AS storageFee, completed_at AS completedAt, picked_up_at AS pickedUpAt
       FROM repair_orders
       WHERE store_id = ?
         AND customer_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [storeId, customer.id]
    );

    const [pendingPurchaseConfirmations] = await pool.query(
      `SELECT pc.id, pc.order_id AS orderId, pc.token, pc.status, pc.created_at AS createdAt,
              o.order_no AS orderNo
       FROM purchase_confirmations pc
       LEFT JOIN orders o ON o.id = pc.order_id
         AND o.store_id = pc.store_id
       WHERE pc.store_id = ?
         AND pc.status = 'PENDING'
         AND pc.token IS NOT NULL
         AND (
           pc.customer_id = ?
           OR o.customer_id = ?
           OR o.customer_phone = ?
         )
       ORDER BY pc.id DESC
       LIMIT 10`,
      [storeId, customer.id, customer.id, customer.phone]
    );

    const [coupons] = await pool.query(
      `SELECT id, code, coupon_type AS couponType, amount, status, is_used AS isUsed,
              eligible_category AS eligibleCategory, issued_at AS issuedAt, used_at AS usedAt
       FROM coupons
       WHERE store_id = ?
         AND customer_id = ?
       ORDER BY id DESC
       LIMIT 20`,
      [storeId, customer.id]
    );

    return res.json({ customer, orders, repairs, pendingPurchaseConfirmations, coupons });
  } catch (error) {
    return next(error);
  }
});


app.post("/api/customer-status/orders/:id/payment", ...customerStatusStaffAuth, async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE orders
       SET unpaid_balance = 0,
           final_payment_status = 'PAID',
           final_paid_at = NOW()
       WHERE id = ?
         AND store_id = ?`,
      [req.params.id, req.storeId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到訂單" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/customer-status/orders/:id/deliver", ...customerStatusStaffAuth, async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE orders
       SET status = 'COMPLETED',
           handover_confirmed_at = NOW()
       WHERE id = ?
         AND store_id = ?`,
      [req.params.id, req.storeId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到訂單" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/customer-status/repairs/:id/payment", ...customerStatusStaffAuth, async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE repair_orders
       SET estimate_amount = 0,
           inspection_fee = 0,
           parts_fee = 0,
           labor_fee = 0,
           storage_fee = 0
       WHERE id = ?
         AND store_id = ?`,
      [req.params.id, req.storeId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到維修單" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/customer-status/repairs/:id/pickup", ...customerStatusStaffAuth, async (req, res, next) => {
  try {
    const [result] = await pool.query(
      `UPDATE repair_orders
       SET status = 'picked_up',
           picked_up_at = NOW()
       WHERE id = ?
         AND store_id = ?`,
      [req.params.id, req.storeId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "找不到維修單" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});




app.post("/api/line/push-test-welcome", async (req, res, next) => {
  try {
    const { pool } = require("./db");
    const config = require("./config");
    const { sendLineMessage } = require("./services/lineClient");

    const phone = String(req.body.phone || "").trim();

    const [[customer]] = await pool.query(
      "SELECT id, name, phone, line_user_id AS lineUserId FROM customers WHERE phone=? AND line_user_id IS NOT NULL ORDER BY id DESC LIMIT 1",
      [phone]
    );

    if (!customer?.lineUserId) {
      return res.status(404).json({ message: "找不到已綁定 LINE 的客戶" });
    }

    await sendLineMessage(config, customer.lineUserId, [
      {
        type: "text",
        text: "歡迎來到 KINGWAY！\n\n請選擇您需要的服務：\n\n🚲 電動自行車預約訂單\n🔧 維修預約",
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "uri",
                label: "🚲 電動自行車預約",
                uri: "https://pos.kingway.tw/line-order"
              }
            },
            {
              type: "action",
              action: {
                type: "uri",
                label: "🔧 維修預約",
                uri: "https://pos.kingway.tw/repair-reservation"
              }
            }
          ]
        }
      }
    ]);

    res.json({ ok: true, lineUserId: customer.lineUserId });
  } catch (error) {
    next(error);
  }
});

app.post("/api/line/profile-name", async (req, res, next) => {
  try {
    const lineUserId = String(req.body.lineUserId || "").trim();
    const displayName = String(req.body.displayName || "").trim();

    if (!lineUserId || !displayName) {
      return res.json({ ok: false });
    }

    const [result] = await pool.query(
      `
        UPDATE customers
        SET
          name = CASE
            WHEN name IS NULL OR TRIM(name) = '' OR name IN ('LINE 客戶', 'LINE Customer')
            THEN ?
            ELSE name
          END,
          line_display_name = ?
        WHERE line_user_id = ?
      `,
      [displayName, displayName, lineUserId]
    );

    console.log("[line-profile-name]", {
      lineUserId,
      updatedRows: Number(result?.affectedRows || 0),
      changedRows: Number(result?.changedRows || 0)
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use("/api/line-order", lineOrderRoutes);
app.use("/api/line-repair", lineRepairRoutes);
app.use("/api/line-google-review", lineGoogleReviewRoutes);
app.use("/api/line-bind-phone", lineBindPhoneRoutes);

app.get("/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use("/api/store", storeSettingsRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/system", systemStatusRoutes);
app.use("/api", storeSignupRoutes);
app.use("/api/platform-auth", platformAuthRoutes);
app.use("/api/saas-admin", saasAdminRoutes);
app.use("/api/store-features", storeFeatureRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders", orderItemsEditRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/purchase-confirmations", purchaseConfirmationRoutes);
app.use("/api/repairs", repairRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/surveys", surveyRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/kpi", kpiRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/telegram", telegramWebhookRoutes);
app.use("/api/line", lineRoutes);
app.use("/api/debug", debugRoutes);
app.use("/files/pdfs", (req, res) => res.status(404).json({ message: "Not found" }));
app.use("/files/products", (req, res) => res.status(404).json({ message: "Not found" }));
app.use("/files", express.static(path.join(__dirname, "..", "storage")));

cron.schedule(
  "0 21 * * *",
  async () => {
    try {
      const result = await sendDailyReport(config);
      console.log(`Daily report finished. Delivered: ${result.delivered}`);
    } catch (error) {
      console.error("Daily report failed:", error.message);
    }
  },
  { timezone: TAIPEI_TZ }
);



cron.schedule(
  "30 13 * * *",
  async () => {
    try {
      const result = await sendRepairPickupReminders();
      console.log(`[Repair Pickup Reminder] checked=${result.checked} lineSent=${result.lineSent} adminAlerts=${result.adminAlerts}`);
    } catch (error) {
      console.error("[Repair Pickup Reminder failed]", error);
    }
  },
  { timezone: TAIPEI_TZ }
);



cron.schedule(
  "0 1 * * *",
  async () => {
    try {
      const result = await updateRepairStorageFees();
      console.log(`[Repair Storage Fee] checked=${result.checked} updated=${result.updated}`);
    } catch (error) {
      console.error("[Repair Storage Fee failed]", error);
    }
  },
  { timezone: TAIPEI_TZ }
);



cron.schedule(
  "0 9 1 * *",
  async () => {
    try {
      const { generateAndSendMonthlySupplierReports } = require("./services/supplierReportService");

      const result = await generateAndSendMonthlySupplierReports();

      console.log(
        `[Supplier Monthly XLSX] sent=${result.sent} files=${result.files}`
      );
    } catch (error) {
      console.error("[Supplier Monthly XLSX failed]", error);
    }
  },
  { timezone: TAIPEI_TZ }
);


app.use((req, res, next) => {
  const error = new Error("Not Found");
  error.statusCode = 404;
  return next(error);
});

app.use(errorHandler);

module.exports = app;
