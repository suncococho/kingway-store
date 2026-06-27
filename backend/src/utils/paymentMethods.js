const PAYMENT_METHOD_LABELS = {
  CASH: "現金",
  CARD: "刷卡",
  CREDIT_CARD: "刷卡",
  LINE_PAY: "LINE Pay",
  TRANSFER: "匯款",
  OTHER: "無卡分期",
  CARDLESS_INSTALLMENT: "無卡分期"
};

const VALID_PAYMENT_METHODS = new Set(Object.keys(PAYMENT_METHOD_LABELS));

function normalizePaymentMethod(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized === "BANK_TRANSFER") return "TRANSFER";
  if (normalized === "INSTALLMENT" || normalized === "CARDLESS") return "OTHER";
  return VALID_PAYMENT_METHODS.has(normalized) ? normalized : "";
}

function mapPaymentMethodLabel(value) {
  const normalized = normalizePaymentMethod(value);
  return PAYMENT_METHOD_LABELS[normalized] || value || null;
}

module.exports = {
  PAYMENT_METHOD_LABELS,
  VALID_PAYMENT_METHODS,
  mapPaymentMethodLabel,
  normalizePaymentMethod
};
