const { createError } = require("../utils/errors");

const WARRANTY_REVIEW_STATUS = Object.freeze({
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING_HEADQUARTERS: "PENDING_HEADQUARTERS",
  NEED_MORE_INFORMATION: "NEED_MORE_INFORMATION",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELED: "CANCELED"
});

const DECIDED_STATUSES = new Set([WARRANTY_REVIEW_STATUS.APPROVED, WARRANTY_REVIEW_STATUS.REJECTED]);
const PENDING_STATUSES = new Set([WARRANTY_REVIEW_STATUS.PENDING_HEADQUARTERS, WARRANTY_REVIEW_STATUS.NEED_MORE_INFORMATION]);
const FINAL_REPAIR_STATUSES = new Set(["completed", "completed_waiting_pickup", "picked_up", "canceled"]);

function normalizeWarrantyReviewStatus(value) {
  const status = String(value || WARRANTY_REVIEW_STATUS.NOT_REQUESTED).trim().toUpperCase();
  return Object.values(WARRANTY_REVIEW_STATUS).includes(status) ? status : WARRANTY_REVIEW_STATUS.NOT_REQUESTED;
}

function assertWarrantyReviewMutable(repair = {}) {
  if (FINAL_REPAIR_STATUSES.has(String(repair.status || "").trim()) || repair.completedAt || repair.completed_at || repair.pickedUpAt || repair.picked_up_at) {
    throw createError("已完成、已取車或已取消的維修單無法變更保固審查", 400);
  }
}

function assertQuoteAllowed(repair = {}) {
  const status = normalizeWarrantyReviewStatus(repair.warrantyReviewStatus || repair.warranty_review_status);
  if (PENDING_STATUSES.has(status)) throw createError("保固審查尚未完成，無法建立或發送正式報價", 400);
  if (![WARRANTY_REVIEW_STATUS.NOT_REQUESTED, WARRANTY_REVIEW_STATUS.CANCELED].includes(status) && !DECIDED_STATUSES.has(status)) {
    throw createError("尚無保固核准或不成立結果，無法建立正式報價", 400);
  }
}

function isWarrantyReviewActive(repair = {}) {
  return PENDING_STATUSES.has(normalizeWarrantyReviewStatus(repair.warrantyReviewStatus || repair.warranty_review_status));
}

module.exports = {
  WARRANTY_REVIEW_STATUS,
  DECIDED_STATUSES,
  PENDING_STATUSES,
  normalizeWarrantyReviewStatus,
  assertWarrantyReviewMutable,
  assertQuoteAllowed,
  assertCustomerApprovalAllowed: assertQuoteAllowed,
  assertRepairStartAllowed: assertQuoteAllowed,
  isWarrantyReviewActive
};
