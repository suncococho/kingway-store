import { PRODUCT_CATEGORY_LABELS } from "./productCategories";
export { PAYMENT_METHOD_LABELS, getPaymentMethodLabel } from "./paymentMethods";

export const CATEGORY_LABELS = {
  ...PRODUCT_CATEGORY_LABELS,
  REPAIR: "維修",
  ACCESSORY: "配件",
  OTHER: "其他",
  FK: "前叉避震器煞車",
  BG: "包包水壺架",
  CL: "夾具類",
  FP: "工廠零件",
  EX: "換貨品",
  TN: "改裝套件",
  ST: "椅子",
  TY: "玩具",
  HG: "車把握把腳踏",
  LC: "鎖具快充"
};

export const ORDER_STATUS_LABELS = {
  pending: "待處理",
  confirmed: "已確認",
  processing: "處理中",
  ready: "待取貨",
  ready_for_pickup: "待取貨",
  picked_up: "已取貨",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款",
  PENDING: "待處理",
  CONFIRMED: "已確認",
  PROCESSING: "處理中",
  READY: "待取貨",
  READY_FOR_PICKUP: "待取貨",
  PICKED_UP: "已取貨",
  COMPLETED: "已完成",
  CANCELED: "已取消",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
  PENDING_PAYMENT: "待付款",
  REPAIRING: "維修中"
};

export const REPAIR_STATUS_LABELS = {
  pending: "待處理",
  new: "待處理",
  estimate_pending: "待估價",
  estimate_pending_approval: "待報價確認",
  estimate_approved: "報價已確認",
  estimate_rejected: "報價已拒絕",
  waiting_parts: "待料中",
  repairing: "維修中",
  in_progress: "維修中",
  completed: "維修完成",
  completed_waiting_pickup: "待取車",
  ready_for_pickup: "待取車",
  picked_up: "已取車",
  cancelled: "已取消",
  canceled: "已取消",
  reserved: "已確認",
  confirmed: "已確認",
  waiting_quote: "已預約待報價",
  waiting_customer_confirm: "已報價待客戶回覆",
  quoted: "已報價待客戶回覆",
  customer_confirmed: "客戶已同意報價",
  repair_order_created: "已建立維修訂單",
  checking: "待群組確認",
  PENDING: "待處理",
  NEW: "待處理",
  ESTIMATE_PENDING: "待估價",
  ESTIMATE_PENDING_APPROVAL: "待報價確認",
  ESTIMATE_APPROVED: "報價已確認",
  ESTIMATE_REJECTED: "報價已拒絕",
  WAITING_PARTS: "待料中",
  REPAIRING: "維修中",
  IN_PROGRESS: "維修中",
  COMPLETED: "維修完成",
  COMPLETED_WAITING_PICKUP: "待取車",
  READY_FOR_PICKUP: "待取車",
  PICKED_UP: "已取車",
  CANCELLED: "已取消",
  CANCELED: "已取消"
};

export const COUPON_TYPE_LABELS = {
  new_friend: "會員服務",
  google_review: "Google 評論"
};

export const COUPON_STATUS_LABELS = {
  available: "可使用",
  inactive: "未啟用",
  used: "已使用",
  expired: "已過期",
  pending_approval: "待審核",
  approved: "已核准",
  rejected: "已拒絕",
  issued: "已發券",
  AVAILABLE: "可使用",
  INACTIVE: "未啟用",
  USED: "已使用",
  EXPIRED: "已過期",
  PENDING_APPROVAL: "待審核",
  APPROVED: "已核准",
  REJECTED: "已拒絕",
  ISSUED: "已發券"
};

export const FINAL_PAYMENT_STATUS_LABELS = {
  unpaid: "未付款",
  paid: "已付款",
  partially_paid: "部分付款",
  partial: "部分付款",
  deposit_paid: "已付訂金",
  refunded: "已退款",
  cancelled: "已取消",
  UNPAID: "未付款",
  PAID: "已付款",
  PARTIAL: "部分付款",
  PARTIALLY_PAID: "部分付款",
  PARTIAL_PAID: "部分付款",
  DEPOSIT_PAID: "已付訂金",
  REFUNDED: "已退款",
  CANCELED: "已取消",
  CANCELLED: "已取消"
};

const UNKNOWN_STATUS_LABEL = "未知狀態";

function resolveStatusLabel(labelMap, status) {
  const raw = String(status || "").trim();
  if (!raw) return UNKNOWN_STATUS_LABEL;
  return (
    labelMap[raw] ||
    labelMap[raw.toLowerCase()] ||
    labelMap[raw.toUpperCase()] ||
    UNKNOWN_STATUS_LABEL
  );
}

export const SUPPLIER_REQUEST_TYPE_LABELS = {
  PURCHASE_ORDER: "發注",
  RETURN: "退貨"
};

export const SUPPLIER_REQUEST_STATUS_LABELS = {
  PENDING_SUPPLIER: "待供應商確認",
  APPROVED: "供應商已確認",
  REJECTED: "供應商已拒絕",
  PARTIALLY_RECEIVED: "部分入庫",
  RECEIVED: "已入庫",
  RETURN_CONFIRMED: "退貨已確認",
  CANCELED: "已取消"
};

export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category || "-";
}

export function getOrderStatusLabel(status) {
  return formatOrderStatus(status);
}

export function formatOrderStatus(status) {
  return resolveStatusLabel(ORDER_STATUS_LABELS, status);
}

export function getRepairStatusLabel(status) {
  return formatRepairStatus(status);
}

export function formatRepairStatus(status) {
  return resolveStatusLabel(REPAIR_STATUS_LABELS, status);
}

export function getCouponTypeLabel(type) {
  return COUPON_TYPE_LABELS[type] || type || "-";
}

export function getCouponStatusLabel(status) {
  return formatCouponStatus(status);
}

export function formatCouponStatus(status) {
  return resolveStatusLabel(COUPON_STATUS_LABELS, status);
}

export function getFinalPaymentStatusLabel(status) {
  return formatPaymentStatus(status);
}

export function formatPaymentStatus(status) {
  return resolveStatusLabel(FINAL_PAYMENT_STATUS_LABELS, status);
}

export function getSupplierRequestTypeLabel(type) {
  return SUPPLIER_REQUEST_TYPE_LABELS[type] || type || "-";
}

export function getSupplierRequestStatusLabel(status) {
  return SUPPLIER_REQUEST_STATUS_LABELS[status] || status || "-";
}

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const text = String(value);
  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return new Date(`${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00+08:00`);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTaipeiParts(value, options) {
  const date = normalizeDateValue(value);
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options
  }).format(date);
}

export function formatTaipeiDate(value) {
  return formatTaipeiParts(value).replace(/\//g, "/");
}

export function formatTaipeiDateTime(value) {
  return formatTaipeiParts(value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
