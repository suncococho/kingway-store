const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { pool } = require("../db");
const config = require("../config");
const {
  SOURCE,
  createPublicStoreContextMiddleware,
  getStoreCodeFromRequest
} = require("../utils/publicStoreResolver");
const {
  createRepairReservationFromSession,
  logWorkflowEvent,
  resolveLineWorkflowStoreContext
} = require("../services/lineWorkflowService");
const { notifyRepairReservationCreated } = require("../services/staffLineNotify");

const router = express.Router();
const resolvePublicStoreContext = createPublicStoreContextMiddleware({
  db: pool,
  allowQueryStoreCode: true,
  allowBodyStoreCode: true,
  legacyFallbackMode: SOURCE.LEGACY_KINGWAY_FALLBACK,
  legacyFallbackStoreId: 1,
  legacyFallbackAllowUnverifiedStore: true
});

const REPAIR_RESERVATION_FLOW = "repair_reservation";
const REPAIR_RESERVATION_DUPLICATE_WINDOW_MS = 10 * 1000;
const REPAIR_RESERVATION_DB_DUPLICATE_WINDOW_MINUTES = 10;
const REPAIR_WARRANTY_TERMS_VERSION = "KINGWAY_REPAIR_WARRANTY_V2026_06";
const REPAIR_WARRANTY_TERMS_ERROR_MESSAGE = "請先確認保固維修範圍說明";
const recentRepairReservationRequests = new Map();

function getReservationDay(date) {
  const day = dayjs(date).day();
  const map = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday"
  };
  return map[day] || "Sunday";
}

function getRequestedStoreCode(req) {
  return getStoreCodeFromRequest(req, {
    allowQueryStoreCode: true,
    allowBodyStoreCode: true
  });
}

async function resolveLineRepairStoreContext(req, lineUserId, reason) {
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
        storeCode: publicContext.storeCode,
        source: "public_store_code",
        legacyFallback: false
      };
    }

    return {
      ok: false,
      status: 404,
      message: "找不到有效的門市代碼"
    };
  }

  const storeContext = await resolveLineWorkflowStoreContext({
    lineUserId,
    connection: pool,
    reason
  });

  return {
    ok: true,
    ...storeContext,
    storeCode: null
  };
}

function normalizeText(value) {
  return String(value || "").trim();
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
        console.warn("[line-repair] release mysql lock failed", {
          lockName,
          message: releaseError.message
        });
      }
    }
    connection.release();
  }
}

async function findRecentDuplicateRepairReservation({
  storeId,
  lineUserId,
  bikeModel,
  issueDescription
}) {
  const normalizedLineUserId = normalizeText(lineUserId);
  if (!normalizedLineUserId) {
    return null;
  }

  const [rows] = await pool.query(
    `
      SELECT
        ro.id AS repairId,
        ro.status,
        ro.bike_model AS bikeModel,
        ro.issue_description AS issueDescription,
        ro.reservation_date AS reservationDate,
        ro.reservation_time AS reservationTime,
        c.name AS customerName,
        c.phone AS customerPhone,
        c.line_user_id AS lineUserId
      FROM repair_orders ro
      LEFT JOIN customers c ON c.id = ro.customer_id AND c.store_id = ro.store_id
      WHERE ro.store_id = ?
        AND ro.deleted_at IS NULL
        AND COALESCE(ro.status, '') <> 'canceled'
        AND (ro.source = 'LINE' OR ro.customer_type = 'LINE')
        AND ro.created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND c.line_user_id = ?
        AND LOWER(TRIM(COALESCE(ro.bike_model, ''))) = LOWER(TRIM(?))
        AND LOWER(TRIM(COALESCE(ro.issue_description, ''))) = LOWER(TRIM(?))
      ORDER BY ro.id DESC
      LIMIT 1
    `,
    [
      storeId,
      REPAIR_RESERVATION_DB_DUPLICATE_WINDOW_MINUTES,
      normalizedLineUserId,
      normalizeText(bikeModel),
      normalizeText(issueDescription)
    ]
  );

  return rows[0] || null;
}

function buildRepairReservationRequestKey({ storeId, lineUserId, bikeModel, issueDescription, reservationDate, reservationTime }) {
  return [
    storeId,
    normalizeText(lineUserId),
    normalizeText(bikeModel).toLowerCase(),
    normalizeText(issueDescription).toLowerCase(),
    normalizeText(reservationDate),
    normalizeText(reservationTime)
  ].join("|");
}

