import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import ActionModal from "../components/ActionModal";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import { getStoredStoreName, getStoredUser } from "../lib/auth";
import { apiRequest } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { formatTaipeiDate, formatTaipeiDateTime, getFinalPaymentStatusLabel, getRepairStatusLabel } from "../lib/display";

const PENDING_NOTICE_SESSION_KEY = "kingway_dashboard_pending_notice_seen";

const PRIORITY_ITEMS = [
  { key: "purchaseConfirmationsPending", label: "購買確認待處理", tone: "warning" },
  { key: "repairReservationsPending", label: "維修待處理", tone: "info" },
  { key: "googleReviewApprovalsPending", label: "Google 評論待確認", tone: "warning" }
];

function formatAmount(value) {
  return `NT$${Number(value || 0).toFixed(0)}`;
}

function normalizeOrderListRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    totalAmount: Number(row.totalAmount || 0),
    depositAmount: Number(row.depositAmount || 0),
    unpaidBalance: Number(row.unpaidBalance || 0)
  }));
}

function DashboardPage() {
  const user = getStoredUser();
  const currentStoreName = getStoredStoreName();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "OVERVIEW");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [showPendingNotice, setShowPendingNotice] = useState(false);
  const [collectingOrderId, setCollectingOrderId] = useState(null);

  const orders = useFetchList("/orders");
  const repairs = useFetchList("/repairs");
  const lowStock = useFetchList("/inventory/low-stock");
  const attendance = useFetchList("/attendance");
  const kpi = useFetchList("/kpi");

  const canConfirmPayment = ["ADMIN", "MANAGER", "CASHIER", "REPAIR"].includes(String(user?.role || "").toUpperCase());
  const pendingBikeDeliveries = useMemo(() => normalizeOrderListRows(summary?.pendingBikeDeliveries || []), [summary?.pendingBikeDeliveries]);
  const pendingRepairPickups = useMemo(() => summary?.pendingRepairPickups || [], [summary?.pendingRepairPickups]);
  const pendingPaymentOrders = useMemo(() => normalizeOrderListRows(summary?.pendingPaymentOrders || []), [summary?.pendingPaymentOrders]);

  const pendingBikeDeliveryCount = Number(summary?.pendingBikeDeliveryCount || pendingBikeDeliveries.length || 0);
  const pendingRepairPickupCount = Number(summary?.pendingRepairPickupCount || pendingRepairPickups.length || 0);
  const pendingPaymentCount = Number(summary?.pendingPaymentCount || pendingPaymentOrders.length || 0);
  const pendingPaymentAmount = Number(summary?.pendingPaymentAmount || 0);
  const pendingTotalCount = pendingBikeDeliveryCount + pendingRepairPickupCount + pendingPaymentCount;

  useEffect(() => {
    const current = searchParams.get("tab") || "OVERVIEW";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);

  useEffect(() => {
    if (!summary) {
      return;
    }

    const hasSeen = sessionStorage.getItem(PENDING_NOTICE_SESSION_KEY) === "1";
    if (!hasSeen && pendingTotalCount > 0) {
      setShowPendingNotice(true);
    }
  }, [summary, pendingTotalCount]);

  async function loadSummary() {
    try {
      setSummaryLoading(true);
      setSummaryError("");
      const data = await apiRequest("/dashboard/summary");
      setSummary(data || null);
    } catch (error) {
      setSummaryError(error?.message || "載入待處理資料失敗");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  function hidePendingNotice() {
    setShowPendingNotice(false);
    sessionStorage.setItem(PENDING_NOTICE_SESSION_KEY, "1");
  }

  function scrollToPendingSection(sectionId) {
    changeTab("OVERVIEW");
    const node = document.getElementById(sectionId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.setTimeout(() => {
      const fallbackNode = document.getElementById(sectionId);
      if (fallbackNode) {
        fallbackNode.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
  }

  function jumpToPendingSection(sectionId) {
    hidePendingNotice();
    scrollToPendingSection(sectionId);
  }

  async function confirmPendingBalance(row) {
    const amount = Number(row.unpaidBalance || 0);
    if (amount <= 0) {
      window.alert("此筆訂單目前沒有未收尾款。");
      return;
    }
    if (!window.confirm("確認已收到此筆尾款？此動作會將訂單標記為已收款。")) {
      return;
    }

    try {
      setCollectingOrderId(Number(row.id));
      await apiRequest(`/orders/${row.id}/collect-balance`, {
        method: "POST",
        body: JSON.stringify({ amount })
      });
      await loadSummary();
      orders.refetch();
      repairs.refetch();
      window.alert("已確認收款並更新完成。");
    } catch (error) {
      window.alert(error?.message || "收款確認失敗。");
    } finally {
      setCollectingOrderId(null);
    }
  }

  const sectionItems = [
    { key: "OVERVIEW", label: "今日總覽" },
    { key: "ORDERS", label: "訂單摘要" },
    { key: "REPAIRS", label: "維修摘要" },
    { key: "INVENTORY", label: "庫存提醒" },
    { key: "STAFF", label: "員工摘要" }
  ];

  const summaryCards = [
    { label: "待交車訂單", value: pendingBikeDeliveryCount },
    { label: "待取車維修", value: pendingRepairPickupCount },
    {
      label: "待收尾款",
      value: `NT$${pendingPaymentAmount.toFixed(0)} (${pendingPaymentCount})`
    },
    {
      label: "今日待確認",
      value:
        (summary?.pendingTasks?.purchaseConfirmationsPending ?? 0) +
        (summary?.pendingTasks?.googleReviewApprovalsPending ?? 0) +
        (summary?.pendingTasks?.repairReservationsPending ?? 0)
    },
    { label: "低庫存", value: summary?.totals?.lowStockCount ?? 0 },
    { label: "今日營業重點", value: `NT$${summary?.totals?.salesToday ?? 0}`, small: true }
  ];

  const pendingNoticeRows = [
    {
      id: "pending-bike",
      title: "待交車訂單",
      count: pendingBikeDeliveryCount,
      tone: pendingBikeDeliveryCount > 0 ? "danger" : "neutral",
      detail: "電動自行車銷售訂單未完成交車確認。"
    },
    {
      id: "pending-repair",
      title: "待取車維修",
      count: pendingRepairPickupCount,
      tone: pendingRepairPickupCount > 0 ? "warning" : "neutral",
      detail: "完成維修尚未取車，請盡快聯繫客戶。"
    },
    {
      id: "pending-payment",
      title: "待收尾款",
      count: pendingPaymentCount,
      tone: pendingPaymentAmount > 0 ? "danger" : "neutral",
      detail: `待收尾款總額：${formatAmount(pendingPaymentAmount)}`
    }
  ];

  const todayTodoRows = useMemo(
    () => [
      ...PRIORITY_ITEMS.map((item) => ({
        ...item,
        count: summary?.pendingTasks?.[item.key] ?? 0
      })),
      {
        id: "inventory",
        title: "低庫存提醒",
        count: summary?.totals?.lowStockCount ?? 0,
        tone: "danger",
        detail: "檢查補貨、發注與庫位異動"
      }
    ],
    [summary]
  );

  const orderSummaryRows = useMemo(
    () =>
      orders.items.slice(0, 8).map((item) => ({
        ...item,
        customerDisplay: item.customerName || item.customerNameSnapshot || "-",
        paymentLabel: item.finalPaymentStatusLabel || item.finalPaymentStatus || "-",
        businessDateLabel: formatTaipeiDate(item.businessDate)
      })),
    [orders.items]
  );

  const repairSummaryRows = useMemo(
    () =>
      repairs.items.slice(0, 8).map((item) => ({
        ...item,
        customerDisplay: item.customerName || "-",
        reservationDateLabel: formatTaipeiDate(item.reservationDate)
      })),
    [repairs.items]
  );

  const lowStockRows = useMemo(() => lowStock.items.slice(0, 8), [lowStock.items]);

  const attendanceRows = useMemo(
    () =>
      attendance.items.slice(0, 8).map((item) => ({
        ...item,
        checkInAtLabel: formatTaipeiDateTime(item.checkInAt),
        checkOutAtLabel: formatTaipeiDateTime(item.checkOutAt)
      })),
    [attendance.items]
  );
  const kpiRows = useMemo(() => kpi.items.slice(0, 8), [kpi.items]);

  const orderColumns = [
    { key: "orderNo", label: "單號" },
    { key: "customerDisplay", label: "客戶" },
    { key: "businessDateLabel", label: "日期" },
    { key: "totalAmount", label: "總額", render: (row) => formatAmount(row.totalAmount || 0) },
    {
      key: "paymentLabel",
      label: "完款",
      render: (row) => (
        <StatusBadge tone={row.finalPaymentStatus === "PAID" ? "success" : Number(row.unpaidBalance || 0) > 0 ? "warning" : "neutral"}>
          {row.paymentLabel}
        </StatusBadge>
      )
    }
  ];

  const repairColumns = [
    { key: "customerDisplay", label: "客戶" },
    { key: "bikeModel", label: "車款 / 品項" },
    {
      key: "statusLabel",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.status === "checking" ? "warning" : row.status === "completed_waiting_pickup" ? "info" : "neutral"}>{row.statusLabel}</StatusBadge>
    },
    { key: "reservationDateLabel", label: "日期" }
  ];

  const inventoryColumns = [
    { key: "name", label: "商品" },
    { key: "sku", label: "SKU" },
    { key: "stock", label: "庫存" },
    { key: "reorderLevel", label: "警戒值" }
  ];

  const attendanceColumns = [
    { key: "staffName", label: "員工" },
    { key: "checkInAtLabel", label: "上班時間" },
    { key: "checkOutAtLabel", label: "下班時間" },
    {
      key: "status",
      label: "今日狀態",
      render: (row) => <StatusBadge tone={row.checkOutAt ? "success" : "warning"}>{row.checkOutAt ? "已完成" : "上班中"}</StatusBadge>
    }
  ];

  const kpiColumns = [
    { key: "staffName", label: "員工" },
    { key: "role", label: "角色" },
    { key: "logCount", label: "紀錄數" },
    { key: "totalScore", label: "總分" }
  ];

  const pendingBikeColumns = [
    { key: "orderNo", label: "訂單編號" },
    { key: "customerName", label: "客戶姓名" },
    { key: "customerPhone", label: "電話" },
    { key: "bikeModel", label: "商品/車款" },
    {
      key: "totalAmount",
      label: "銷售金額",
      render: (row) => formatAmount(row.totalAmount || 0)
    },
    {
      key: "collectedAmount",
      label: "已收金額",
      render: (row) => formatAmount(row.collectedAmount || 0)
    },
    {
      key: "unpaidBalance",
      label: "未收金額",
      render: (row) => <strong>{formatAmount(row.unpaidBalance || 0)}</strong>
    },
    {
      key: "finalPaymentStatus",
      label: "付款狀態",
      render: (row) => (
        <StatusBadge tone={row.unpaidBalance > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel || getFinalPaymentStatusLabel(row.finalPaymentStatus)}</StatusBadge>
      )
    },
    { key: "businessDateLabel", label: "訂單日期" }
  ];

  const pendingRepairColumns = [
    { key: "id", label: "維修編號" },
    { key: "customerName", label: "客戶姓名" },
    { key: "customerPhone", label: "電話" },
    { key: "bikeModel", label: "車款/車型" },
    {
      key: "status",
      label: "維修狀態",
      render: (row) => <StatusBadge tone={row.status === "completed_waiting_pickup" ? "info" : "warning"}>{row.statusLabel}</StatusBadge>
    },
    { key: "receiveDateLabel", label: "接收日期/完成日期" }
  ];

  const pendingPaymentColumns = [
    { key: "orderNo", label: "訂單編號" },
    { key: "customerName", label: "客戶姓名" },
    { key: "customerPhone", label: "電話" },
    { key: "bikeModel", label: "商品/車款" },
    {
      key: "totalAmount",
      label: "銷售金額",
      render: (row) => formatAmount(row.totalAmount || 0)
    },
    {
      key: "collectedAmount",
      label: "已收金額",
      render: (row) => formatAmount(row.collectedAmount || 0)
    },
    {
      key: "unpaidBalance",
      label: "未收金額",
      render: (row) => <strong>{formatAmount(row.unpaidBalance || 0)}</strong>
    },
    {
      key: "finalPaymentStatus",
      label: "付款狀態",
      render: (row) => (
        <StatusBadge tone={row.unpaidBalance > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel || getFinalPaymentStatusLabel(row.finalPaymentStatus)}</StatusBadge>
      )
    },
    { key: "businessDateLabel", label: "訂單日期" }
  ];

  const pendingBikeRows = useMemo(
    () =>
      pendingBikeDeliveries.map((row) => ({
        ...row,
        collectedAmount: Math.max(Number(row.totalAmount || 0) - Number(row.unpaidBalance || 0), 0),
        businessDateLabel: formatTaipeiDate(row.businessDate),
        finalPaymentStatusLabel: row.finalPaymentStatusLabel || getFinalPaymentStatusLabel(row.finalPaymentStatus)
      })),
    [pendingBikeDeliveries]
  );

  const pendingRepairRows = useMemo(
    () =>
      pendingRepairPickups.map((row) => ({
        ...row,
        statusLabel: row.statusLabel || getRepairStatusLabel(row.status),
        receiveDateLabel: formatTaipeiDate(row.completedAt || row.reservationDate || row.createdAt)
      })),
    [pendingRepairPickups]
  );

  const pendingPaymentRows = useMemo(
    () =>
      pendingPaymentOrders.map((row) => ({
        ...row,
        collectedAmount: Math.max(Number(row.totalAmount || 0) - Number(row.unpaidBalance || 0), 0),
        businessDateLabel: formatTaipeiDate(row.businessDate),
        finalPaymentStatusLabel: row.finalPaymentStatusLabel || getFinalPaymentStatusLabel(row.finalPaymentStatus)
      })),
    [pendingPaymentOrders]
  );

  function ResponsiveDataSection({ children }) {
    return <div className="dashboard-responsive-data">{children}</div>;
  }

  return (
    <div>
      <PageHeader title="儀表板" description="營運首頁優先顯示今日待辦、關鍵數字與各工作區摘要。" />
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="儀表板子功能" />

      <section
        className="admin-panel"
        style={{
          borderLeft: pendingTotalCount > 0 ? "4px solid var(--warning-700)" : "4px solid transparent"
        }}
      >
        <AdminSectionHeader eyebrow="今日提醒" title="今日待處理" description="優先處理會影響交車與收款的待辦件數。總件數>0 時建議優先處理。 " />
        <div className="admin-highlight-list">
          {pendingNoticeRows.map((item) => (
            <div key={item.id} className="metric-row">
              <span>{item.title}</span>
              <div className="action-row" style={{ gap: 10, alignItems: "center" }}>
                <StatusBadge tone={item.tone}>{item.count}</StatusBadge>
                <StatusBadge tone={item.tone}>{item.detail}</StatusBadge>
              </div>
            </div>
          ))}
          <div className="metric-row">
            <span>待處理總件數</span>
            <strong>{pendingTotalCount}</strong>
          </div>
        </div>
      </section>

      <div className="admin-summary-grid dashboard-summary-grid">
        {summaryCards.map((card) => (
          <article key={`${card.label}-${String(card.value)}`} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className={`admin-summary-value ${card.small ? "admin-summary-value-small" : ""}`}>{card.value}</div>
          </article>
        ))}
      </div>

      {summaryLoading ? <div className="muted-text">載入待辦資料中...</div> : null}
      {summaryError ? (
        <div className="muted-text" style={{ color: "var(--danger-700, #b00020)" }}>
          {summaryError}
        </div>
      ) : null}

      <section className="dashboard-hero">
        <div className="hero-card">
          <h2>今日門市重點</h2>
          <p>優先確認待處理維修、訂金未清、購買確認與評論審核。重要工作必須一眼可讀。</p>
          <div className="hero-meta">
            <span className="hero-meta-item">登入帳號：{user?.displayName || user?.username || "-"}</span>
            <span className="hero-meta-item">角色：{user?.role || "-"}</span>
            <span className="hero-meta-item">目前門市：{currentStoreName}</span>
            <span className="hero-meta-item">今日銷售：NT${summary?.totals?.salesToday ?? 0}</span>
          </div>
        </div>
        <div className="admin-subpanel">
          <AdminSectionHeader eyebrow="優先待辦" title="今日待辦" description="先處理會卡住營運與交車的項目。" />
          <div className="metric-list">
            {todayTodoRows.map((item) => (
              <div key={item.id} className="metric-row">
                <div>
                  <div className="identity-title">{item.title}</div>
                  <div className="muted-text">{item.detail}</div>
                </div>
                <StatusBadge tone={item.tone}>{item.count}</StatusBadge>
              </div>
            ))}
          </div>
        </div>
      </section>

      {tab === "OVERVIEW" ? (
        <>
          <section className="admin-panel" id="pending-bike-deliveries">
            <AdminSectionHeader eyebrow="待交車" title="待交車訂單" description="電動自行車/EBIKE 訂單未完成交車確認。可直接前往訂單編輯。" />
            <ResponsiveDataSection>
              <DataTable
                columns={pendingBikeColumns}
                rows={pendingBikeRows}
                emptyText="目前沒有待交車訂單。"
                cardTitle={(row) => row.orderNo}
                cardDescription={(row) => `${row.customerName} / ${row.businessDateLabel}`}
                cardBadges={(row) => <StatusBadge tone={Number(row.unpaidBalance || 0) > 0 ? "warning" : "success"}>{row.finalPaymentStatusLabel}</StatusBadge>}
                cardFooter={(row) => (
                  <div className="action-row">
                    <button type="button" className="secondary-button" onClick={() => navigate(`/orders/${row.id}/edit`)}>
                      查看訂單
                    </button>
                    {Number(row.unpaidBalance || 0) > 0 && canConfirmPayment ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => confirmPendingBalance(row)}
                        disabled={collectingOrderId === row.id}
                      >
                        {collectingOrderId === row.id ? "處理中..." : "確認收款"}
                      </button>
                    ) : null}
                  </div>
                )}
              />
            </ResponsiveDataSection>
          </section>

          <section className="admin-panel" id="pending-repair-pickups">
            <AdminSectionHeader eyebrow="待取車" title="待取車維修" description="完成維修尚未交車，請先聯繫客戶完成收款與取車。" />
            <ResponsiveDataSection>
              <DataTable
                columns={pendingRepairColumns}
                rows={pendingRepairRows}
                emptyText="目前沒有待取車維修。"
                cardTitle={(row) => `維修單 #${row.id}`}
                cardDescription={(row) => `${row.customerName} / ${row.receiveDateLabel}`}
                cardBadges={(row) => <StatusBadge tone={row.status === "completed_waiting_pickup" ? "info" : "warning"}>{row.statusLabel}</StatusBadge>}
                cardFooter={(row) => (
                  <div className="action-row">
                    <button type="button" className="secondary-button" onClick={() => navigate(`/repairs/${row.id}`)}>
                      查看維修
                    </button>
                  </div>
                )}
              />
            </ResponsiveDataSection>
          </section>

          <section className="admin-panel" id="pending-payments">
            <AdminSectionHeader eyebrow="待收尾款" title="待收尾款" description="有未收尾款的訂單尚未完成收款，請盡快確認。"/>
            <ResponsiveDataSection>
              <DataTable
                columns={pendingPaymentColumns}
                rows={pendingPaymentRows}
                emptyText="目前沒有待收尾款訂單。"
                cardTitle={(row) => row.orderNo}
                cardDescription={(row) => `${row.customerName} / ${row.businessDateLabel}`}
                cardFooter={(row) => (
                  <div className="action-row">
                    <button type="button" className="secondary-button" onClick={() => navigate(`/orders/${row.id}/edit`)}>
                      查看訂單
                    </button>
                    {Number(row.unpaidBalance || 0) > 0 && canConfirmPayment ? (
                      <button
                        type="button"
                        className="primary-button inline-submit"
                        onClick={() => confirmPendingBalance(row)}
                        disabled={collectingOrderId === row.id}
                      >
                        {collectingOrderId === row.id ? "處理中..." : "確認收款"}
                      </button>
                    ) : null}
                  </div>
                )}
              />
            </ResponsiveDataSection>
          </section>

          <section className="admin-split-grid">
            <section className="admin-panel">
              <AdminSectionHeader eyebrow="今日待辦" title="重點處理清單" description="先看最會影響今天營運的工作。" />
              <div className="admin-task-list">
                {todayTodoRows.map((item) => (
                  <div key={item.id} className="stack-card">
                    <div className="stack-header">
                      <div>
                        <div className="stack-title">{item.title}</div>
                        <div className="stack-subtitle">{item.detail}</div>
                      </div>
                      <StatusBadge tone={item.tone}>{item.count}</StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-panel">
              <AdminSectionHeader eyebrow="今日營業重點" title="工作台摘要" description="用一致卡片語言集中顯示跨模組重點。" />
              <div className="admin-highlight-list">
                <div className="metric-row">
                  <span>發注 / 退貨待處理</span>
                  <StatusBadge tone="info">{summary?.totals?.supplierRequestsPending ?? 0}</StatusBadge>
                </div>
                <div className="metric-row">
                  <span>客戶總數</span>
                  <strong>{summary?.totals?.customers ?? 0}</strong>
                </div>
                <div className="metric-row">
                  <span>商品總數</span>
                  <strong>{summary?.totals?.products ?? 0}</strong>
                </div>
                <div className="metric-row">
                  <span>訂單總數</span>
                  <strong>{summary?.totals?.orders ?? 0}</strong>
                </div>
              </div>
            </section>
          </section>
        </>
      ) : null}

      {tab === "ORDERS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="訂單摘要" title="近期訂單" description="快速查看今日門市訂單與完款狀態。" />
          <ResponsiveDataSection>
            <DataTable
              columns={orderColumns}
              rows={orderSummaryRows}
              emptyText="目前沒有訂單資料。"
              cardTitle={(row) => row.orderNo}
              cardDescription={(row) => `${row.customerDisplay} / ${row.businessDateLabel}`}
              cardBadges={(row) => (
                <StatusBadge tone={row.finalPaymentStatus === "PAID" ? "success" : "warning"}>{row.paymentLabel}</StatusBadge>
              )}
            />
          </ResponsiveDataSection>
        </section>
      ) : null}

      {tab === "REPAIRS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="維修摘要" title="近期維修案件" description="維修待處理與報價回覆狀態集中檢視。" />
          <ResponsiveDataSection>
            <DataTable
              columns={repairColumns}
              rows={repairSummaryRows}
              emptyText="目前沒有維修資料。"
              cardTitle={(row) => row.customerDisplay}
              cardDescription={(row) => `${row.bikeModel || "-"} / ${row.reservationDateLabel}`}
              cardBadges={(row) => <StatusBadge tone={row.status === "checking" ? "warning" : "info"}>{row.statusLabel}</StatusBadge>}
            />
          </ResponsiveDataSection>
        </section>
      ) : null}

      {tab === "INVENTORY" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="庫存提醒" title="低庫存商品" description="優先補貨與發注的商品集中顯示。" />
          <ResponsiveDataSection>
            <DataTable
              columns={inventoryColumns}
              rows={lowStockRows}
              emptyText="目前沒有低庫存商品。"
              cardTitle={(row) => row.name}
              cardDescription={(row) => `${row.categoryLabel || "-"} / SKU：${row.sku}`}
              cardBadges={(row) => <StatusBadge tone={Number(row.stock) <= 0 ? "danger" : "warning"}>{Number(row.stock) <= 0 ? "無庫存" : "低庫存"}</StatusBadge>}
            />
          </ResponsiveDataSection>
        </section>
      ) : null}

      {tab === "STAFF" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="員工出勤摘要" title="今日出勤" description="先看誰已打卡、誰仍未完成今日工作。" />
            <ResponsiveDataSection>
              <DataTable
                columns={attendanceColumns}
                rows={attendanceRows}
                emptyText="目前沒有出勤紀錄。"
                cardTitle={(row) => row.staffName}
                cardDescription={(row) => `上班：${row.checkInAtLabel} / 下班：${row.checkOutAtLabel}`}
                cardBadges={(row) => <StatusBadge tone={row.checkOutAt ? "success" : "warning"}>{row.checkOutAt ? "已完成" : "上班中"}</StatusBadge>}
              />
            </ResponsiveDataSection>
          </section>

          <section className="admin-panel">
            <AdminSectionHeader eyebrow="KPI 摘要" title="本月表現前段班" description="快速查看目前 KPI 排名與紀錄數。" />
            <ResponsiveDataSection>
              <DataTable
                columns={kpiColumns}
                rows={kpiRows}
                emptyText="目前沒有績效資料。"
                cardTitle={(row) => row.staffName}
                cardDescription={(row) => `${row.role} / 總分 ${row.totalScore}`}
                cardBadges={(row) => <StatusBadge tone="info">紀錄 {row.logCount}</StatusBadge>}
              />
            </ResponsiveDataSection>
          </section>
        </div>
      ) : null}

      <ActionModal
        open={showPendingNotice}
        tone="warning"
        title="今日提醒"
        message={`目前有 ${pendingBikeDeliveryCount} 筆待交車訂單、${pendingRepairPickupCount} 筆待取車維修、${pendingPaymentCount} 筆待收尾款，請優先處理。${pendingPaymentAmount > 0 ? ` (待收尾款總額 NT$${pendingPaymentAmount.toFixed(0)})` : ""}`}
        confirmText="稍後處理"
        onCancel={hidePendingNotice}
        onConfirm={hidePendingNotice}
      >
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={() => jumpToPendingSection("pending-bike-deliveries")}>
            查看待交車
          </button>
          <button type="button" className="secondary-button" onClick={() => jumpToPendingSection("pending-repair-pickups")}>
            查看待取車
          </button>
          <button type="button" className="secondary-button" onClick={() => jumpToPendingSection("pending-payments")}>
            查看待收尾款
          </button>
          <button type="button" className="inline-submit" onClick={hidePendingNotice}>
            稍後處理
          </button>
        </div>
      </ActionModal>
    </div>
  );
}

export default DashboardPage;
