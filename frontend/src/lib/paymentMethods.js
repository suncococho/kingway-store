export const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "現金" },
  { value: "CARD", label: "刷卡" },
  { value: "TRANSFER", label: "匯款" },
  { value: "LINE_PAY", label: "LINE Pay" },
  { value: "OTHER", label: "無卡分期" }
];

export const PAYMENT_METHOD_LABELS = {
  CASH: "現金",
  CARD: "刷卡",
  CREDIT_CARD: "刷卡",
  TRANSFER: "匯款",
  LINE_PAY: "LINE Pay",
  OTHER: "無卡分期",
  CARDLESS_INSTALLMENT: "無卡分期"
};

export function getPaymentMethodLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return PAYMENT_METHOD_LABELS[normalized] || value || "-";
}
