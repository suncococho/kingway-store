const express = require("express");
const { pool } = require("../db");
const config = require("../config");
const { authenticate, authorize } = require("../middleware/auth");
const { verifyLineSignature } = require("../utils/line");
const { sendDailyReport } = require("../services/reportService");
const { logKpi } = require("../services/kpiService");
const {
  logWorkflowEvent,
  buildWelcomeMessages,
  buildStaffLauncherMessages,
  claimLineWebhookEvent,
  findOrCreateLineCustomer,
  handleCustomerMessageEvent,
  handleLineSlashCommand,
  handleStaffOperationalCommand,
  handleLinePostback,
  mapRegistrationTypeLabel,
  replyToLine,
  sendToGroups,
  withStaffQuickReply,
  createFlexMessage,
  createUriAction
} = require("../services/lineWorkflowService");

const router = express.Router();

router.post("/webhook", async (req, res, next) => {
  try {
    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody || "";

    if (!verifyLineSignature(rawBody, config.line.channelSecret, signature)) {
      return res.status(401).json({ message: "Invalid LINE signature" });
    }

    const events = Array.isArray(req.body.events) ? req.body.events : [];
    await logWorkflowEvent("line_webhook_received", "WEBHOOK", null, {
      eventCount: events.length,
      path: req.originalUrl
    });
    console.log("[line:webhook] received", {
      method: req.method,
      url: req.originalUrl,
      events: events.length
    });

    for (const event of events) {
      const claimResult = await claimLineWebhookEvent(event, req.originalUrl);
      if (!claimResult.claimed) {
        await logWorkflowEvent("line_webhook_duplicate_skipped", "WEBHOOK", null, {
          path: req.originalUrl,
          eventType: event?.type || null,
          eventKey: claimResult.eventKey
        });
        console.log("[line:webhook] skip duplicate", {
          eventType: event?.type || null,
          eventKey: claimResult.eventKey
        });
        continue;
      }

      const sourceType = event.source && event.source.type;
      const messageText = event.message && event.message.type === "text" ? event.message.text.trim() : "";
      console.log("[line:webhook] event", {
        eventType: event.type,
        eventKey: claimResult.eventKey,
        sourceType,
        userId: event.source?.userId || null,
        groupId: event.source?.groupId || null,
        roomId: event.source?.roomId || null,
        messageType: event.message?.type || null,
        messageText
      });

      if (event.type === "follow" && event.source.userId) {
        await findOrCreateLineCustomer(event.source.userId);
        if (event.replyToken) {
          await replyToLine(event.replyToken, buildWelcomeMessages());
        }
      }

      if (event.type === "postback") {
        console.log("[line:webhook] route postback", {
          sourceType,
          data: event.postback?.data || null
        });
        await handleLinePostback(event);
      }

      if ((sourceType === "group" || sourceType === "room") && messageText.startsWith("/register")) {
        console.log("[line:webhook] route register", {
          sourceType,
          messageText
        });
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
          const qaModeNote = config.line.unifiedQaGroupMode
            ? "\n目前已啟用單一 LINE 測試群組模式，其他群組通知會暫時統一路由到這個測試群組。"
            : "";
          const responseMessages = [
            {
              type: "text",
              text: `群組已註冊為 ${mapRegistrationTypeLabel(registrationType)}。${qaModeNote}`
            }
          ];
          if (["admin", "staff", "repair", "inventory"].includes(registrationType)) {
            responseMessages.push(...buildStaffLauncherMessages());
          }
          await replyToLine(event.replyToken, responseMessages);
        }
        continue;
      }

      if ((sourceType === "group" || sourceType === "room") && ["功能", "選單", "menu", "MENU", "/menu", "工作台"].includes(messageText)) {
        console.log("[line:webhook] route menu", {
          sourceType,
          messageText
        });
        if (event.replyToken) {
          await replyToLine(event.replyToken, buildStaffLauncherMessages());
        }
        continue;
      }

      if (messageText) {
        console.log("[line:webhook] route slash:detect", {
          sourceType,
          messageText
        });
        const handledBySlash = await handleLineSlashCommand(event);
        console.log("[line:webhook] route slash:result", {
          sourceType,
          messageText,
          handled: handledBySlash
        });
        if (handledBySlash) {
          continue;
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
            if (event.replyToken) {
              await replyToLine(
                event.replyToken,
                withStaffQuickReply([
                  {
                    type: "text",
                    text: "已完成上班打卡。"
                  }
                ])
              );
            }
          } else if (event.replyToken) {
            await replyToLine(
              event.replyToken,
              withStaffQuickReply([
                {
                  type: "text",
                  text: "今天已經完成打卡。"
                }
              ])
            );
          }
        } else if (event.replyToken) {
          await replyToLine(
            event.replyToken,
            withStaffQuickReply([
              {
                type: "text",
                text: "找不到員工帳號，請先完成 LINE 綁定。"
              }
            ])
          );
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
          if (event.replyToken) {
            await replyToLine(
              event.replyToken,
              withStaffQuickReply([
                {
                  type: "text",
                  text: "已完成下班打卡。"
                }
              ])
            );
          }
        } else if (event.replyToken) {
          await replyToLine(
            event.replyToken,
            withStaffQuickReply([
              {
                type: "text",
                text: "找不到員工帳號，請先完成 LINE 綁定。"
              }
            ])
          );
        }
      }

      if (messageText === "/checkin" || messageText === "/checkout") {
        continue;
      }

      if (sourceType === "user" && event.source.userId && messageText) {
        console.log("[line:webhook] route fallback:customer", {
          sourceType,
          messageText
        });
        await handleCustomerMessageEvent(event);
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
          (SELECT COUNT(*) FROM repair_orders WHERE status IN ('checking', 'reserved', 'estimate_pending_approval', 'estimate_approved', 'completed_waiting_pickup')) AS repairsPending,
          (SELECT COUNT(*) FROM coupons WHERE coupon_type = 'google_review' AND approved_by_staff_id IS NULL) AS reviewPending
      `
    );

    const message = [
      "KINGWAY 待處理事項",
      `購買確認待處理：${summary.purchaseConfirmationsPending}`,
      `維修待處理：${summary.repairsPending}`,
      `Google 評論待確認：${summary.reviewPending}`
    ].join("\n");
    const notification = [
      createFlexMessage(
        "今日待確認",
        "今日待確認",
        message.split("\n"),
        [createUriAction("前往今日待確認", `${config.frontendBaseUrl}/dashboard`)]
      )
    ];

    const delivered = await sendToGroups(["admin", "staff"], notification);

    return res.json({ delivered, message });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
