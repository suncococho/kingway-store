const { PRODUCT_CATEGORY_LABELS } = require("./productCategories");

const CATEGORY_LABELS = {
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

const PAYMENT_METHOD_LABELS = {
  CASH: "現金",
  CARD: "刷卡",
  LINE_PAY: "LINE Pay",
  TRANSFER: "轉帳",
  OTHER: "其他"
};

const ORDER_STATUS_LABELS = {
  COMPLETED: "已完成",
  PENDING: "待處理",
  PENDING_PAYMENT: "待付款",
  REPAIRING: "維修中",
  CANCELED: "已取消",
  CANCELLED: "已取消"
};

const REPAIR_STATUS_LABELS = {
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

const COUPON_TYPE_LABELS = {
  new_friend: "會員服務紀錄",
  google_review: "Google 評論紀錄"
};

const COUPON_STATUS_LABELS = {
  pending_approval: "待審核",
  approved: "已核准",
  rejected: "已拒絕",
  issued: "已發券",
  used: "已使用",
  expired: "已過期"
};

const FINAL_PAYMENT_STATUS_LABELS = {
  UNPAID: "未付款",
  PARTIAL: "部分付款",
  PAID: "已完款"
};

const SUPPLIER_REQUEST_TYPE_LABELS = {
  PURCHASE_ORDER: "發注",
  RETURN: "退貨"
};

const SUPPLIER_REQUEST_STATUS_LABELS = {
  PENDING_SUPPLIER: "待供應商確認",
  APPROVED: "供應商已確認",
  REJECTED: "供應商已拒絕",
  PARTIALLY_RECEIVED: "部分入庫",
  RECEIVED: "已入庫",
  RETURN_CONFIRMED: "退貨已確認",
  CANCELED: "已取消"
};

function mapCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category || null;
}

function mapPaymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || null;
}

function mapOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || null;
}

function mapRepairStatusLabel(status) {
  return REPAIR_STATUS_LABELS[status] || status || null;
}

function mapCouponTypeLabel(type) {
  return COUPON_TYPE_LABELS[type] || type || null;
}

function mapCouponStatusLabel(status) {
  return COUPON_STATUS_LABELS[status] || status || null;
}

function mapFinalPaymentStatusLabel(status) {
  return FINAL_PAYMENT_STATUS_LABELS[status] || status || null;
}

function mapSupplierRequestTypeLabel(type) {
  return SUPPLIER_REQUEST_TYPE_LABELS[type] || type || null;
}

function mapSupplierRequestStatusLabel(status) {
  return SUPPLIER_REQUEST_STATUS_LABELS[status] || status || null;
}

module.exports = {
  CATEGORY_LABELS,
  mapCategoryLabel,
  mapPaymentMethodLabel,
  mapOrderStatusLabel,
  mapRepairStatusLabel,
  mapCouponTypeLabel,
  mapCouponStatusLabel,
  mapFinalPaymentStatusLabel,
  mapSupplierRequestTypeLabel,
  mapSupplierRequestStatusLabel
};
