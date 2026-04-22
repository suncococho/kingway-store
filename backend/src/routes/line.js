const express = require("express");
const { pool } = require("../db");
const config = require("../config");
const { authenticate, authorize } = require("../middleware/auth");
const { verifyLineSignature, sendLineMessage } = require("../utils/line");
const { sendDailyReport } = require("../services/reportService");
const { logKpi } = require("../services/kpiService");

const router = express.Router();

router.post("/webhook", async (req, res, next) => {
console.log("LINE BODY:", JSON.stringify(req.body));
  try {
    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody || "";

    if (!verifyLineSignature(rawBody, config.line.channelSecret, signature)) {
      return res.status(401).json({ message: "Invalid LINE signature" });
    }

    const events = Array.isArray(req.body.events) ? req.body.events : [];

    for (const event of events) {
      const sourceType = event.source && event.source.type;
      const messageText = event.message && event.message.type === "text" ? event.message.text.trim() : "";

      if ((sourceType === "group" || sourceType === "room") && messageText.startsWith("/register")) {
        const lineGroupId = sourceType === "group" ? event.source.groupId : event.source.roomId;
        const groupName = `${sourceType}:${lineGroupId.slice(0, 8)}`;
        const parts = messageText.split(/\s+/);
        const registrationType = ["admin", "staff", "repair", "inventory", "daily"].includes(parts[1])
          ? parts[1]
          : "daily";

        await pool.query(
          `
            INSERT INTO line_group_registrations (line_group_id, source_type, registration_type, group_name, registered_by_line_user_id, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
              source_type = VALUES(source_type),
              registration_type = VALUES(registration_type),
              group_name = VALUES(group_name),
              registered_by_line_user_id = VALUES(registered_by_line_user_id),
              is_active = 1
          `,
          [lineGroupId, sourceType, registrationType, groupName, event.source.userId || null]
        );

        if (event.replyToken) {
          await replyToLine(event.replyToken, [
            {
              type: "text",
              text: `\u7FA4\u7D44\u5DF2\u8A3B\u518A\u70BA ${registrationType} \u901A\u77E5\u7FA4\u7D44\u3002`
            }
          ]);
        }
      }

      if (messageText === "/checkin" && event.source.userId) {
        const [staffRows] = await pool.query(
          `
            SELECT id
            FROM staff_users
            WHERE line_user_id = ?
            LIMIT 1
          `,
          [event.source.userId]
        );

        if (staffRows[0]) {
          const [openRows] = await pool.query(
            `
              SELECT id
              FROM staff_attendance
              WHERE staff_user_id = ? AND check_out_at IS NULL
              LIMIT 1
            `,
            [staffRows[0].id]
          );

          if (!openRows[0]) {
            await pool.query(
              `
                INSERT INTO staff_attendance (staff_user_id, check_in_at)
                VALUES (?, NOW())
              `,
              [staffRows[0].id]
            );
            await logKpi(staffRows[0].id, "LINE_CHECK_IN", "ATTENDANCE", null, 1);
          }
        }
      }

      if (messageText === "/checkout" && event.source.userId) {
        const [staffRows] = await pool.query(
          `
            SELECT id
            FROM staff_users
            WHERE line_user_id = ?
            LIMIT 1
          `,
          [event.source.userId]
        );

        if (staffRows[0]) {
          await pool.query(
            `
              UPDATE staff_attendance
              SET check_out_at = NOW()
              WHERE staff_user_id = ? AND check_out_at IS NULL
            `,
            [staffRows[0].id]
          );
        }
      }
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/groups", authenticate, authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          id,
          line_group_id AS lineGroupId,
          source_type AS sourceType,
          registration_type AS registrationType,
          group_name AS groupName,
          registered_by_line_user_id AS registeredByLineUserId,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM line_group_registrations
        ORDER BY id DESC
      `
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/daily-report/send", authenticate, authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const result = await sendDailyReport(config, req.body.date);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/pending-summary/send", authenticate, authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  try {
    const [[summary]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM purchase_confirmation_tokens WHERE used_at IS NULL AND expires_at >= NOW()) AS purchaseConfirmationsPending,
          (SELECT COUNT(*) FROM repair_orders WHERE status IN ('reserved', 'estimate_pending_approval', 'completed_waiting_pickup')) AS repairsPending,
          (SELECT COUNT(*) FROM coupons WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL) AS reviewPending
      `
    );

    const message = [
      "KINGWAY Pending Tasks",
      `Purchase confirmations: ${summary.purchaseConfirmationsPending}`,
      `Repairs pending: ${summary.repairsPending}`,
      `Google review approvals: ${summary.reviewPending}`
    ].join("\n");

    const [groups] = await pool.query(
      `
        SELECT line_group_id
        FROM line_group_registrations
        WHERE is_active = 1 AND registration_type IN ('admin', 'staff')
      `
    );

    for (const group of groups) {
      await sendLineMessage(config, group.line_group_id, [{ type: "text", text: message }]);
    }

    return res.json({ delivered: groups.length, message });
  } catch (error) {
    return next(error);
  }
});

async function replyToLine(replyToken, messages) {
  if (!config.line.channelAccessToken) {
    return;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.line.channelAccessToken}`
    },
    body: JSON.stringify({
      replyToken,
      messages
    })
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`LINE reply failed: ${response.status} ${details}`);
    error.statusCode = 502;
    throw error;
  }
}

module.exports = router;