function acquireRepairReservationRequestLock(key) {
  const now = Date.now();
  const expiresAt = recentRepairReservationRequests.get(key) || 0;

  if (expiresAt > now) {
    return false;
  }

  recentRepairReservationRequests.set(key, now + REPAIR_RESERVATION_DUPLICATE_WINDOW_MS);
  return true;
}

function releaseRepairReservationRequestLock(key) {
  recentRepairReservationRequests.delete(key);
}

function keepRepairReservationRequestLockTemporarily(key) {
  setTimeout(() => {
    if ((recentRepairReservationRequests.get(key) || 0) <= Date.now()) {
      recentRepairReservationRequests.delete(key);
    }
  }, REPAIR_RESERVATION_DUPLICATE_WINDOW_MS + 1000).unref?.();
}

function isPlaceholderCustomerName(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "LINE 客戶" || normalized === "LINE Customer";
}

router.use(resolvePublicStoreContext);

router.get("/customer", async (req, res, next) => {
  try {
    const lineUserId = String(req.query.lineUserId || "").trim();
    const displayName = String(req.query.displayName || "").trim();

    if (!lineUserId) {
      return res.json({ customer: null });
    }

    const storeContext = await resolveLineRepairStoreContext(req, lineUserId, "line_repair_page_customer");
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const resolvedStoreId = storeContext.storeId;

    const [rows] = await pool.query(
      `SELECT
        id,
        name,
        phone,
        line_user_id AS lineUserId,
        store_id AS storeId
      FROM customers
      WHERE line_user_id = ?
        AND store_id = ?
        AND COALESCE(crm_stage, '') <> 'deleted'
      LIMIT 1`,
      [lineUserId, resolvedStoreId]
    );

    const customer = rows[0] || null;
    if (customer && displayName) {
      const trimmedDisplayName = normalizeText(displayName);
      const updates = ["line_display_name = ?"];
      const params = [trimmedDisplayName];
      if (isPlaceholderCustomerName(customer.name)) {
        updates.unshift("name = ?");
        params.unshift(trimmedDisplayName);
      }
      await pool.query(
        `
          UPDATE customers
          SET ${updates.join(", ")}
          WHERE id = ? AND store_id = ?
        `,
        [...params, customer.id, resolvedStoreId]
      );
      if (isPlaceholderCustomerName(customer.name)) {
        customer.name = trimmedDisplayName;
      }
    }

    return res.json({ customer });
  } catch (error) {
    return next(error);
  }
});

