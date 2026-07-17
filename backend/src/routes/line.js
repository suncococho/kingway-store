const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const config = require("../config");
const { authenticate, authorize } = require("../middleware/auth");
const { verifyLineSignature, sendLineReply } = require("../utils/line");
const { resolveStoreLineCredentials } = require("../services/storeLineSettingsService");
const {
  recordStoreLineChannelWebhookReceived,
  resolveStoreLineChannelByWebhookPath
} = require("../services/storeLineChannelService");
const {
  detectGroupTypeHint,
  getEventGroupId,
  maskLineId,
  shouldCaptureGroupCandidate,
  upsertLineGroupCandidate
} = require("../services/lineGroupCandidateService");
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
  runWithLineAccessTokenOptions,
  sendToGroups,
  withStaffQuickReply,
  createFlexMessage,
  createUriAction
} = require("../services/lineWorkflowService");

const router = express.Router();

function normalizeWebhookPathToken(value) {
  const raw = String(value || "");
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (raw !== trimmed || /\s/.test(trimmed)) {
    throw createHttpError("webhook_path 格式不正確", 400);
  }
  if (trimmed.length > 500) {
    throw createHttpError("webhook_path 格式不正確", 400);
  }

  let token = trimmed;
  const channelPrefix = "/api/line/webhook/channel/";
  const legacyPrefix = "/api/line/webhook/";
  try {
    const parsed = new URL(token);
    if (parsed.search || parsed.hash) {
      throw createHttpError("webhook_path 格式不正確", 400);
    }
    if (!parsed.pathname.startsWith(channelPrefix) && !parsed.pathname.startsWith(legacyPrefix)) {
      throw createHttpError("webhook_path 格式不正確", 400);
    }
    token = parsed.pathname;
  } catch (error) {
    if (error.statusCode) throw error;
    // Not a full URL; continue with the raw path/token.
  }

  if (token.startsWith(channelPrefix)) {
    token = token.slice(channelPrefix.length);
  } else if (token.startsWith(legacyPrefix)) {
    token = token.slice(legacyPrefix.length);
  }

  return token;
}

function buildWebhookPathFromToken(webhookPathToken) {
  return `/api/line/webhook/${webhookPathToken}`;
}

function hashWebhookPathToken(webhookPathToken) {
  if (!webhookPathToken) {
    return null;
  }

  return `sha256:${crypto.createHash("sha256").update(webhookPathToken).digest("hex").slice(0, 16)}`;
}

async function findStoreLineSettingsByWebhookPathToken(webhookPathToken) {
  const [rows] = await pool.query(
    `
      SELECT
        store_id AS storeId,
        line_enabled AS lineEnabled,
        channel_id AS channelId,
        channel_access_token_ref AS channelAccessTokenRef,
        channel_secret_ref AS channelSecretRef,
        channel_secret_present AS channelSecretPresent,
        channel_access_token_present AS channelAccessTokenPresent,
        webhook_path AS webhookPath,
        staff_group_enabled AS staffGroupEnabled,
        updated_at AS updatedAt
      FROM store_line_settings
      WHERE webhook_path = ?
      LIMIT 1
    `,
    [buildWebhookPathFromToken(webhookPathToken)]
  );

  return rows[0] || null;
}

function buildTokenizedWebhookRouteDecision(event) {
  const eventType = event?.type || "unknown";
  const sourceType = event?.source?.type || null;
  const messageType = event?.message?.type || null;
  const hasReplyToken = Boolean(event?.replyToken);
  const messageText = messageType === "text" ? String(event?.message?.text || "") : null;

  let intendedHandler = "unknown";
  let wouldHandle = false;

  if (eventType === "postback") {
    intendedHandler = "postback";
    wouldHandle = true;
  } else if (eventType === "follow") {
    intendedHandler = "follow";
    wouldHandle = true;
  } else if (eventType === "message" && messageType === "text") {
    intendedHandler = "message_text";
    wouldHandle = true;
  } else if (eventType === "message" && messageType) {
    intendedHandler = `message_${messageType}`;
  }

  return {
    eventType,
    hasReplyToken,
    sourceType,
    messageType,
    messageText,
    wouldHandle,
    intendedHandler
  };
}

