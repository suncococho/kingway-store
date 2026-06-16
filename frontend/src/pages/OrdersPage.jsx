import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ActionModal from "../components/ActionModal";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import FilterChips from "../components/FilterChips";
import PageHeader from "../components/PageHeader";
import ProcessingOverlay from "../components/ProcessingOverlay";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { useProcessingGuard } from "../hooks/useProcessingGuard";
import { apiRequest } from "../lib/api";
import { formatTaipeiDate, formatTaipeiDateTime, getFinalPaymentStatusLabel, getOrderStatusLabel, getPaymentMethodLabel, getRepairStatusLabel } from "../lib/display";

function formatAmount(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function getDisplayFinalAmount(order) {
  const candidates = [
    order?.displayFinalAmount,
    order?.display_final_amount,
    order?.finalDisplayAmount,
    order?.final_display_amount,
    order?.finalAmount,
    order?.final_amount,
    order?.finalChargedAmount,
    order?.final_charged_amount,
    order?.finalChargeAmount,
    order?.final_charge_amount,
    order?.repairFinalAmount,
    order?.repair_final_amount,
    order?.receivableAmount,
    order?.receivable_amount,
    order?.payableAmount,
    order?.payable_amount,
    order?.totalAmount,
    order?.total_amount
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null && value !== "") {
      const amount = Number(value);
      return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
    }
  }

  return 0;
}

function formatOrderFinalAmount(order) {
  return formatAmount(getDisplayFinalAmount(order));
}

function getOrderCardDescription(row) {
  return `${row.customerName || row.customerNameSnapshot || "-"} / ${row.customerPhone || row.customerPhoneSnapshot || "未留電話"}`;
}

function normalizeCustomerType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OFFLINE_WITH_PHONE" || normalized === "OFFLINE_NO_PHONE") {
    return normalized;
  }
  if (normalized === "OFFLINE") {
    return "OFFLINE_WITH_PHONE";
  }
  return "LINE";
}

function getCustomerTypeLabel(value) {
  return normalizeCustomerType(value) === "LINE" ? "LINE" : "一般";
}

function isOfflineCustomerType(value) {
  return normalizeCustomerType(value) !== "LINE";
}

function isRepairRelatedOrder(row) {
  const orderNo = String(row.orderNo || row.order_no || "").trim();
  return Boolean(
    row.source === "repair_quote" ||
      row.repairOrderId ||
      row.repairId ||
      row.isRepairOrder ||
      orderNo.startsWith("REP-")
  );
}

function normalizeOrderDetailItems(detail) {
  const rawItems =
    Array.isArray(detail?.items) ? detail.items :
    Array.isArray(detail?.orderItems) ? detail.orderItems :
    Array.isArray(detail?.order_items) ? detail.order_items :
    [];

  return rawItems.map((item) => ({
    id: item.id || `${item.productId || item.product_id || item.sku || item.productName}-${item.quantity}`,
    productId: item.productId || item.product_id || null,
    sku: item.sku || item.sku_snapshot || "-",
    productName: item.productName || item.product_name || item.product_name_snapshot || item.name || "商品",
    productCategory: item.productCategory || item.product_category || item.product_category_snapshot || "",
    quantity: Number(item.quantity || item.qty || 0),
    unitPrice: Number(item.unitPrice ?? item.unit_price ?? item.price ?? 0),
    lineTotal: Number(item.lineTotal ?? item.line_total ?? item.total ?? 0)
  }));
}

function isEbikeCategory(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "EB" || normalized === "EBIKE";
}