router.post("/create", async (req, res, next) => {
  try {
    const lineUserId = String(req.body.lineUserId || "").trim();
    const displayName = String(req.body.displayName || "").trim();
    const bikeModel = String(req.body.bikeModel || "").trim();
    const issueDescription = String(req.body.issueDescription || "").trim();
    const reservationDate = req.body.reservationDate || dayjs().format("YYYY-MM-DD");
    const reservationTime = String(req.body.reservationTime || "13:00").trim();
    const warrantyTermsAccepted = req.body.warrantyTermsAccepted === true || req.body.repairWarrantyAccepted === true;
    const warrantyTermsAcceptedAt = new Date().toISOString();

    if (!lineUserId) {
      return res.status(400).json({ message: "缺少 LINE 使用者資料" });
    }

    if (!bikeModel || !issueDescription) {
      return res.status(400).json({ message: "請填寫完整維修資訊" });
    }

    if (!warrantyTermsAccepted) {
      return res.status(400).json({ message: REPAIR_WARRANTY_TERMS_ERROR_MESSAGE });
    }

    const storeContext = await resolveLineRepairStoreContext(req, lineUserId, "line_repair_page_create");
    if (!storeContext.ok) {
      return res.status(storeContext.status).json({ message: storeContext.message });
    }

    const resolvedStoreId = storeContext.storeId;
    const requestKey = buildRepairReservationRequestKey({
      storeId: resolvedStoreId,
      lineUserId,
      bikeModel,
      issueDescription,
      reservationDate,
      reservationTime
    });

    if (!acquireRepairReservationRequestLock(requestKey)) {
      return res.status(409).json({ message: "維修預約正在建立中，請不要重複送出。" });
    }

    const lockName = buildMysqlLockName("line_repair", [resolvedStoreId, lineUserId]);

    try {
      const responsePayload = await withMysqlRequestLock(lockName, async () => {
        const duplicateReservation = await findRecentDuplicateRepairReservation({
          storeId: resolvedStoreId,
          lineUserId,
          bikeModel,
          issueDescription
        });

        if (duplicateReservation) {
          releaseRepairReservationRequestLock(requestKey);
          return {
            ok: true,
            reusedExisting: true,
            duplicate: true,
            message: "維修預約已建立，請勿重複送出。",
            repairId: duplicateReservation.repairId,
            reservationDay: getReservationDay(duplicateReservation.reservationDate || reservationDate)
          };
        }

        await pool.query(
          `
            INSERT INTO line_chat_sessions (line_user_id, flow_type, step_key, payload)
            VALUES (?, ?, 'confirm', ?)
            ON DUPLICATE KEY UPDATE
              step_key = VALUES(step_key),
              payload = VALUES(payload),
              updated_at = CURRENT_TIMESTAMP
          `,
          [
            lineUserId,
            REPAIR_RESERVATION_FLOW,
            JSON.stringify({
              reservationDate,
              reservationTime,
              bikeModel,
              issueDescription,
              storeId: resolvedStoreId,
              storeCode: storeContext.storeCode || null,
              warrantyTermsAccepted: true,
              warrantyTermsVersion: REPAIR_WARRANTY_TERMS_VERSION,
              warrantyTermsAcceptedAt
            })
          ]
        );

        const result = await createRepairReservationFromSession(lineUserId, {
          storeId: resolvedStoreId,
          displayName
        });

        if (result?.phoneRequired) {
          releaseRepairReservationRequestLock(requestKey);
          throw Object.assign(new Error("請先回 LINE 對話輸入手機號碼完成綁定。"), { statusCode: 400 });
        }

        if (!result) {
          releaseRepairReservationRequestLock(requestKey);
          throw Object.assign(new Error("維修預約建立失敗"), { statusCode: 500 });
        }

      if (result.duplicate) {
        releaseRepairReservationRequestLock(requestKey);
        return {
          ok: true,
          reusedExisting: true,
          duplicate: true,
          message: "維修預約已建立，請勿重複送出。",
          repairId: result.repairId,
          reservationDay: getReservationDay(reservationDate)
        };
      }

      await pool.query(
        `
          INSERT INTO repair_logs (repair_order_id, action, note)
          VALUES (?, 'warranty_terms_accepted', ?)
        `,
        [
          result.repairId,
          JSON.stringify({
            warrantyTermsAccepted: true,
            warrantyTermsVersion: REPAIR_WARRANTY_TERMS_VERSION,
            warrantyTermsAcceptedAt,
            source: "line_repair_page"
          })
        ]
      );

      try {
        const lineNotificationResult = await notifyRepairReservationCreated({
          repairId: result.repairId,
          storeId: resolvedStoreId,
          customerName: result.customer.name || "LINE 客戶",
          customerPhone: result.customer.phone || null,
          reservationDate: result.payload.reservationDate,
          reservationTime: result.payload.reservationTime,
          bikeModel: result.payload.bikeModel,
          issueDescription: result.payload.issueDescription,
          sourceLabel: "LINE 維修預約",
          storeName: storeContext?.storeName,
          adminUrl: `${config.frontendBaseUrl}/repairs/${result.repairId}`
        }, {
          registrationTypes: ["repair", "staff", "admin"]
        });
        try {
          await logWorkflowEvent(
            "repair_reservation_line_group_notified",
            "REPAIR_ORDER",
            result.repairId,
            {
              fromLine: true,
              source: "line_repair_page",
              delivered: lineNotificationResult.delivered,
              skipped: Boolean(lineNotificationResult.skipped),
              reason: lineNotificationResult.reason || null,
              targetGroupIds: lineNotificationResult.targetGroupIds || [],
              lineGroupId: lineNotificationResult.lineGroupId || null
            },
            null
          );
        } catch (lineLogError) {
          console.warn("[staff-line] log line reservation notify event failed", {
            repairId: result.repairId,
            message: lineLogError.message
          });
        }
      } catch (staffLineError) {
        console.warn("[staff-line] line repair page notification failed after creation", {
          repairId: result.repairId,
          message: staffLineError.message
        });
        try {
          await logWorkflowEvent(
            "repair_reservation_line_group_notified",
            "REPAIR_ORDER",
            result.repairId,
            {
              fromLine: true,
              source: "line_repair_page",
              delivered: 0,
              skipped: false,
              reason: staffLineError.message || "notification_exception",
              targetGroupIds: [],
              exception: true
            },
            null
          );
        } catch (lineLogError) {
          console.warn("[staff-line] log line reservation notify failure event failed", {
            repairId: result.repairId,
            message: lineLogError.message
          });
        }
      }

      releaseRepairReservationRequestLock(requestKey);
      return {
        ok: true,
        repairId: result.repairId,
        reservationDay: getReservationDay(reservationDate)
      };
      });

      return res.json(responsePayload);
    } catch (createError) {
      releaseRepairReservationRequestLock(requestKey);
      throw createError;
    }
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
