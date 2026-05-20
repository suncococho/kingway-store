import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";
import { formatTaipeiDate, formatTaipeiDateTime, getCouponStatusLabel, getCouponTypeLabel, getFinalPaymentStatusLabel, getRepairStatusLabel } from "../lib/display";

const FOLLOW_UP_ACTIONS = [
  { key: "3日追蹤", label: "3日追蹤", tone: "warm" },
  { key: "7日追蹤", label: "7日追蹤", tone: "strong" },
  { key: "14日追蹤", label: "14日追蹤", tone: "neutral" },
  { key: "手動發送", label: "手動發送", tone: "dark" }
];

function FollowUpButtonGroup({ customer, onSelect, activeAction }) {
  return (
    <div className="follow-up-button-group">
      {FOLLOW_UP_ACTIONS.map((action) => (
        <button
          key={`${customer.id}-${action.key}`}
          type="button"
          className={`follow-up-button follow-up-button-${action.tone}${activeAction === action.key ? " follow-up-button-active" : ""}`}
          onClick={() => onSelect(customer, action.key)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function toneFromBool(value) {
  return value ? "success" : "neutral";
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

function getCustomerTier(visitCount) {
  const count = Number(visitCount || 0);
  if (count >= 5) {
    return "VIP";
  }
  if (count >= 3) {
    return "常客";
  }
  return "";
}

function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, loading, error, refetch } = useFetchList("/customers");
  const coupons = useFetchList("/coupons");
  const confirmations = useFetchList("/purchase-confirmations");
  const surveys = useFetchList("/surveys");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    customerType: "LINE",
    lineUserId: "",
    crmStage: "",
    budget: "",
    purchaseTiming: "",
    usagePurpose: "",
    notes: ""
  });
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailForm, setDetailForm] = useState({
    name: "",
    phone: "",
    customerType: "LINE",
    lineUserId: "",
    crmStage: "",
    budget: "",
    purchaseTiming: "",
    usagePurpose: "",
    notes: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [crmFilter, setCrmFilter] = useState("ALL");
  const [lineFilter, setLineFilter] = useState("ALL");
  const [followUpFilter, setFollowUpFilter] = useState("ALL");
  const [confirmationFilter, setConfirmationFilter] = useState("ALL");
  const [surveyFilter, setSurveyFilter] = useState("ALL");
  const [crmQueueFilter, setCrmQueueFilter] = useState("ALL");
  const searchQuery = searchParams.get("search") || searchParams.get("phone") || "";

  const sectionItems = [
    { key: "LIST", label: "客戶列表" },
    { key: "CRM", label: "CRM 追蹤" },
    { key: "COUPONS", label: "優惠券" },
    { key: "CONFIRMATIONS", label: "購買確認書" },
    { key: "SURVEYS", label: "問卷結果" }
  ];
  const section = sectionItems.some((item) => item.key === searchParams.get("section")) ? searchParams.get("section") : "LIST";

  useEffect(() => {
    if (searchQuery) {
      setSearchTerm(searchQuery);
    }
  }, [searchQuery]);

  const crmStageOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.crmStage).filter(Boolean))),
    [items]
  );

  const customerRows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        lastInteractionAt: item.lastInteractionAt || item.lastContactAt || item.createdAt,
        customerType: normalizeCustomerType(item.customerType || (item.lineUserId ? "LINE" : item.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")),
        visitCount: Number(item.visitCount || 0),
        totalSpent: Number(item.totalSpent || 0),
        customerTier: getCustomerTier(item.visitCount),
        lineBindingLabel: item.lineUserId ? "已綁定" : "未綁定",
        lineBindingTone: toneFromBool(item.lineUserId),
        crmStageLabel: item.crmStage || "未設定",
        lastInteractionLabel: formatTaipeiDateTime(item.lastInteractionAt || item.lastContactAt || item.createdAt),
        orderCount: Number(item.orderCount || 0),
        repairCount: Number(item.repairCount || 0),
        hasPendingFollowUp: Boolean(item.hasPendingFollowUp),
        hasPendingPurchaseConfirmation: Boolean(item.hasPendingPurchaseConfirmation),
        hasSurveyResult: Boolean(item.hasSurveyResult)
      })),
    [items]
  );

  const summaryCards = useMemo(
    () => [
      { label: "客戶總數", value: customerRows.length },
      { label: "LINE 已綁定", value: customerRows.filter((item) => item.lineUserId).length },
      { label: "常客 / VIP", value: customerRows.filter((item) => item.customerTier).length },
      { label: "待處理 follow-up", value: customerRows.filter((item) => item.hasPendingFollowUp).length },
      { label: "待確認購買確認書", value: customerRows.filter((item) => item.hasPendingPurchaseConfirmation).length },
      { label: "有問卷結果", value: customerRows.filter((item) => item.hasSurveyResult).length }
    ],
    [customerRows]
  );

  const filteredItems = useMemo(
    () =>
      customerRows.filter((item) => {
        const keyword = searchTerm.trim().toLowerCase();
        if (keyword && !`${item.name} ${item.phone || ""} ${item.lineUserId || ""}`.toLowerCase().includes(keyword)) {
          return false;
        }
        if (crmFilter !== "ALL" && (item.crmStage || "-") !== crmFilter) {
          return false;
        }
        if (lineFilter !== "ALL" && (lineFilter === "BOUND" ? !item.lineUserId : Boolean(item.lineUserId))) {
          return false;
        }
        if (followUpFilter !== "ALL" && (followUpFilter === "YES" ? !item.hasPendingFollowUp : item.hasPendingFollowUp)) {
          return false;
        }
        if (
          confirmationFilter !== "ALL" &&
          (confirmationFilter === "YES" ? !item.hasPendingPurchaseConfirmation : item.hasPendingPurchaseConfirmation)
        ) {
          return false;
        }
        if (surveyFilter !== "ALL" && (surveyFilter === "YES" ? !item.hasSurveyResult : item.hasSurveyResult)) {
          return false;
        }
        return true;
      }),
    [confirmationFilter, customerRows, crmFilter, followUpFilter, lineFilter, searchTerm, surveyFilter]
  );

  const crmQueueRows = useMemo(
    () =>
      customerRows
        .filter((item) => item.hasPendingFollowUp || item.followUpDueAt || item.crmStage)
        .filter((item) => {
          if (crmQueueFilter === "PENDING" && !item.hasPendingFollowUp) {
            return false;
          }
          if (crmQueueFilter === "BOUND" && !item.lineUserId) {
            return false;
          }
          if (crmQueueFilter === "ALL") {
            return true;
          }
          return true;
        })
        .sort((a, b) => {
          if (a.hasPendingFollowUp !== b.hasPendingFollowUp) {
            return a.hasPendingFollowUp ? -1 : 1;
          }
          return String(b.lastInteractionAt || "").localeCompare(String(a.lastInteractionAt || ""));
        }),
    [crmQueueFilter, customerRows]
  );

  const couponRows = useMemo(
    () =>
      coupons.items.map((item) => ({
        id: item.id,
        customerName: item.customerName || `客戶 #${item.customerId || "-"}`,
        code: item.code,
        couponTypeLabel: item.couponTypeLabel || getCouponTypeLabel(item.couponType),
        statusLabel: item.statusLabel || getCouponStatusLabel(item.status || (item.isUsed ? "used" : "issued")),
        amount: Number(item.amount || 0),
        eligibleCategory: item.eligibleCategory || "-",
        approvedByStaffId: item.approvedByStaffId || null
      })),
    [coupons.items]
  );

  const confirmationRows = useMemo(
    () =>
      confirmations.items.map((item) => ({
        id: item.id,
        orderNo: item.orderNo || `訂單 #${item.orderId || "-"}`,
        customerName: item.customerName || "-",
        customerPhone: item.customerPhone || "-",
        submittedAt: formatTaipeiDateTime(item.submittedAt),
        statusLabel: item.statusLabel || (item.status === "COMPLETED" ? "已完成" : "待確認"),
        pdfUrl: item.pdfUrl || null
      })),
    [confirmations.items]
  );

  const surveyRows = useMemo(
    () =>
      surveys.items.map((item) => ({
        id: item.id,
        customerName: item.customerName || "-",
        targetLabel: item.repairOrderId ? `維修 #${item.repairOrderId}` : `訂單 #${item.orderId || "-"}`,
        rating: item.rating || "-",
        feedback: item.feedback || "-",
        link: item.link || null
      })),
    [surveys.items]
  );

  const listColumns = [
    {
      key: "name",
      label: "姓名",
      render: (row) => (
        <div className="customer-identity">
          <div className="identity-copy">
            <div className="identity-title">{row.name}</div>
            <div className="identity-subtitle">{row.crmStageLabel}</div>
          </div>
          <StatusBadge tone={isOfflineCustomerType(row.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(row.customerType)}</StatusBadge>
          {row.customerTier ? <StatusBadge tone={row.customerTier === "VIP" ? "success" : "warning"}>{row.customerTier}</StatusBadge> : null}
        </div>
      )
    },
    { key: "phone", label: "電話", render: (row) => row.phone || "未留電話", mobileHidden: true },
    {
      key: "visitCount",
      label: "來店",
      render: (row) => `${row.visitCount || 0} 次`,
      mobileHidden: true
    },
    {
      key: "lineBinding",
      label: "LINE 綁定狀態",
      render: (row) => <StatusBadge tone={row.lineBindingTone}>{row.lineBindingLabel}</StatusBadge>,
      mobileHidden: true
    },
    {
      key: "crmStage",
      label: "CRM 階段",
      render: (row) => <StatusBadge tone="info">{row.crmStageLabel}</StatusBadge>
    },
    { key: "lastInteractionLabel", label: "最近互動時間", render: (row) => row.lastInteractionLabel, mobileHidden: true },
    { key: "orderCount", label: "訂單數", mobileHidden: true },
    { key: "repairCount", label: "維修數", mobileHidden: true },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="action-row compact-actions">
          <button type="button" className="secondary-button" onClick={() => loadDetail(row.id)}>
            查看
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => handleFollowUpSelect(row, "手動發送")}
          >
            追蹤
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={async () => {
              const pin = window.prompt("請輸入管理員 PIN");
              if (!pin) return;
              if (!window.confirm("確認刪除此客戶？")) return;

              try {
                await apiRequest(`/customers/${row.id}`, {
                  method: "DELETE",
                  body: JSON.stringify({ adminPin: pin })
                });
                alert("客戶已刪除");
                refetch();
              } catch (error) {
                alert(error.message || "刪除失敗");
              }
            }}
          >
            刪除
          </button>
        </div>
      ),
      mobileHidden: true
    }
  ];

  const crmColumns = [
    {
      key: "name",
      label: "客戶",
      render: (row) => (
        <div className="customer-identity">
          <div className="identity-copy">
            <div className="identity-title">{row.name}</div>
            <div className="identity-subtitle">{row.phone || "未留電話"}</div>
          </div>
        </div>
      )
    },
    {
      key: "crmStage",
      label: "CRM 階段",
      render: (row) => <StatusBadge tone="info">{row.crmStageLabel}</StatusBadge>
    },
    { key: "lastInteractionLabel", label: "最近互動時間", render: (row) => row.lastInteractionLabel },
    {
      key: "followUp",
      label: "Follow-up",
      render: (row) => <StatusBadge tone={row.hasPendingFollowUp ? "warning" : "neutral"}>{row.hasPendingFollowUp ? "待處理" : "正常"}</StatusBadge>
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <FollowUpButtonGroup
          customer={row}
          onSelect={handleFollowUpSelect}
          activeAction={selectedFollowUp?.customerId === row.id ? selectedFollowUp.action : null}
        />
      ),
      mobileHidden: true
    }
  ];

  const couponColumns = [
    { key: "code", label: "券碼" },
    {
      key: "customerName",
      label: "客戶",
      render: (row) => (
        <div className="status-stack">
          <span>{row.customerName || "-"}</span>
          <button
            type="button"
            className="danger-button"
            onClick={async () => {
              const pin = window.prompt("請輸入管理員 PIN");
              if (!pin) return;

              if (!window.confirm("確認刪除此客戶？")) return;

              try {
                await apiRequest(`/customers/${row.id}`, {
                  method: "DELETE",
                  body: JSON.stringify({ adminPin: pin })
                });

                alert("客戶已刪除");
                window.location.reload();
              } catch (error) {
                alert(error.message);
              }
            }}
          >
            刪除
          </button>
        </div>
      )
    },
    { key: "couponTypeLabel", label: "類型" },
    { key: "statusLabel", label: "狀態" },
    { key: "amount", label: "金額", render: (row) => `NT$${Number(row.amount || 0).toFixed(0)}` },
    { key: "eligibleCategory", label: "可用類別" }
  ];

  const confirmationColumns = [
    { key: "orderNo", label: "單號" },
    { key: "customerName", label: "客戶" },
    { key: "customerPhone", label: "電話" },
    { key: "statusLabel", label: "狀態" },
    { key: "submittedAt", label: "送出時間" },
    {
      key: "pdfUrl",
      label: "PDF",
      render: (row) =>
        row.pdfUrl ? (
          <a href={row.pdfUrl} target="_blank" rel="noreferrer">
            開啟 PDF
          </a>
        ) : (
          "-"
        )
    }
  ];

  const surveyColumns = [
    { key: "customerName", label: "客戶" },
    { key: "targetLabel", label: "來源" },
    { key: "rating", label: "評分" },
    { key: "feedback", label: "意見回饋" },
    {
      key: "link",
      label: "連結",
      render: (row) =>
        row.link ? (
          <a href={row.link} target="_blank" rel="noreferrer">
            開啟
          </a>
        ) : (
          "-"
        )
    }
  ];

  function handleSectionChange(nextSection) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextSection === "LIST") {
      nextParams.delete("section");
    } else {
      nextParams.set("section", nextSection);
    }
    setSearchParams(nextParams, { replace: true });
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      await apiRequest("/customers", {
        method: "POST",
        body: JSON.stringify({
          ...form,
        customerType: normalizeCustomerType(form.customerType),
        phone: normalizeCustomerType(form.customerType) === "OFFLINE_NO_PHONE" ? "" : form.phone,
        lineUserId: isOfflineCustomerType(form.customerType) ? null : form.lineUserId.trim() || null
        })
      });
      setForm({
        name: "",
        phone: "",
        customerType: "LINE",
        lineUserId: "",
        crmStage: "",
        budget: "",
        purchaseTiming: "",
        usagePurpose: "",
        notes: ""
      });
      refetch();
      alert("客戶已新增");
    } catch (requestError) {
      alert(requestError.message);
    }
  }

  async function handleFollowUpSelect(customer, action) {
    setSelectedFollowUp({
      customerId: customer.id,
      customerName: customer.name,
      action
    });
    try {
      await apiRequest(`/customers/${customer.id}/follow-up`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      refetch();
      if (detail?.customer?.id === customer.id) {
        loadDetail(customer.id);
      }
      alert("追蹤已建立");
    } catch (error) {
      alert(error.message);
    }
  }

  async function loadDetail(customerId) {
    try {
      const data = await apiRequest(`/customers/${customerId}/detail`);
      setDetail(data);
      setDetailForm({
        name: data.customer.name || "",
        phone: data.customer.phone || "",
        customerType: normalizeCustomerType(data.customer.customerType || (data.customer.lineUserId ? "LINE" : data.customer.phone ? "OFFLINE_WITH_PHONE" : "OFFLINE_NO_PHONE")),
        lineUserId: data.customer.lineUserId || "",
        crmStage: data.customer.crmStage || "",
        budget: data.customer.budget || "",
        purchaseTiming: data.customer.purchaseTiming || "",
        usagePurpose: data.customer.usagePurpose || "",
        notes: data.customer.notes || ""
      });
    } catch (error) {
      alert(error.message);
    }
  }

  async function saveCustomerDetail(event) {
    event.preventDefault();
    if (!detail) {
      return;
    }

    try {
      await apiRequest(`/customers/${detail.customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: detailForm.name,
          phone: normalizeCustomerType(detailForm.customerType) === "OFFLINE_NO_PHONE" ? "" : detailForm.phone,
          customerType: normalizeCustomerType(detailForm.customerType),
          lineUserId: isOfflineCustomerType(detailForm.customerType) ? null : detailForm.lineUserId.trim() || null,
          crmStage: detailForm.crmStage,
          budget: detailForm.budget,
          purchaseTiming: detailForm.purchaseTiming,
          usagePurpose: detailForm.usagePurpose,
          notes: detailForm.notes
        })
      });
      await loadDetail(detail.customer.id);
      refetch();
      alert("客戶資料已更新");
    } catch (error) {
      alert(error.message);
    }
  }

  async function cancelCoupon(couponId) {
    try {
      await apiRequest(`/coupons/${couponId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "後台作廢" })
      });
      coupons.refetch();
      if (detail?.customer?.id) {
        loadDetail(detail.customer.id);
      }
      alert("優惠券已作廢");
    } catch (error) {
      alert(error.message);
    }
  }

  async function resendPurchaseConfirmation(orderId) {
    try {
      const data = await apiRequest(`/orders/${orderId}/purchase-confirmation`, {
        method: "POST",
        body: JSON.stringify({})
      });
      confirmations.refetch();
      if (detail?.customer?.id) {
        loadDetail(detail.customer.id);
      }
      alert(`購買確認書連結已送出：\n${data.link}`);
    } catch (error) {
      alert(error.message);
    }
  }

  function getTimelineLabel(type) {
    const map = {
      customer_support_contacted: "客服已聯絡客戶",
      customer_support_done: "客服處理完成",
      order_balance_collected: "尾款已收款",
      order_handover_confirmed: "已確認交車",
      order_created: "訂單已建立",
      purchase_confirmation_completed: "購買確認書已完成",
      google_review_coupon_approved: "Google 評論券已核准",
      google_review_coupon_rejected: "Google 評論券已拒絕",
      customer_follow_up: "客戶追蹤",
      line_order_status_checked: "LINE 查詢訂單",
      line_balance_checked: "LINE 查詢尾款",
      line_support_requested: "LINE 客服協助請求"
    };
    return map[type] || type || "-";
  }

  const detailCombinedHistory = useMemo(() => {
    if (!detail) {
      return [];
    }

    return [
      ...(detail.timeline || []).map((item) => ({
        ...item,
        type: "timeline"
      })),
      ...(detail.crmEvents || []).map((item) => ({
        ...item,
        type: "crm"
      })),
      ...(detail.followUps || []).map((item) => ({
        ...item,
        type: "followup"
      }))
    ]
      .map((item) => ({
        ...item,
        time: item.createdAt || item.sentAt || item.completedAt || null,
        label: getTimelineLabel(item.eventType || item.actionType),
        text: item.note || item.message || (item.payload?.actor ? `處理人員：${item.payload.actor}` : "-")
      }))
      .sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  }, [detail]);

  const detailSurveyRows = detail?.surveys || [];
  const detailConfirmationRows = detail?.confirmations || [];
  const detailSummaryCards = detail
    ? [
        { label: "LINE 綁定", value: detail.customer.lineUserId ? "已綁定" : "未綁定" },
        { label: "來店次數", value: detail.customer.visitCount || 0 },
        { label: "累計消費", value: `NT$${Number(detail.customer.totalSpent || 0).toFixed(0)}` },
        { label: "CRM 階段", value: detail.customer.crmStage || "未設定" }
      ]
    : [];

  return (
    <div>
      <PageHeader title="客戶管理" description="CRM 追蹤、優惠券、購買確認書與問卷結果，集中在同一套客戶工作台。" />
      <SectionTabs items={sectionItems} value={section} onChange={handleSectionChange} label="客戶管理子功能" />
      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

      {section === "LIST" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>客戶列表</h2>
              <p className="muted-text">只顯示核心欄位，詳細歷程請從「查看」開啟 drawer。</p>
            </div>
            <StatusBadge tone="info">顯示 {filteredItems.length} 筆</StatusBadge>
          </div>
          <FilterBar>
            <label className="form-field">
              <span>關鍵字搜尋</span>
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="姓名 / 電話 / LINE" />
            </label>
            <label className="form-field">
              <span>CRM 階段</span>
              <select value={crmFilter} onChange={(event) => setCrmFilter(event.target.value)}>
                <option value="ALL">全部階段</option>
                {crmStageOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>LINE 綁定</span>
              <select value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}>
                <option value="ALL">全部</option>
                <option value="BOUND">已綁定</option>
                <option value="UNBOUND">未綁定</option>
              </select>
            </label>
            <label className="form-field">
              <span>未處理 follow-up</span>
              <select value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value)}>
                <option value="ALL">全部</option>
                <option value="YES">有待處理</option>
                <option value="NO">沒有</option>
              </select>
            </label>
            <label className="form-field">
              <span>待確認購買確認書</span>
              <select value={confirmationFilter} onChange={(event) => setConfirmationFilter(event.target.value)}>
                <option value="ALL">全部</option>
                <option value="YES">有待確認</option>
                <option value="NO">沒有</option>
              </select>
            </label>
            <label className="form-field">
              <span>問卷結果</span>
              <select value={surveyFilter} onChange={(event) => setSurveyFilter(event.target.value)}>
                <option value="ALL">全部</option>
                <option value="YES">有問卷</option>
                <option value="NO">沒有</option>
              </select>
            </label>
          </FilterBar>
          {loading ? <div className="loading-state">載入客戶資料中...</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {!loading && !error ? (
            <DataTable
              columns={listColumns}
              rows={filteredItems}
              emptyText="目前沒有客戶資料。"
              cardTitle={(row) => row.name}
              cardDescription={(row) => `${row.phone || "未留電話"} / ${row.crmStageLabel}`}
              cardBadges={(row) => (
                <>
                  <StatusBadge tone={row.lineBindingTone}>{row.lineBindingLabel}</StatusBadge>
                  <StatusBadge tone={row.hasPendingFollowUp ? "warning" : "neutral"}>
                    {row.hasPendingFollowUp ? "待處理 follow-up" : "follow-up 正常"}
                  </StatusBadge>
                  <StatusBadge tone={row.hasPendingPurchaseConfirmation ? "warning" : "success"}>
                    {row.hasPendingPurchaseConfirmation ? "待確認購買確認書" : "購買確認正常"}
                  </StatusBadge>
                  <StatusBadge tone={row.hasSurveyResult ? "info" : "neutral"}>{row.hasSurveyResult ? "有問卷" : "無問卷"}</StatusBadge>
                </>
              )}
              cardFooter={(row) => (
                <div className="field-grid">
                  <div className="field-item">
                    <div className="field-label">最近互動時間</div>
                    <div className="field-value">{row.lastInteractionLabel}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">訂單數 / 維修數</div>
                    <div className="field-value">
                      {row.orderCount} / {row.repairCount}
                    </div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">追蹤</div>
                    <div className="field-value">
                      <FollowUpButtonGroup
                        customer={row}
                        onSelect={handleFollowUpSelect}
                        activeAction={selectedFollowUp?.customerId === row.id ? selectedFollowUp.action : null}
                      />
                    </div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">客戶歷程</div>
                    <div className="field-value">
                      <button type="button" className="secondary-button" onClick={() => loadDetail(row.id)}>
                        查看
                      </button>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : null}
        </section>
      ) : null}

      {section === "CRM" ? (
        <section className="section-panel">
          <div className="page-grid">
            <div className="page-grid-main">
              <section className="content-card">
                <div className="section-header">
                  <div>
                    <h2>CRM 追蹤</h2>
                    <p className="muted-text">優先處理待跟進客戶、未處理 follow-up 與可立即發送的追蹤訊息。</p>
                  </div>
                  <StatusBadge tone="info">待跟進 {crmQueueRows.filter((row) => row.hasPendingFollowUp).length} 筆</StatusBadge>
                </div>
                <FilterBar compact>
                  <label className="form-field">
                    <span>追蹤隊列</span>
                    <select value={crmQueueFilter} onChange={(event) => setCrmQueueFilter(event.target.value)}>
                      <option value="ALL">全部</option>
                      <option value="PENDING">僅待處理</option>
                      <option value="BOUND">僅已綁定</option>
                    </select>
                  </label>
                </FilterBar>
                <DataTable
                  columns={crmColumns}
                  rows={crmQueueRows}
                  emptyText="目前沒有可追蹤的客戶資料。"
                  cardTitle={(row) => row.name}
                  cardDescription={(row) => `${row.phone || "未留電話"} / ${row.crmStageLabel}`}
                  cardBadges={(row) => (
                    <>
                      <StatusBadge tone={row.hasPendingFollowUp ? "warning" : "neutral"}>
                        {row.hasPendingFollowUp ? "待處理 follow-up" : "follow-up 正常"}
                      </StatusBadge>
                      <StatusBadge tone={row.lineUserId ? "success" : "neutral"}>{row.lineUserId ? "LINE 已綁定" : "LINE 未綁定"}</StatusBadge>
                    </>
                  )}
                  cardFooter={(row) => (
                    <div className="field-grid">
                      <div className="field-item">
                        <div className="field-label">最近互動</div>
                        <div className="field-value">{row.lastInteractionLabel}</div>
                      </div>
                      <div className="field-item">
                        <div className="field-label">追蹤操作</div>
                        <div className="field-value">
                          <FollowUpButtonGroup
                            customer={row}
                            onSelect={handleFollowUpSelect}
                            activeAction={selectedFollowUp?.customerId === row.id ? selectedFollowUp.action : null}
                          />
                        </div>
                      </div>
                      <div className="field-item">
                        <div className="field-label">查看</div>
                        <div className="field-value">
                          <button type="button" className="secondary-button" onClick={() => loadDetail(row.id)}>
                            客戶歷程
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                />
              </section>
            </div>
            <div className="page-grid-side">
              <section className="content-card form-card">
                <div className="section-header">
                  <div>
                    <h2>新增客戶</h2>
                    <p className="muted-text">保留原本新增流程，但整理成獨立區塊。</p>
                  </div>
                </div>
                <form className="grid-form compact-grid" onSubmit={handleSubmit}>
                  <label className="form-field">
                    <span>姓名</span>
                    <input name="name" value={form.name} onChange={handleChange} required />
                  </label>
                  <label className="form-field">
                    <span>客戶類型</span>
                    <select name="customerType" value={form.customerType} onChange={handleChange}>
                      <option value="LINE">LINE 客戶</option>
                      <option value="OFFLINE_WITH_PHONE">一般客戶（有電話）</option>
                      <option value="OFFLINE_NO_PHONE">一般客戶（無電話）</option>
                    </select>
                  </label>
                  {normalizeCustomerType(form.customerType) !== "OFFLINE_NO_PHONE" ? (
                  <label className="form-field">
                    <span>電話</span>
                    <input name="phone" value={form.phone} onChange={handleChange} />
                  </label>
                  ) : null}
                  {!isOfflineCustomerType(form.customerType) ? (
                  <label className="form-field">
                    <span>LINE 綁定 ID</span>
                    <input name="lineUserId" value={form.lineUserId} onChange={handleChange} />
                  </label>
                  ) : null}
                  <label className="form-field">
                    <span>CRM 階段</span>
                    <input name="crmStage" value={form.crmStage} onChange={handleChange} />
                  </label>
                  <label className="form-field">
                    <span>預算</span>
                    <input name="budget" value={form.budget} onChange={handleChange} />
                  </label>
                  <label className="form-field">
                    <span>預計購買時間</span>
                    <input name="purchaseTiming" value={form.purchaseTiming} onChange={handleChange} />
                  </label>
                  <label className="form-field">
                    <span>用途</span>
                    <input name="usagePurpose" value={form.usagePurpose} onChange={handleChange} />
                  </label>
                  <label className="form-field">
                    <span>備註</span>
                    <input name="notes" value={form.notes} onChange={handleChange} />
                  </label>
                  <button type="submit" className="primary-button inline-submit">
                    新增客戶
                  </button>
                </form>
              </section>
            </div>
          </div>
        </section>
      ) : null}

      {section === "COUPONS" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>優惠券</h2>
              <p className="muted-text">集中查看新好友與 Google 評論優惠券狀態。</p>
            </div>
            <StatusBadge tone="info">顯示 {couponRows.length} 筆</StatusBadge>
          </div>
          <DataTable
            columns={couponColumns}
            rows={couponRows}
            emptyText="目前沒有優惠券資料。"
            cardTitle={(row) => row.code || `優惠券 #${row.id}`}
            cardDescription={(row) => `${row.customerName} / ${row.couponTypeLabel}`}
            cardBadges={(row) => <StatusBadge tone={row.statusLabel === "已發券" ? "success" : row.statusLabel === "待審核" ? "warning" : "neutral"}>{row.statusLabel}</StatusBadge>}
          />
        </section>
      ) : null}

      {section === "CONFIRMATIONS" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>購買確認書</h2>
              <p className="muted-text">直接看到 PDF 是否已產生，方便確認簽署完成與否。</p>
            </div>
            <StatusBadge tone="info">顯示 {confirmationRows.length} 筆</StatusBadge>
          </div>
          <DataTable
            columns={confirmationColumns}
            rows={confirmationRows}
            emptyText="目前沒有購買確認書資料。"
            cardTitle={(row) => row.orderNo}
            cardDescription={(row) => `${row.customerName} / ${row.customerPhone}`}
            cardBadges={(row) => <StatusBadge tone={row.statusLabel === "已完成" ? "success" : "warning"}>{row.statusLabel}</StatusBadge>}
          />
        </section>
      ) : null}

      {section === "SURVEYS" ? (
        <section className="content-card section-panel">
          <div className="section-header">
            <div>
              <h2>問卷結果</h2>
              <p className="muted-text">把問卷結果和來源來源整理成可快速掃描的清單。</p>
            </div>
            <StatusBadge tone="info">顯示 {surveyRows.length} 筆</StatusBadge>
          </div>
          <DataTable
            columns={surveyColumns}
            rows={surveyRows}
            emptyText="目前沒有問卷資料。"
            cardTitle={(row) => row.customerName}
            cardDescription={(row) => `${row.targetLabel} / 評分 ${row.rating}`}
            cardBadges={(row) => <StatusBadge tone="info">評分 {row.rating}</StatusBadge>}
          />
        </section>
      ) : null}

      <DetailModal
        open={Boolean(detail)}
        title={detail ? `${detail.customer.name} 的客戶歷程` : "客戶歷程"}
        subtitle={detail ? `${detail.customer.crmStage || "未設定 CRM 階段"} / ${detail.customer.lineUserId ? "LINE 已綁定" : "LINE 未綁定"}` : ""}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="admin-detail-layout">
            <div className="admin-summary-grid">
              {detailSummaryCards.map((card) => (
                <article key={card.label} className="admin-summary-card">
                  <div className="admin-summary-label">{card.label}</div>
                  <div className="admin-summary-value admin-summary-value-small">{card.value}</div>
                </article>
              ))}
            </div>
            <section className="stack-card">
              <div className="section-title">編輯客戶資料</div>
              <form className="grid-form compact-grid" onSubmit={saveCustomerDetail}>
                <label className="form-field">
                  <span>姓名</span>
                  <input value={detailForm.name} onChange={(event) => setDetailForm((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <label className="form-field">
                  <span>客戶類型</span>
                  <select value={detailForm.customerType} onChange={(event) => setDetailForm((current) => ({ ...current, customerType: event.target.value }))}>
                    <option value="LINE">LINE 客戶</option>
                    <option value="OFFLINE_WITH_PHONE">一般客戶（有電話）</option>
                    <option value="OFFLINE_NO_PHONE">一般客戶（無電話）</option>
                  </select>
                </label>
                {normalizeCustomerType(detailForm.customerType) !== "OFFLINE_NO_PHONE" ? (
                <label className="form-field">
                  <span>電話</span>
                  <input value={detailForm.phone} onChange={(event) => setDetailForm((current) => ({ ...current, phone: event.target.value }))} />
                </label>
                ) : null}
                {!isOfflineCustomerType(detailForm.customerType) ? (
                <label className="form-field">
                  <span>LINE userId</span>
                  <input value={detailForm.lineUserId} onChange={(event) => setDetailForm((current) => ({ ...current, lineUserId: event.target.value }))} />
                </label>
                ) : null}
                <label className="form-field">
                  <span>CRM 階段</span>
                  <input value={detailForm.crmStage} onChange={(event) => setDetailForm((current) => ({ ...current, crmStage: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>預算</span>
                  <input value={detailForm.budget} onChange={(event) => setDetailForm((current) => ({ ...current, budget: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>預計購買時間</span>
                  <input value={detailForm.purchaseTiming} onChange={(event) => setDetailForm((current) => ({ ...current, purchaseTiming: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>用途</span>
                  <input value={detailForm.usagePurpose} onChange={(event) => setDetailForm((current) => ({ ...current, usagePurpose: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>備註</span>
                  <input value={detailForm.notes} onChange={(event) => setDetailForm((current) => ({ ...current, notes: event.target.value }))} />
                </label>
                <button type="submit" className="primary-button inline-submit">
                  儲存客戶
                </button>
              </form>
            </section>
            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">基本資料</div>
                <div className="field-grid">
                  <div className="field-item">
                    <div className="field-label">姓名</div>
                    <div className="field-value">{detail.customer.name}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">電話</div>
                    <div className="field-value">{detail.customer.phone || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">客戶類型</div>
                    <div className="field-value">
                      <StatusBadge tone={isOfflineCustomerType(detail.customer.customerType) ? "neutral" : "info"}>{getCustomerTypeLabel(detail.customer.customerType)}</StatusBadge>
                      {getCustomerTier(detail.customer.visitCount) ? <StatusBadge tone={getCustomerTier(detail.customer.visitCount) === "VIP" ? "success" : "warning"}>{getCustomerTier(detail.customer.visitCount)}</StatusBadge> : null}
                    </div>
                  </div>
                  {isOfflineCustomerType(detail.customer.customerType) ? null : (
                  <>
                  <div className="field-item">
                    <div className="field-label">LINE 綁定</div>
                    <div className="field-value">{detail.customer.lineUserId ? "已綁定" : "未綁定"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">LINE userId</div>
                    <div className="field-value">{detail.customer.lineUserId || "-"}</div>
                  </div>
                  </>
                  )}
                  <div className="field-item">
                    <div className="field-label">來店次數</div>
                    <div className="field-value">{detail.customer.visitCount || 0} 次</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">累計消費</div>
                    <div className="field-value">NT${Number(detail.customer.totalSpent || 0).toFixed(0)}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">最近來店</div>
                    <div className="field-value">{formatTaipeiDateTime(detail.customer.lastVisit)}</div>
                  </div>
                </div>
              </section>
              <section className="stack-card">
                <div className="section-title">CRM 狀態</div>
                <div className="field-grid">
                  <div className="field-item">
                    <div className="field-label">CRM 階段</div>
                    <div className="field-value">{detail.customer.crmStage || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">預算</div>
                    <div className="field-value">{detail.customer.budget || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">預計購買時間</div>
                    <div className="field-value">{detail.customer.purchaseTiming || "-"}</div>
                  </div>
                  <div className="field-item">
                    <div className="field-label">用途</div>
                    <div className="field-value">{detail.customer.usagePurpose || "-"}</div>
                  </div>
                </div>
              </section>
            </div>

            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">訂單歷史</div>
                {detail.orders?.length ? (
                  <div className="stack-list">
                    {detail.orders.map((order) => (
                      <div key={order.id} className="log-row">
                        <strong>{order.orderNo}</strong>
                        <div>{getFinalPaymentStatusLabel(order.finalPaymentStatus)}</div>
                        <div className="muted-text">{formatTaipeiDate(order.businessDate)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有訂單紀錄。</div>
                )}
              </section>
              <section className="stack-card">
                <div className="section-title">維修歷史</div>
                {detail.repairs?.length ? (
                  <div className="stack-list">
                    {detail.repairs.map((repair) => (
                      <div key={repair.id} className="log-row">
                        <strong>{repair.bikeModel || `維修 #${repair.id}`}</strong>
                        <div>{getRepairStatusLabel(repair.status)}</div>
                        <div className="muted-text">{formatTaipeiDate(repair.reservationDate)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有維修紀錄。</div>
                )}
              </section>
            </div>

            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">優惠券</div>
                {detail.coupons?.length ? (
                  <div className="stack-list">
                    {detail.coupons.map((coupon) => (
                      <div key={coupon.id} className="log-row">
                        <div>
                          <strong>{coupon.code}</strong>
                          <div>{getCouponTypeLabel(coupon.couponType)}</div>
                          <div className="muted-text">{getCouponStatusLabel(coupon.status || (coupon.isUsed ? "used" : "issued"))}</div>
                        </div>
                        {!coupon.isUsed && coupon.status !== "expired" && coupon.status !== "rejected" ? (
                          <button type="button" className="secondary-button" onClick={() => cancelCoupon(coupon.id)}>
                            作廢
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有優惠券。</div>
                )}
              </section>
              <section className="stack-card">
                <div className="section-title">購買確認書 PDF</div>
                {detail.confirmations?.length ? (
                  <div className="stack-list">
                    {detail.confirmations.map((item) => (
                      <div key={item.id} className="log-row">
                        <div>
                          <strong>{item.orderId ? `訂單 #${item.orderId}` : `確認書 #${item.id}`}</strong>
                          <div>{item.status}</div>
                          <div className="muted-text">
                            {item.pdfUrl ? (
                              <a href={item.pdfUrl} target="_blank" rel="noreferrer">
                                開啟 PDF
                              </a>
                            ) : (
                              "尚未產生 PDF"
                            )}
                          </div>
                        </div>
                        {item.orderId ? (
                          <button type="button" className="secondary-button" onClick={() => resendPurchaseConfirmation(item.orderId)}>
                            重寄連結
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有購買確認書。</div>
                )}
              </section>
            </div>

            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">問卷結果</div>
                {detailSurveyRows.length ? (
                  <div className="stack-list">
                    {detailSurveyRows.map((survey) => (
                      <div key={survey.id} className="log-row">
                        <strong>評分 {survey.rating || "-"}</strong>
                        <div>{survey.feedback || "-"}</div>
                        <div className="muted-text">{formatTaipeiDateTime(survey.submittedAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有問卷結果。</div>
                )}
              </section>
              <section className="stack-card">
                <div className="section-title">Follow-up / CRM 紀錄</div>
                {detailCombinedHistory.length ? (
                  <div className="stack-list">
                    {detailCombinedHistory.slice(0, 12).map((item, index) => (
                      <div key={`${item.label}-${item.id || index}`} className="log-row">
                        <strong>{item.label}</strong>
                        <div>{item.text}</div>
                        <div className="muted-text">{formatTaipeiDateTime(item.time)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">目前沒有 CRM / Follow-up 紀錄。</div>
                )}
              </section>
            </div>

            <div className="action-row">
              <button type="button" className="secondary-button" onClick={() => loadDetail(detail.customer.id)}>
                重新整理
              </button>
              <button type="button" className="secondary-button" onClick={() => setDetail(null)}>
                關閉
              </button>
            </div>
          </div>
        ) : null}
      </DetailModal>
    </div>
  );
}

export default CustomersPage;
