import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ActionModal from "../components/ActionModal";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import ProductImage from "../components/ProductImage";
import StatusBadge from "../components/StatusBadge";
import { apiRequest } from "../lib/api";
import { formatTaipeiDate, formatTaipeiDateTime, getCategoryLabel, getRepairStatusLabel } from "../lib/display";

function getStockTone(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "danger";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "warning";
  }
  return "success";
}

function getStockLabel(stock, reorderLevel) {
  if (Number(stock) <= 0) {
    return "無庫存";
  }
  if (Number(stock) <= Number(reorderLevel || 0)) {
    return "低庫存";
  }
  return "有庫存";
}

function formatCurrency(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function normalizeQuoteItem(item) {
  const quantity = Number(item?.quantity || 0);
  const unitPrice = Number(item?.unitPrice !== undefined ? item.unitPrice : item?.price || 0);
  const productId = item?.productId !== undefined ? Number(item.productId) : item?.product_id !== undefined ? Number(item.product_id) : null;
  const sku = String(item?.sku || item?.productSku || item?.product_sku || "").trim();
  const name = String(item?.name || item?.productName || item?.product_name || "").trim();
  return {
    productId,
    sku,
    name,
    itemKey:
      String(item?.itemKey || "").trim() ||
      (productId !== null && Number.isFinite(productId) ? `product:${productId}` : sku ? `sku:${sku}` : name ? `name:${name}` : `item:${Math.random().toString(36).slice(2)}`),
    quantity,
    unitPrice,
    total: Number(item?.total || quantity * unitPrice)
  };
}

function parseQuoteItemsJson(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeQuoteItem).filter((item) => item.name && Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice));
  } catch {
    return [];
  }
}

function formatQuoteItemLabel(item) {
  return item.sku ? `${item.name} / ${item.sku}` : item.name;
}

function getReservationStatusLabel(status) {
  const labels = {
    pending_approval: "待群組確認",
    approved: "已確認",
    rejected: "已拒絕"
  };

  return labels[status] || status || "-";
}

function getEstimateLabel(detail) {
  if ((detail.quote_status === "approved" || detail.quote_status === "accepted") || detail.status === "customer_confirmed") {
    return "客戶已同意報價";
  }
  if (detail.quote_status === "rejected") {
    return "客戶已拒絕報價";
  }
  if (detail.quote_status === "sent") {
    return "待客戶回覆";
  }
  if (detail.customer_estimate_response === "approved") {
    return "客戶已同意報價";
  }
  if (detail.customer_estimate_response === "rejected") {
    return "客戶已拒絕報價";
  }
  if (detail.customer_estimate_response === "pending" && (detail.quote_status === "sent" || detail.status === "estimate_pending_approval" || detail.estimate_sent_at)) {
    return "待客戶回覆";
  }
  if (detail.status === "estimate_pending_approval") {
    return "待客戶回覆";
  }
  return "尚未報價";
}

function getEstimateTone(detail) {
  if ((detail.quote_status === "approved" || detail.quote_status === "accepted") || detail.status === "customer_confirmed") {
    return "success";
  }
  if (detail.quote_status === "rejected") {
    return "danger";
  }
  if (detail.quote_status === "sent") {
    return "warning";
  }
  if (detail.customer_estimate_response === "approved") {
    return "success";
  }
  if (detail.customer_estimate_response === "rejected") {
    return "danger";
  }
  if ((detail.customer_estimate_response === "pending" && (detail.quote_status === "sent" || detail.status === "estimate_pending_approval" || detail.estimate_sent_at)) || detail.status === "estimate_pending_approval") {
    return "warning";
  }
  return "neutral";
}

function getRepairTone(status) {
  if (status === "repairing") {
    return "warning";
  }
  if (status === "completed_waiting_pickup") {
    return "info";
  }
  if (status === "picked_up") {
    return "success";
  }
  if (status === "estimate_rejected" || status === "canceled") {
    return "danger";
  }
  return "neutral";
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
  return normalizeCustomerType(value) === "LINE" ? "LINE 客戶" : "現場客戶";
}

function isOfflineCustomerType(value) {
  return normalizeCustomerType(value) !== "LINE";
}

function getRepairActionErrorMessage(error) {
  if (false) {
    return error?.message || "操作失敗";
  }

  return error?.message || "操作失敗";
}

function getRepairConfirmationStatusLabel(status) {
  const normalized = String(status || "NOT_SENT").trim();
  if (normalized === "PENDING") return "待顧客簽署";
  if (normalized === "COMPLETED") return "已完成簽署";
  if (normalized === "CANCELED") return "已取消";
  return "未發送";
}

function getRepairConfirmationTone(status) {
  const normalized = String(status || "NOT_SENT").trim();
  if (normalized === "COMPLETED") return "success";
  if (normalized === "PENDING") return "warning";
  if (normalized === "CANCELED") return "danger";
  return "neutral";
}

function RepairDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [inspectionFee, setInspectionFee] = useState("");

  const [laborFee, setLaborFee] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");

  const [quoteItems, setQuoteItems] = useState([]);
  const [estimateNote, setEstimateNote] = useState("");
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [warningModal, setWarningModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [repairConfirmation, setRepairConfirmation] = useState(null);
  const [repairConfirmationLoading, setRepairConfirmationLoading] = useState(false);

  async function loadDetail() {
    try {
      const data = await apiRequest(`/repairs/${id}`);
      setDetail(data);
      loadRepairConfirmation();
    } catch (error) {
      alert(getRepairActionErrorMessage(error));
    }
  }

  async function loadRepairConfirmation() {
    setRepairConfirmationLoading(true);
    try {
      const data = await apiRequest(`/repair-confirmations/repairs/${id}`);
      setRepairConfirmation(data);
    } catch {
      setRepairConfirmation(null);
    } finally {
      setRepairConfirmationLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
    const intervalId = window.setInterval(() => {
      loadDetail();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [id]);

  useEffect(() => {
    async function loadProducts() {
      setProductsLoading(true);
      try {
        const data = await apiRequest("/products");
        setProducts(Array.isArray(data) ? data : []);
        setProductsError("");
      } catch (error) {
        setProductsError("找不到商品");
      } finally {
        setProductsLoading(false);
      }
    }

    loadProducts();
  }, []);

  useEffect(() => {
    if (!detail) {
      return;
    }
    setInspectionFee(detail.inspection_fee !== undefined && detail.inspection_fee !== null ? String(Number(detail.inspection_fee || 0)) : "");
    setInspectionNotes(detail.inspectionNotes || "");

    setLaborFee(detail.labor_fee !== undefined && detail.labor_fee !== null ? String(Number(detail.labor_fee || 0)) : "");
    setEstimateNote(detail.quote_notes || "");
    setQuoteItems(parseQuoteItemsJson(detail.quote_items_json));
  }, [detail?.id]);

  async function callAction(path, body = {}) {
    try {
      const response = await apiRequest(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
      loadDetail();
      loadRepairConfirmation();
      if (response?.quoteConfirmationWarning) {
        window.alert(`${response.quoteConfirmationWarning}\n${response.quoteConfirmationLink || ""}`);
      }
      return response;
    } catch (error) {
      alert(getRepairActionErrorMessage(error));
      return null;
    }
  }

  async function respondReservation(approved) {
    try {
      await apiRequest(`/repairs/${id}/reservation/respond`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          note: approved ? "後台人工確認" : "後台人工拒絕"
        })
      });
      loadDetail();
    } catch (error) {
      alert(getRepairActionErrorMessage(error));
    }
  }

  async function respondEstimate(approved) {
    try {
      await apiRequest(`/repairs/${id}/customer-response`, {
        method: "POST",
        body: JSON.stringify({
          approved
        })
      });
      loadDetail();
    } catch (error) {
      alert(getRepairActionErrorMessage(error));
    }
  }

  async function sendQuoteConfirmation() {
    const response = await callAction(`/repairs/${id}/send-quote-confirmation`);
    if (response?.quoteConfirmationWarning) {
      return;
    }
    if (response?.message) {
      window.alert(response.message);
    }
  }

  async function copyQuoteConfirmationLink() {
    const link = detail?.quoteConfirmationLink || `/line-progress?tab=repair&repairId=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(link);
      window.alert("已複製報價確認連結");
    } catch {
      window.prompt("請複製報價確認連結", link);
    }
  }

  function requestAction({ title, message, confirmText, action }) {
    setConfirmModal({ title, message, confirmText, action });
  }

  function warnPreviousStep(stepName) {
    setWarningModal({
      title: "請依照維修 SOP",
      message: `請先完成上一個步驟：${stepName}`
    });
  }

  function addProductToQuote(product) {
    if (!product) {
      return;
    }

    if (quoteLocked) {
      warnPreviousStep("等待群組確認");
      return;
    }

    const nextItem = normalizeQuoteItem({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unitPrice: Number(product.price || 0)
    });

    setQuoteItems((current) => {
      const existingIndex = current.findIndex(
        (item) =>
          item.itemKey === nextItem.itemKey ||
          (nextItem.productId !== null && item.productId !== null && String(item.productId) === String(nextItem.productId)) ||
          (nextItem.sku && item.sku && item.sku === nextItem.sku) ||
          (nextItem.name && item.name && item.name === nextItem.name)
      );
      if (existingIndex < 0) {
        return [...current, nextItem];
      }

      return current.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              productId: nextItem.productId || item.productId,
              sku: nextItem.sku || item.sku,
              name: nextItem.name || item.name,
              unitPrice: nextItem.unitPrice,
              quantity: Number(item.quantity || 0) + 1,
              total: (Number(item.quantity || 0) + 1) * nextItem.unitPrice
            }
          : item
      );
    });
  }

  function updateQuoteItemQuantity(targetId, value) {
    if (quoteLocked) {
      warnPreviousStep("等待群組確認");
      return;
    }

    const nextQuantity = Math.max(1, Number(value || 0));
    if (!Number.isFinite(nextQuantity)) {
      return;
    }

    setQuoteItems((current) =>
      current
        .map((item) =>
          item.itemKey === String(targetId || "")
            ? {
                ...item,
                quantity: nextQuantity,
                total: nextQuantity * Number(item.unitPrice || 0)
              }
            : item
        )
        .filter((item) => item.name && Number(item.quantity || 0) > 0)
    );
  }

  function changeQuoteItemQuantity(targetId, delta) {
    const item = quoteItems.find((current) => current.itemKey === String(targetId || ""));
    if (!item) {
      return;
    }

    updateQuoteItemQuantity(targetId, Number(item.quantity || 0) + Number(delta || 0));
  }

  function removeQuoteItem(targetId) {
    if (quoteLocked) {
      warnPreviousStep("等待群組確認");
      return;
    }

    setQuoteItems((current) => current.filter((item) => item.itemKey !== String(targetId || "")));
  }

  async function saveInspection() {
    if (!inspectionNotes.trim()) {
      window.alert("請先填寫檢查內容");
      return;
    }

    try {
      await apiRequest(`/repairs/${id}/inspection`, {
        method: "PATCH",
        body: JSON.stringify({
          inspectionFee: Number(inspectionFee || 0),
          inspectionNotes: inspectionNotes.trim()
        })
      });

      await loadDetail();
      window.alert("檢查內容已儲存，可以進入下一步填寫報價");
    } catch (error) {
      window.alert(error.message || "檢查內容儲存失敗");
    }
  }

  function requestSendEstimate() {
    if (!canShowQuoteEditor) {
      warnPreviousStep("維修報價");
      return;
    }
    if (detail.reservation_status === "pending_approval") {
      warnPreviousStep("建立維修單");
      return;
    }
    const items = quoteItems.map(normalizeQuoteItem).filter((item) => item.name && Number(item.quantity || 0) > 0);
    const partsFee = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const totalAmount = Number(inspectionFee || 0) + partsFee + Number(laborFee || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setWarningModal({
        title: "請先完成報價",
        message: "請先加入零件，或填入檢查費與工資，系統會自動計算總報價。"
      });
      return;
    }
    requestAction({
      title: "送出報價",
      message: "確認要送出維修報價給客戶嗎？",
      confirmText: "送出報價",
      action: () =>
        callAction(`/repairs/${id}/estimate`, {
          estimateAmount: totalAmount,
          inspectionFee: Number(inspectionFee || 0),
          inspectionNotes,
          partsFee,
          laborFee: Number(laborFee || 0),
          items,
          note: estimateNote,
          notes: estimateNote,
          totalAmount
        })
    });
  }

  function requestStartRepair() {
    if (!canStartRepair) {
      warnPreviousStep("等待客戶同意");
      return;
    }
    requestAction({
      title: "開始維修",
      message: "確認客戶已同意報價，開始維修嗎？",
      confirmText: "開始維修",
      action: () => callAction(`/repairs/${id}/approve`)
    });
  }


  async function offlineCompleteRepair() {
    const amountText = window.prompt(
      "請輸入現場已完成維修金額",
      detail.estimate_amount || detail.estimateAmount || "0"
    );

    if (amountText === null) return;

    const amount = Number(amountText || 0);

    if (!Number.isFinite(amount) || amount < 0) {
      alert("金額不正確");
      return;
    }

    const note = window.prompt(
      "備註（可留空）",
      "現場已完成維修，略過 LINE 報價流程"
    );

    if (note === null) return;

    await callAction(`/repairs/${id}/offline-complete`, {
      estimateAmount: amount,
      note,
      details: note
    });
  }

  function requestCompleteRepair() {
    if (detail.status !== "repairing") {
      warnPreviousStep("維修中");
      return;
    }
    requestAction({
      title: "完成通知取車",
      message: isOfflineCustomerType(detail.customerType) ? "確認維修已完成？完成後請按「已電話通知」記錄通知。" : "確認維修已完成並通知客戶取車嗎？",
      confirmText: "完成通知取車",
      action: () => callAction(`/repairs/${id}/complete`)
    });
  }

  function requestPhoneNotified() {
    requestAction({
      title: "已電話通知",
      message: "確認已用電話通知客戶取車嗎？",
      confirmText: "已電話通知",
      action: () => callAction(`/repairs/${id}/phone-notified`)
    });
  }

  function requestPickup() {
    if (detail.status !== "completed_waiting_pickup") {
      warnPreviousStep("完成通知取車");
      return;
    }
    const confirmationStatus = repairConfirmation?.status || repairConfirmation?.confirmation?.status || "NOT_SENT";
    requestAction({
      title: "已取車",
      message: confirmationStatus === "COMPLETED"
        ? "確認客戶已取車嗎？"
        : "顧客尚未完成維修確認簽名，是否仍要完成取車？",
      confirmText: "已取車",
      action: () => callAction(`/repairs/${id}/pickup`)
    });
  }

  async function sendRepairConfirmation() {
    try {
      const response = await apiRequest(`/repair-confirmations/repairs/${id}/send`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await loadRepairConfirmation();
      if (response?.lineError) {
        alert(`${response.message || "已產生維修完成確認書連結"}\nLINE 發送失敗：${response.lineError}\n連結：${response.link || ""}`);
      } else {
        alert(response?.message || "已發送維修完成確認書");
      }
    } catch (error) {
      alert(getRepairActionErrorMessage(error));
    }
  }

  async function copyRepairConfirmationLink() {
    const link = repairConfirmation?.confirmation?.link;
    if (!link) {
      alert("目前沒有可複製的確認書連結");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      alert("已複製連結");
    } catch {
      window.prompt("請複製維修確認書連結", link);
    }
  }

  const summaryBadges = useMemo(
    () =>
      detail
        ? [
            { tone: detail.reservation_status === "pending_approval" ? "warning" : "info", label: getReservationStatusLabel(detail.reservation_status) },
            { tone: getEstimateTone(detail), label: getEstimateLabel(detail) },
            { tone: getRepairTone(detail.status), label: getRepairStatusLabel(detail.status) },
            { tone: detail.completed_at ? "success" : "neutral", label: detail.completed_at ? "已完成通知" : "未通知完成" },
            { tone: detail.surveyId || detail.surveys?.length ? "info" : "neutral", label: detail.surveyId || detail.surveys?.length ? "已填問卷" : "未填問卷" }
          ]
        : [],
    [detail]
  );

  const summaryCards = useMemo(
    () =>
      detail
        ? [
            { label: "預約狀態", value: getReservationStatusLabel(detail.reservation_status) },
            { label: "報價狀態", value: getEstimateLabel(detail) },
            { label: "維修狀態", value: getRepairStatusLabel(detail.status) },
            { label: "完成通知", value: detail.completed_at ? "已通知" : "未通知" },
            { label: "問卷", value: detail.surveyId || detail.surveys?.length ? "已填寫" : "未填寫" }
          ]
        : [],
    [detail]
  );

  if (!detail) {
    return <div className="loading-state">載入維修明細中...</div>;
  }

  const surveyRows = detail.surveys || [];
  const logRows = detail.logs || [];
  const quoteLocked = detail.reservation_status === "pending_approval" || detail.reservation_status === "rejected" || detail.status === "canceled";
  const repairStatusValue = String(detail.status || "").trim();
  const quoteStatusValue = String(detail.quote_status || "").trim();
  const hasCompletedAt = Boolean(detail.completed_at);
  const hasPickedUpAt = Boolean(detail.picked_up_at);
  const isFinalizedRepair =
    ["completed", "completed_waiting_pickup", "picked_up"].includes(repairStatusValue) ||
    hasCompletedAt ||
    hasPickedUpAt;
  const canShowQuoteEditor =
    !isFinalizedRepair &&
    Boolean(detail.inspectionNotes && detail.inspectionNotes.trim()) &&
    detail.reservation_status === "approved" &&
    repairStatusValue === "reserved" &&
    !detail.estimate_sent_at &&
    !["estimate_pending_approval", "estimate_approved", "customer_confirmed", "repairing"].includes(repairStatusValue) &&
    !["sent", "approved", "accepted"].includes(quoteStatusValue) &&
    detail.customer_estimate_response !== "approved";
  const canStartRepair =
    !isFinalizedRepair &&
    (detail.customer_estimate_response === "approved" ||
      quoteStatusValue === "approved" ||
      quoteStatusValue === "accepted" ||
      repairStatusValue === "estimate_approved" ||
      repairStatusValue === "customer_confirmed");
  const inspectionAmount = Number(inspectionFee || 0);
  const laborAmount = Number(laborFee || 0);
  const selectedQuoteItems = quoteItems.map(normalizeQuoteItem).filter((item) => item.name && Number(item.quantity || 0) > 0);
  const partsTotal = selectedQuoteItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const estimateTotal = inspectionAmount + partsTotal + laborAmount;
  const productKeyword = productSearch.trim().toLowerCase();
  const productRows = products.map((item) => ({
    ...item,
    categoryLabel: item.categoryLabel || getCategoryLabel(item.category),
    stockTone: getStockTone(item.stock, item.reorderLevel),
    stockLabel: getStockLabel(item.stock, item.reorderLevel)
  }));
  const filteredProducts = productRows.filter((product) => {
    return `${product.name || ""} ${product.sku || ""} ${product.categoryLabel || ""}`
      .toLowerCase()
      .includes(productKeyword);
  });

  const repairSteps = [
    { label: "建立維修單", done: detail.reservation_status !== "pending_approval" },
    { 
      label: "填寫檢查內容", 
      done: Boolean(detail.inspectionNotes && detail.inspectionNotes.trim()) 
    },
    { label: "填寫報價", done: Number(detail.estimate_amount || 0) > 0 },
    { label: "等待客戶同意", done: detail.customer_estimate_response === "approved" || detail.quote_status === "approved" || detail.quote_status === "accepted" || detail.status === "estimate_approved" || detail.status === "customer_confirmed" || detail.status === "repairing" || detail.status === "completed_waiting_pickup" || detail.status === "picked_up" },
    { label: "維修中", done: detail.status === "repairing" || detail.status === "completed_waiting_pickup" || detail.status === "picked_up" },
    { label: "完成通知取車", done: detail.status === "completed_waiting_pickup" || detail.status === "picked_up" }
  ];
  const currentStep = repairSteps.find((step) => !step.done) || repairSteps[repairSteps.length - 1];
  const currentRepairAction =
    isFinalizedRepair
      ? null
      : detail.reservation_status === "pending_approval"
        ? { label: "確認預約", action: () => respondReservation(true), tone: "blue" }
        : currentStep.label === "填寫報價"
          ? canShowQuoteEditor
            ? { label: "送出報價", action: requestSendEstimate, tone: "blue" }
            : null
          : currentStep.label === "等待客戶同意"
            ? { label: "等待客戶同意", action: () => warnPreviousStep("等待客戶同意"), tone: "yellow" }
            : currentStep.label === "維修中"
              ? canStartRepair
                ? { label: "開始維修", action: requestStartRepair, tone: "blue" }
                : null
              : detail.status === "repairing"
                ? { label: "完成通知取車", action: requestCompleteRepair, tone: "blue" }
              : detail.status === "completed_waiting_pickup"
                ? { label: "已取車", action: requestPickup, tone: "green" }
                  : null;
  const repairConfirmationStatus = repairConfirmation?.status || repairConfirmation?.confirmation?.status || "NOT_SENT";
  const repairConfirmationData = repairConfirmation?.confirmation || null;
  const repairConfirmationBlockReason = repairConfirmation?.blockReason || "";
  const canSendRepairConfirmation = Boolean(repairConfirmation?.canSend);
  const quoteConfirmationStatus = detail?.quoteConfirmationStatus || "NOT_SENT";
  const quoteConfirmationLabel =
    quoteConfirmationStatus === "SENT"
      ? "已發送"
      : quoteConfirmationStatus === "FAILED"
        ? "發送失敗"
        : "未發送";
  const quoteConfirmationTone =
    quoteConfirmationStatus === "SENT"
      ? "success"
      : quoteConfirmationStatus === "FAILED"
        ? "danger"
        : "neutral";
  const repairConfirmationDescription =
    repairConfirmationStatus === "COMPLETED"
      ? "顧客已完成簽署，可查看 PDF。"
      : repairConfirmationStatus === "PENDING"
        ? "待顧客現場確認車輛狀態後完成簽名。"
        : repairConfirmationBlockReason || "系統將在維修完成且付款完成後自動發送維修確認書。";
  const repairConfirmationPanel = (
    <section className="content-card">
      <div className="section-header">
        <div>
          <h2>維修完成確認書</h2>
          <p className="muted-text">{repairConfirmationDescription}</p>
          {repairConfirmationStatus === "PENDING" && !detail.lineUserId ? (
            <p className="muted-text">顧客未綁定 LINE，請複製連結或現場提供給顧客簽署。</p>
          ) : null}
        </div>
        <StatusBadge tone={getRepairConfirmationTone(repairConfirmationStatus)}>
          {repairConfirmationLoading ? "讀取中" : getRepairConfirmationStatusLabel(repairConfirmationStatus)}
        </StatusBadge>
      </div>
      <div className="action-row sop-primary-action">
        {repairConfirmationStatus === "COMPLETED" ? (
          repairConfirmationData?.pdfUrl ? (
            <a className="primary-button inline-submit" href={repairConfirmationData.pdfUrl} target="_blank" rel="noreferrer">
              查看PDF
            </a>
          ) : null
        ) : (
          <button
            type="button"
            className="primary-button inline-submit"
            onClick={sendRepairConfirmation}
            disabled={!canSendRepairConfirmation || repairConfirmationLoading}
          >
            {canSendRepairConfirmation ? (repairConfirmationStatus === "PENDING" ? "再次發送維修確認書" : "發送維修確認書") : (repairConfirmationBlockReason || "維修完成後可發送確認書")}
          </button>
        )}
        {repairConfirmationStatus === "PENDING" && repairConfirmationData?.link ? (
          <button type="button" className="secondary-button" onClick={copyRepairConfirmationLink}>
            複製連結
          </button>
        ) : null}
        {repairConfirmationStatus === "COMPLETED" && repairConfirmationData?.link ? (
          <button type="button" className="secondary-button" onClick={copyRepairConfirmationLink}>
            複製連結
          </button>
        ) : null}
      </div>
    </section>
  );

  if (isFinalizedRepair) {
    return (
      <div>
        <PageHeader
          title={`維修工單 #${detail.id}`}
          description="已完成或已取車的維修單僅顯示摘要，不再提供前一階段操作。"
        />

        <section className="content-card">
          <div className="section-header">
            <div>
              <h2>{hasPickedUpAt || repairStatusValue === "picked_up" ? "已取車" : "已完成"}</h2>
              <p className="muted-text">完成後只保留查詢與系統資訊。</p>
            </div>
            <div className="status-stack">
              {hasCompletedAt || repairStatusValue === "completed_waiting_pickup" || repairStatusValue === "picked_up" ? (
                <StatusBadge tone="success">已完成</StatusBadge>
              ) : null}
              {hasPickedUpAt || repairStatusValue === "picked_up" ? <StatusBadge tone="success">已取車</StatusBadge> : null}
            </div>
          </div>
          <div className="sop-focus-grid">
            <div className="field-item">
              <div className="field-label">客戶</div>
              <div className="field-value">{detail.customerName}</div>
            </div>
            <div className="field-item">
              <div className="field-label">車款 / 問題</div>
              <div className="field-value">
                {detail.bike_model || "-"} / {detail.issue_description || "-"}
              </div>
            </div>
            <div className="field-item">
              <div className="field-label">報價狀態</div>
              <div className="field-value">
                <StatusBadge tone={getEstimateTone(detail)}>{getEstimateLabel(detail)}</StatusBadge>
              </div>
            </div>
            <div className="field-item">
              <div className="field-label">維修狀態</div>
              <div className="field-value">{getRepairStatusLabel(detail.status)}</div>
            </div>
          </div>
          <div className="action-row sop-primary-action">
            <button type="button" className="secondary-button" onClick={() => setDetailsOpen((current) => !current)}>
              {detailsOpen ? "收合詳情" : "查看詳情"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setSystemInfoOpen((current) => !current)}>
              系統資訊
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate("/repairs")}>
              返回列表
            </button>
          </div>
        </section>

        {repairConfirmationPanel}

        {detailsOpen ? (
          <section className="content-card">
            <div className="section-title">維修詳情</div>
            <div className="field-grid">
              <div className="field-item">
                <div className="field-label">客戶</div>
                <div className="field-value">{detail.customerName}</div>
              </div>
              <div className="field-item">
                <div className="field-label">電話</div>
                <div className="field-value">{detail.customerPhone || "-"}</div>
              </div>
              <div className="field-item">
                <div className="field-label">客戶類型</div>
                <div className="field-value">
                  <StatusBadge tone={isOfflineCustomerType(detail.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(detail.customerType)}</StatusBadge>
                </div>
              </div>
              {!isOfflineCustomerType(detail.customerType) ? (
                <div className="field-item">
                  <div className="field-label">LINE 綁定</div>
                  <div className="field-value">{detail.lineUserId ? "已綁定" : "未綁定"}</div>
                </div>
              ) : null}
              <div className="field-item">
                <div className="field-label">完修時間</div>
                <div className="field-value">{formatTaipeiDateTime(detail.completed_at)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">取車時間</div>
                <div className="field-value">{formatTaipeiDateTime(detail.picked_up_at)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">報價金額</div>
                <div className="field-value">NT${Number(detail.estimate_amount || 0).toFixed(0)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">檢查內容</div>
                <div className="field-value">{detail.inspectionNotes || "-"}</div>
              </div>


              <div className="field-item">
                <div className="field-label">報價內容</div>
                <div className="field-value">{detail.estimate_details || "-"}</div>
              </div>
            </div>
          </section>
        ) : null}

        {systemInfoOpen ? (
          <section className="content-card">
            <div className="section-title">系統資訊</div>
            <div className="field-grid">
              <div className="field-item">
                <div className="field-label">維修單號</div>
                <div className="field-value">#{detail.id}</div>
              </div>
              {!isOfflineCustomerType(detail.customerType) ? (
                <div className="field-item">
                  <div className="field-label">LINE userId</div>
                  <div className="field-value">{detail.lineUserId || "-"}</div>
                </div>
              ) : null}
              <div className="field-item">
                <div className="field-label">建立時間</div>
                <div className="field-value">{formatTaipeiDateTime(detail.created_at)}</div>
              </div>
              <div className="field-item">
                <div className="field-label">保管費</div>
                <div className="field-value">NT${Number(detail.storageFee || 0).toFixed(0)}</div>
              </div>
            </div>
          </section>
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
            const action = confirmModal?.action;
            setConfirmModal(null);
            action?.();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`維修工單 #${detail.id}`}
        description="依照維修 SOP 一步一步處理，每次只操作下一個主要動作。"
      />

      <section className="content-card sop-overview">
        <div className="sop-step-list">
          {repairSteps.map((step, index) => (
            <div key={step.label} className={`sop-step ${step.done ? "sop-step-done" : index === repairSteps.findIndex((item) => !item.done) ? "sop-step-active" : ""}`}>
              <div className="sop-step-number">{index + 1}</div>
              <div>
                <strong>{step.label}</strong>
                <span>{step.done ? "已完成" : "待處理"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {repairConfirmationPanel}

      <div className="page-grid">
        <div className="page-grid-main">
          <div className="section-panel">
            <section className="content-card">
              <div className="section-header">
                <div>
                  <h2>目前步驟：{currentStep.label}</h2>
                  <p className="muted-text">此頁預設只顯示維修 SOP 下一個需要處理的動作。</p>
                </div>
                <StatusBadge tone={getRepairTone(detail.status)}>{getRepairStatusLabel(detail.status)}</StatusBadge>
              </div>
              <div className="sop-focus-grid">
                <div className="field-item">
                  <div className="field-label">客戶</div>
                  <div className="field-value">{detail.customerName}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">車款 / 問題</div>
                  <div className="field-value">{detail.bike_model || "-"} / {detail.issue_description || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">報價狀態</div>
                  <div className="field-value"><StatusBadge tone={getEstimateTone(detail)}>{getEstimateLabel(detail)}</StatusBadge></div>
                </div>
                <div className="field-item">
                  <div className="field-label">維修訂單</div>
                  <div className="field-value">{detail.order_id ? `#${detail.order_id}` : "尚未建立"}</div>
                </div>
              </div>

              {currentStep.label === "填寫檢查內容" ? (
                <div className="wizard-panel wizard-panel-blue sop-primary-action">
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>
                    填寫檢查內容
                  </div>
                  <textarea
                    rows={6}
                    value={inspectionNotes}
                    onChange={(e) => setInspectionNotes(e.target.value)}
                    placeholder="請直接在這裡填寫檢查內容，例如：輪胎、煞車、控制器、馬達、線路、電池狀況..."
                    style={{
                      width: "100%",
                      minHeight: 150,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #cbd5e1",
                      fontSize: 16,
                      lineHeight: 1.6,
                      boxSizing: "border-box",
                      marginBottom: 12
                    }}
                  />
                  <button
                    type="button"
                    className="primary-button inline-submit"
                    onClick={saveInspection}
                    disabled={!inspectionNotes.trim()}
                  >
                    儲存檢查內容，進入下一步
                  </button>
                </div>
              ) : null}

              {currentStep.label === "填寫報價" && !detail.inspectionNotes?.trim() ? (
                <div className="wizard-panel wizard-panel-yellow sop-primary-action">
                  請先完成 Step 2「填寫檢查內容」，才能進入 Step 3「填寫報價」。
                </div>
              ) : null}

              {detail.reservation_status === "pending_approval" ? (
                <div className="action-row sop-primary-action">
                  <button type="button" className="primary-button inline-submit" onClick={() => respondReservation(true)}>
                    下一步：確認預約
                  </button>
                  <button type="button" className="secondary-button" onClick={() => respondReservation(false)}>
                    拒絕預約
                  </button>
                </div>
              ) : null}

              {detail.reservation_status !== "pending_approval" && currentRepairAction ? (
                <div className={`wizard-panel wizard-panel-${currentRepairAction.tone} sop-primary-action`}>
                  <button type="button" className="primary-button inline-submit" onClick={currentRepairAction.action}>
                    {currentRepairAction.label}
                  </button>
                </div>
              ) : null}
              {isOfflineCustomerType(detail.customerType) && detail.status === "completed_waiting_pickup" ? (
                <div className="wizard-panel wizard-panel-blue sop-primary-action">
                  <button type="button" className="primary-button inline-submit" onClick={requestPhoneNotified}>
                    已電話通知
                  </button>
                </div>
              ) : null}
              <div className="action-row sop-primary-action">
                <button type="button" className="secondary-button" onClick={() => setDetailsOpen((current) => !current)}>
                  {detailsOpen ? "收合詳情" : "查看詳情"}
                </button>
                <button type="button" className="secondary-button" onClick={() => setSystemInfoOpen((current) => !current)}>
                  系統資訊
                </button>
                <button type="button" className="secondary-button" onClick={() => navigate("/repairs")}>
                  返回列表
                </button>
                {detail.order_id ? (
                  <button type="button" className="secondary-button" onClick={() => navigate("/orders?tab=REPAIR")}>
                    查看維修訂單
                  </button>
                ) : null}
              </div>
            </section>

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">維修詳情</div>
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">客戶</div>
                  <div className="field-value">{detail.customerName}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">電話</div>
                  <div className="field-value">{detail.customerPhone || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">客戶類型</div>
                  <div className="field-value">
                    <StatusBadge tone={isOfflineCustomerType(detail.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(detail.customerType)}</StatusBadge>
                  </div>
                </div>
                {!isOfflineCustomerType(detail.customerType) ? (
                  <div className="field-item">
                    <div className="field-label">LINE 綁定</div>
                    <div className="field-value">{detail.lineUserId ? "已綁定" : "未綁定"}</div>
                  </div>
                ) : null}
              </div>
            </section>
            ) : null}

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">預約資訊</div>
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">預約日期</div>
                  <div className="field-value">{formatTaipeiDate(detail.reservation_date)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">預約時間</div>
                  <div className="field-value">{detail.reservation_time || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">預約狀態</div>
                  <div className="field-value">{getReservationStatusLabel(detail.reservation_status)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">群組確認時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.group_confirmed_at)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">群組確認人</div>
                  <div className="field-value">{detail.group_confirmed_by || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">建立時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.created_at)}</div>
                </div>
              </div>
              {detail.reservation_status === "pending_approval" ? (
                <div className="action-row" style={{ marginTop: 12 }}>
                  <button type="button" className="secondary-button" onClick={() => respondReservation(true)}>
                    確認預約
                  </button>
                  <button type="button" className="secondary-button" onClick={() => respondReservation(false)}>
                    拒絕預約
                  </button>
                </div>
              ) : null}
            </section>
            ) : null}

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">維修內容</div>
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">車款</div>
                  <div className="field-value">{detail.bike_model || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">維修內容</div>
                  <div className="field-value">{detail.issue_description || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">維修狀態</div>
                  <div className="field-value">{getRepairStatusLabel(detail.status)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">保管費</div>
                  <div className="field-value">NT${Number(detail.storageFee || 0).toFixed(0)}</div>
                </div>
              </div>
            </section>
            ) : null}

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">報價資訊</div>
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">報價金額</div>
                  <div className="field-value">NT${Number(detail.estimate_amount || 0).toFixed(0)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">檢查費</div>
                  <div className="field-value">NT${Number(detail.inspection_fee || 0).toFixed(0)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">零件費</div>
                  <div className="field-value">NT${Number(detail.parts_fee || 0).toFixed(0)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">工資</div>
                  <div className="field-value">NT${Number(detail.labor_fee || 0).toFixed(0)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">報價內容</div>
                  <div className="field-value">{detail.estimate_details || "-"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">報價狀態</div>
                  <div className="field-value">
                    <StatusBadge tone={getEstimateTone(detail)}>{getEstimateLabel(detail)}</StatusBadge>
                  </div>
                </div>
                <div className="field-item">
                  <div className="field-label">送出時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.estimate_sent_at)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">報價確認通知</div>
                  <div className="field-value">
                    <StatusBadge tone={quoteConfirmationTone}>{quoteConfirmationLabel}</StatusBadge>
                  </div>
                </div>
                <div className="field-item">
                  <div className="field-label">通知時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.quoteConfirmationSentAt || detail.quoteConfirmationFailedAt)}</div>
                </div>
              </div>
              {(detail.customer_estimate_response === "pending" || detail.status === "estimate_pending_approval") ? (
                <>
                  {detail.quoteConfirmationWarning ? (
                    <p className="muted-text">{detail.quoteConfirmationWarning}</p>
                  ) : null}
                  <div className="action-row" style={{ marginTop: 12 }}>
                    <button type="button" className="secondary-button" onClick={sendQuoteConfirmation}>
                      再次發送報價確認
                    </button>
                    <button type="button" className="secondary-button" onClick={copyQuoteConfirmationLink}>
                      複製確認連結
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondEstimate(true)}>
                      客戶同意報價
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondEstimate(false)}>
                      客戶拒絕報價
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={offlineCompleteRepair}
                    >
                      現場已完成維修登錄
                    </button>
                  </div>
                </>
              ) : null}
            </section>
            ) : null}

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">客戶回覆</div>
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">客戶回覆</div>
                  <div className="field-value">{detail.customerEstimateResponseLabel || "尚未送出報價"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">回覆時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.customer_estimate_responded_at)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">客戶確認時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.customer_confirmed_at)}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">開始維修</div>
                  <div className="field-value">{detail.approved_by_staff_id ? "已處理" : "未處理"}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">完修時間</div>
                  <div className="field-value">{formatTaipeiDateTime(detail.completed_at)}</div>
                </div>
              </div>
            </section>
            ) : null}

            {detailsOpen ? (
              <section className="content-card">
              <div className="section-title">處理紀錄</div>
              {logRows.length ? (
                <div className="stack-list">
                  {logRows.map((log) => (
                    <div key={log.id} className="log-row">
                      <strong>{log.action}</strong>
                      <div>{log.note}</div>
                      <div className="muted-text">{formatTaipeiDateTime(log.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">目前沒有紀錄。</div>
              )}
            </section>
            ) : null}

            {systemInfoOpen ? (
              <section className="content-card">
                <div className="section-title">系統資訊</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">維修單號</div><div className="field-value">#{detail.id}</div></div>
                  {!isOfflineCustomerType(detail.customerType) ? (
                    <div className="field-item"><div className="field-label">LINE userId</div><div className="field-value">{detail.lineUserId || "-"}</div></div>
                  ) : null}
                  <div className="field-item"><div className="field-label">建立時間</div><div className="field-value">{formatTaipeiDateTime(detail.created_at)}</div></div>
                  <div className="field-item"><div className="field-label">保管費</div><div className="field-value">NT${Number(detail.storageFee || 0).toFixed(0)}</div></div>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <div className="page-grid-side">
          <div className="section-panel">
            <section className="content-card form-card">
              <div className="section-title">問卷結果</div>
              {surveyRows.length ? (
                <div className="stack-list">
                  {surveyRows.map((survey) => (
                    <div key={survey.id} className="log-row">
                      <strong>評分 {survey.rating || "-"}</strong>
                      <div>{survey.feedback || "-"}</div>
                      <div className="muted-text">{formatTaipeiDateTime(survey.submittedAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">目前沒有維修問卷。</div>
              )}
            </section>

            {canShowQuoteEditor ? (
              <section className="content-card form-card">
                <div className="section-title">維修報價</div>
                <div className="grid-form compact-grid">
                  <div className="field-item">
                    <div className="field-label">客戶</div>
                    <div className="field-value">{detail.customerName} / {detail.customerPhone || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">車款 / 問題</div>
                    <div className="field-value">{detail.bike_model || "-"} / {detail.issue_description || "-"}</div>
                  </div>
                  <label className="form-field">
                    <span>檢查費</span>
                    <input type="number" min="0" value={inspectionFee} disabled={quoteLocked} onChange={(event) => setInspectionFee(event.target.value)} />

                  </label>
                  <label className="form-field">
                    <span>工資</span>
                    <input type="number" min="0" value={laborFee} disabled={quoteLocked} onChange={(event) => setLaborFee(event.target.value)} />
                  </label>
                  <div className="form-field form-field-wide">
                    <div className="field-label">商品列表</div>
                    <FilterBar compact>
                      <label className="form-field">
                        <span>搜尋商品</span>
                        <input
                          value={productSearch}
                          disabled={quoteLocked}
                          onChange={(event) => setProductSearch(event.target.value)}
                          placeholder="商品名稱 / SKU / 類別"
                        />
                      </label>
                    </FilterBar>
                    {productsLoading ? <div className="loading-state">載入商品中...</div> : null}
                    {productsError ? <div className="error-banner">{productsError}</div> : null}
                    {!productsLoading && !productsError ? (
                      filteredProducts.length ? (
                        <div className="pos-product-grid">
                          {filteredProducts.map((product) => (
                            <article key={product.id} className="pos-product-card">
                              <div className="pos-product-media">
                                <ProductImage src={product.imageUrl} alt={product.name} />
                                <div className="identity-copy">
                                  <div className="identity-title">{product.name}</div>
                                  <div className="identity-subtitle">
                                    {product.sku} / {product.categoryLabel || "-"}
                                  </div>
                                </div>
                              </div>
                              <div className="pos-product-meta">
                                <StatusBadge tone={product.stockTone}>{product.stockLabel}</StatusBadge>
                                <div className="pos-product-price">{formatCurrency(product.price)}</div>
                                <div className="muted-text">庫存 {Number(product.stock || 0)}</div>
                              </div>
                              <button type="button" className="primary-button pos-add-button" disabled={quoteLocked} onClick={() => addProductToQuote(product)}>
                                加入零件
                              </button>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">沒有符合條件的商品。</div>
                      )
                    ) : null}
                  </div>
                  <div className="form-field form-field-wide">
                    <div className="field-label">零件項目</div>
                    {selectedQuoteItems.length ? (
                      <div className="cart-list">
                        {selectedQuoteItems.map((item) => (
                          <div key={item.itemKey} className="cart-row">
                            <div className="cart-row-copy">
                              <div className="identity-title">{formatQuoteItemLabel(item)}</div>
                              <div className="identity-subtitle">單價 NT${Number(item.unitPrice || 0).toFixed(0)}</div>
                            </div>
                            <div className="cart-row-actions">
                              <div className="cart-row-price">
                                <strong>NT${Number(item.total || 0).toFixed(0)}</strong>
                                <span className="muted-text">小計</span>
                              </div>
                              <div className="cart-stepper">
                                <button type="button" className="secondary-button" disabled={quoteLocked} onClick={() => changeQuoteItemQuantity(item.itemKey, -1)}>
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  disabled={quoteLocked}
                                  onChange={(event) => updateQuoteItemQuantity(item.itemKey, event.target.value)}
                                  style={{ width: 84 }}
                                />
                                <button type="button" className="secondary-button" disabled={quoteLocked} onClick={() => changeQuoteItemQuantity(item.itemKey, 1)}>
                                  +
                                </button>
                                <button type="button" className="secondary-button" disabled={quoteLocked} onClick={() => removeQuoteItem(item.itemKey)}>
                                  移除
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">尚未加入零件。</div>
                    )}
                  </div>
                  <div className="sop-summary-box form-field-wide">
                    <div><strong>檢查費</strong><span>{formatCurrency(inspectionAmount)}</span></div>
                    <div><strong>零件合計</strong><span>{formatCurrency(partsTotal)}</span></div>
                    <div><strong>工資</strong><span>{formatCurrency(laborAmount)}</span></div>
                    <div><strong>總報價</strong><span>{formatCurrency(estimateTotal)}</span></div>
                  </div>
                  <label className="form-field">
                    <span>備註</span>
                    <input value={estimateNote} disabled={quoteLocked} onChange={(event) => setEstimateNote(event.target.value)} />
                  </label>
                  {quoteLocked ? <div className="muted-text">待群組確認前不可編輯或送出報價。</div> : null}
                  <div className="wizard-actions form-field-wide">
                    <button type="button" className="primary-button inline-submit" disabled={quoteLocked || estimateTotal <= 0} onClick={requestSendEstimate}>
                      下一步
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
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
          const action = confirmModal?.action;
          setConfirmModal(null);
          action?.();
        }}
      />
    </div>
  );
}

export default RepairDetailPage;
