import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import { getStoredUser } from "../lib/auth";
import { apiRequest } from "../lib/api";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { formatTaipeiDate, formatTaipeiDateTime } from "../lib/display";

const PRIORITY_ITEMS = [
  { key: "purchaseConfirmationsPending", label: "購買確認待處理", tone: "warning" },
  { key: "repairReservationsPending", label: "維修待處理", tone: "info" },
  { key: "googleReviewApprovalsPending", label: "Google 評論待確認", tone: "warning" }
];

function DashboardPage() {
  const user = getStoredUser();
  const currentStoreName = user?.storeName || "KINGWAY 門市";
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "OVERVIEW");
  const [summary, setSummary] = useState(null);
  const orders = useFetchList("/orders");
  const repairs = useFetchList("/repairs");
  const lowStock = useFetchList("/inventory/low-stock");
  const attendance = useFetchList("/attendance");
  const kpi = useFetchList("/kpi");

  useEffect(() => {
    const current = searchParams.get("tab") || "OVERVIEW";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);

  useEffect(() => {
    async function loadSummary() {
      try {
        const data = await apiRequest("/dashboard/summary");
        setSummary(data);
      } catch (error) {
        setSummary(null);
      }
    }

    loadSummary();
  }, []);

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  const sectionItems = [
    { key: "OVERVIEW", label: "今日總覽" },
    { key: "ORDERS", label: "訂單摘要" },
    { key: "REPAIRS", label: "維修摘要" },
    { key: "INVENTORY", label: "庫存提醒" },
    { key: "STAFF", label: "員工摘要" }
  ];

  const summaryCards = [
    {
      label: "今日待確認",
      value:
        (summary?.pendingTasks?.purchaseConfirmationsPending ?? 0) +
        (summary?.pendingTasks?.googleReviewApprovalsPending ?? 0)
    },
    { label: "今日待處理", value: summary?.pendingTasks?.repairReservationsPending ?? 0 },
    { label: "訂金未清", value: summary?.totals?.depositOrdersPending ?? 0 },
    { label: "購買確認待處理", value: summary?.pendingTasks?.purchaseConfirmationsPending ?? 0 },
    { label: "Google 評論待確認", value: summary?.pendingTasks?.googleReviewApprovalsPending ?? 0 },
    { label: "維修待處理", value: summary?.pendingTasks?.repairReservationsPending ?? 0 },
    { label: "低庫存", value: summary?.totals?.lowStockCount ?? 0 },
    { label: "今日營業重點", value: `NT$${summary?.totals?.salesToday ?? 0}`, small: true }
  ];

  const todayTodoRows = useMemo(
    () => [
      {
        id: "purchase-confirm",
        title: "購買確認待處理",
        count: summary?.pendingTasks?.purchaseConfirmationsPending ?? 0,
        tone: "warning",
        detail: "需確認購買確認書與交車前作業"
      },
      {
        id: "repair",
        title: "維修待處理",
        count: summary?.pendingTasks?.repairReservationsPending ?? 0,
        tone: "info",
        detail: "優先查看待群組確認與待報價案件"
      },
      {
        id: "review",
        title: "Google 評論待確認",
        count: summary?.pendingTasks?.googleReviewApprovalsPending ?? 0,
        tone: "warning",
        detail: "確認後再人工核發優惠券"
      },
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
    { key: "totalAmount", label: "總額", render: (row) => `NT$${Number(row.totalAmount || 0).toFixed(0)}` },
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

  return (
    <div>
      <PageHeader title="儀表板" description="營運首頁優先顯示今日待辦、關鍵數字與各工作區摘要。" />
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="儀表板子功能" />

      <div className="admin-summary-grid dashboard-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className={`admin-summary-value ${card.small ? "admin-summary-value-small" : ""}`}>{card.value}</div>
          </article>
        ))}
      </div>

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
        <div className="admin-split-grid">
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
        </div>
      ) : null}

      {tab === "ORDERS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="訂單摘要" title="近期訂單" description="快速查看今日門市訂單與完款狀態。" />
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
        </section>
      ) : null}

      {tab === "REPAIRS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="維修摘要" title="近期維修案件" description="維修待處理與報價回覆狀態集中檢視。" />
          <DataTable
            columns={repairColumns}
            rows={repairSummaryRows}
            emptyText="目前沒有維修資料。"
            cardTitle={(row) => row.customerDisplay}
            cardDescription={(row) => `${row.bikeModel || "-"} / ${row.reservationDateLabel}`}
            cardBadges={(row) => <StatusBadge tone={row.status === "checking" ? "warning" : "info"}>{row.statusLabel}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "INVENTORY" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="庫存提醒" title="低庫存商品" description="優先補貨與發注的商品集中顯示。" />
          <DataTable
            columns={inventoryColumns}
            rows={lowStockRows}
            emptyText="目前沒有低庫存商品。"
            cardTitle={(row) => row.name}
            cardDescription={(row) => `${row.categoryLabel || "-"} / SKU：${row.sku}`}
            cardBadges={(row) => <StatusBadge tone={Number(row.stock) <= 0 ? "danger" : "warning"}>{Number(row.stock) <= 0 ? "無庫存" : "低庫存"}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "STAFF" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="員工出勤摘要" title="今日出勤" description="先看誰已打卡、誰仍未完成今日工作。" />
            <DataTable
              columns={attendanceColumns}
              rows={attendanceRows}
              emptyText="目前沒有出勤紀錄。"
              cardTitle={(row) => row.staffName}
              cardDescription={(row) => `上班：${row.checkInAtLabel} / 下班：${row.checkOutAtLabel}`}
              cardBadges={(row) => <StatusBadge tone={row.checkOutAt ? "success" : "warning"}>{row.checkOutAt ? "已完成" : "上班中"}</StatusBadge>}
            />
          </section>

          <section className="admin-panel">
            <AdminSectionHeader eyebrow="KPI 摘要" title="本月表現前段班" description="快速查看目前 KPI 排名與紀錄數。" />
            <DataTable
              columns={kpiColumns}
              rows={kpiRows}
              emptyText="目前沒有績效資料。"
              cardTitle={(row) => row.staffName}
              cardDescription={(row) => `${row.role} / 總分 ${row.totalScore}`}
              cardBadges={(row) => <StatusBadge tone="info">紀錄 {row.logCount}</StatusBadge>}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default DashboardPage;
