import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { getStoredToken, getStoredUser } from "../lib/auth";
import { formatTaipeiDateTime } from "../lib/display";
import { createEvaluationNote, fetchEvaluationNotes } from "../lib/staffEvaluationsApi";
import { PAGE_HELP } from "../lib/pageHelpContent";
import {
  fetchStaffKpiEvents,
  fetchStaffKpiSummary,
  getStaffKpiEventsExportUrl,
  getStaffKpiSummaryExportUrl
} from "../lib/staffKpiApi";

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
  const storedUser = useMemo(() => getStoredUser(), []);
  const [tab, setTab] = useState("SUMMARY");
  const [filters, setFilters] = useState(monthRange);
  const [summary, setSummary] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [evaluationNotes, setEvaluationNotes] = useState([]);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const [evaluationForm, setEvaluationForm] = useState({ rating: "GOOD", note: "" });

  const canWriteEvaluation = useMemo(() => {
    const role = String(storedUser?.role || "").toUpperCase();
    const storeRole = String(storedUser?.storeRole || storedUser?.store_role || "").toLowerCase();
    const companyRole = String(storedUser?.companyRole || storedUser?.company_role || "").toLowerCase();
    return ["ADMIN", "MANAGER"].includes(role)
      || ["owner", "admin", "manager"].includes(storeRole)
      || ["company_owner", "hq_admin", "inventory_manager", "finance"].includes(companyRole);
  }, [storedUser]);

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

  async function downloadExcel(kind) {
    setDownloading(kind);
    setError("");
    try {
      const token = getStoredToken();
      const url = kind === "summary"
        ? getStaffKpiSummaryExportUrl(filters)
        : getStaffKpiEventsExportUrl({ ...filters, limit: 1000 });
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        let message = "Excel 下載失敗";
        try {
          const errorBody = await response.json();
          message = errorBody.message || message;
        } catch (parseError) {
          message = await response.text() || message;
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/);
      const filename = filenameMatch?.[1]
        || (kind === "summary"
          ? `kingway_staff_kpi_summary_${filters.startDate}_${filters.endDate}.xlsx`
          : `kingway_staff_kpi_events_${filters.startDate}_${filters.endDate}.xlsx`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(downloadError.message || "Excel 下載失敗");
    } finally {
      setDownloading("");
    }
  }

  async function openEvaluationModal(row) {
    setSelectedStaff(row);
    setEvaluationForm({ rating: "GOOD", note: "" });
    setEvaluationNotes([]);
    setEvaluationError("");
    setEvaluationLoading(true);
    try {
      const response = await fetchEvaluationNotes({
        staffUserId: row.staffUserId,
        periodStart: filters.startDate,
        periodEnd: filters.endDate
      });
      setEvaluationNotes(response.notes || []);
    } catch (noteError) {
      setEvaluationError(noteError.message || "評價備註讀取失敗");
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function saveEvaluationNote(event) {
    event.preventDefault();
    if (!selectedStaff) return;
    setEvaluationLoading(true);
    setEvaluationError("");
    try {
      await createEvaluationNote({
        staffUserId: selectedStaff.staffUserId,
        periodStart: filters.startDate,
        periodEnd: filters.endDate,
        rating: evaluationForm.rating,
        note: evaluationForm.note
      });
      const response = await fetchEvaluationNotes({
        staffUserId: selectedStaff.staffUserId,
        periodStart: filters.startDate,
        periodEnd: filters.endDate
      });
      setEvaluationNotes(response.notes || []);
      setEvaluationForm({ rating: "GOOD", note: "" });
    } catch (saveError) {
      setEvaluationError(saveError.message || "評價備註儲存失敗");
    } finally {
      setEvaluationLoading(false);
    }
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
      <PageHelpButton help={PAGE_HELP.staffKpi} />
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
        <button type="button" className="secondary-button" onClick={() => downloadExcel("summary")} disabled={loading || downloading}>
          {downloading === "summary" ? "匯出中..." : "匯出KPI總表"}
        </button>
        <button type="button" className="secondary-button" onClick={() => downloadExcel("events")} disabled={loading || downloading}>
          {downloading === "events" ? "匯出中..." : "匯出事件明細"}
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
              { key: "lateCount", label: "逾期", render: (row) => <StatusBadge tone={row.lateCount > 0 ? "warning" : "success"}>{row.lateCount}</StatusBadge> },
              {
                key: "evaluation",
                label: "評價備註",
                render: (row) => canWriteEvaluation ? (
                  <button type="button" className="secondary-button compact-button" onClick={() => openEvaluationModal(row)}>
                    評價備註
                  </button>
                ) : "僅管理者"
              }
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

      {selectedStaff ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="staff-evaluation-title">
            <div className="admin-modal-header">
              <div>
                <p className="eyebrow">evaluation note</p>
                <h2 id="staff-evaluation-title">評價備註</h2>
                <p className="admin-modal-copy">
                  {selectedStaff.displayName} / {filters.startDate} ～ {filters.endDate}
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedStaff(null)} aria-label="關閉">
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              {evaluationError ? <div className="error-banner">{evaluationError}</div> : null}
              <form className="form-grid" onSubmit={saveEvaluationNote}>
                <label className="form-field">
                  <span>評級</span>
                  <select
                    value={evaluationForm.rating}
                    onChange={(event) => setEvaluationForm((current) => ({ ...current, rating: event.target.value }))}
                  >
                    <option value="EXCELLENT">EXCELLENT</option>
                    <option value="GOOD">GOOD</option>
                    <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
                    <option value="NOTE">NOTE</option>
                  </select>
                </label>
                <label className="form-field form-field-wide">
                  <span>管理者備註</span>
                  <textarea
                    rows={4}
                    value={evaluationForm.note}
                    onChange={(event) => setEvaluationForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder="請輸入本期間的工作表現、提醒事項或管理者觀察。"
                    required
                  />
                </label>
                <div className="action-row">
                  <button type="submit" className="primary-button" disabled={evaluationLoading || !evaluationForm.note.trim()}>
                    {evaluationLoading ? "儲存中..." : "儲存"}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setSelectedStaff(null)}>
                    關閉
                  </button>
                </div>
              </form>
              <div className="admin-section-header" style={{ marginTop: 18 }}>
                <div>
                  <p className="eyebrow">notes</p>
                  <h3>既有備註</h3>
                </div>
              </div>
              {evaluationLoading && !evaluationNotes.length ? <div className="loading-state">讀取中...</div> : null}
              {!evaluationLoading && !evaluationNotes.length ? <div className="empty-state">此期間尚無評價備註。</div> : null}
              {evaluationNotes.length ? (
                <div className="stack-list">
                  {evaluationNotes.map((note) => (
                    <article className="content-card" key={note.id}>
                      <div className="action-row" style={{ justifyContent: "space-between" }}>
                        <StatusBadge tone={note.rating === "NEEDS_ATTENTION" ? "warning" : "info"}>{note.rating || "NOTE"}</StatusBadge>
                        <span className="muted-text">{formatTaipeiDateTime(note.createdAt)}</span>
                      </div>
                      <p>{note.note}</p>
                      <p className="muted-text">評價者：{note.evaluatorDisplayName || note.evaluatorUsername || "-"}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default StaffKpiPage;