function isLimitedTokenizedReplyEvent(event) {
  return (
    event?.type === "message" &&
    event?.message?.type === "text" &&
    Boolean(event?.replyToken) &&
    (event.message.text === "ping" || event.message.text === "PING")
  );
}


function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertValidWebhookPathToken(webhookPathToken) {
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(webhookPathToken)) {
    throw createHttpError("webhook_path 格式不正確", 400);
  }
}

function isStagingRuntime() {
  const marker = `${config.nodeEnv || ""} ${config.appEnv || ""}`.toLowerCase();
  return marker.includes("staging");
}

function refMatchesStagingAllowPattern(ref) {
  const normalizedRef = String(ref || "").toLowerCase();
  if (!normalizedRef) return false;
  const patterns = config.line.stagingCredentialRefAllowPatterns || [];
  const refMarkers = normalizedRef.split(/[^a-z0-9]+/).filter(Boolean);
  return patterns.some((pattern) => {
    const normalizedPattern = String(pattern || "").trim().toLowerCase();
    return normalizedPattern && refMarkers.includes(normalizedPattern);
  });
}

function assertStagingStoreLineChannelAllowed(channel, webhookPath) {
  if (!isStagingRuntime()) return;

  const token = normalizeWebhookPathToken(webhookPath || channel.webhookPath);
  const allowedPrefixes = config.line.stagingChannelWebhookAllowedPrefixes || ["kwstg_"];
  const hasAllowedPrefix = allowedPrefixes.some((prefix) => token.startsWith(prefix));
  if (!hasAllowedPrefix) {
    throw createHttpError("staging LINE webhook token 未在允許清單內", 403);
  }

  if (!refMatchesStagingAllowPattern(channel.lineChannelSecretRef) || !refMatchesStagingAllowPattern(channel.channelAccessTokenRef)) {
    throw createHttpError("staging LINE channel credentials ref 不符合 staging 命名規則", 403);
  }
}

async function findAuthorizedLineGroupRegistrar(storeId, lineUserId) {
  if (!storeId || !lineUserId) return null;

  const [rows] = await pool.query(
    `
      SELECT id, role, display_name AS displayName
      FROM staff_users
      WHERE store_id = ?
        AND line_user_id = ?
        AND is_active = 1
        AND role IN ('ADMIN')
      LIMIT 1
    `,
    [storeId, lineUserId]
  );

  return rows[0] || null;
}

const REGISTER_USAGE_MESSAGE = "請使用：\n/register daily\n/register repair\n/register staff\n/register admin";
const LINE_GROUP_REGISTRATION_TYPES = new Set(["daily", "repair", "staff", "admin"]);
const STAFF_LAUNCHER_REGISTRATION_TYPES = new Set(["admin", "staff", "repair"]);

function parseLineGroupRegistrationType(messageText) {
  const parts = String(messageText || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2 || !LINE_GROUP_REGISTRATION_TYPES.has(parts[1])) {
    return { ok: false, message: REGISTER_USAGE_MESSAGE };
  }
  return { ok: true, registrationType: parts[1] };
}

