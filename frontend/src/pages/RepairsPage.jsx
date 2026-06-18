import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ActionModal from "../components/ActionModal";
import DataTable from "../components/DataTable";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import ProcessingOverlay from "../components/ProcessingOverlay";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { useProcessingGuard } from "../hooks/useProcessingGuard";
import { getStoredUser } from "../lib/auth";
import { API_BASE_URL, apiRequest } from "../lib/api";
import { formatTaipeiDate, getRepairStatusLabel } from "../lib/display";

function getReservationStatusLabel(status) {
  const labels = {
    pending_approval: "待群組確認",
    approved: "已確認",
    rejected: "已拒絕"
  };

  return labels[status] || status || "-";
}

function getEstimateStatusLabel(row) {
  if (row.customerEstimateResponse === "approved") {
    return "客戶已同意";
  }
  if (row.customerEstimateResponse === "rejected") {
    return "客戶已拒絕";
  }
  if (row.customerEstimateResponse === "pending") {
    return "待客戶回覆";
  }
  if (["estimate_pending_approval", "quoted", "waiting_customer_confirm"].includes(String(row.status || "").trim())) {
    return "待客戶回覆";
  }
  return "尚未報價";
}

function getEstimateTone(row) {
  if (row.customerEstimateResponse === "approved") {
    return "success";
  }
  if (row.customerEstimateResponse === "rejected") {
    return "danger";
  }
  if (row.customerEstimateResponse === "pending" || ["estimate_pending_approval", "quoted", "waiting_customer_confirm"].includes(String(row.status || "").trim())) {
    return "warning";
  }
  return "neutral";
}

