function maskTargetId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function formatValue(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildStaffGroupMessagePreview(input = {}) {
  return [
    "【KINGWAY 系統通知】",
    `類型：${formatValue(input.eventLabel || input.eventType, "系統提醒")}`,
    `門市：${formatValue(input.storeName, input.storeId ? `#${input.storeId}` : "-")}`,
    `內容：${formatValue(input.message || input.title, "請至 POS 確認。")}`,
    input.targetUrl ? `連結：${input.targetUrl}` : null
  ].filter(Boolean).join("\n");
}

function buildSupplierGroupMessagePreview(input = {}) {
  const type = String(input.eventType || "").toUpperCase() === "SUPPLIER_RETURN" ? "退貨通知" : "發注通知";
  const label = type === "退貨通知" ? "【KINGWAY 退貨通知】" : "【KINGWAY 發注通知】";
  return [
    label,
    `門市：${formatValue(input.storeName, input.storeId ? `#${input.storeId}` : "-")}`,
    `供應商：${formatValue(input.supplierName)}`,
    input.documentNo ? `單號：${input.documentNo}` : null,
    input.sku ? `商品：${input.sku}` : null,
    input.quantity ? `數量：${input.quantity}` : null,
    input.reason ? `原因：${input.reason}` : null,
    type === "退貨通知" ? "請協助確認收件，謝謝。" : "請協助確認是否可出貨，謝謝。"
  ].filter(Boolean).join("\n");
}

async function dryRunStaffGroupNotification(input = {}) {
  return {
    ok: true,
    dryRun: true,
    targetPreview: maskTargetId(input.targetId),
    messagePreview: buildStaffGroupMessagePreview(input)
  };
}

async function dryRunSupplierGroupNotification(input = {}) {
  return {
    ok: true,
    dryRun: true,
    targetPreview: maskTargetId(input.targetId || input.lineGroupId),
    messagePreview: buildSupplierGroupMessagePreview(input)
  };
}

async function sendStaffGroupNotification(input = {}) {
  return dryRunStaffGroupNotification(input);
}

async function sendSupplierGroupNotification(input = {}) {
  return dryRunSupplierGroupNotification(input);
}

module.exports = {
  buildStaffGroupMessagePreview,
  buildSupplierGroupMessagePreview,
  dryRunStaffGroupNotification,
  dryRunSupplierGroupNotification,
  maskTargetId,
  sendStaffGroupNotification,
  sendSupplierGroupNotification
};