async function handleLineGroupRegistration(event, lineContext, registrationType) {
  const sourceType = event.source && event.source.type;
  const lineGroupId = sourceType === "group" ? event.source.groupId : event.source.roomId;
  const lineUserId = event.source && event.source.userId;
  const storeId = Number(lineContext.storeId || 1);

  if (!LINE_GROUP_REGISTRATION_TYPES.has(registrationType)) {
    return { ok: false, code: "invalid_type", message: REGISTER_USAGE_MESSAGE };
  }

  if ((sourceType !== "group" && sourceType !== "room") || !lineGroupId || !lineUserId || !storeId) {
    return { ok: false, message: "無權限註冊群組，請由門市管理員操作。" };
  }

  const registrar = await findAuthorizedLineGroupRegistrar(storeId, lineUserId);
  if (!registrar) {
    return { ok: false, message: "無權限註冊群組，請由門市管理員操作。" };
  }

  const groupName = `${sourceType}:${lineGroupId.slice(0, 8)}`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
        SELECT id, registration_type AS registrationType
        FROM line_group_registrations
        WHERE line_group_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [lineGroupId]
    );
    const existing = existingRows[0] || null;

    if (existing && existing.registrationType !== registrationType) {
      await connection.rollback();
      const typeLabel = mapRegistrationTypeLabel(existing.registrationType) || existing.registrationType || "其他用途";
      return { ok: false, code: "type_conflict", message: `此群組已註冊為 ${typeLabel}。
如需不同用途，請建立另一個 LINE 群組。` };
    }

    if (existing) {
      await connection.query(
        `
          UPDATE line_group_registrations
          SET source_type = ?,
              group_name = ?,
              registered_by_line_user_id = ?,
              is_active = 1
          WHERE id = ?
            AND registration_type = ?
        `,
        [sourceType, groupName, lineUserId, existing.id, registrationType]
      );
    } else {
      try {
        await connection.query(
          `
            INSERT INTO line_group_registrations (line_group_id, source_type, registration_type, group_name, registered_by_line_user_id, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
          `,
          [lineGroupId, sourceType, registrationType, groupName, lineUserId]
        );
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;

        const [raceRows] = await connection.query(
          `
            SELECT id, registration_type AS registrationType
            FROM line_group_registrations
            WHERE line_group_id = ?
            LIMIT 1
            FOR UPDATE
          `,
          [lineGroupId]
        );
        const raceExisting = raceRows[0] || null;
        if (!raceExisting || raceExisting.registrationType !== registrationType) {
          await connection.rollback();
          const typeLabel = mapRegistrationTypeLabel(raceExisting?.registrationType) || raceExisting?.registrationType || "其他用途";
          return { ok: false, code: "type_conflict", message: `此群組已註冊為 ${typeLabel}。
如需不同用途，請建立另一個 LINE 群組。` };
        }
        await connection.query(
          `
            UPDATE line_group_registrations
            SET source_type = ?,
                group_name = ?,
                registered_by_line_user_id = ?,
                is_active = 1
            WHERE id = ?
              AND registration_type = ?
          `,
          [sourceType, groupName, lineUserId, raceExisting.id, registrationType]
        );
      }
    }

    await connection.commit();
    return { ok: true, registrationType };
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) {}
    throw error;
  } finally {
    connection.release();
  }
}

async function handleLineWebhookEvents({ req, events, lineContext = {} }) {
  const scopedLineContext = {
    allowConfigFallback: lineContext.allowConfigFallback !== false,
    ...lineContext
  };

  return runWithLineAccessTokenOptions(scopedLineContext, async () => {
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
        lineUserIdMasked: maskLineId(event.source?.userId),
        lineGroupIdMasked: maskLineId(event.source?.groupId),
        lineRoomIdMasked: maskLineId(event.source?.roomId),
        messageType: event.message?.type || null,
        messageText
      });

      if (
        event.type === "message" &&
        (sourceType === "group" || sourceType === "room") &&
        messageText &&
        shouldCaptureGroupCandidate(messageText)
      ) {
        const lineGroupId = getEventGroupId(event.source || {});
        const hint = detectGroupTypeHint(messageText);
        try {
          const candidate = await upsertLineGroupCandidate({
            groupId: lineGroupId,
            sourceType,
            messageText,
            hint
          });
          console.log("[line:webhook] group candidate detected", {
            sourceType,
            groupIdMasked: maskLineId(lineGroupId),
            candidateId: candidate?.id || null,
            hint: candidate?.groupTypeHint || hint
          });
        } catch (error) {
          console.warn("[line:webhook] group candidate save failed", {
            sourceType,
            groupIdMasked: maskLineId(lineGroupId),
            code: error.code || null,
            message: error.message
          });
        }

        if (event.replyToken) {
          try {
            await replyToLine(event.replyToken, [
              {
                type: "text",
                text: "已收到 KINGWAY 群組登錄訊息，請到 POS 系統設定連結此群組。"
              }
            ]);
          } catch (error) {
            console.warn("[line:webhook] group candidate reply failed", {
              sourceType,
              groupIdMasked: maskLineId(lineGroupId),
              code: error.code || null,
              message: error.message
            });
          }
        }
        continue;
      }

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
          messageText,
          scopedPolicy: scopedLineContext.registrationPolicy || null
        });

        if (scopedLineContext.registrationPolicy === "staging_staff_only") {
          const parsed = parseLineGroupRegistrationType(messageText);
          if (!parsed.ok || parsed.registrationType !== "staff") {
            if (event.replyToken) {
              await replyToLine(event.replyToken, [
                {
                  type: "text",
                  text: parsed.ok ? "staging 測試頻道目前只支援 /register staff。" : parsed.message
                }
              ]);
            }
            continue;
          }

          const registrationResult = await handleLineGroupRegistration(event, scopedLineContext, "staff");
          if (event.replyToken) {
            const responseMessages = registrationResult.ok
              ? [
                  {
                    type: "text",
                    text: `群組已註冊為 ${mapRegistrationTypeLabel("staff")}。`
                  },
                  ...buildStaffLauncherMessages()
                ]
              : [
                  {
                    type: "text",
                    text: registrationResult.message || "無權限註冊群組，請由門市管理員操作。"
                  }
                ];
            await replyToLine(event.replyToken, responseMessages);
          }
          continue;
        }

        const parsed = parseLineGroupRegistrationType(messageText);
        if (!parsed.ok) {
          if (event.replyToken) {
            await replyToLine(event.replyToken, [
              {
                type: "text",
                text: parsed.message
              }
            ]);
          }
          continue;
        }

        const registrationResult = await handleLineGroupRegistration(event, scopedLineContext, parsed.registrationType);

        if (event.replyToken) {
          const responseMessages = registrationResult.ok
            ? [
                {
                  type: "text",
                  text: `群組已註冊為 ${mapRegistrationTypeLabel(registrationResult.registrationType)}。${
                    config.line.unifiedQaGroupMode
                      ? "\n目前已啟用單一 LINE 測試群組模式，其他群組通知會暫時統一路由到這個測試群組。"
                      : ""
                  }`
                }
              ]
            : [
                {
                  type: "text",
                  text: registrationResult.message || "無權限註冊群組，請由門市管理員操作。"
                }
              ];
          if (registrationResult.ok && STAFF_LAUNCHER_REGISTRATION_TYPES.has(registrationResult.registrationType)) {
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


  });
}