function getRepairStatusTone(status) {
  if (["repairing", "in_progress"].includes(String(status || "").trim())) {
    return "warning";
  }
  if (["completed_waiting_pickup", "ready_for_pickup"].includes(String(status || "").trim())) {
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

function getSourceBadgeLabel(row) {
  return normalizeCustomerType(row.customerType) === "LINE" && row.source === "LINE" ? "LINE預約" : "現場客戶";
}

function getReservationBadgeLabel(row) {
  if (normalizeCustomerType(row.customerType) !== "LINE" || row.source !== "LINE") {
    return null;
  }
  return row.reservationStatusLabel || getReservationStatusLabel(row.reservationStatus);
}

function formatReservationDateTime(row) {
  const dateText = formatTaipeiDate(row.reservationDate);
  const timeText = row.reservationTime || "-";
  return `${dateText} ${timeText}`;
}

function isPendingReservation(row) {
  return ["checking", "new", "pending"].includes(String(row.status || "").trim()) || row.reservationStatus === "pending_approval";
}

function isReservedReservation(row) {
  const status = String(row.status || "").trim();
  return ["reserved", "confirmed", "waiting_quote"].includes(status) || (row.reservationStatus === "approved" && status === "checking");
}

function isEstimatedReservation(row) {
  return ["estimate_pending_approval", "quoted", "waiting_customer_confirm"].includes(String(row.status || "").trim());
}

function isApprovedReservation(row) {
  const status = String(row.status || "").trim();
  if (["completed_waiting_pickup", "ready_for_pickup", "picked_up"].includes(status)) {
    return false;
  }
  return row.customerEstimateResponse === "approved" || ["estimate_approved", "customer_confirmed", "repair_order_created"].includes(status);
}

function isRepairingReservation(row) {
  return ["repairing", "in_progress"].includes(String(row.status || "").trim());
}

function isCompletedReservation(row) {
  return ["completed_waiting_pickup", "ready_for_pickup"].includes(String(row.status || "").trim());
}

function RepairsPage() {
  const location = useLocation();
  const currentUser = getStoredUser();
  const repairs = useFetchList("/repairs", { refreshIntervalMs: 10000 });
  const customers = useFetchList("/customers");
  const [tab, setTab] = useState("PENDING");
  const [hasUserSelectedTab, setHasUserSelectedTab] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    customerId: "",
    bikeModel: "",
    issueDescription: "",
    reservationDate: "",
    reservationTime: "14:00"
  });
  const [warningModal, setWarningModal] = useState(null);
  const [repairCreateStep, setRepairCreateStep] = useState(1);
  const [repairSubmitting, setRepairSubmitting] = useState(false);
  const { isProcessing, pendingAction, runWithProcessing } = useProcessingGuard();
  const hasAutoSelectedInitialTab = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextTab = params.get("tab");
    if (nextTab && ["PENDING", "RESERVED", "ESTIMATED", "APPROVED", "REPAIRING", "COMPLETED", "PICKED_UP", "CREATE", "GUIDE"].includes(nextTab)) {
      setTab(nextTab);
      setHasUserSelectedTab(false);
      hasAutoSelectedInitialTab.current = true;
    }
  }, [location.search]);

  const sectionItems = [
    { key: "PENDING", label: "待確認" },
    { key: "RESERVED", label: "已預約" },
    { key: "ESTIMATED", label: "已報價" },
    { key: "APPROVED", label: "客戶已同意" },
    { key: "REPAIRING", label: "維修中" },
    { key: "COMPLETED", label: "已完成待取車" },
    { key: "PICKED_UP", label: "已取車" },
    { key: "CREATE", label: "新增預約" },
    { key: "GUIDE", label: "維修須知" }
  ];

  const sopSteps = [
    "建立維修單",
    "填寫檢查內容",
    "填寫報價",
    "等待客戶同意",
    "維修中",
    "完成通知取車"
  ];


  async function deleteRepair(row) {
    const pin = window.prompt("請輸入管理員 PIN");
    if (pin === null) return;

    if (pin !== "1144") {
      window.alert("PIN 錯誤");
      return;
    }

    if (!window.confirm(
      `確定要刪除維修單 #${row.id}？刪除後可在「已刪除資料」復原。`
    )) return;

    await runWithProcessing(async () => {
      await apiRequest(`/repairs/${row.id}`, {
        method: "DELETE",
        headers: {
          "X-Admin-Pin": pin
        }
      });

      repairs.refetch();
      window.alert("維修單已移至已刪除資料");
    }, { id: `repair-delete-${row.id}`, label: "維修單刪除中..." }).catch((error) => {
      window.alert(error.message || "刪除維修單失敗");
    });
  }

  const rows = useMemo(
    () =>
      repairs.items.map((item) => ({
        ...item,
        repairSourceLabel: item.repairSourceLabel || (item.repairSource === "ORDER" ? "訂單維修" : "維修工單"),
        sourceLabel: item.sourceLabel || (item.source === "LINE" ? "LINE預約" : "現場客戶"),
        reservationStatusLabel: item.reservationStatusLabel || getReservationStatusLabel(item.reservationStatus),
        repairStatusLabel: item.statusLabel || getRepairStatusLabel(item.status),
        estimateStatusLabel: item.customerEstimateResponseLabel || getEstimateStatusLabel(item),
        completionNoticeLabel: item.completedAt ? "已通知" : "未通知",
        surveyLabel: item.surveyId ? "已填問卷" : "未填問卷",
        repairConfirmationStatus: item.repairConfirmationStatus || "NOT_SENT",
        repairConfirmationLabel: getRepairConfirmationStatusLabel(item.repairConfirmationStatus),
        customerType: normalizeCustomerType(item.customerType || (item.lineUserId ? "LINE" : item.customerPhone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")),
        detailPath: item.repairSource === "REPAIR_ORDER" ? `/repairs/${item.id}` : null,
        statusTone: getRepairStatusTone(item.status),
        reservationDateLabel: formatTaipeiDate(item.reservationDate)
      })),
    [repairs.items]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phoneParam = params.get("phone");
    const keywordParam = params.get("keyword");
    const nextSearchTerm = phoneParam || keywordParam;

    if (nextSearchTerm) {
      setSearchTerm(nextSearchTerm);
    }
  }, []);

  const filteredRows = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return rows.filter((item) => {
      if (keyword && !`${item.id} ${item.customerName || ""} ${item.customerPhone || ""} ${item.bikeModel || ""}`.toLowerCase().includes(keyword)) {
        return false;
      }
      if (tab === "PENDING") {
        return isPendingReservation(item);
      }
      if (tab === "RESERVED") {
        return isReservedReservation(item);
      }
      if (tab === "ESTIMATED") {
        return isEstimatedReservation(item);
      }
      if (tab === "APPROVED") {
        return isApprovedReservation(item);
      }
      if (tab === "REPAIRING") {
        return isRepairingReservation(item);
      }
      if (tab === "COMPLETED") {
        return isCompletedReservation(item);
      }
      if (tab === "PICKED_UP") {
        return item.status === "picked_up";
      }
      return true;
    });
  }, [rows, searchTerm, tab]);

  useEffect(() => {
    if (repairs.loading) {
      return;
    }

    const params = new URLSearchParams(location.search);
    if (params.get("tab") || hasUserSelectedTab || hasAutoSelectedInitialTab.current) {
      return;
    }

    const tabOrder = [
      ["PENDING", isPendingReservation],
      ["RESERVED", isReservedReservation],
      ["ESTIMATED", isEstimatedReservation],
      ["APPROVED", isApprovedReservation],
      ["REPAIRING", isRepairingReservation],
      ["COMPLETED", isCompletedReservation],
      ["PICKED_UP", (item) => item.status === "picked_up"]
    ];

    const nextTab = tabOrder.find(([, matcher]) => rows.some(matcher))?.[0] || "PENDING";
    if (nextTab !== tab) {
      setTab(nextTab);
    }
    hasAutoSelectedInitialTab.current = true;
  }, [hasUserSelectedTab, location.search, repairs.loading, rows, tab]);

  function handleTabChange(nextTab) {
    setHasUserSelectedTab(true);
    setTab(nextTab);
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function quickCreateRepairCustomer() {
    const name = window.prompt("請輸入客戶姓名");
    if (!name || !name.trim()) {
      return;
    }

    const phone = window.prompt("請輸入客戶電話");
    if (!phone || !phone.trim()) {
      return;
    }

    await runWithProcessing(async () => {
      const customer = await apiRequest("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          customerType: "OFFLINE_WITH_PHONE"
        })
      });

      setForm((current) => ({
        ...current,
        customerId: String(customer.id || "")
      }));

      if (customers.refetch) {
        customers.refetch();
      }

      alert(customer.reused ? "此電話已存在，已選擇既有客戶" : "已新增一般客戶並選取");
    }, { id: "repair-customer-create", label: "客戶建立中..." }).catch((error) => {
      alert(error.message || "新增客戶失敗");
    });
  }

  async function createRepair(event) {
    event.preventDefault();

    if (repairSubmitting || isProcessing) return;
    setRepairSubmitting(true);

    await runWithProcessing(async () => {
      await apiRequest("/repairs", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(form.customerId),
          bikeModel: form.bikeModel,
          issueDescription: form.issueDescription,
          reservationDate: form.reservationDate,
          reservationTime: form.reservationTime,
          customerType: normalizeCustomerType(selectedCustomer?.customerType || (selectedCustomer?.lineUserId ? "LINE" : selectedCustomer?.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE"))
        })
      });
      setForm({
        customerId: "",
        bikeModel: "",
        issueDescription: "",
        reservationDate: "",
        reservationTime: "14:00"
      });
      setRepairCreateStep(1);
      repairs.refetch();
      alert("維修預約已建立");
    }, { id: "repair-create", label: "維修預約建立中..." }).catch((error) => {
      alert(error.message);
    }).finally(() => {
      setRepairSubmitting(false);
    });
  }

  async function respondReservation(row, approved) {
    await runWithProcessing(async () => {
      await apiRequest(`/repairs/${row.id}/reservation/respond`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          note: approved ? "後台人工確認" : "後台人工拒絕"
        })
      });
      repairs.refetch();
      alert(approved ? "已確認維修預約" : "已拒絕維修預約");
    }, { id: `repair-reservation-${approved ? "approve" : "reject"}-${row.id}`, label: approved ? "維修確認中..." : "維修拒絕中..." }).catch((error) => {
      alert(error.message);
    });
  }

  function showStepWarning(stepName) {
    setWarningModal({
      title: "請依照維修 SOP",
      message: `請先完成上一個步驟：${stepName}`
    });
  }

  const selectedCustomer = customers.items.find((customer) => String(customer.id) === String(form.customerId));
  const repairCreateSteps = [
    { number: 1, title: "客戶與車輛", tone: form.customerId && form.bikeModel ? "green" : "blue" },
    { number: 2, title: "問題描述", tone: form.issueDescription ? "green" : repairCreateStep === 2 ? "blue" : "yellow" },
    { number: 3, title: "確認建立", tone: repairCreateStep === 3 ? "blue" : "yellow" }
  ];

  function goToRepairCreateStep(nextStep) {
    if (nextStep > 1 && (!form.customerId || !form.bikeModel.trim())) {
      showStepWarning("客戶與車輛");
      return;
    }
    if (nextStep > 2 && !form.issueDescription.trim()) {
      showStepWarning("問題描述");
      return;
    }
    setRepairCreateStep(nextStep);
  }

  const columns = [
    { key: "id", label: "維修單號", mobileHidden: true },
    {
      key: "customerName",
      label: "客戶",
      render: (row) => (
        <div className="customer-identity">
            <div className="identity-copy">
              <div className="identity-title">{row.customerName}</div>
            <div className="identity-subtitle">{row.repairSourceLabel}</div>
            </div>
          <StatusBadge tone={row.source === "LINE" ? "info" : "neutral"}>{getSourceBadgeLabel(row)}</StatusBadge>
          <StatusBadge tone={isOfflineCustomerType(row.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(row.customerType)}</StatusBadge>
          <button
            type="button"
            data-delete-button="repair-visible"
            className="danger-button"
            onClick={() => deleteRepair(row)}
            disabled={isProcessing}
          >
            {pendingAction?.id === `repair-delete-${row.id}` ? "處理中..." : "刪除"}
          </button>
        </div>
      ),
      mobileHidden: true
    },
    { key: "customerPhone", label: "電話", mobileHidden: true },
    { key: "reservationDate", label: "預約日期", render: (row) => row.reservationDateLabel, mobileHidden: true },
    { key: "reservationTime", label: "預約時間", render: (row) => row.reservationTime || "-", mobileHidden: true },
    { key: "bikeModel", label: "車款", mobileHidden: true },
    {
      key: "repairStatus",
      label: "維修狀態",
      render: (row) => (
        <div className="status-stack">
          {getReservationBadgeLabel(row) ? (
            <StatusBadge tone={row.reservationStatus === "pending_approval" ? "warning" : "info"}>{getReservationBadgeLabel(row)}</StatusBadge>
          ) : null}
          <StatusBadge tone={row.statusTone}>{row.repairStatusLabel}</StatusBadge>
          <StatusBadge tone={row.completedAt ? "success" : "neutral"}>{row.completionNoticeLabel}</StatusBadge>
          <StatusBadge tone={row.surveyId ? "info" : "neutral"}>{row.surveyLabel}</StatusBadge>
          <StatusBadge tone={getRepairConfirmationTone(row.repairConfirmationStatus)}>{row.repairConfirmationLabel}</StatusBadge>
        </div>
      ),
      mobileHidden: true
    },
    {
      key: "estimateStatus",
      label: "報價狀態",
      render: (row) => <StatusBadge tone={getEstimateTone(row)}>{row.estimateStatusLabel}</StatusBadge>,
      mobileHidden: true
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          {row.reservationStatus === "pending_approval" ? (
            <>
              <button type="button" className="primary-button inline-submit" onClick={() => respondReservation(row, true)} disabled={isProcessing}>
                {pendingAction?.id === `repair-reservation-approve-${row.id}` ? "處理中..." : "確認"}
              </button>
              <button type="button" className="secondary-button" onClick={() => respondReservation(row, false)} disabled={isProcessing}>
                {pendingAction?.id === `repair-reservation-reject-${row.id}` ? "處理中..." : "拒絕"}
              </button>
            </>
          ) : null}
          {row.detailPath ? (
            <Link to={row.detailPath} className="secondary-button">
              下一步
            </Link>
          ) : row.reservationStatus !== "pending_approval" ? (
            <button type="button" className="secondary-button" onClick={() => showStepWarning("建立維修單")}>
              下一步
            </button>
          ) : null}
        </div>
      ),
      mobileHidden: true
    }
  ];

  const showDebugBox = ["ADMIN", "MANAGER", "CASHIER", "REPAIR"].includes(String(currentUser?.role || "").trim().toUpperCase());
  const debugRowsPreview = rows.slice(0, 5).map((row) => ({
    id: row.id,
    status: row.status,
    reservationStatus: row.reservationStatus,
    repairSource: row.repairSource
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Link to="/trash" className="secondary-button">已刪除資料</Link>
      </div>

      

      <PageHeader title="維修管理" description="依照建立、檢查、報價、等待同意、維修、通知取車的 SOP 處理。" />
      {repairs.error ? <div className="empty-state">{repairs.error}</div> : null}
      <section className="content-card sop-overview">
        <div className="sop-step-list">
          {sopSteps.map((step, index) => (
            <div key={step} className={`sop-step ${index === 0 ? "sop-step-active" : ""}`}>
              <div className="sop-step-number">{index + 1}</div>
              <div>
                <strong>{step}</strong>
                <span>{index === 0 ? "從新增預約或待確認開始" : "進入維修詳情後處理"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <SectionTabs items={sectionItems} value={tab} onChange={handleTabChange} label="維修子功能" />

      {tab === "GUIDE" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>維修須知</h2>
              <p className="muted-text">這裡只保留門市現場需要知道的規則，不另外建立第二套流程。</p>
            </div>
          </div>
          <ul className="simple-list">
            <li>非保固維修需收取基本檢查 / 工資 NT$400</li>
            <li>除非非常簡單的調整，車輛需留店檢查</li>
            <li>維修完成通知後，超過 3 日未取車，每日收取保管費 NT$80</li>
          </ul>
        </section>
      ) : null}

      {tab === "CREATE" ? (
        <section className="content-card form-card">
          <div className="section-header">
            <div>
              <h2>Step {repairCreateStep} / 3：{repairCreateSteps[repairCreateStep - 1]?.title}</h2>
              <p className="muted-text">先建立維修單，後續檢查、報價、客戶確認與完修在維修詳情逐步處理。</p>
            </div>
          </div>
          <div className="wizard-progress">
            {repairCreateSteps.map((step) => (
              <button
                key={step.number}
                type="button"
                className={`wizard-step-card wizard-step-${step.tone}${repairCreateStep === step.number ? " wizard-step-active" : ""}`}
                onClick={() => goToRepairCreateStep(step.number)}
              >
                <span>Step {step.number}</span>
                <strong>{step.title}</strong>
              </button>
            ))}
          </div>
          <form className="grid-form wizard-panel wizard-panel-blue" onSubmit={createRepair}>
            {repairCreateStep === 1 ? (
            <>
            <label className="form-field">
              <span>客戶</span>
              <select name="customerId" value={form.customerId} onChange={handleChange} required>
                <option value="">請選擇客戶</option>
                {customers.items.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} / {customer.phone || "-"} / {getCustomerTypeLabel(customer.customerType || (customer.lineUserId ? "LINE" : customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE"))}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={quickCreateRepairCustomer}
              disabled={isProcessing}
            >
              {pendingAction?.id === "repair-customer-create" ? "處理中..." : "新增一般客戶"}
            </button>
            <label className="form-field">
              <span>車款</span>
              <input name="bikeModel" value={form.bikeModel} onChange={handleChange} required />
            </label>
            <div className="field-item">
              <div className="field-label">電話</div>
              <div className="field-value">{selectedCustomer?.phone || "選擇客戶後顯示"}</div>
            </div>
            <div className="field-item">
              <div className="field-label">客戶類型</div>
              <div className="field-value">{selectedCustomer ? getCustomerTypeLabel(selectedCustomer.customerType || (selectedCustomer.lineUserId ? "LINE" : selectedCustomer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")) : "選擇客戶後顯示"}</div>
            </div>
            </>
            ) : null}
            {repairCreateStep === 2 ? (
            <>
            <label className="form-field">
              <span>預約日期</span>
              <input name="reservationDate" type="date" value={form.reservationDate} onChange={handleChange} required />
            </label>
            <label className="form-field">
              <span>預約時間</span>
              <select name="reservationTime" value={form.reservationTime} onChange={handleChange} required>
                <option value="14:00">14:00-15:00</option>
                <option value="15:00">15:00-16:00</option>
                <option value="16:00">16:00-17:00</option>
                <option value="18:00">18:00-19:00</option>
                <option value="19:00">19:00-20:00</option>
              </select>
            </label>
            <label className="form-field form-field-wide">
              <span>問題描述</span>
              <textarea name="issueDescription" value={form.issueDescription} onChange={handleChange} rows="3" required />
            </label>
            <div className="field-item">
              <div className="field-label">照片</div>
              <div className="field-value">目前維持既有維修流程，若系統支援照片會在詳情中處理。</div>
            </div>
            </>
            ) : null}
            {repairCreateStep === 3 ? (
              <div className="sop-summary-box">
                <div><strong>客戶</strong><span>{selectedCustomer?.name || "-"}</span></div>
                <div><strong>客戶類型</strong><span>{selectedCustomer ? getCustomerTypeLabel(selectedCustomer.customerType || (selectedCustomer.lineUserId ? "LINE" : selectedCustomer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")) : "-"}</span></div>
                <div><strong>電話</strong><span>{selectedCustomer?.phone || "-"}</span></div>
                <div><strong>車款</strong><span>{form.bikeModel || "-"}</span></div>
                <div><strong>預約</strong><span>{form.reservationDate || "-"} {form.reservationTime || ""}</span></div>
                <div><strong>問題</strong><span>{form.issueDescription || "-"}</span></div>
              </div>
            ) : null}
            <div className="wizard-actions form-field-wide">
              {repairCreateStep > 1 ? (
                <button type="button" className="secondary-button" onClick={() => setRepairCreateStep((current) => Math.max(1, current - 1))}>
                  上一步
                </button>
              ) : null}
              {repairCreateStep < 3 ? (
                <button type="button" className="primary-button" onClick={() => goToRepairCreateStep(repairCreateStep + 1)} disabled={(repairCreateStep === 1 && (!form.customerId || !form.bikeModel.trim())) || (repairCreateStep === 2 && !form.issueDescription.trim())}>
                  下一步
                </button>
              ) : (
                <button type="submit" className="primary-button" disabled={repairSubmitting || isProcessing}>
                  {repairSubmitting || pendingAction?.id === "repair-create" ? "處理中..." : "儲存"}
                </button>
              )}
            </div>
          </form>
        </section>
      ) : null}

      {tab !== "GUIDE" && tab !== "CREATE" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>{sectionItems.find((item) => item.key === tab)?.label || "維修工作台"}</h2>
              <p className="muted-text">主列表只保留工作台核心欄位，狀態摘要用 badge 一眼看懂。</p>
            </div>
            <StatusBadge tone="info">顯示 {filteredRows.length} 筆</StatusBadge>
          </div>
          <FilterBar>
            <label className="form-field">
              <span>關鍵字搜尋</span>
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="單號 / 客戶 / 電話 / 車款" />
            </label>
          </FilterBar>
          <DataTable
            columns={columns}
            rows={filteredRows}
            emptyText="目前沒有維修資料。"
            cardTitle={(row) => `維修單 #${row.id}`}
            cardDescription={(row) => `${row.customerName} / ${row.customerPhone || "-"} / ${row.reservationDateLabel}`}
            cardBadges={(row) => (
              <>
                {getReservationBadgeLabel(row) ? (
                  <StatusBadge tone={row.reservationStatus === "pending_approval" ? "warning" : "info"}>{getReservationBadgeLabel(row)}</StatusBadge>
                ) : null}
                <StatusBadge tone={row.source === "LINE" ? "info" : "neutral"}>{getSourceBadgeLabel(row)}</StatusBadge>
                <StatusBadge tone={isOfflineCustomerType(row.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(row.customerType)}</StatusBadge>
                <StatusBadge tone={row.statusTone}>{row.repairStatusLabel}</StatusBadge>
                <StatusBadge tone={row.completedAt ? "success" : "neutral"}>{row.completionNoticeLabel}</StatusBadge>
                <StatusBadge tone={row.surveyId ? "info" : "neutral"}>{row.surveyLabel}</StatusBadge>
                <StatusBadge tone={getRepairConfirmationTone(row.repairConfirmationStatus)}>{row.repairConfirmationLabel}</StatusBadge>
              </>
            )}
            cardFooter={(row) => (
              <div className="compact-card-footer">
                <div className="compact-card-meta">
                  <strong>{row.bikeModel || "未填車款"}</strong>
                  <span>{formatReservationDateTime(row)}</span>
                </div>
                <div className="compact-card-actions">
                  <StatusBadge tone={getEstimateTone(row)}>{row.estimateStatusLabel}</StatusBadge>
                  {row.detailPath ? <Link className="secondary-button compact-detail-button" to={row.detailPath}>查看</Link> : null}
                </div>
              </div>
            )}
          />
        </section>
      ) : null}
      <ActionModal
        open={Boolean(warningModal)}
        tone="warning"
        title={warningModal?.title}
        message={warningModal?.message}
        onConfirm={() => setWarningModal(null)}
      />
      <ProcessingOverlay active={isProcessing} message={pendingAction?.label || "處理中"} description={pendingAction?.description || "系統正在處理，請勿重複點擊。"} />
    </div>
  );
}

export default RepairsPage;
