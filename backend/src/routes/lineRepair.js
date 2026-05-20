const express = require("express");
const dayjs = require("dayjs");
const { pool } = require("../db");
const {
  createRepairReservationFromSession,
  sendToGroupsWithResult,
  buildGroupApprovalMessage,
  logWorkflowEvent
} = require("../services/lineWorkflowService");

const router = express.Router();

const REPAIR_RESERVATION_FLOW = "repair_reservation";

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

router.get("/customer", async (req, res, next) => {
  try {
    const lineUserId = String(req.query.lineUserId || "").trim();

    if (!lineUserId) {
      return res.json({ customer: null });
    }

    const [rows] = await pool.query(
      `SELECT
         id,
         name,
         phone,
         line_user_id AS lineUserId
       FROM customers
       WHERE line_user_id = ?
         AND COALESCE(crm_stage, '') <> 'deleted'
       LIMIT 1`,
      [lineUserId]
    );

    return res.json({ customer: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.post("/create", async (req, res, next) => {
  try {
    const lineUserId = String(req.body.lineUserId || "").trim();
    const bikeModel = String(req.body.bikeModel || "").trim();
    const issueDescription = String(req.body.issueDescription || "").trim();
    const reservationDate = req.body.reservationDate || dayjs().format("YYYY-MM-DD");
    const reservationTime = String(req.body.reservationTime || "13:00").trim();

    if (!lineUserId) {
      return res.status(400).json({ message: "缺少 LINE 使用者資料" });
    }

    if (!bikeModel || !issueDescription) {
      return res.status(400).json({ message: "請填寫完整維修資訊" });
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
          issueDescription
        })
      ]
    );

    const result = await createRepairReservationFromSession(lineUserId);

    if (result?.phoneRequired) {
      return res.status(400).json({ message: "請先回 LINE 對話輸入手機號碼完成綁定。" });
    }

    if (!result) {
      return res.status(500).json({ message: "維修預約建立失敗" });
    }

    if (result.duplicate) {
      return res.status(409).json({
        message: `已有相同時段的維修預約，工單 #${result.repairId}`,
        repairId: result.repairId
      });
    }

    const deliveryResult = await sendToGroupsWithResult(["repair", "admin"], [
      buildGroupApprovalMessage("repair_reservation", {
        id: result.repairId,
        customerName: result.customer.name || "LINE 客戶",
        customerPhone: result.customer.phone || null,
        reservationDate: result.payload.reservationDate,
        reservationTime: result.payload.reservationTime,
        bikeModel: result.payload.bikeModel,
        issueDescription: result.payload.issueDescription
      })
    ]);

    await logWorkflowEvent(
      "repair_reservation_group_notified",
      "REPAIR_ORDER",
      result.repairId,
      {
        delivered: deliveryResult.delivered,
        targetGroupIds: deliveryResult.targetGroupIds,
        fromLine: true,
        source: "line_repair_page"
      },
      null
    );

    return res.json({
      ok: true,
      repairId: result.repairId,
      reservationDay: getReservationDay(reservationDate)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
