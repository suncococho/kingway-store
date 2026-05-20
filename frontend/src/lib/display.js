import { PRODUCT_CATEGORY_LABELS } from "./productCategories";

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

export const PAYMENT_METHOD_LABELS = {
  CASH: "現金",
  CARD: "刷卡",
  LINE_PAY: "LINE Pay",
  TRANSFER: "轉帳",
  OTHER: "其他"
};

export const ORDER_STATUS_LABELS = {
  COMPLETED: "已完成",
  PENDING: "待處理",
  PENDING_PAYMENT: "待付款",
  REPAIRING: "維修中",
  CANCELED: "已取消",
  CANCELLED: "已取消"
};

export const REPAIR_STATUS_LABELS = {
  reserved: "已確認",
  confirmed: "已確認",
  waiting_quote: "已預約待報價",
  checking: "待群組確認",
  pending: "待確認",
  new: "待確認",
  estimate_pending_approval: "待核准報價",
  quoted: "已報價待客戶回覆",
  waiting_customer_confirm: "已報價待客戶回覆",
  estimate_approved: "報價已核准",
  customer_confirmed: "客戶已同意報價",
  repair_order_created: "已建立維修訂單",
  estimate_rejected: "報價已拒絕",
  repairing: "維修中",
  in_progress: "維修中",
  completed_waiting_pickup: "已完修待取車",
  ready_for_pickup: "已完修待取車",
  picked_up: "已取車",
  canceled: "已取消"
};

export const COUPON_TYPE_LABELS = {
  new_friend: "新好友優惠券",
  google_review: "Google 評論優惠券"
};

export const COUPON_STATUS_LABELS = {
  pending_approval: "待審核",
  approved: "已核准",
  rejected: "已拒絕",
  issued: "已發券",
  used: "已使用",
  expired: "已過期"
};

export const FINAL_PAYMENT_STATUS_LABELS = {
  UNPAID: "未付款",
  PARTIAL: "部分付款",
  PAID: "已完款"
};

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

export function getPaymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || "-";
}

export function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || "-";
}

export function getRepairStatusLabel(status) {
  return REPAIR_STATUS_LABELS[status] || status || "-";
}

export function getCouponTypeLabel(type) {
  return COUPON_TYPE_LABELS[type] || type || "-";
}

export function getCouponStatusLabel(status) {
  return COUPON_STATUS_LABELS[status] || status || "-";
}

export function getFinalPaymentStatusLabel(status) {
  return FINAL_PAYMENT_STATUS_LABELS[status] || status || "-";
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
