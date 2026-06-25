import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { formatTaipeiDateTime } from "../lib/display";
import { fetchStaffKpiEvents, fetchStaffKpiSummary } from "../lib/staffKpiApi";

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function StaffKpiPage() {
  const monthRange = useMemo(() => getMonthRange(), []);
  const [tab, setTab] = useState("SUMMARY");
  const [filters, setFilters] = useState(monthRange);
  const [summary, setSummary] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [summaryResponse, eventsResponse] = await Promise.all([
        fetchStaffKpiSummary(filters),
        fetchStaffKpiEvents({ ...filters, limit: 100 })
      ]);
      setSummary(summaryResponse.summary || []);
      setEvents(eventsResponse.events || []);
    } catch (loadError) {
      setError(loadError.message || "KPI 資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  const totals = useMemo(() => ({
    staffCount: summary.length,
    totalEvents: summary.reduce((sum, row) => sum + Number(row.totalEvents || 0), 0),
    totalScore: summary.reduce((sum, row) => sum + Number(row.totalScore || 0), 0),
    lateCount: summary.reduce((sum, row) => sum + Number(row.lateCount || 0), 0)
  }), [summary]);

  return (
    <div>
      <PageHeader
        title="員工KPI / 評價"
        description="此頁為工作處理紀錄與參考統計，不會自動決定薪資或最終人事評價。"
      />
      {error ? <div className="empty-state">{error}</div> : null}
      <FilterBar>
        <label className="form-field">
          <span>開始日期</span>
          <input name="startDate" type="date" value={filters.startDate} onChange={updateFilter} />
        </label>
        <label className="form-field">
          <span>結束日期</span>
          <input name="endDate" type="date" value={filters.endDate} onChange={updateFilter} />
        </label>
        <label className="form-field">
          <span>事件類型</span>
          <input name="eventType" value={filters.eventType || ""} onChange={updateFilter} placeholder="例如 DAILY_TASK_DONE" />
        </label>
        <button type="button" className="primary-button" onClick={load} disabled={loading}>
          查詢
        </button>
      </FilterBar>

      <div className="admin-summary-grid">
        <article className="admin-summary-card"><div className="admin-summary-label">統計員工</div><div className="admin-summary-value">{totals.staffCount}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">完成事件</div><div className="admin-summary-value">{totals.totalEvents}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">參考分數</div><div className="admin-summary-value">{Number(totals.totalScore).toFixed(1)}</div></article>
        <article className="admin-summary-card"><div className="admin-summary-label">逾期件數</div><div className="admin-summary-value">{totals.lateCount}</div></article>
      </div>

      <SectionTabs
        label="KPI 檢視"
        value={tab}
        onChange={setTab}
        items={[
          { key: "SUMMARY", label: "員工摘要" },
          { key: "EVENTS", label: "詳細紀錄" }
        ]}
      />

      {tab === "SUMMARY" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="KPI summary" title="員工處理統計" description="分數僅作營運參考，初期以紀錄與透明度為主。" />
          <DataTable
            columns={[
              { key: "displayName", label: "員工" },
              { key: "storeName", label: "門市", mobileHidden: true },
              { key: "totalEvents", label: "完成件數" },
              { key: "totalScore", label: "KPI分數", render: (row) => Number(row.totalScore || 0).toFixed(1) },
              { key: "dailyTaskDoneCount", label: "日任務", mobileHidden: true },
              { key: "notificationDoneCount", label: "通知完成", mobileHidden: true },
              { key: "transferCount", label: "入出貨", mobileHidden: true },
              { key: "supplierCount", label: "供應商", mobileHidden: true },
              { key: "messageReadCount", label: "訊息已讀", mobileHidden: true },
              { key: "lateCount", label: "逾期", render: (row) => <StatusBadge tone={row.lateCount > 0 ? "warning" : "success"}>{row.lateCount}</StatusBadge> }
            ]}
            rows={summary}
            emptyText="目前沒有 KPI 事件紀錄。"
            cardTitle={(row) => row.displayName}
            cardDescription={(row) => `${row.storeName || "-"} / 分數 ${Number(row.totalScore || 0).toFixed(1)}`}
          />
        </section>
      ) : null}

      {tab === "EVENTS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="event log" title="員工處理明細" description="每筆事件對應一個實際處理動作，避免把單純查看誤認為完成。" />
          <DataTable
            columns={[
              { key: "occurredAt", label: "時間", render: (row) => formatTaipeiDateTime(row.occurredAt) },
              { key: "displayName", label: "員工" },
              { key: "eventType", label: "類型", mobileHidden: true },
              { key: "title", label: "內容" },
              { key: "score", label: "分數", render: (row) => Number(row.score || 0).toFixed(1) },
              { key: "isLate", label: "逾期", render: (row) => <StatusBadge tone={row.isLate ? "warning" : "success"}>{row.isLate ? "逾期" : "正常"}</StatusBadge> }
            ]}
            rows={events}
            emptyText="目前沒有明細紀錄。"
            cardTitle={(row) => row.title}
            cardDescription={(row) => `${row.displayName || "-"} / ${row.eventType}`}
          />
        </section>
      ) : null}
    </div>
  );
}

export default StaffKpiPage;