router.post("/webhook/channel/:webhookPath", async (req, res, next) => {
  try {
    const webhookPath = normalizeWebhookPathToken(req.params.webhookPath);
    assertValidWebhookPathToken(webhookPath);
    const webhookPathHash = hashWebhookPathToken(webhookPath);
    const resolved = await resolveStoreLineChannelByWebhookPath(webhookPath);
    const { channel } = resolved;
    assertStagingStoreLineChannelAllowed(channel, webhookPath);
    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody || "";

    if (!verifyLineSignature(rawBody, resolved.channelSecret.secret, signature)) {
      console.warn("[line:webhook:channel] invalid signature", {
        storeId: channel.storeId,
        channelId: channel.id,
        webhookPathHash
      });
      return res.status(401).json({ message: "Invalid LINE signature" });
    }

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const destinations = [...new Set(events.map((event) => String(event?.destination || "").trim()).filter(Boolean))];
    const configuredLineChannelId = String(channel.lineChannelId || "").trim();
    const destinationMismatch = configuredLineChannelId && destinations.length > 0
      ? destinations.some((destination) => destination !== configuredLineChannelId)
      : false;

    if (destinationMismatch) {
      console.warn("[line:webhook:channel] destination mismatch", {
        storeId: channel.storeId,
        channelId: channel.id,
        webhookPathHash,
        destinationCount: destinations.length
      });
      return res.status(403).json({ message: "LINE webhook destination mismatch" });
    }

    await recordStoreLineChannelWebhookReceived(channel.id);

    const lineContext = {
      storeId: channel.storeId,
      storeCode: channel.storeCode || null,
      lineChannelId: channel.lineChannelId || null,
      lineChannelDbId: channel.id,
      lineOfficialAccountId: channel.lineOfficialAccountId || null,
      lineBasicId: channel.lineBasicId || null,
      source: "store_line_channel",
      purpose: "store_line_channel_webhook",
      channelAccessTokenRef: channel.channelAccessTokenRef || null,
      channelSecretRef: channel.lineChannelSecretRef || null,
      credentialsResolved: true,
      allowConfigFallback: false,
      registrationPolicy: isStagingRuntime() ? "staging_staff_only" : null,
      channelAccessToken: resolved.channelAccessToken.secret
    };
    req.lineContext = lineContext;

    await logWorkflowEvent("line_webhook_received", "WEBHOOK", channel.storeId, {
      eventCount: events.length,
      path: req.originalUrl,
      source: lineContext.source,
      lineChannelDbId: channel.id,
      webhookPathHash
    });
    console.log("[line:webhook:channel] received", {
      method: req.method,
      url: req.originalUrl,
      storeId: channel.storeId,
      channelId: channel.id,
      events: events.length,
      webhookPathHash
    });

    await handleLineWebhookEvents({
      req,
      events,
      lineContext
    });

    return res.json({
      ok: true,
      mode: "store_line_channel_webhook",
      storeId: channel.storeId,
      storeCode: channel.storeCode || null,
      lineChannelDbId: channel.id,
      eventCount: events.length
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/webhook/:webhookPathToken", async (req, res, next) => {
  try {
    const webhookPathToken = normalizeWebhookPathToken(req.params.webhookPathToken);
    const webhookPathTokenHash = hashWebhookPathToken(webhookPathToken);

    if (!/^[A-Za-z0-9_-]{1,190}$/.test(webhookPathToken)) {
      return res.status(404).json({
        ok: false,
        mode: "tokenized_webhook_dry_run",
        dryRun: true,
        sendSuppressed: true,
        resolved: false,
        credentialsResolved: false,
        message: "找不到對應的門市 LINE webhook 設定"
      });
    }

    const row = await findStoreLineSettingsByWebhookPathToken(webhookPathToken);

    if (!row) {
      console.warn("[line:webhook:skeleton] mapping not found", {
        webhookPathTokenHash
      });
      return res.status(404).json({
        ok: false,
        mode: "tokenized_webhook_dry_run",
        dryRun: true,
        sendSuppressed: true,
        resolved: false,
        credentialsResolved: false,
        message: "找不到對應的門市 LINE webhook 設定"
      });
    }

    console.log("[line:webhook:skeleton] mapping resolved", {
      storeId: row.storeId,
      webhookPathTokenHash,
      channelIdPresent: Boolean(row.channelId),
      channelSecretPresent: Boolean(row.channelSecretPresent),
      channelAccessTokenPresent: Boolean(row.channelAccessTokenPresent)
    });

    const resolvedCredentials = await resolveStoreLineCredentials({
      storeId: row.storeId,
      purpose: "tokenized_webhook"
    });

    if (!resolvedCredentials.channelSecret) {
      console.warn("[line:webhook:skeleton] secret unavailable", {
        storeId: row.storeId,
        webhookPathTokenHash,
        channelSecretSource: resolvedCredentials.channelSecretStatus?.source || "none",
        channelSecretResolvable: Boolean(resolvedCredentials.channelSecretStatus?.resolvable),
        channelSecretPresent: Boolean(row.channelSecretPresent)
      });
      return res.status(503).json({
        ok: false,
        mode: "tokenized_webhook_dry_run",
        dryRun: true,
        sendSuppressed: true,
        resolved: true,
        signatureVerified: false,
        credentialsResolved: false,
        message: "找不到可用的 LINE channel secret 設定"
      });
    }

    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody || "";
    const signatureVerified = verifyLineSignature(rawBody, resolvedCredentials.channelSecret, signature);

    if (!signatureVerified) {
      console.warn("[line:webhook:skeleton] invalid signature", {
        storeId: row.storeId,
        webhookPathTokenHash
      });
      return res.status(401).json({
        ok: false,
        mode: "tokenized_webhook_dry_run",
        dryRun: true,
        sendSuppressed: true,
        resolved: true,
        signatureVerified: false,
        credentialsResolved: false,
        message: "Invalid LINE signature"
      });
    }

    if (!resolvedCredentials.credentialsResolved || !resolvedCredentials.accessToken || !resolvedCredentials.channelSecret) {
      console.warn("[line:webhook:skeleton] credentials unavailable", {
        storeId: row.storeId,
        webhookPathTokenHash,
        accessTokenSource: resolvedCredentials.channelAccessTokenStatus?.source || "none",
        channelSecretSource: resolvedCredentials.channelSecretStatus?.source || "none",
        accessTokenResolvable: Boolean(resolvedCredentials.channelAccessTokenStatus?.resolvable),
        channelSecretResolvable: Boolean(resolvedCredentials.channelSecretStatus?.resolvable)
      });
      return res.status(503).json({
        ok: false,
        mode: "tokenized_webhook_dry_run",
        dryRun: true,
        sendSuppressed: true,
        resolved: true,
        signatureVerified: true,
        credentialsResolved: false,
        message: "找不到可用的門市 LINE credentials"
      });
    }

    const lineContext = {
      storeId: resolvedCredentials.storeId,
      storeCode: resolvedCredentials.storeCode,
      lineChannelId: row.channelId || null,
      channelAccessTokenRef: row.channelAccessTokenRef || null,
      channelSecretRef: row.channelSecretRef || null,
      source: "tokenized_webhook_reply",
      purpose: "tokenized_webhook_reply",
      credentialsResolved: true
    };
    req.lineContext = lineContext;

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const routeDecisions = events.map(buildTokenizedWebhookRouteDecision);
    const replyCandidates = events.filter(isLimitedTokenizedReplyEvent);

    if (replyCandidates.length > 0) {
      try {
        for (const event of replyCandidates) {
          await sendLineReply(config, event.replyToken, [{ type: "text", text: "pong" }], {
            channelAccessToken: resolvedCredentials.accessToken,
            accessToken: resolvedCredentials.accessToken,
            allowConfigFallback: false,
            context: lineContext
          });
        }

        console.log("[line:webhook:tokenized-reply] delivered", {
          storeId: resolvedCredentials.storeId,
          webhookPathTokenHash,
          replyAttemptedCount: replyCandidates.length,
          lineChannelId: row.channelId || null
        });

        return res.status(200).json({
          ok: true,
          mode: "tokenized_webhook_reply",
          dryRun: false,
          sendSuppressed: false,
          resolved: true,
          signatureVerified: true,
          credentialsResolved: true,
          replyAttempted: true,
          replyDelivered: true,
          replyAttemptedCount: replyCandidates.length,
          replyMessage: "pong",
          storeScopedTokenUsed: true,
          storeId: resolvedCredentials.storeId,
          storeCode: resolvedCredentials.storeCode,
          eventCount: routeDecisions.length,
          routeDecisions
        });
      } catch (error) {
        console.warn("[line:webhook:tokenized-reply] failed", {
          storeId: resolvedCredentials.storeId,
          webhookPathTokenHash,
          replyAttemptedCount: replyCandidates.length,
          lineApiStatus: error.lineApiStatus || null,
          safeDetails: error.safeDetails || error.message
        });

        return res.status(error.statusCode || 502).json({
          ok: false,
          mode: "tokenized_webhook_reply",
          dryRun: false,
          sendSuppressed: true,
          resolved: true,
          signatureVerified: true,
          credentialsResolved: true,
          replyAttempted: true,
          replyDelivered: false,
          replyAttemptedCount: replyCandidates.length,
          storeScopedTokenUsed: true,
          storeId: resolvedCredentials.storeId,
          storeCode: resolvedCredentials.storeCode,
          eventCount: routeDecisions.length,
          routeDecisions,
          message: "LINE reply failed safely",
          safeError: error.safeDetails || error.message
        });
      }
    }

    console.log("[line:webhook:dry-run] analyzed", {
      storeId: resolvedCredentials.storeId,
      webhookPathTokenHash,
      eventCount: routeDecisions.length,
      intendedHandlers: routeDecisions.map((decision) => decision.intendedHandler)
    });

    return res.status(200).json({
      ok: true,
      mode: "tokenized_webhook_dry_run",
      dryRun: true,
      sendSuppressed: true,
      resolved: true,
      signatureVerified: true,
      credentialsResolved: true,
      storeId: resolvedCredentials.storeId,
      storeCode: resolvedCredentials.storeCode,
      eventCount: routeDecisions.length,
      routeDecisions,
      lineEnabled: Boolean(row.lineEnabled),
      channelIdPresent: Boolean(row.channelId),
      channelSecretPresent: Boolean(row.channelSecretPresent),
      channelAccessTokenPresent: Boolean(row.channelAccessTokenPresent),
      staffGroupEnabled: Boolean(row.staffGroupEnabled),
      webhookConfigured: Boolean(row.webhookPath),
      updatedAt: row.updatedAt || null
    });
  } catch (error) {
    return next(error);
  }
});

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

    await handleLineWebhookEvents({
      req,
      events,
      lineContext: {
        source: "global_webhook",
        purpose: "global_webhook",
        allowConfigFallback: true,
        credentialsResolved: true
      }
    });

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
