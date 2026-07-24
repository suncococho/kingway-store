const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize, requireStoreScope } = require("../middleware/auth");
const { createError } = require("../utils/errors");
const { logWorkflowEvent } = require("../services/lineWorkflowService");
const { listRepairAttachments, saveRepairAttachment } = require("../services/repairAttachmentService");
const { isStaffLineNotifySuppressed } = require("../services/staffLineNotify");
const {
  WARRANTY_REVIEW_STATUS,
  assertWarrantyReviewMutable,
  normalizeWarrantyReviewStatus
} = require("../services/repairWarrantyReviewService");

const router = express.Router();
const REPAIR_ROLES = ["ADMIN", "MANAGER", "STAFF", "CASHIER", "REPAIR", "USER", "EMPLOYEE"];
const CUSTOMER_NOTICE = [
  "本次送修零件仍在保固期間內，門市已完成初步檢查，現正送交總公司判定故障原因。",
  "是否屬於產品本身瑕疵，或因使用、碰撞、進水、改裝及其他外部因素所造成，將以總公司最終檢查結果為準。",
  "目前尚未確認為免費保固維修，也尚未產生正式維修費用。判定完成後，門市將另行通知保固結果或提供正式維修報價。"
].join("\n\n");

router.use(authenticate, requireStoreScope(), authorize(REPAIR_ROLES));

function attachmentIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