function OrdersPage() {
  const { items, loading, error, refetch } = useFetchList("/orders");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "ALL");
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [depositFilter, setDepositFilter] = useState("ALL");
  const [detail, setDetail] = useState(null);
  const [detailForm, setDetailForm] = useState({
    customerName: "",
    customerPhone: "",
    paymentMethod: "CASH",
    isReservationOrder: false,
    depositAmount: "",
    unpaidBalance: "",
    finalPaymentStatus: "PAID",
    notes: ""
  });
  const [searchMode, setSearchMode] = useState(false);
  const [searchScope, setSearchScope] = useState("ALL");
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [warningModal, setWarningModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const { isProcessing, pendingAction, runWithProcessing } = useProcessingGuard();

  const sectionItems = [
    { key: "ALL", label: "全部訂單" },
    { key: "GENERAL", label: "一般訂單" },
    { key: "RESERVATION", label: "預約單" },
    { key: "DEPOSIT", label: "訂金未清" },
    { key: "PAID", label: "已完款" },
    { key: "REPAIR", label: "維修相關" }
  ];

  useEffect(() => {
    const current = searchParams.get("tab") || "ALL";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);


  useEffect(() => {
    const keywordParam = searchParams.get("keyword");

    if (keywordParam) {
      setKeyword(keywordParam);
    }
  }, [searchParams]);

  const rows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        paymentMethodLabel: item.paymentMethodLabel || getPaymentMethodLabel(item.paymentMethod),
        statusLabel: item.statusLabel || getOrderStatusLabel(item.status),
        finalPaymentStatusLabel: item.finalPaymentStatusLabel || getFinalPaymentStatusLabel(item.finalPaymentStatus),
        repairStatusLabel: item.repairStatusLabel || getRepairStatusLabel(item.repairStatus),
        typeLabel: item.source === "line_order" ? "LINE 預約單" : isRepairRelatedOrder(item) ? "維修訂單" : item.isReservationOrder ? "預約單" : "一般訂單",
        orderKindLabel: item.source === "line_order" ? "LINE 預約單" : isRepairRelatedOrder(item) ? "維修訂單" : item.isReservationOrder ? "預約單" : "一般訂單",
        customerType: normalizeCustomerType(item.customerType || (item.lineUserId ? "LINE" : item.customerPhone || item.customerPhoneSnapshot ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")),
        depositLabel: Number(item.unpaidBalance || 0) > 0 ? "訂金未清" : "已結清",
        businessDateLabel: formatTaipeiDate(item.businessDate),
        createdAtLabel: formatTaipeiDateTime(item.createdAt)
      })),
    [items]
  );

  const summaryCards = useMemo(
    () => [
      { label: "訂單總數", value: rows.length },
      { label: "維修訂單", value: rows.filter((row) => isRepairRelatedOrder(row)).length },
      { label: "預約單", value: rows.filter((row) => row.isReservationOrder).length },
      { label: "訂金未清", value: rows.filter((row) => Number(row.unpaidBalance || 0) > 0).length },
      { label: "已完款", value: rows.filter((row) => row.finalPaymentStatus === "PAID").length }
    ],
    [rows]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const text = keyword.trim().toLowerCase();
        if (text && !`${row.orderNo} ${row.customerName || row.customerNameSnapshot || ""} ${row.customerPhone || row.customerPhoneSnapshot || ""}`.toLowerCase().includes(text)) {
          return false;
        }
        if (
          typeFilter !== "ALL" &&
          (
            (typeFilter === "REPAIR" && !isRepairRelatedOrder(row)) ||
            (typeFilter === "RESERVATION" && !row.isReservationOrder) ||
            (typeFilter === "GENERAL" && (row.isReservationOrder || isRepairRelatedOrder(row)))
          )
        ) {
          return false;
        }
        if (statusFilter !== "ALL" && row.status !== statusFilter) {
          return false;
        }
        if (depositFilter !== "ALL" && ((depositFilter === "YES" && Number(row.unpaidBalance || 0) <= 0) || (depositFilter === "NO" && Number(row.unpaidBalance || 0) > 0))) {
          return false;
        }
        if (tab === "GENERAL") {
          return !row.isReservationOrder && !isRepairRelatedOrder(row);
        }
        if (tab === "RESERVATION") {
          return row.isReservationOrder;
        }
        if (tab === "DEPOSIT") {
          return Number(row.unpaidBalance || 0) > 0;
        }
        if (tab === "PAID") {
          return row.finalPaymentStatus === "PAID";
        }
        if (tab === "REPAIR") {
          return isRepairRelatedOrder(row);
        }
        return true;
      }),
    [depositFilter, keyword, rows, statusFilter, tab, typeFilter]
  );

  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const key = row.businessDateLabel || "未分類";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(row);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => String(b).localeCompare(String(a)))
      .map(([businessDate, groupRows]) => ({ businessDate, rows: groupRows }));
  }, [filteredRows]);

  const lastUpdatedText = useMemo(() => {
    const latest = rows[0];
    return latest?.createdAt ? `最後更新：${formatTaipeiDateTime(latest.createdAt)}` : "最後更新：-";
  }, [rows]);

  async function collectBalance(row) {
    const amount = Number(row.unpaidBalance || 0);

    if (amount <= 0) {
      setWarningModal({ title: "不需完成付款", message: "此訂單目前已結清，不需要補收尾款。" });
      return;
    }

    await runWithProcessing(async () => {
      await apiRequest(`/orders/${row.id}/collect-balance`, {
        method: "POST",
        body: JSON.stringify({ amount })
      });
      await refetch();
      alert("已完成付款");
    }, { id: `order-payment-${row.id}`, label: "付款處理中..." }).catch((error) => {
      alert(error.message);
    });
  }

  async function confirmHandover(row) {
    await runWithProcessing(async () => {
      await apiRequest(`/orders/${row.id}/confirm-handover`, {
        method: "POST",
        body: JSON.stringify({})
      });
      refetch();
      alert("已確認交車");
    }, { id: `order-handover-${row.id}`, label: "交車確認中..." }).catch((error) => {
      alert(error.message);
    });
  }

  function requestCollectBalance(row) {
    if (Number(row.unpaidBalance || 0) <= 0) {
      setWarningModal({ title: "不需完成付款", message: "此訂單目前已結清，不需要補收尾款。" });
      return;
    }
    setConfirmModal({
      title: "完成付款",
      message: "確認要補收尾款並更新付款狀態嗎？",
      confirmText: "完成付款",
      action: () => collectBalance(row)
    });
  }

  function requestHandover(row) {
    if (row.finalPaymentStatus !== "PAID") {
      setWarningModal({ title: "請先完成上一個步驟", message: "請先完成付款，再確認交車。" });
      return;
    }
    setConfirmModal({
      title: "確認交車",
      message: "確認此訂單已完成交車嗎？",
      confirmText: "確認交車",
      action: () => confirmHandover(row)
    });
  }

  async function saveOrderDetail(event) {
    event.preventDefault();

    if (!detail) {
      return;
    }

    await runWithProcessing(async () => {
      await apiRequest(`/orders/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          customerName: detailForm.customerName,
          customerPhone: detailForm.customerPhone,
          paymentMethod: detailForm.paymentMethod,
          isReservationOrder: detailForm.isReservationOrder,
          depositAmount: detailForm.depositAmount === "" ? null : Number(detailForm.depositAmount),
          unpaidBalance: detailForm.unpaidBalance === "" ? null : Number(detailForm.unpaidBalance),
          finalPaymentStatus: detailForm.finalPaymentStatus,
          notes: detailForm.notes
        })
      });
      refetch();
      setDetail((current) => (current ? { ...current, ...detailForm } : current));
      alert("訂單已更新");
    }, { id: `order-save-${detail.id}`, label: "訂單更新中..." }).catch((error) => {
      alert(error.message);
    });
  }

  async function triggerPurchaseConfirmation() {
    if (!detail) {
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/orders/${detail.id}/purchase-confirmation`, {
        method: "POST",
        body: JSON.stringify({})
      });
      refetch();
      alert(`購買確認書連結已送出：\n${data.link}`);
    }, { id: `order-confirmation-${detail.id}`, label: "確認書發送中..." }).catch((error) => {
      alert(error.message);
    });
  }

  function requestPurchaseConfirmation() {
    if (!detail) {
      return;
    }
    const phone = detail.customerPhone || detail.customerPhoneSnapshot || detailForm.customerPhone;
    const status = String(detail.status || "").trim().toUpperCase();
    const items = normalizeOrderDetailItems(detail);
    const isPaid = detail.finalPaymentStatus === "PAID" || detail.finalPaymentStatus === "已完款" || Number(detail.unpaidBalance || 0) <= 0;
    if (!phone || ["CANCELED", "CANCELLED", "DELETED", "VOID"].includes(status) || !isPaid || !items.some((item) => isEbikeCategory(item.productCategory))) {
      setWarningModal({
        title: "請先完成上一個步驟",
        message:
          !phone ? "請先確認客戶電話，再發送購買確認書。" :
          ["CANCELED", "CANCELLED", "DELETED", "VOID"].includes(status) ? "此訂單已取消，無法產生購買確認書" :
          !isPaid ? "尚未完款，無法產生購買確認書" :
          "此訂單沒有電動自行車商品，無法產生購買確認書"
      });
      return;
    }
    setConfirmModal({
      title: "發送購買確認書",
      message: "確認要發送購買確認書給客戶嗎？",
      confirmText: "發送確認書",
      action: triggerPurchaseConfirmation
    });
  }

  async function requestGoogleReviewCoupon() {
    if (!detail?.id) return;

    if (!window.confirm("確認核准 Google 評論優惠並套用  折抵？")) {
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/coupons/approve-google-review-for-order/${detail.id}`, {
        method: "POST"
      });

      alert(data.message || "Google 評論優惠已核准並套用");
      window.location.reload();
    }, { id: `google-review-${detail.id}`, label: "優惠核准中..." }).catch((error) => {
      alert(error.message || "Google 評論優惠處理失敗");
    });
  }

  function requestDownloadPurchasePdf() {
    if (!detail) {
      return;
    }
    const pdfUrl = detail.purchaseConfirmationPdfUrl || detail.pdfUrl;
    if (!pdfUrl) {
      setWarningModal({
        title: "尚未產生 PDF",
        message: "請先發送購買確認書並等待客戶簽名完成，再查看或下載 PDF。"
      });
      return;
    }
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }

  async function openDetail(row) {
    setDetail(row);
    setSystemInfoOpen(false);
    setDetailForm({
      customerName: row.customerName || row.customerNameSnapshot || "",
      customerPhone: row.customerPhone || row.customerPhoneSnapshot || "",
      paymentMethod: row.paymentMethod || "CASH",
      isReservationOrder: Boolean(row.isReservationOrder),
      depositAmount: String(row.depositAmount ?? ""),
      unpaidBalance: String(row.unpaidBalance ?? ""),
      finalPaymentStatus: row.finalPaymentStatus || "PAID",
      notes: row.notes || ""
    });
    try {
      const loaded = await apiRequest(`/orders/${row.id}`);
      const nextDetail = {
        ...row,
        ...loaded,
        paymentMethodLabel: loaded.paymentMethodLabel || row.paymentMethodLabel || getPaymentMethodLabel(loaded.paymentMethod || row.paymentMethod),
        statusLabel: loaded.statusLabel || row.statusLabel || getOrderStatusLabel(loaded.status || row.status),
        finalPaymentStatusLabel: loaded.finalPaymentStatusLabel || row.finalPaymentStatusLabel || getFinalPaymentStatusLabel(loaded.finalPaymentStatus || row.finalPaymentStatus),
        repairStatusLabel: loaded.repairStatusLabel || row.repairStatusLabel || getRepairStatusLabel(loaded.repairStatus || row.repairStatus),
        orderKindLabel: row.orderKindLabel
      };
      setDetail(nextDetail);
      setDetailForm({
        customerName: nextDetail.customerName || nextDetail.customerNameSnapshot || "",
        customerPhone: nextDetail.customerPhone || nextDetail.customerPhoneSnapshot || "",
        paymentMethod: nextDetail.paymentMethod || "CASH",
        isReservationOrder: Boolean(nextDetail.isReservationOrder),
        depositAmount: String(nextDetail.depositAmount ?? ""),
        unpaidBalance: String(nextDetail.unpaidBalance ?? ""),
        finalPaymentStatus: nextDetail.finalPaymentStatus || "PAID",
        notes: nextDetail.notes || ""
      });
    } catch (loadError) {
      setToastMessage(loadError.message || "訂單明細載入失敗");
    }
  }

  function openSearch(scope = "ALL") {
    setSearchScope(scope);
    setSearchMode(true);
  }

  async function deleteOrder(row) {
    
const pin = window.prompt("請輸入管理員 PIN");
if (pin !== "1144") {
  window.alert("PIN 錯誤");
  return;
}

if (!window.confirm(
`確定要刪除訂單 ${row.orderNo || "#" + row.id}？刪除後可在「已刪除資料」復原。`)) return;
    await runWithProcessing(async () => {
      await apiRequest(`/orders/${row.id}`, { method: "DELETE" });
      await refetch();
      setToastMessage("訂單已移至已刪除資料");
    }, { id: `order-delete-${row.id}`, label: "訂單刪除中..." }).catch((error) => {
      alert(error.message || "刪除訂單失敗");
    });
  }

  function closeSearch() {
    setSearchMode(false);
  }

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }


  function moneyForInvoice(value) {
    return `NT$ ${Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
  }

  function escapeInvoiceHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function invoiceMoney(value) {
    return `NT$ ${Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
  }

  function invoiceEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function printOrderInvoice(row) {
    try {
      const marker = "PRINT_FRONTEND_ONLY_V4_DETAIL_ITEMS";

      let detail = row;

      try {
        if (row?.id) {
          const loaded = await apiRequest(`/orders/${row.id}`);
          detail = loaded?.order || loaded?.data || loaded || row;
        }
      } catch (loadError) {
        detail = row;
      }

      const orderNo = detail.orderNo || detail.order_no || row.orderNo || row.order_no || row.id || "-";
      const customerName = detail.customerName || detail.customer_name || detail.customerNameSnapshot || row.customerName || row.customer_name || "-";
      const customerPhone = detail.customerPhone || detail.customer_phone || detail.customerPhoneSnapshot || row.customerPhone || row.customer_phone || "";
      const orderDate = detail.businessDate || detail.business_date || detail.createdAt || detail.created_at || row.businessDate || row.createdAt || "";
      const totalAmount = Number(detail.totalAmount ?? detail.total_amount ?? row.totalAmount ?? row.total_amount ?? 0);
      const depositAmount = Number(detail.depositAmount ?? detail.deposit_amount ?? row.depositAmount ?? row.deposit_amount ?? 0);
      const unpaidBalance = Number(detail.unpaidBalance ?? detail.unpaid_balance ?? row.unpaidBalance ?? row.unpaid_balance ?? Math.max(totalAmount - depositAmount, 0));

      const couponDiscountAmount = Number(
        detail.couponDiscountAmount ??
        detail.coupon_discount_amount ??
        detail.coupon_discount ??
        detail.couponAmount ??
        row.couponDiscountAmount ??
        row.coupon_discount_amount ??
        row.coupon_discount ??
        0
      );

      const storedOtherDiscount = Number(
        detail.otherDiscountAmount ??
        detail.other_discount_amount ??
        detail.other_discount ??
        detail.manual_discount ??
        row.otherDiscountAmount ??
        row.other_discount_amount ??
        row.other_discount ??
        0
      );

      const paymentStatus = detail.finalPaymentStatus || detail.final_payment_status || row.finalPaymentStatus || row.final_payment_status || "-";
      const orderStatus = detail.status || row.status || "-";

      const rawItems =
        Array.isArray(detail.items) ? detail.items :
        Array.isArray(detail.orderItems) ? detail.orderItems :
        Array.isArray(detail.order_items) ? detail.order_items :
        Array.isArray(detail.products) ? detail.products :
        Array.isArray(row.items) ? row.items :
        Array.isArray(row.orderItems) ? row.orderItems :
        [];

      const summaryText =
        detail.itemSummary ||
        detail.itemsSummary ||
        detail.productSummary ||
        detail.productsSummary ||
        row.itemSummary ||
        row.itemsSummary ||
        row.productSummary ||
        row.productsSummary ||
        "";

      let invoiceItems = rawItems.map((item) => ({
        name: item.productName || item.product_name || item.product_name_snapshot || item.productNameSnapshot || item.name || item.title || "商品",
        qty: Number(item.quantity ?? item.qty ?? 1),
        price: Number(item.unitPrice ?? item.unit_price ?? item.price ?? item.unitPriceSnapshot ?? 0),
        total: Number(item.subtotal ?? item.line_total ?? item.total ?? item.amount ?? 0),
      }));

      if (!invoiceItems.length && summaryText) {
        invoiceItems = String(summaryText)
          .split(" / ")
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text) => ({
            name: text,
            qty: "",
            price: "",
            total: "",
          }));
      }

      const itemTotal = invoiceItems.reduce((sum, item) => {
        const lineTotal = Number(item.total || 0);
        const qty = Number(item.qty || 0);
        const price = Number(item.price || 0);
        return sum + (lineTotal > 0 ? lineTotal : qty * price);
      }, 0);

      const computedOtherDiscount = Math.max(itemTotal - totalAmount - couponDiscountAmount, 0);
      const otherDiscountAmount = storedOtherDiscount > 0 ? storedOtherDiscount : computedOtherDiscount;
      const originalAmount = Math.max(
        itemTotal,
        totalAmount + couponDiscountAmount + otherDiscountAmount
      );

      const itemsHtml = invoiceItems.length
        ? invoiceItems.map((item, index) => `
          <tr>
            <td class="idx">${index + 1}</td>
            <td class="item-name">${invoiceEscape(item.name)}</td>
            <td class="num">${item.qty === "" ? "" : Number(item.qty || 0).toLocaleString()}</td>
            <td class="num">${item.price === "" ? "" : invoiceMoney(item.price)}</td>
            <td class="num">${item.total === "" ? "" : invoiceMoney(item.total)}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty">此訂單目前沒有商品明細資料</td></tr>`;

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>訂單明細 ${invoiceEscape(orderNo)}</title>
  <style>
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, "Noto Sans TC", sans-serif; color:#111827; margin:0; padding:14px; background:#fff; font-size:11px; }
    .invoice { max-width:760px; margin:0 auto; }
    .top { display:flex; justify-content:space-between; border-bottom:3px solid #111827; padding-bottom:9px; margin-bottom:10px; }
    .brand { font-size:22px; font-weight:900; letter-spacing:1px; }
    .subtitle { color:#667085; margin-top:3px; font-size:11px; }
    .title { font-size:17px; font-weight:900; text-align:right; letter-spacing:2px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:4px 26px; margin-bottom:8px; font-size:11px; }
    .meta div { display:flex; justify-content:space-between; border-bottom:1px solid #e5e7eb; padding:4px 0; gap:10px; }
    .meta span { color:#667085; }
    .items-title { font-size:13px; font-weight:900; margin:7px 0 4px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9.5px; }
    th { background:#f3f4f6; color:#374151; padding:4px 5px; border:1px solid #e5e7eb; text-align:left; font-weight:800; }
    td { padding:3px 5px; border:1px solid #e5e7eb; vertical-align:top; line-height:1.18; }
    .idx { width:26px; text-align:center; color:#667085; }
    .item-name { width:auto; word-break:break-word; }
    .num { text-align:right; white-space:nowrap; }
    .summary { width:300px; margin-left:auto; margin-top:8px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
    .summary-row { display:flex; justify-content:space-between; padding:6px 9px; border-bottom:1px solid #e5e7eb; font-size:11px; }
    .summary-row:last-child { border-bottom:none; }
    .discount { color:#b42318; }
    .final { font-size:14px; font-weight:900; background:#f9fafb; }
    .note { margin-top:8px; padding:7px 9px; background:#f9fafb; border-radius:8px; color:#475467; font-size:9.5px; line-height:1.35; }
    .footer { margin-top:10px; color:#667085; font-size:9px; text-align:center; }
    .empty { text-align:center; color:#667085; padding:7px; }
    @media print {
      body { padding:0; }
      .invoice { max-width:none; }
      .top, .meta, table, .summary, .note, .footer { page-break-inside:avoid; }
    }
  </style>
</head>
<body>
  <div class="invoice" data-marker="${marker}">
    <div class="top">
      <div>
        <div class="brand">KINGWAY 台南門市</div>
        <div class="subtitle">訂單明細 / Invoice</div>
      </div>
      <div class="title">ORDER INVOICE</div>
    </div>

    <div class="meta">
      <div><span>訂單編號</span><strong>${invoiceEscape(orderNo)}</strong></div>
      <div><span>日期</span><strong>${invoiceEscape(String(orderDate).slice(0, 10))}</strong></div>
      <div><span>客戶</span><strong>${invoiceEscape(customerName)}</strong></div>
      <div><span>電話</span><strong>${invoiceEscape(customerPhone)}</strong></div>
      <div><span>付款狀態</span><strong>${invoiceEscape(paymentStatus)}</strong></div>
      <div><span>訂單狀態</span><strong>${invoiceEscape(orderStatus)}</strong></div>
    </div>

    <div class="items-title">商品明細</div>
    <table>
      <thead>
        <tr>
          <th style="width:28px;">#</th>
          <th>商品</th>
          <th style="width:42px;" class="num">數量</th>
          <th style="width:82px;" class="num">單價</th>
          <th style="width:82px;" class="num">小計</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div class="summary">
      <div class="summary-row"><span>商品總額</span><strong>${invoiceMoney(originalAmount)}</strong></div>
      <div class="summary-row discount"><span>會員服務</span><strong>- ${invoiceMoney(couponDiscountAmount)}</strong></div>
      <div class="summary-row discount"><span>其他折扣</span><strong>- ${invoiceMoney(otherDiscountAmount)}</strong></div>
      <div class="summary-row final"><span>訂單應收</span><strong>${invoiceMoney(totalAmount)}</strong></div>
      <div class="summary-row"><span>已收訂金</span><strong>${invoiceMoney(depositAmount)}</strong></div>
      <div class="summary-row"><span>未收尾款</span><strong>${invoiceMoney(unpaidBalance)}</strong></div>
    </div>

    <div class="note">本列印單作為門市訂單、付款與交車確認參考。商品較多時已自動壓縮版面，盡量維持單頁列印。</div>
    <div class="footer">感謝您的購買。請妥善保存此訂單明細作為門市服務與付款紀錄參考。</div>
  </div>

  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`;

      const printWindow = window.open("", "_blank", "width=900,height=1100");
      if (!printWindow) {
        window.alert("瀏覽器阻擋了列印視窗，請允許彈出視窗後再試一次。");
        return;
      }

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (error) {
      window.alert(error.message || "無法產生訂單列印資料");
    }
  }


  const columns = [
    { key: "orderNo", label: "訂單編號", mobileHidden: true },
    {
      key: "customerName",
      label: "客戶",
      render: (row) => (
        <div className="status-stack">
          {(() => {
            const rawName = row.lineDisplayName || row.displayName || row.customerDisplayName || row.customerName || row.customerNameSnapshot || "";
            const name = rawName === "LINE 客戶" ? "" : rawName;
            const phone = row.customerPhone || row.customerPhoneSnapshot || "";
            return (
              <>
                {name ? <span>{name}</span> : null}
                {phone ? <span style={{ fontSize: 12, color: "#64748b" }}>{phone}</span> : null}
                {!name && !phone ? <span>-</span> : null}
              </>
            );
          })()}
          <button
            type="button"
            data-delete-button="order-visible"
            className="danger-button"
            onClick={() => deleteOrder(row)}
            disabled={isProcessing}
          >
            {pendingAction?.id === `order-delete-${row.id}` ? "處理中..." : "刪除"}
          </button>
        </div>
      ),
      mobileHidden: true
    },
    {
      key: "typeLabel",
      label: "類型",
      render: (row) => (
        <StatusBadge tone={isRepairRelatedOrder(row) ? "info" : row.isReservationOrder ? "warning" : "neutral"}>
          {row.typeLabel}
        </StatusBadge>
      ),
      mobileHidden: true
    },
    { key: "businessDateLabel", label: "日期", mobileHidden: true },
    { key: "finalAmount", label: "最終金額", render: (row) => formatOrderFinalAmount(row), mobileHidden: true },
    {
      key: "statusLabel",
      label: "訂單狀態",
      render: (row) => (
        <StatusBadge tone={row.finalPaymentStatus === "PAID" ? "success" : Number(row.unpaidBalance || 0) > 0 ? "warning" : "info"}>
          {row.finalPaymentStatusLabel || row.statusLabel}
        </StatusBadge>
      ),
      mobileHidden: true
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          {Number(row.unpaidBalance || 0) > 0 ? (
            <button type="button" className="secondary-button" onClick={() => requestCollectBalance(row)} disabled={isProcessing}>
              {pendingAction?.id === `order-payment-${row.id}` ? "處理中..." : "完成付款"}
            </button>
          ) : null}
          {!row.handoverConfirmedAt ? (
            <button type="button" className="secondary-button" onClick={() => requestHandover(row)} disabled={isProcessing}>
              {pendingAction?.id === `order-handover-${row.id}` ? "處理中..." : "確認交車"}
            </button>
          ) : (
            "已完成交車"
          )}
          <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
            詳情
          </button>
            <button type="button" className="secondary-button" onClick={() => printOrderInvoice(row)}>
              列印訂單
            </button>
          <button type="button" className="danger-button" onClick={() => deleteOrder(row)} disabled={isProcessing}>
            {pendingAction?.id === `order-delete-${row.id}` ? "處理中..." : "刪除"}
          </button>
                  <button
                    type="button"
                    data-edit-button="order-edit"
                    className="secondary-button"
                    onClick={() => navigate(`/orders/${row.id}/edit`)}
                  >
                    編輯
                  </button>
        </div>
      ),
      mobileHidden: true
    }
  ];

  return (
    <div className="orders-page">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Link to="/trash" className="secondary-button">已刪除資料</Link>
      </div>

      {toastMessage ? <div className="success-banner">{toastMessage}</div> : null}

      <PageHeader
        title="訂單管理"
        description="主列表只保留門市訂單核心資訊，詳情放在同頁 modal，避免把資料庫欄位直接攤平。"
      />
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="訂單子功能" />
      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>
      {searchMode ? (
        <section className="admin-panel product-search-screen">
          <div className="search-screen-header">
            <button type="button" className="secondary-button" onClick={closeSearch}>
              取消
            </button>
            <div>
              <div className="section-title">搜尋訂單</div>
              <div className="muted-text">{lastUpdatedText}</div>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setKeyword("");
                setSearchScope("ALL");
              }}
            >
              清除
            </button>
          </div>
          <FilterBar compact>
            <label className="form-field">
              <span>搜尋</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="訂單 / 客戶 / 電話" />
            </label>
          </FilterBar>
          <FilterChips
            items={[
              { key: "ALL", label: "全部訂單" },
              { key: "CUSTOMER", label: "客戶" },
              { key: "PHONE", label: "電話" }
            ]}
            value={searchScope}
            onChange={setSearchScope}
          />
          <DataTable
            columns={columns}
            rows={filteredRows.filter((row) => {
              const text = keyword.trim().toLowerCase();
              if (!text) {
                return true;
              }
              const customer = `${row.customerName || row.customerNameSnapshot || ""}`.toLowerCase();
              const phone = `${row.customerPhone || row.customerPhoneSnapshot || ""}`.toLowerCase();
              const orderNo = `${row.orderNo}`.toLowerCase();
              if (searchScope === "CUSTOMER") {
                return customer.includes(text);
              }
              if (searchScope === "PHONE") {
                return phone.includes(text);
              }
              return `${orderNo} ${customer} ${phone}`.includes(text);
            })}
            emptyText="目前沒有符合條件的訂單。"
            cardTitle={(row) => row.orderNo}
            cardDescription={(row) => `${getOrderCardDescription(row)} / 最終金額 ${formatOrderFinalAmount(row)}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={isRepairRelatedOrder(row) ? "info" : row.isReservationOrder ? "warning" : "neutral"}>{row.typeLabel}</StatusBadge>
                <StatusBadge tone={Number(row.unpaidBalance || 0) > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel}</StatusBadge>
                <StatusBadge tone={row.repairStatus === "repairing" ? "warning" : row.repairStatus ? "info" : "neutral"}>{row.repairStatusLabel || row.repairStatus || "無維修狀態"}</StatusBadge>
              </>
            )}
          />
        </section>
      ) : null}
      <div className="section-panel">
        {tab === "REPAIR" ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="維修相關"
              title="維修相關訂單"
              description="客戶同意維修報價後建立的維修訂單會同步顯示在這裡，方便追蹤收款與維修狀態。"
            />
            <DataTable
              columns={columns}
              rows={filteredRows}
              emptyText="目前沒有維修相關訂單。"
              cardTitle={(row) => row.orderNo}
              cardDescription={getOrderCardDescription}
              cardBadges={(row) => (
                <>
                  <StatusBadge tone={isRepairRelatedOrder(row) ? "info" : "neutral"}>{row.typeLabel}</StatusBadge>
                  <StatusBadge tone={Number(row.unpaidBalance || 0) > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel}</StatusBadge>
                  <StatusBadge tone={row.repairStatus === "repairing" ? "warning" : row.repairStatus ? "info" : "neutral"}>{row.repairStatusLabel || row.repairStatus || "無維修狀態"}</StatusBadge>
                </>
              )}
              cardFooter={(row) => (
                <div className="compact-card-footer">
                  <div className="compact-card-meta">
                    <strong>{`最終金額 ${formatOrderFinalAmount(row)}`}</strong>
                    <span>{row.repairId ? `REP-${row.repairId}` : row.repairOrderId ? `維修工單 #${row.repairOrderId}` : row.orderNo || "-"}</span>
                  </div>
                  {columns.find((column) => column.key === "actions").render(row)}
                </div>
              )}
            />
          </section>
        ) : !searchMode ? (
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow={sectionItems.find((item) => item.key === tab)?.label || "全部訂單"}
              title="訂單列表"
              description="訂單資料以日期分組，手機上更容易快速掃描。"
              badges={
                <>
                  <StatusBadge tone="info">顯示 {filteredRows.length} 筆</StatusBadge>
                  <StatusBadge tone="neutral">{lastUpdatedText}</StatusBadge>
                </>
              }
              actions={
                <>
                  <button type="button" className="secondary-button" onClick={() => openSearch("ALL")}>
                    搜尋
                  </button>
                  <button type="button" className="secondary-button" onClick={() => navigate("/pos")}>
                    新增
                  </button>
                </>
              }
            />
            <FilterBar>
              <label className="form-field">
                <span>關鍵字搜尋</span>
                <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="訂單編號 / 客戶 / 電話" />
              </label>
              <label className="form-field">
                <span>類型</span>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                  <option value="ALL">全部類型</option>
                  <option value="GENERAL">一般訂單</option>
                  <option value="RESERVATION">預約單</option>
                  <option value="REPAIR">維修相關</option>
                </select>
              </label>
              <label className="form-field">
                <span>狀態</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="ALL">全部狀態</option>
                  <option value="COMPLETED">已完成</option>
                  <option value="PENDING">待處理</option>
                  <option value="PENDING_PAYMENT">待付款</option>
                  <option value="REPAIRING">維修中</option>
                  <option value="CANCELED">已取消</option>
                </select>
              </label>
              <label className="form-field">
                <span>訂金 / 尾款</span>
                <select value={depositFilter} onChange={(event) => setDepositFilter(event.target.value)}>
                  <option value="ALL">全部</option>
                  <option value="YES">訂金未清</option>
                  <option value="NO">已結清</option>
                </select>
              </label>
            </FilterBar>
            {loading ? <div className="loading-state">載入訂單資料中...</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}
            {!loading && !error ? (
              <div className="grouped-order-list">
                {groupedRows.map((group) => (
                  <section key={group.businessDate} className="grouped-order-section">
                    <AdminSectionHeader eyebrow="訂單群組" title={group.businessDate} description={`共 ${group.rows.length} 筆`} />
                    <DataTable
                      columns={columns}
                      rows={group.rows}
                      emptyText="目前沒有符合條件的訂單。"
                      cardTitle={(row) => row.orderNo}
                      cardDescription={getOrderCardDescription}
                      cardBadges={(row) => (
                        <>
                          <StatusBadge tone={isRepairRelatedOrder(row) ? "info" : row.isReservationOrder ? "warning" : "neutral"}>{row.typeLabel}</StatusBadge>
                          <StatusBadge tone={Number(row.unpaidBalance || 0) > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel}</StatusBadge>
                          <StatusBadge tone={row.repairStatus === "repairing" ? "warning" : row.repairStatus ? "info" : "neutral"}>{row.repairStatusLabel || row.repairStatus || "無維修狀態"}</StatusBadge>
                        </>
                      )}
                      cardFooter={(row) => (
                        <div className="compact-card-footer">
                          <div className="compact-card-meta">
                            <strong>{`最終金額 ${formatOrderFinalAmount(row)}`}</strong>
                            <span>{row.repairId ? `REP-${row.repairId}` : row.customerPhone || row.customerPhoneSnapshot || "未留電話"}</span>
                          </div>
                          {columns.find((column) => column.key === "actions").render(row)}
                        </div>
                      )}
                    />
                  </section>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      <DetailModal
        open={Boolean(detail)}
        title={detail ? `訂單 ${detail.orderNo}` : "訂單詳情"}
        subtitle={detail ? `${detail.customerName || detail.customerNameSnapshot || "-"} / ${detail.paymentMethodLabel}` : ""}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="admin-detail-layout sop-detail-layout">
            <section className="stack-card">
              <div className="section-title">訂單摘要</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">訂單編號</div><div className="field-value">{detail.orderNo}</div></div>
                <div className="field-item"><div className="field-label">日期</div><div className="field-value">{detail.businessDateLabel || formatTaipeiDate(detail.businessDate)}</div></div>
                <div className="field-item"><div className="field-label">訂單類型</div><div className="field-value">{detail.orderKindLabel}</div></div>
                <div className="field-item"><div className="field-label">維修狀態</div><div className="field-value">{detail.repairStatusLabel || detail.repairStatus || "-"}</div></div>
                <div className="field-item"><div className="field-label">最終金額</div><div className="field-value">{formatOrderFinalAmount(detail)}</div></div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">客戶資料</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">客戶</div><div className="field-value">{detail.customerName || detail.customerNameSnapshot || "-"}</div></div>
                <div className="field-item"><div className="field-label">電話</div><div className="field-value">{detail.customerPhone || detail.customerPhoneSnapshot || "-"}</div></div>
                <div className="field-item"><div className="field-label">客戶類型</div><div className="field-value"><StatusBadge tone={isOfflineCustomerType(detail.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(detail.customerType)}</StatusBadge></div></div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">商品明細</div>
              {normalizeOrderDetailItems(detail).length ? (
                <div className="table-scroll">
                  <table className="data-table compact-table">
                    <thead>
                      <tr>
                        <th>商品名稱</th>
                        <th>SKU</th>
                        <th>數量</th>
                        <th>單價</th>
                        <th>金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normalizeOrderDetailItems(detail).map((item) => (
                        <tr key={item.id}>
                          <td>{item.productName}</td>
                          <td>{item.sku || "-"}</td>
                          <td>{item.quantity}</td>
                          <td>{formatAmount(item.unitPrice)}</td>
                          <td>{formatAmount(item.lineTotal || item.unitPrice * item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">此訂單尚未建立商品明細，請先補登商品後再產生購買確認書。</div>
              )}
            </section>
            <section className="stack-card">
              <div className="section-title">付款狀態</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">付款方式</div><div className="field-value">{detail.paymentMethodLabel}</div></div>
                <div className="field-item"><div className="field-label">完款狀態</div><div className="field-value"><StatusBadge tone={detail.finalPaymentStatus === "PAID" ? "success" : "warning"}>{detail.finalPaymentStatusLabel}</StatusBadge></div></div>
                <div className="field-item"><div className="field-label">訂金</div><div className="field-value">{formatAmount(detail.depositAmount)}</div></div>
                <div className="field-item"><div className="field-label">尾款</div><div className="field-value">{formatAmount(detail.unpaidBalance)}</div></div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">購買確認書狀態</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">確認書</div><div className="field-value">{detail.purchaseConfirmationSentAt ? "已發送" : "未發送"}</div></div>
                <div className="field-item"><div className="field-label">交車</div><div className="field-value">{detail.handoverConfirmedAt ? "已確認" : "未確認"}</div></div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">操作</div>
              <div className="action-row">
              {Number(detail.unpaidBalance || 0) > 0 ? (
                <button type="button" className="primary-button inline-submit" onClick={() => requestCollectBalance(detail)} disabled={isProcessing}>
                  {pendingAction?.id === `order-payment-${detail.id}` ? "處理中..." : "完成付款"}
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={requestPurchaseConfirmation} disabled={isProcessing}>
                {pendingAction?.id === `order-confirmation-${detail.id}` ? "處理中..." : "發送確認書"}
              </button>
              <button type="button" className="secondary-button" onClick={requestDownloadPurchasePdf}>
                查看/下載 PDF
              </button>
              {!detail.handoverConfirmedAt ? (
                <button type="button" className="secondary-button" onClick={() => requestHandover(detail)} disabled={isProcessing}>
                  {pendingAction?.id === `order-handover-${detail.id}` ? "處理中..." : "確認交車"}
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => setSystemInfoOpen((current) => !current)}>
                系統資訊
              </button>
              <button type="button" className="secondary-button" onClick={() => setDetail(null)}>
                關閉
              </button>
              </div>
            </section>
            {systemInfoOpen ? (
              <section className="stack-card">
                <div className="section-title">系統資訊</div>
                <form className="grid-form compact-grid" onSubmit={saveOrderDetail}>
                  <label className="form-field"><span>客戶姓名</span><input value={detailForm.customerName} onChange={(event) => setDetailForm((current) => ({ ...current, customerName: event.target.value }))} /></label>
                  <label className="form-field"><span>客戶電話</span><input value={detailForm.customerPhone} onChange={(event) => setDetailForm((current) => ({ ...current, customerPhone: event.target.value }))} /></label>
                  <label className="form-field"><span>付款方式</span><select value={detailForm.paymentMethod} onChange={(event) => setDetailForm((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="CASH">現金</option><option value="CARD">刷卡</option><option value="LINE_PAY">LINE Pay</option><option value="TRANSFER">轉帳</option><option value="OTHER">其他</option></select></label>
                  <label className="form-field"><span>預約單</span><select value={detailForm.isReservationOrder ? "1" : "0"} onChange={(event) => setDetailForm((current) => ({ ...current, isReservationOrder: event.target.value === "1" }))}><option value="0">一般訂單</option><option value="1">預約訂單</option></select></label>
                  <label className="form-field"><span>訂金</span><input type="number" min="0" value={detailForm.depositAmount} onChange={(event) => setDetailForm((current) => ({ ...current, depositAmount: event.target.value }))} /></label>
                  <label className="form-field"><span>未付款金額</span><input type="number" min="0" value={detailForm.unpaidBalance} onChange={(event) => setDetailForm((current) => ({ ...current, unpaidBalance: event.target.value }))} /></label>
                  <label className="form-field"><span>完款狀態</span><select value={detailForm.finalPaymentStatus} onChange={(event) => setDetailForm((current) => ({ ...current, finalPaymentStatus: event.target.value }))}><option value="UNPAID">未付款</option><option value="PARTIAL">部分付款</option><option value="PAID">已完款</option></select></label>
                  <label className="form-field form-field-wide"><span>備註</span><input value={detailForm.notes} onChange={(event) => setDetailForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                  <button type="submit" className="primary-button inline-submit" disabled={isProcessing}>{pendingAction?.id === `order-save-${detail.id}` ? "處理中..." : "儲存"}</button>
                </form>
              </section>
            ) : null}
            </div>
        ) : null}
      </DetailModal>
      <ActionModal
        open={Boolean(warningModal)}
        tone="warning"
        title={warningModal?.title}
        message={warningModal?.message}
        onConfirm={() => setWarningModal(null)}
      />
      <ActionModal
        open={Boolean(confirmModal)}
        title={confirmModal?.title}
        message={confirmModal?.message}
        confirmText={confirmModal?.confirmText || "確認"}
        cancelText="取消"
        onCancel={() => setConfirmModal(null)}
        onConfirm={() => {
          if (isProcessing) {
            return;
          }
          const action = confirmModal?.action;
          setConfirmModal(null);
          action?.();
        }}
      />
      <ProcessingOverlay active={isProcessing} message={pendingAction?.label || "處理中"} description={pendingAction?.description || "系統正在處理，請勿重複點擊。"} />
    </div>
  );
}

export default OrdersPage;
