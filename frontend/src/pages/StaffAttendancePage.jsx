import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { apiRequest } from "../lib/api";
import { formatTaipeiDateTime } from "../lib/display";

const columns = [
  { key: "staffName", label: "員工" },
  { key: "checkInAtLabel", label: "上班時間" },
  { key: "checkOutAtLabel", label: "下班時間" }
];

function StaffAttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "TODAY");
  const attendance = useFetchList("/attendance");
  const checklist = useFetchList("/attendance/checklist/today");
  const kpi = useFetchList("/kpi");

  const attendanceRows = useMemo(
    () =>
      attendance.items.map((item) => ({
        ...item,
        checkInAtLabel: formatTaipeiDateTime(item.checkInAt),
        checkOutAtLabel: formatTaipeiDateTime(item.checkOutAt)
      })),
    [attendance.items]
  );
  const todayWorkingRows = useMemo(() => attendanceRows.filter((row) => !row.checkOutAt).slice(0, 8), [attendanceRows]);
  const todayCompletedRows = useMemo(() => attendanceRows.filter((row) => row.checkOutAt).slice(0, 8), [attendanceRows]);
  const kpiRows = useMemo(() => kpi.items.slice(0, 8), [kpi.items]);

  const sectionItems = [
    { key: "TODAY", label: "今日狀態" },
    { key: "RECORDS", label: "歷史紀錄" },
    { key: "CHECKLIST", label: "待確認事項" },
    { key: "KPI", label: "KPI 摘要" }
  ];

  useEffect(() => {
    const current = searchParams.get("tab") || "TODAY";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  async function checkIn() {
    try {
      await apiRequest("/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({})
      });
      attendance.refetch();
      alert("已完成上班打卡");
    } catch (error) {
      alert(error.message);
    }
  }

  async function checkOut() {
    try {
      await apiRequest("/attendance/check-out", {
        method: "POST",
        body: JSON.stringify({})
      });
      attendance.refetch();
      alert("已完成下班打卡");
    } catch (error) {
      alert(error.message);
    }
  }

  async function toggleChecklist(item, done) {
    try {
      await apiRequest(`/attendance/checklist/${item.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ done })
      });
      checklist.refetch();
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div>
      <PageHeader title="出勤管理" description="先看今天狀態，再看歷史紀錄與待確認事項，維持同一套營運工作台語言。" />
      {attendance.error || checklist.error || kpi.error ? (
        <div className="empty-state">{attendance.error || checklist.error || kpi.error}</div>
      ) : null}
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="出勤子功能" />

      <div className="admin-summary-grid">
        <article className="admin-summary-card">
          <div className="admin-summary-label">今日已打卡</div>
          <div className="admin-summary-value">{todayWorkingRows.length + todayCompletedRows.length}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">今日未退勤</div>
          <div className="admin-summary-value">{todayWorkingRows.length}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">今日待確認事項</div>
          <div className="admin-summary-value">{checklist.items.filter((item) => !item.isDone).length}</div>
        </article>
        <article className="admin-summary-card">
          <div className="admin-summary-label">今日已完成</div>
          <div className="admin-summary-value">{todayCompletedRows.length}</div>
        </article>
      </div>

      {tab === "TODAY" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="今日打卡"
              title="快速操作"
              description="先顯示今天狀態與打卡按鈕，再往下看其他資料。"
              actions={
                <div className="action-row">
                  <button type="button" className="primary-button action-button" onClick={checkIn}>
                    上班打卡
                  </button>
                  <button type="button" className="secondary-button action-button" onClick={checkOut}>
                    下班打卡
                  </button>
                </div>
              }
            />
            <div className="metric-list">
              <div className="metric-row">
                <span>今日已打卡</span>
                <StatusBadge tone="info">{todayWorkingRows.length + todayCompletedRows.length}</StatusBadge>
              </div>
              <div className="metric-row">
                <span>今日未退勤</span>
                <StatusBadge tone="warning">{todayWorkingRows.length}</StatusBadge>
              </div>
              <div className="metric-row">
                <span>今日已完成</span>
                <StatusBadge tone="success">{todayCompletedRows.length}</StatusBadge>
              </div>
            </div>
          </section>

          <section className="admin-panel">
            <AdminSectionHeader eyebrow="今日工作確認" title="待確認事項" description="完成後會同步記錄既有 checklist / KPI 流程。" />
            {checklist.items.length === 0 ? <div className="empty-state">今日尚無確認事項。</div> : null}
            <div className="checklist-list">
              {checklist.items.map((item) => (
                <label key={item.id} className="checklist-item">
                  <input
                    type="checkbox"
                    checked={Boolean(item.isDone)}
                    onChange={(event) => toggleChecklist(item, event.target.checked)}
                  />
                  <span>{item.itemLabel}</span>
                </label>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "RECORDS" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="歷史紀錄" title="出勤紀錄" description="桌面版表格、手機版卡片，不再依賴大表格橫向閱讀。" />
          <DataTable
            columns={[
              ...columns,
              {
                key: "status",
                label: "狀態",
                render: (row) => <StatusBadge tone={row.checkOutAt ? "success" : "warning"}>{row.checkOutAt ? "已完成" : "上班中"}</StatusBadge>
              }
            ]}
            rows={attendanceRows}
            emptyText="目前沒有出勤紀錄。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `上班：${row.checkInAtLabel} / 下班：${row.checkOutAtLabel}`}
            cardBadges={(row) => <StatusBadge tone={row.checkOutAt ? "success" : "warning"}>{row.checkOutAt ? "已完成" : "上班中"}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "CHECKLIST" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="待確認事項" title="今日確認進度" description="先處理未完成項目，再回到打卡或歷史紀錄。" />
          {checklist.items.length === 0 ? <div className="empty-state">今日尚無確認事項。</div> : null}
          <div className="checklist-list">
            {checklist.items.map((item) => (
              <label key={item.id} className="checklist-item">
                <input
                  type="checkbox"
                  checked={Boolean(item.isDone)}
                  onChange={(event) => toggleChecklist(item, event.target.checked)}
                />
                <span>{item.itemLabel}</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "KPI" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="KPI 摘要" title="本月出勤相關績效" description="從既有 KPI 紀錄顯示今天工作完成與排行摘要。" />
          <DataTable
            columns={[
              { key: "staffName", label: "員工" },
              { key: "role", label: "角色" },
              { key: "logCount", label: "紀錄數" },
              { key: "totalScore", label: "總分" }
            ]}
            rows={kpiRows}
            emptyText="目前沒有績效資料。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `${row.role} / 總分 ${row.totalScore}`}
            cardBadges={(row) => <StatusBadge tone="info">紀錄 {row.logCount}</StatusBadge>}
          />
        </section>
      ) : null}
    </div>
  );
}

export default StaffAttendancePage;
