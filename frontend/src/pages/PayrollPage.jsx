import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";

function PayrollPage() {
  const payroll = useFetchList("/payroll/summary");
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "SUMMARY");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const current = searchParams.get("tab") || "SUMMARY";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);

  const sectionItems = [
    { key: "SUMMARY", label: "薪資總覽" },
    { key: "LIST", label: "明細列表" }
  ];

  const rows = useMemo(
    () =>
      payroll.items.map((item) => ({
        ...item,
        totalDaysWorked: Number(item.totalDaysWorked || 0),
        completedShifts: Number(item.completedShifts || 0)
      })),
    [payroll.items]
  );

  const filteredRows = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) {
      return rows;
    }

    return rows.filter((row) => `${row.staffName || ""}`.toLowerCase().includes(text));
  }, [keyword, rows]);

  const summaryCards = [
    { label: "員工數", value: rows.length },
    { label: "平均出勤天數", value: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.totalDaysWorked, 0) / rows.length) : 0 },
    { label: "平均完整班次", value: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.completedShifts, 0) / rows.length) : 0 },
    { label: "總完整班次", value: rows.reduce((sum, row) => sum + row.completedShifts, 0) }
  ];

  const topRows = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.totalDaysWorked - a.totalDaysWorked || b.completedShifts - a.completedShifts || a.staffName.localeCompare(b.staffName))
        .slice(0, 5),
    [rows]
  );

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  return (
    <div>
      <PageHeader title="薪資摘要" description="依出勤紀錄彙整月度薪資參考資料。" />
      {payroll.error ? <div className="empty-state">{payroll.error}</div> : null}
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="薪資子功能" />

      <div className="admin-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="admin-summary-card">
            <div className="admin-summary-label">{card.label}</div>
            <div className="admin-summary-value">{card.value}</div>
          </article>
        ))}
      </div>

      {tab === "SUMMARY" ? (
        <div className="admin-split-grid">
          <section className="admin-panel">
            <AdminSectionHeader
              eyebrow="薪資總覽"
              title="本月摘要"
              description="先看出勤天數與完整班次分布，再往下看員工明細。"
            />
            <div className="metric-list">
              <div className="metric-row">
                <span>員工數</span>
                <strong>{rows.length}</strong>
              </div>
              <div className="metric-row">
                <span>平均出勤天數</span>
                <strong>{rows.length ? Math.round(rows.reduce((sum, row) => sum + row.totalDaysWorked, 0) / rows.length) : 0}</strong>
              </div>
              <div className="metric-row">
                <span>平均完整班次</span>
                <strong>{rows.length ? Math.round(rows.reduce((sum, row) => sum + row.completedShifts, 0) / rows.length) : 0}</strong>
              </div>
            </div>
          </section>
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="前段班" title="出勤較完整的員工" description="以天數與完整班次排序，方便快速檢查。" />
            <DataTable
              columns={[
                { key: "staffName", label: "員工" },
                { key: "totalDaysWorked", label: "出勤天數" },
                { key: "completedShifts", label: "完整班次" }
              ]}
              rows={topRows}
              emptyText="目前沒有薪資摘要。"
              cardTitle={(row) => row.staffName}
              cardDescription={(row) => `出勤 ${row.totalDaysWorked} 天 / 完整班次 ${row.completedShifts}`}
              cardBadges={() => <StatusBadge tone="neutral">月度摘要</StatusBadge>}
            />
          </section>
        </div>
      ) : null}

      {tab === "LIST" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="薪資明細" title="員工薪資摘要列表" description="保留同一份資料，只把明細與摘要拆開呈現。" />
          <FilterBar>
            <label className="form-field">
              <span>關鍵字搜尋</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="員工姓名" />
            </label>
          </FilterBar>
          <DataTable
            columns={[
              { key: "staffName", label: "員工" },
              { key: "totalDaysWorked", label: "出勤天數" },
              { key: "completedShifts", label: "完整班次" },
              { key: "firstCheckIn", label: "首次上班" },
              { key: "lastCheckOut", label: "最後下班" }
            ]}
            rows={filteredRows}
            emptyText="目前沒有薪資摘要。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `出勤 ${row.totalDaysWorked} 天 / 完整班次 ${row.completedShifts}`}
            cardBadges={() => <StatusBadge tone="neutral">月度摘要</StatusBadge>}
          />
        </section>
      ) : null}
    </div>
  );
}

export default PayrollPage;
