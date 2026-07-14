import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ActionModal from "../components/ActionModal";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import FilterChips from "../components/FilterChips";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import ProcessingOverlay from "../components/ProcessingOverlay";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { useProcessingGuard } from "../hooks/useProcessingGuard";
import { apiRequest } from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { formatTaipeiDate, formatTaipeiDateTime, getFinalPaymentStatusLabel, getOrderStatusLabel, getPaymentMethodLabel, getRepairStatusLabel } from "../lib/display";
import { PAGE_HELP } from "../lib/pageHelpContent";
import { PAYMENT_METHOD_OPTIONS } from "../lib/paymentMethods";
import { canEditPaymentCompletionDate } from "../lib/roleAccess";

function formatAmount(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function getTaipeiDatetimeLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

function parseTaipeiDatetimeLocal(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, yyyy, mm, dd, hh, min] = match;
  const parsed = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTaipeiDatetimeLocalInput(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}T${match[2]}:${match[3]}`;
  }

  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? getTaipeiDatetimeLocal(parsed) : getTaipeiDatetimeLocal();
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
  return normalized === "EB" || normalized === "EBIKE" || normalized.includes("電動自行車");
}

function isEbikeSku(value) {
  return String(value || "").trim().toUpperCase().startsWith("B-EB-");
}

function isEbikeItem(item = {}) {
  return isEbikeCategory(item.productCategory || item.category) || isEbikeSku(item.sku);
}

function isAccessoryCategory(value) {
  return String(value || "").trim().toUpperCase() === "ACCESSORY";
}

function buildEmptyAccessoryChecklistState() {
  return {
    loading: false,
    error: "",
    tableExists: true,
    applicable: false,
    hasEbike: false,
    hasAccessoryItems: false,
    readyForHandoverChecklist: true,
    blockReason: "",
    items: []
  };
}

function isAccessoryChecklistEligible(detail) {
  if (!detail || isRepairRelatedOrder(detail) || String(detail.source || "").trim().toLowerCase() === "repair_quote") {
    return false;
  }

  const items = normalizeOrderDetailItems(detail);
  return items.some(isEbikeItem) && items.some((item) => isAccessoryCategory(item.productCategory));
}

function canPrintInstallCheck(row) {
  if (!row || isRepairRelatedOrder(row) || String(row.source || "").trim().toLowerCase() === "repair_quote") {
    return false;
  }

  if (row.hasEbikeItems || row.hasAccessoryItems || row.hasEbike || row.applicable) {
    return true;
  }

  return normalizeOrderDetailItems(row).some(isEbikeItem) || isAccessoryChecklistEligible(row);
}

function buildAccessoryUpdatePayload(item, overrides = {}) {
  const next = { ...item, ...overrides };
  return {
    isInstalled: Boolean(next.isInstalled),
    isTested: Boolean(next.isTested),
    isPhotoConfirmed: Boolean(next.isPhotoConfirmed),
    note: next.note || ""
  };
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
  const [accessoryChecklist, setAccessoryChecklist] = useState(buildEmptyAccessoryChecklistState());
  const [searchMode, setSearchMode] = useState(false);
  const [searchScope, setSearchScope] = useState("ALL");
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [warningModal, setWarningModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentDateModal, setPaymentDateModal] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const { isProcessing, pendingAction, runWithProcessing } = useProcessingGuard();
  const currentUser = useMemo(() => getStoredUser(), []);
  const canEditCompletedPaymentDate = canEditPaymentCompletionDate(currentUser);

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

  function inferPaymentStage(row) {
    return Number(row?.depositAmount || 0) > 0 || row?.isReservationOrder ? "BALANCE" : "FULL_PAYMENT";
  }

  function openPaymentModal(row) {
    const amount = Number(row.unpaidBalance || 0);

    if (amount <= 0) {
      setWarningModal({ title: "不需完成付款", message: "此訂單目前已結清，不需要補收尾款。" });
      return;
    }

    setPaymentModal({
      order: row,
      paymentMethod: row.finalPaymentMethod || row.paymentMethod || "CASH",
      receivedAmount: String(amount),
      paymentCompletedAt: getTaipeiDatetimeLocal(),
      note: row.finalPaymentNote || "",
      error: ""
    });
  }

  function updatePaymentModal(key, value) {
    setPaymentModal((current) => current ? { ...current, [key]: value, error: "" } : current);
  }

  function isPaidOrder(row) {
    return String(row?.finalPaymentStatus || "").toUpperCase() === "PAID";
  }

  function isCanceledOrDeletedOrder(row) {
    const status = String(row?.status || "").trim().toUpperCase();
    return ["CANCELED", "CANCELLED", "DELETED", "VOID"].includes(status);
  }

  function getPickupNotifyBlockReason(row) {
    if (!row) return "";
    if (isCanceledOrDeletedOrder(row)) return "此訂單已取消或刪除";
    if (row.handoverConfirmedAt) return "已完成交車";
    if (!row.lineUserId) return "客戶尚未綁定 LINE";
    return "";
  }

  function shouldShowPickupNotifyButton(row) {
    return Boolean(row && !isCanceledOrDeletedOrder(row) && !row.handoverConfirmedAt);
  }

  function openPaymentDateModal(row) {
    if (!row || !canEditCompletedPaymentDate || !isPaidOrder(row)) {
      return;
    }
    setPaymentDateModal({
      order: row,
      paymentCompletedAt: toTaipeiDatetimeLocalInput(row.finalPaymentCompletedAt || row.finalPaidAt),
      error: ""
    });
  }

  function updatePaymentDateModal(value) {
    setPaymentDateModal((current) => current ? { ...current, paymentCompletedAt: value, error: "" } : current);
  }

  async function submitPaymentDateModal(event) {
    event.preventDefault();
    if (!paymentDateModal?.order) return;

    const order = paymentDateModal.order;
    const paymentCompletedAt = String(paymentDateModal.paymentCompletedAt || "").trim();
    const parsedPaymentCompletedAt = parseTaipeiDatetimeLocal(paymentCompletedAt);
    if (!paymentCompletedAt || !parsedPaymentCompletedAt) {
      setPaymentDateModal((current) => ({ ...current, error: "請輸入正確的實際付款完成日期" }));
      return;
    }
    if (parsedPaymentCompletedAt.getTime() > Date.now()) {
      setPaymentDateModal((current) => ({ ...current, error: "實際付款完成日期不可晚於現在" }));
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/orders/${order.id}/payment-completed-at`, {
        method: "PATCH",
        body: JSON.stringify({ paymentCompletedAt })
      });
      await refetch();
      setDetail((current) => current && current.id === order.id ? {
        ...current,
        finalPaymentCompletedAt: data.finalPaymentCompletedAt || data.newFinalPaymentCompletedAt || paymentCompletedAt,
        finalPaidAt: data.finalPaidAt || data.finalPaymentCompletedAt || paymentCompletedAt,
        paymentRecords: Array.isArray(current.paymentRecords)
          ? current.paymentRecords.map((record) => data.updatedPaymentRecordIds?.includes(record.id) ? { ...record, receivedAt: data.finalPaymentCompletedAt || paymentCompletedAt } : record)
          : current.paymentRecords
      } : current);
      setPaymentDateModal(null);
      setToastMessage(data.message || "實際付款完成日期已更新");
    }, { id: `order-payment-date-${order.id}`, label: "付款完成日期更新中..." }).catch((error) => {
      setPaymentDateModal((current) => current ? { ...current, error: error.message || "付款完成日期更新失敗" } : current);
    });
  }

  async function submitPaymentModal(event) {
    event.preventDefault();
    if (!paymentModal?.order) return;

    const order = paymentModal.order;
    const expectedAmount = Number(order.unpaidBalance || 0);
    const receivedAmount = Number(paymentModal.receivedAmount || 0);
    if (!paymentModal.paymentMethod) {
      setPaymentModal((current) => ({ ...current, error: "請選擇付款方式" }));
      return;
    }
    if (!Number.isFinite(receivedAmount) || receivedAmount < 0) {
      setPaymentModal((current) => ({ ...current, error: "實際收款金額不可為負數" }));
      return;
    }
    if (receivedAmount < expectedAmount) {
      setPaymentModal((current) => ({ ...current, error: "實收金額不可小於未收尾款" }));
      return;
    }
    const paymentCompletedAt = String(paymentModal.paymentCompletedAt || "").trim();
    const parsedPaymentCompletedAt = parseTaipeiDatetimeLocal(paymentCompletedAt);
    if (!paymentCompletedAt || !parsedPaymentCompletedAt) {
      setPaymentModal((current) => ({ ...current, error: "請輸入正確的實際付款完成日期" }));
      return;
    }
    if (parsedPaymentCompletedAt.getTime() > Date.now()) {
      setPaymentModal((current) => ({ ...current, error: "實際付款完成日期不可晚於現在" }));
      return;
    }
    if (receivedAmount > expectedAmount && !window.confirm("實收金額高於未收尾款，確認仍要完成收款？")) {
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/orders/${order.id}/collect-balance`, {
        method: "POST",
        body: JSON.stringify({
          paymentMethod: paymentModal.paymentMethod,
          receivedAmount,
          note: paymentModal.note,
          paymentCompletedAt,
          paymentStage: inferPaymentStage(order)
        })
      });
      await refetch();
      setDetail((current) => current && current.id === order.id ? {
        ...current,
        unpaidBalance: 0,
        finalPaymentStatus: "PAID",
        finalPaymentStatusLabel: data.finalPaymentStatusLabel || "已完款",
        finalPaymentMethod: data.paymentMethod,
        finalPaymentMethodLabel: data.paymentMethodLabel,
        finalPaymentReceivedAmount: data.receivedAmount,
        finalPaymentNote: data.paymentNote,
        finalPaymentCompletedByStaffUserId: data.receivedByStaffUserId,
        finalPaymentCompletedAt: data.finalPaymentCompletedAt || data.paymentCompletedAt || paymentCompletedAt
      } : current);
      setPaymentModal(null);
      alert("已完成付款");
    }, { id: `order-payment-${order.id}`, label: "付款處理中..." }).catch((error) => {
      setPaymentModal((current) => current ? { ...current, error: error.message || "付款處理失敗" } : current);
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

  async function notifyPickup(row) {
    if (!row) return;
    const blockReason = getPickupNotifyBlockReason(row);
    if (blockReason) {
      alert(blockReason);
      return;
    }
    if (!window.confirm("確定要發送 LINE 取車通知給客戶嗎？")) {
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/orders/${row.id}/notify-pickup`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await refetch();
      setToastMessage(data.message || "已發送取車通知");
      alert(data.message || "已發送取車通知");
    }, { id: `order-pickup-notify-${row.id}`, label: "發送中..." }).catch((error) => {
      alert(error.message || "取車通知發送失敗");
    });
  }

  function requestCollectBalance(row) {
    if (Number(row.unpaidBalance || 0) <= 0) {
      setWarningModal({ title: "不需完成付款", message: "此訂單目前已結清，不需要補收尾款。" });
      return;
    }
    openPaymentModal(row);
  }

  function requestHandover(row) {
    if (row.finalPaymentStatus !== "PAID") {
      setWarningModal({ title: "請先完成上一個步驟", message: "請先完成付款，再確認交車。" });
      return;
    }
    if (accessoryChecklist.applicable && accessoryChecklist.hasAccessoryItems && !accessoryChecklist.readyForHandoverChecklist) {
      setWarningModal({
        title: "請先完成上一個步驟",
        message: accessoryChecklist.blockReason || "配件安裝確認尚未完成，請先完成安裝、測試、照片確認與交叉確認。"
      });
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

    if (!window.confirm("確認 Google 評論紀錄？")) {
      return;
    }

    await runWithProcessing(async () => {
      const data = await apiRequest(`/coupons/approve-google-review-for-order/${detail.id}`, {
        method: "POST"
      });

      alert(data.message || "Google 評論已確認");
      window.location.reload();
    }, { id: `google-review-${detail.id}`, label: "評論確認中..." }).catch((error) => {
      alert(error.message || "Google 評論確認失敗");
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
    setAccessoryChecklist(buildEmptyAccessoryChecklistState());
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
      const loaded = await apiRequest("/orders/" + row.id);
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
      if (isAccessoryChecklistEligible(nextDetail)) {
        setAccessoryChecklist((current) => ({ ...current, loading: true, error: "" }));
        try {
          const checklist = await apiRequest("/orders/" + row.id + "/accessory-install-confirmations");
          setAccessoryChecklist({
            loading: false,
            error: "",
            ...buildEmptyAccessoryChecklistState(),
            ...checklist
          });
        } catch (checklistError) {
          setAccessoryChecklist({
            ...buildEmptyAccessoryChecklistState(),
            loading: false,
            error: checklistError.message || "配件安裝確認讀取失敗"
          });
        }
      }
    } catch (loadError) {
      setToastMessage(loadError.message || "訂單明細載入失敗");
    }
  }

  async function reloadAccessoryChecklist(orderId) {
    const checklist = await apiRequest("/orders/" + orderId + "/accessory-install-confirmations");
    setAccessoryChecklist({
      loading: false,
      error: "",
      ...buildEmptyAccessoryChecklistState(),
      ...checklist
    });
    return checklist;
  }

  function updateAccessoryChecklistItemLocally(confirmationId, updater) {
    setAccessoryChecklist((current) => ({
      ...current,
      items: current.items.map((item) => item.id === confirmationId ? updater(item) : item)
    }));
  }

  async function saveAccessoryChecklistItem(item, overrides = {}) {
    if (!detail?.id) {
      return;
    }

    await runWithProcessing(async () => {
      const response = await apiRequest("/orders/" + detail.id + "/accessory-install-confirmations/" + item.id, {
        method: "PATCH",
        body: JSON.stringify(buildAccessoryUpdatePayload(item, overrides))
      });
      setAccessoryChecklist({
        loading: false,
        error: "",
        ...buildEmptyAccessoryChecklistState(),
        ...response
      });
    }, { id: "order-accessory-" + detail.id + "-" + item.id, label: "配件安裝確認更新中..." }).catch((error) => {
      alert(error.message || "配件安裝確認更新失敗");
      reloadAccessoryChecklist(detail.id).catch(() => {});
    });
  }

  async function crossCheckAccessoryChecklistItem(item) {
    if (!detail?.id) {
      return;
    }

    await runWithProcessing(async () => {
      const response = await apiRequest("/orders/" + detail.id + "/accessory-install-confirmations/" + item.id + "/cross-check", {
        method: "POST",
        body: JSON.stringify({})
      });
      setAccessoryChecklist({
        loading: false,
        error: "",
        ...buildEmptyAccessoryChecklistState(),
        ...response
      });
    }, { id: "order-accessory-cross-" + detail.id + "-" + item.id, label: "配件交叉確認中..." }).catch((error) => {
      alert(error.message || "配件交叉確認失敗");
      reloadAccessoryChecklist(detail.id).catch(() => {});
    });
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

  function printInstallCheck(row) {
    if (!row?.id) {
      return;
    }
    window.open(`/orders/${row.id}/install-check-print`, "_blank", "noopener,noreferrer");
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
          {canEditCompletedPaymentDate && isPaidOrder(row) ? (
            <button type="button" className="secondary-button" onClick={() => openPaymentDateModal(row)} disabled={isProcessing}>
              {pendingAction?.id === `order-payment-date-${row.id}` ? "處理中..." : "修改付款完成日期"}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={() => notifyPickup(row)}
            disabled={isProcessing || Boolean(getPickupNotifyBlockReason(row))}
            title={getPickupNotifyBlockReason(row) || "通知客戶可以取車"}
          >
            {pendingAction?.id === `order-pickup-notify-${row.id}` ? "發送中..." : "通知取車"}
          </button>
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
          {canPrintInstallCheck(row) ? (
            <button type="button" className="secondary-button" onClick={() => printInstallCheck(row)}>
              列印安裝品項確認單
            </button>
          ) : null}
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
      <PageHelpButton help={PAGE_HELP.orders} />
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
            {accessoryChecklist.applicable && accessoryChecklist.hasAccessoryItems ? (
              <section className="stack-card">
                <div className="section-header compact-header">
                  <div>
                    <div className="section-title">配件安裝確認</div>
                    <p className="muted-text">電動自行車訂單中的配件需完成安裝、測試、照片確認與交叉確認後才能交車。</p>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => printInstallCheck(detail)}>
                    列印安裝品項確認單
                  </button>
                </div>
                {accessoryChecklist.error ? <div className="empty-state">{accessoryChecklist.error}</div> : null}
                {accessoryChecklist.blockReason && !accessoryChecklist.readyForHandoverChecklist ? (
                  <div className="error-banner">{accessoryChecklist.blockReason}</div>
                ) : null}
                {accessoryChecklist.loading ? (
                  <div className="empty-state">配件安裝確認讀取中...</div>
                ) : accessoryChecklist.items.length ? (
                  <div className="stack-list">
                    {accessoryChecklist.items.map((item) => (
                      <div key={item.id} className="log-row">
                        <div className="section-header compact-header">
                          <div>
                            <strong>{item.itemName}</strong>
                            <div className="muted-text">
                              {item.sku ? item.sku + " / " : ""}數量 {item.quantity} / 單價 {formatAmount(item.unitPrice)} / 小計 {formatAmount(item.lineTotal)}
                            </div>
                          </div>
                          <StatusBadge tone={item.completed ? "success" : "warning"}>{item.completed ? "已交叉確認" : "待確認"}</StatusBadge>
                        </div>
                        <div className="action-row">
                          <label className="checkbox-label">
                            <input type="checkbox" checked={Boolean(item.isInstalled)} disabled={isProcessing} onChange={(event) => saveAccessoryChecklistItem(item, { isInstalled: event.target.checked })} />
                            <span>已安裝</span>
                          </label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={Boolean(item.isTested)} disabled={isProcessing} onChange={(event) => saveAccessoryChecklistItem(item, { isTested: event.target.checked })} />
                            <span>已測試</span>
                          </label>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={Boolean(item.isPhotoConfirmed)} disabled={isProcessing} onChange={(event) => saveAccessoryChecklistItem(item, { isPhotoConfirmed: event.target.checked })} />
                            <span>照片已確認</span>
                          </label>
                        </div>
                        <label className="form-field">
                          <span>備註</span>
                          <textarea
                            rows="2"
                            value={item.note || ""}
                            disabled={isProcessing}
                            onChange={(event) => updateAccessoryChecklistItemLocally(item.id, (current) => ({ ...current, note: event.target.value }))}
                            onBlur={(event) => saveAccessoryChecklistItem(item, { note: event.target.value })}
                          />
                        </label>
                        <div className="muted-text">
                          確認：{item.checkedByStaffName || "-"} {formatTaipeiDateTime(item.checkedAt)}
                          {" / "}
                          交叉確認：{item.crossCheckedByStaffName || "-"} {formatTaipeiDateTime(item.crossCheckedAt)}
                        </div>
                        <div className="action-row">
                          <button type="button" className="secondary-button" disabled={isProcessing || item.completed || !item.isInstalled || !item.isTested || !item.isPhotoConfirmed} onClick={() => crossCheckAccessoryChecklistItem(item)}>
                            交叉確認
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有需要確認的配件項目。</div>
                )}
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">整體狀態</div><div className="field-value"><StatusBadge tone={accessoryChecklist.readyForHandoverChecklist ? "success" : "warning"}>{accessoryChecklist.readyForHandoverChecklist ? "可交車" : "待確認"}</StatusBadge></div></div>
                </div>
              </section>
            ) : null}
            <section className="stack-card">
              <div className="section-title">付款狀態</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">付款方式</div><div className="field-value">{detail.paymentMethodLabel}</div></div>
                <div className="field-item"><div className="field-label">完款狀態</div><div className="field-value"><StatusBadge tone={detail.finalPaymentStatus === "PAID" ? "success" : "warning"}>{detail.finalPaymentStatusLabel}</StatusBadge></div></div>
                <div className="field-item"><div className="field-label">訂金</div><div className="field-value">{formatAmount(detail.depositAmount)}</div></div>
                <div className="field-item"><div className="field-label">尾款</div><div className="field-value">{formatAmount(detail.unpaidBalance)}</div></div>
                <div className="field-item"><div className="field-label">收款人員</div><div className="field-value">{detail.finalPaymentCompletedByName || "-"}</div></div>
                <div className="field-item"><div className="field-label">收款時間</div><div className="field-value">{detail.finalPaymentCompletedAt ? formatTaipeiDateTime(detail.finalPaymentCompletedAt) : "-"}</div></div>
                <div className="field-item"><div className="field-label">實收金額</div><div className="field-value">{detail.finalPaymentReceivedAmount ? formatAmount(detail.finalPaymentReceivedAmount) : "-"}</div></div>
                <div className="field-item"><div className="field-label">實際付款方式</div><div className="field-value">{detail.finalPaymentMethodLabel || detail.paymentMethodLabel || "-"}</div></div>
                <div className="field-item field-item-wide"><div className="field-label">收款備註</div><div className="field-value">{detail.finalPaymentNote || "-"}</div></div>
              </div>
            </section>
            <section className="stack-card">
              <div className="section-title">收款紀錄</div>
              {Array.isArray(detail.paymentRecords) && detail.paymentRecords.length ? (
                <div className="table-scroll">
                  <table className="data-table compact-table">
                    <thead>
                      <tr>
                        <th>時間</th>
                        <th>方式</th>
                        <th>階段</th>
                        <th>金額</th>
                        <th>人員</th>
                        <th>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.paymentRecords.map((record) => (
                        <tr key={record.id}>
                          <td>{formatTaipeiDateTime(record.receivedAt)}</td>
                          <td>{record.paymentMethodLabel}</td>
                          <td>{record.paymentStage}</td>
                          <td>{formatAmount(record.receivedAmount)}</td>
                          <td>{record.receivedByName || "-"}</td>
                          <td>{record.note || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">尚無收款紀錄。</div>
              )}
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
              {accessoryChecklist.applicable && accessoryChecklist.hasAccessoryItems && !accessoryChecklist.readyForHandoverChecklist ? (
                <div className="error-banner">{accessoryChecklist.blockReason || "配件安裝確認尚未完成，請先完成安裝、測試、照片確認與交叉確認。"}</div>
              ) : null}
              <div className="action-row">
              {Number(detail.unpaidBalance || 0) > 0 ? (
                <button type="button" className="primary-button inline-submit" onClick={() => requestCollectBalance(detail)} disabled={isProcessing}>
                  {pendingAction?.id === `order-payment-${detail.id}` ? "處理中..." : "完成付款"}
                </button>
              ) : null}
              {canEditCompletedPaymentDate && isPaidOrder(detail) ? (
                <button type="button" className="secondary-button" onClick={() => openPaymentDateModal(detail)} disabled={isProcessing}>
                  {pendingAction?.id === `order-payment-date-${detail.id}` ? "處理中..." : "修改付款完成日期"}
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={requestPurchaseConfirmation} disabled={isProcessing}>
                {pendingAction?.id === `order-confirmation-${detail.id}` ? "處理中..." : "發送確認書"}
              </button>
              <button type="button" className="secondary-button" onClick={requestDownloadPurchasePdf}>
                查看/下載 PDF
              </button>
              {canPrintInstallCheck(detail) || accessoryChecklist.applicable || accessoryChecklist.hasAccessoryItems ? (
                <button type="button" className="secondary-button" onClick={() => printInstallCheck(detail)}>
                  列印安裝品項確認單
                </button>
              ) : null}
              {shouldShowPickupNotifyButton(detail) ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => notifyPickup(detail)}
                  disabled={isProcessing || Boolean(getPickupNotifyBlockReason(detail))}
                  title={getPickupNotifyBlockReason(detail) || "通知客戶可以取車"}
                >
                  {pendingAction?.id === `order-pickup-notify-${detail.id}` ? "發送中..." : getPickupNotifyBlockReason(detail) ? `通知取車（${getPickupNotifyBlockReason(detail)}）` : "通知取車"}
                </button>
              ) : null}
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
                  <label className="form-field"><span>付款方式</span><select value={detailForm.paymentMethod} onChange={(event) => setDetailForm((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="CASH">現金</option><option value="CARD">刷卡</option><option value="LINE_PAY">LINE Pay</option><option value="TRANSFER">匯款</option><option value="OTHER">無卡分期</option></select></label>
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
      {paymentModal ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-label="付款完成確認">
            <div className="admin-modal-header">
              <div>
                <h2>付款完成確認</h2>
                <p>此操作會記錄處理人員、實收金額與實際付款完成日期。</p>
              </div>
              <button type="button" className="icon-button" aria-label="關閉" onClick={() => setPaymentModal(null)}>×</button>
            </div>
            <form className="grid-form compact-grid" onSubmit={submitPaymentModal}>
              <div className="field-item">
                <div className="field-label">訂單編號</div>
                <div className="field-value">{paymentModal.order.orderNo || `#${paymentModal.order.id}`}</div>
              </div>
              <div className="field-item">
                <div className="field-label">客戶</div>
                <div className="field-value">{paymentModal.order.customerName || paymentModal.order.customerNameSnapshot || "-"}</div>
              </div>
              <div className="field-item">
                <div className="field-label">訂單總額</div>
                <div className="field-value">{formatOrderFinalAmount(paymentModal.order)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">未收尾款</div>
                <div className="field-value">{formatAmount(paymentModal.order.unpaidBalance)}</div>
              </div>
              <label className="form-field">
                <span>請選擇付款方式</span>
                <select value={paymentModal.paymentMethod} onChange={(event) => updatePaymentModal("paymentMethod", event.target.value)} required>
                  <option value="">請選擇</option>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>實際收款金額</span>
                <input type="number" min="0" step="0.01" value={paymentModal.receivedAmount} onChange={(event) => updatePaymentModal("receivedAmount", event.target.value)} required />
              </label>
              <label className="form-field form-field-wide">
                <span>實際付款完成日期</span>
                <input
                  type="datetime-local"
                  value={paymentModal.paymentCompletedAt}
                  max={getTaipeiDatetimeLocal()}
                  onChange={(event) => updatePaymentModal("paymentCompletedAt", event.target.value)}
                  required
                />
                <small className="muted-text">預設為今天，可依實際收款日修改。此日期會用於銷售管理的付款完成日統計。</small>
              </label>
              <label className="form-field form-field-wide">
                <span>既有訂單備註</span>
                <textarea value={paymentModal.order.notes || ""} readOnly rows={2} />
              </label>
              <label className="form-field form-field-wide">
                <span>收款備註</span>
                <textarea value={paymentModal.note} onChange={(event) => updatePaymentModal("note", event.target.value)} rows={3} placeholder="可輸入收款說明、無卡分期資訊或其他備註" />
              </label>
              {paymentModal.error ? <div className="alert alert-error form-field-wide">{paymentModal.error}</div> : null}
              <div className="form-actions form-field-wide">
                <button type="button" className="secondary-button" onClick={() => setPaymentModal(null)}>取消</button>
                <button type="submit" className="primary-button" disabled={isProcessing}>
                  {pendingAction?.id === `order-payment-${paymentModal.order.id}` ? "處理中..." : "確認收款"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {paymentDateModal ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-label="修改實際付款完成日期">
            <div className="admin-modal-header">
              <div>
                <h2>修改實際付款完成日期</h2>
                <p>此日期會影響銷售管理的付款完成日統計，請依實際收款日填寫。</p>
              </div>
              <button type="button" className="icon-button" aria-label="關閉" onClick={() => setPaymentDateModal(null)}>×</button>
            </div>
            <form className="grid-form compact-grid" onSubmit={submitPaymentDateModal}>
              <div className="field-item">
                <div className="field-label">訂單編號</div>
                <div className="field-value">{paymentDateModal.order.orderNo || `#${paymentDateModal.order.id}`}</div>
              </div>
              <div className="field-item">
                <div className="field-label">客戶</div>
                <div className="field-value">{paymentDateModal.order.customerName || paymentDateModal.order.customerNameSnapshot || "-"}</div>
              </div>
              <label className="form-field form-field-wide">
                <span>實際付款完成日期</span>
                <input
                  type="datetime-local"
                  value={paymentDateModal.paymentCompletedAt}
                  max={getTaipeiDatetimeLocal()}
                  onChange={(event) => updatePaymentDateModal(event.target.value)}
                  required
                />
                <small className="muted-text">此日期會影響銷售管理的付款完成日統計，請依實際收款日填寫。</small>
              </label>
              {paymentDateModal.error ? <div className="alert alert-error form-field-wide">{paymentDateModal.error}</div> : null}
              <div className="form-actions form-field-wide">
                <button type="button" className="secondary-button" onClick={() => setPaymentDateModal(null)}>取消</button>
                <button type="submit" className="primary-button" disabled={isProcessing}>
                  {pendingAction?.id === `order-payment-date-${paymentDateModal.order.id}` ? "處理中..." : "儲存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
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