async function getRepairForUpdate(connection, id, storeId) {
  const [rows] = await connection.query(
    `SELECT id, status, reservation_status AS reservationStatus, inspection_notes AS inspectionNotes,
            estimate_sent_at AS estimateSentAt, warranty_review_status AS warrantyReviewStatus,
            completed_at AS completedAt, picked_up_at AS pickedUpAt
     FROM repair_orders WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [id, storeId]
  );
  if (!rows[0]) throw createError("找不到維修工單", 404);
  return rows[0];
}

async function validateAttachments(connection, id, storeId, ids) {
  if (!ids.length) return;
  const [rows] = await connection.query(
    "SELECT id FROM repair_order_attachments WHERE repair_order_id = ? AND store_id = ? AND id IN (?)",
    [id, storeId, ids]
  );
  if (rows.length !== ids.length) throw createError("部分附件不屬於此維修單", 400);
}

async function logEvent(connection, repairId, action, note, staffId, payload = {}) {
  await connection.query(
    "INSERT INTO repair_logs (repair_order_id, action, note) VALUES (?, ?, ?)",
    [repairId, action, JSON.stringify({ ...payload, note: note || null })]
  );
  await logWorkflowEvent(action, "REPAIR_ORDER", repairId, payload, staffId, connection);
}

async function logDryRunNotice(connection, repairId, type, staffId) {
  const dryRun = isStaffLineNotifySuppressed();
  await logEvent(connection, repairId, "warranty_customer_notified", "保固流程通知", staffId, {
    notificationType: type,
    dryRun,
    customerNotice: type === "WARRANTY_REVIEW_REQUESTED" ? CUSTOMER_NOTICE : null
  });
  console.info("[warranty-review-notification]", { repairId: Number(repairId), type, dryRun });
  return dryRun;
}

router.get("/:id/warranty-review", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ro.*, requester.display_name AS warrantyRequestedByName,
              decider.display_name AS warrantyDecidedByName
       FROM repair_orders ro
       LEFT JOIN staff_users requester ON requester.id = ro.warranty_review_requested_by
       LEFT JOIN staff_users decider ON decider.id = ro.warranty_review_decided_by
       WHERE ro.id = ? AND ro.store_id = ? AND ro.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.storeId]
    );
    if (!rows[0]) throw createError("找不到維修工單", 404);
    const attachments = await listRepairAttachments(req.params.id, req.storeId);
    return res.json({ review: rows[0], attachments, customerNotice: CUSTOMER_NOTICE });
  } catch (error) { return next(error); }
});

router.post("/:id/warranty-review/attachments", express.raw({ type: ["image/*", "video/*"], limit: "80mb" }), async (req, res, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const repair = await getRepairForUpdate(connection, req.params.id, req.storeId);
      assertWarrantyReviewMutable(repair);
      const result = await saveRepairAttachment({
        storeId: req.storeId,
        repairOrderId: Number(req.params.id),
        uploadedBy: "warranty_review_staff",
        originalName: req.headers["x-file-name"] || "warranty-review-attachment",
        contentType: req.headers["content-type"],
        buffer: req.body
      }, connection);
      await logEvent(connection, req.params.id, "warranty_review_attachment_added", "已新增保固審查附件", req.user.id, { attachmentId: result.id });
      await connection.commit();
      return res.status(201).json(result);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  } catch (error) { return next(error); }
});

router.post("/:id/warranty-review/request", async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const body = req.body || {};
    for (const key of ["partName", "initialDiagnosis", "symptom", "serialNumber", "reviewNote"]) {
      if (!String(body[key] || "").trim()) throw createError("請完整填寫保固審查必填資料", 400);
    }
    if (!body.purchaseDate && !body.expirationDate) throw createError("請填寫購買日或保固到期日", 400);
    for (const key of ["exteriorDamage", "waterIngress", "collisionDamage", "modified", "purchaseProofChecked"]) {
      if (typeof body[key] !== "boolean") throw createError("請完整確認外觀、進水、碰撞、改裝及購買證明狀態", 400);
    }
    const ids = attachmentIds(body.attachmentIds);
    if (!ids.length) throw createError("請至少選擇一個照片或影片附件", 400);
    await connection.beginTransaction();
    const repair = await getRepairForUpdate(connection, req.params.id, req.storeId);
    assertWarrantyReviewMutable(repair);
    if (repair.reservationStatus !== "approved") throw createError("請先確認維修預約", 400);
    if (normalizeWarrantyReviewStatus(repair.warrantyReviewStatus) !== WARRANTY_REVIEW_STATUS.NOT_REQUESTED) throw createError("此維修單已有保固審查紀錄", 409);
    if (repair.estimateSentAt) throw createError("已發送正式報價的維修單無法改為保固審查", 400);
    await validateAttachments(connection, req.params.id, req.storeId, ids);
    await connection.query(
      `UPDATE repair_orders SET inspection_notes = ?, warranty_review_status = 'PENDING_HEADQUARTERS',
       warranty_review_requested_at = NOW(), warranty_review_requested_by = ?, warranty_review_note = ?,
       warranty_review_request_attachment_json = ?, warranty_part_name = ?, warranty_purchase_date = ?,
       warranty_expiration_date = ?, warranty_purchase_proof_checked = ?, warranty_serial_number = ?,
       warranty_symptom = ?, warranty_exterior_damage = ?, warranty_water_ingress = ?,
       warranty_collision_damage = ?, warranty_modified = ?, updated_at = NOW()
       WHERE id = ? AND store_id = ?`,
      [String(body.initialDiagnosis).trim(), req.user.id, String(body.reviewNote).trim(), JSON.stringify(ids),
       String(body.partName).trim(), body.purchaseDate || null, body.expirationDate || null,
       body.purchaseProofChecked ? 1 : 0, String(body.serialNumber).trim(), String(body.symptom).trim(),
       body.exteriorDamage ? 1 : 0, body.waterIngress ? 1 : 0, body.collisionDamage ? 1 : 0,
       body.modified ? 1 : 0, req.params.id, req.storeId]
    );
    await logEvent(connection, req.params.id, "warranty_review_requested", "已送交總公司判定", req.user.id, { partName: body.partName, attachmentIds: ids });
    const notificationDryRun = await logDryRunNotice(connection, req.params.id, "WARRANTY_REVIEW_REQUESTED", req.user.id);
    await connection.commit();
    return res.status(201).json({ status: WARRANTY_REVIEW_STATUS.PENDING_HEADQUARTERS, notificationDryRun });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.patch("/:id/warranty-review/supplement", async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const note = String(req.body?.note || "").trim();
    const ids = attachmentIds(req.body?.attachmentIds);
    if (!note && !ids.length) throw createError("請填寫補充說明或選擇附件", 400);
    await connection.beginTransaction();
    const repair = await getRepairForUpdate(connection, req.params.id, req.storeId);
    assertWarrantyReviewMutable(repair);
    if (normalizeWarrantyReviewStatus(repair.warrantyReviewStatus) !== WARRANTY_REVIEW_STATUS.NEED_MORE_INFORMATION) throw createError("目前不是待補充資料狀態", 400);
    await validateAttachments(connection, req.params.id, req.storeId, ids);
    await connection.query(
      `UPDATE repair_orders SET warranty_review_status = 'PENDING_HEADQUARTERS',
       warranty_review_note = CONCAT_WS('\n', warranty_review_note, ?),
       warranty_review_request_attachment_json = ?, updated_at = NOW() WHERE id = ? AND store_id = ?`,
      [note || null, JSON.stringify(ids), req.params.id, req.storeId]
    );
    await logEvent(connection, req.params.id, "warranty_review_requested", "已補充資料並重新送審", req.user.id, { supplemented: true, attachmentIds: ids });
    await connection.commit();
    return res.json({ status: WARRANTY_REVIEW_STATUS.PENDING_HEADQUARTERS });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.post("/:id/warranty-review/decision", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const decision = normalizeWarrantyReviewStatus(req.body?.decision);
    if (![WARRANTY_REVIEW_STATUS.APPROVED, WARRANTY_REVIEW_STATUS.REJECTED, WARRANTY_REVIEW_STATUS.NEED_MORE_INFORMATION].includes(decision)) throw createError("保固判定種類不正確", 400);
    const reason = String(req.body?.reason || "").trim();
    const reference = String(req.body?.reference || "").trim();
    const customerNote = String(req.body?.customerNote || "").trim();
    const ids = attachmentIds(req.body?.attachmentIds);
    if (!reason || !reference || !customerNote || !ids.length) throw createError("請填寫判定原因、回覆編號、客戶說明並選擇附件", 400);
    await connection.beginTransaction();
    const repair = await getRepairForUpdate(connection, req.params.id, req.storeId);
    assertWarrantyReviewMutable(repair);
    if (normalizeWarrantyReviewStatus(repair.warrantyReviewStatus) === WARRANTY_REVIEW_STATUS.NOT_REQUESTED) throw createError("尚未提出保固審查", 400);
    await validateAttachments(connection, req.params.id, req.storeId, ids);
    await connection.query(
      `UPDATE repair_orders SET warranty_review_status = ?, warranty_review_decided_at = NOW(),
       warranty_review_decided_by = ?, warranty_review_reason = ?, warranty_review_reference = ?,
       warranty_review_result_attachment_json = ?, warranty_customer_note = ?, updated_at = NOW()
       WHERE id = ? AND store_id = ?`,
      [decision, req.user.id, reason, reference, JSON.stringify(ids), customerNote, req.params.id, req.storeId]
    );
    const action = decision === WARRANTY_REVIEW_STATUS.APPROVED ? "warranty_review_approved" : decision === WARRANTY_REVIEW_STATUS.REJECTED ? "warranty_review_rejected" : "warranty_review_more_info_requested";
    await logEvent(connection, req.params.id, action, reason, req.user.id, { decision, reference, attachmentIds: ids, customerNote });
    const notificationDryRun = await logDryRunNotice(connection, req.params.id, action, req.user.id);
    await connection.commit();
    return res.json({ status: decision, notificationDryRun });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

router.post("/:id/warranty-review/cancel", authorize(["ADMIN", "MANAGER"]), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const repair = await getRepairForUpdate(connection, req.params.id, req.storeId);
    assertWarrantyReviewMutable(repair);
    if (normalizeWarrantyReviewStatus(repair.warrantyReviewStatus) === WARRANTY_REVIEW_STATUS.NOT_REQUESTED) throw createError("尚未提出保固審查", 400);
    await connection.query("UPDATE repair_orders SET warranty_review_status = 'CANCELED', updated_at = NOW() WHERE id = ? AND store_id = ?", [req.params.id, req.storeId]);
    await logEvent(connection, req.params.id, "warranty_review_canceled", String(req.body?.reason || "已取消保固審查"), req.user.id);
    await connection.commit();
    return res.json({ status: WARRANTY_REVIEW_STATUS.CANCELED });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally { connection.release(); }
});

module.exports = router;
