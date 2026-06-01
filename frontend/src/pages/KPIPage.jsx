import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminSectionHeader from "../components/AdminSectionHeader";
import DataTable from "../components/DataTable";
import DetailModal from "../components/DetailModal";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { useFetchList } from "../hooks/useFetchList";
import { formatTaipeiDateTime } from "../lib/display";

function KPIPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "SUMMARY");
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [attendanceFilter, setAttendanceFilter] = useState("ALL");
  const [detail, setDetail] = useState(null);
  const kpi = useFetchList("/kpi");
  const staff = useFetchList("/staff");
  const attendance = useFetchList("/attendance");

  const latestAttendanceByStaffId = useMemo(() => {
    const map = new Map();
    for (const row of attendance.items) {
      if (!map.has(row.staffUserId)) {
        map.set(row.staffUserId, row);
      }
    }
    return map;
  }, [attendance.items]);

  const rows = useMemo(
    () =>
      staff.items.map((item) => {
        const kpiRow = kpi.items.find((entry) => entry.staffUserId === item.id) || {};
        const attendanceRow = latestAttendanceByStaffId.get(item.id) || null;
        const attendanceStatus = attendanceRow
          ? attendanceRow.checkOutAt
            ? "已完成"
            : "上班中"
          : "今日未打卡";
        const attendanceTone = attendanceRow
          ? attendanceRow.checkOutAt
            ? "success"
            : "warning"
          : "neutral";
        return {
          ...item,
          staffUserId: item.id,
          displayRole: item.role || "-",
          logCount: Number(kpiRow.logCount || 0),
          totalScore: Number(kpiRow.totalScore || 0),
          attendanceStatus,
          attendanceTone,
          checkInAt: attendanceRow?.checkInAt || null,
          checkOutAt: attendanceRow?.checkOutAt || null,
          isActive: Boolean(item.isActive)
        };
      }),
    [kpi.items, latestAttendanceByStaffId, staff.items]
  );

  const rankingRows = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.totalScore - a.totalScore || a.staffName.localeCompare(b.staffName))
        .map((row, index) => ({
          ...row,
          rank: index + 1
        })),
    [rows]
  );

  const attendanceRows = useMemo(() => rows.filter((row) => row.checkInAt || row.checkOutAt), [rows]);
  const pendingRows = useMemo(() => rows.filter((item) => item.logCount === 0 || item.attendanceStatus === "今日未打卡"), [rows]);

  const staffRoles = useMemo(() => ["ALL", ...new Set(rows.map((row) => row.displayRole).filter(Boolean))], [rows]);
  const sectionItems = [
    { key: "SUMMARY", label: "KPI 摘要" },
    { key: "STAFF", label: "員工列表" },
    { key: "ATTENDANCE", label: "出勤" },
    { key: "RANKING", label: "排名" },
    { key: "PENDING", label: "待確認事項" },
    { key: "TREND", label: "趨勢 / 比較" }
  ];

  useEffect(() => {
    const current = searchParams.get("tab") || "SUMMARY";
    if (current !== tab) {
      setTab(current);
    }
  }, [searchParams, tab]);

  function changeTab(next) {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  function openDetail(row) {
    setDetail(row);
  }

  const summaryCards = [
    { label: "本月 KPI 人數", value: rows.length },
    { label: "本月第一名", value: rankingRows[0]?.staffName || "-" },
    { label: "最高總分", value: rankingRows[0]?.totalScore ?? 0 },
    { label: "待確認事項", value: pendingRows.length },
    { label: "今日上班中", value: rows.filter((row) => row.attendanceStatus === "上班中").length },
    { label: "今日未打卡", value: rows.filter((row) => row.attendanceStatus === "今日未打卡").length }
  ];

  return (
    <div>
      <PageHeader title="員工績效" description="用同一套營運工作台結構呈現員工、KPI、排名與待確認摘要。" />
      {kpi.error || staff.error || attendance.error ? (
        <div className="empty-state">{kpi.error || staff.error || attendance.error}</div>
      ) : null}
      <SectionTabs items={sectionItems} value={tab} onChange={changeTab} label="KPI 子功能" />

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
            <AdminSectionHeader eyebrow="本月 KPI summary" title="核心摘要" description="先看排名、平均值與待確認事項，再進一步看明細。" />
            <div className="metric-list">
              <div className="metric-row">
                <span>本月第一名</span>
                <strong>{rankingRows[0]?.staffName || "-"}</strong>
              </div>
              <div className="metric-row">
                <span>第一名總分</span>
                <strong>{rankingRows[0]?.totalScore ?? 0}</strong>
              </div>
              <div className="metric-row">
                <span>平均總分</span>
                <strong>{rows.length ? Math.round(rows.reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / rows.length) : 0}</strong>
              </div>
            </div>
          </section>
          <section className="admin-panel">
            <AdminSectionHeader eyebrow="指標拆解" title="重點拆解" description="目前依既有資料來源顯示紀錄數、總分與今日出勤狀態。" />
            <DataTable
              columns={[
                { key: "staffName", label: "員工" },
                { key: "logCount", label: "紀錄數" },
                { key: "totalScore", label: "總分" },
                {
                  key: "attendanceStatus",
                  label: "今日出勤",
                  render: (row) => <StatusBadge tone={row.attendanceTone}>{row.attendanceStatus}</StatusBadge>
                }
              ]}
              rows={rankingRows.slice(0, 5)}
              emptyText="目前沒有績效紀錄。"
              cardTitle={(row) => row.staffName}
              cardDescription={(row) => `${row.displayRole} / 總分 ${row.totalScore}`}
              cardBadges={(row) => <StatusBadge tone="info">紀錄 {row.logCount}</StatusBadge>}
            />
          </section>
        </div>
      ) : null}

      {tab === "STAFF" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="員工列表" title="員工基本資料與本月摘要" description="主畫面只顯示姓名、角色、今日出勤狀態、本月 KPI 與操作。" />
          <FilterBar>
            <label className="form-field">
              <span>關鍵字搜尋</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="員工姓名 / 角色" />
            </label>
            <label className="form-field">
              <span>角色</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                {staffRoles.map((role) => (
                  <option key={role} value={role}>
                    {role === "ALL" ? "全部角色" : role}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>出勤狀態</span>
              <select value={attendanceFilter} onChange={(event) => setAttendanceFilter(event.target.value)}>
                <option value="ALL">全部</option>
                <option value="CHECKED_IN">上班中</option>
                <option value="NOT_CHECKED_IN">今日未打卡</option>
                <option value="DONE">已完成</option>
              </select>
            </label>
          </FilterBar>
          <DataTable
            columns={[
              { key: "staffName", label: "員工姓名" },
              { key: "displayRole", label: "角色", mobileHidden: true },
              {
                key: "attendanceStatus",
                label: "今日出勤狀態",
                render: (row) => <StatusBadge tone={row.attendanceTone}>{row.attendanceStatus}</StatusBadge>,
                mobileHidden: true
              },
              {
                key: "kpiSummary",
                label: "本月 KPI 摘要",
                render: (row) => (
                  <div className="stack-list">
                    <StatusBadge tone="info">總分 {row.totalScore}</StatusBadge>
                    <StatusBadge tone={row.logCount > 0 ? "success" : "warning"}>紀錄 {row.logCount}</StatusBadge>
                  </div>
                )
              },
              {
                key: "actions",
                label: "操作",
                render: (row) => (
                  <button type="button" className="secondary-button" onClick={() => openDetail(row)}>
                    詳情
                  </button>
                )
              }
            ]}
            rows={rows.filter((row) => {
              const text = keyword.trim().toLowerCase();
              if (text && !`${row.staffName} ${row.displayRole}`.toLowerCase().includes(text)) {
                return false;
              }
              if (roleFilter !== "ALL" && row.displayRole !== roleFilter) {
                return false;
              }
              if (attendanceFilter === "CHECKED_IN" && row.attendanceStatus !== "上班中") {
                return false;
              }
              if (attendanceFilter === "NOT_CHECKED_IN" && row.attendanceStatus !== "今日未打卡") {
                return false;
              }
              if (attendanceFilter === "DONE" && row.attendanceStatus !== "已完成") {
                return false;
              }
              return true;
            })}
            emptyText="目前沒有績效紀錄。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `${row.displayRole} / 本月 KPI ${row.totalScore}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={row.attendanceTone}>{row.attendanceStatus}</StatusBadge>
                <StatusBadge tone="info">總分 {row.totalScore}</StatusBadge>
              </>
            )}
            cardFooter={(row) => (
              <div className="field-grid">
                <div className="field-item">
                  <div className="field-label">紀錄數</div>
                  <div className="field-value">{row.logCount}</div>
                </div>
                <div className="field-item">
                  <div className="field-label">今日打卡</div>
                  <div className="field-value">{row.checkInAt ? formatTaipeiDateTime(row.checkInAt) : "今日未打卡"}</div>
                </div>
              </div>
            )}
          />
        </section>
      ) : null}

      {tab === "ATTENDANCE" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="出勤" title="今日出勤摘要" description="先看今天誰已打卡、誰未打卡，再往下看歷史。" />
          <div className="admin-summary-grid">
            <article className="admin-summary-card">
              <div className="admin-summary-label">已完成</div>
              <div className="admin-summary-value">{rows.filter((row) => row.attendanceStatus === "已完成").length}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">上班中</div>
              <div className="admin-summary-value">{rows.filter((row) => row.attendanceStatus === "上班中").length}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">今日未打卡</div>
              <div className="admin-summary-value">{rows.filter((row) => row.attendanceStatus === "今日未打卡").length}</div>
            </article>
          </div>
          <DataTable
            columns={[
              { key: "staffName", label: "員工" },
              { key: "displayRole", label: "角色" },
              {
                key: "attendanceStatus",
                label: "今日狀態",
                render: (row) => <StatusBadge tone={row.attendanceTone}>{row.attendanceStatus}</StatusBadge>
              },
              { key: "checkInAt", label: "上班時間", render: (row) => formatTaipeiDateTime(row.checkInAt), mobileHidden: true },
              { key: "checkOutAt", label: "下班時間", render: (row) => formatTaipeiDateTime(row.checkOutAt), mobileHidden: true }
            ]}
            rows={attendanceRows}
            emptyText="目前沒有今日出勤資料。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `上班：${formatTaipeiDateTime(row.checkInAt)} / 下班：${formatTaipeiDateTime(row.checkOutAt)}`}
            cardBadges={(row) => <StatusBadge tone={row.attendanceTone}>{row.attendanceStatus}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "RANKING" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="月度排行" title="本月表現排行" description="用一致表格 / 卡片語言顯示目前排名。" />
          <div className="admin-summary-grid">
            <article className="admin-summary-card">
              <div className="admin-summary-label">第一名</div>
              <div className="admin-summary-value">{rankingRows[0]?.staffName || "-"}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">第一名總分</div>
              <div className="admin-summary-value">{rankingRows[0]?.totalScore ?? 0}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">前 3 名</div>
              <div className="admin-summary-value">{rankingRows.slice(0, 3).length}</div>
            </article>
          </div>
          <DataTable
            columns={[
              { key: "rank", label: "排名" },
              { key: "staffName", label: "員工" },
              { key: "displayRole", label: "角色", mobileHidden: true },
              { key: "logCount", label: "紀錄數", mobileHidden: true },
              { key: "totalScore", label: "總分" }
            ]}
            rows={rankingRows}
            emptyText="目前沒有績效紀錄。"
            cardTitle={(row) => `第 ${row.rank} 名 ${row.staffName}`}
            cardDescription={(row) => `${row.displayRole} / 總分 ${row.totalScore}`}
            cardBadges={(row) => <StatusBadge tone={row.rank <= 3 ? "success" : "info"}>紀錄 {row.logCount}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "PENDING" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="待確認事項" title="需補資料的員工" description="優先處理本月尚未累積 KPI 或今日尚未打卡的員工。" />
          <DataTable
            columns={[
              { key: "staffName", label: "員工" },
              { key: "displayRole", label: "角色", mobileHidden: true },
              { key: "attendanceStatus", label: "今日出勤", mobileHidden: true },
              { key: "logCount", label: "紀錄數", mobileHidden: true },
              { key: "totalScore", label: "總分" }
            ]}
            rows={pendingRows}
            emptyText="目前沒有待確認的 KPI 項目。"
            cardTitle={(row) => row.staffName}
            cardDescription={(row) => `${row.displayRole} / 目前紀錄 ${row.logCount}`}
            cardBadges={(row) => <StatusBadge tone={row.attendanceTone === "success" ? "success" : "warning"}>{row.attendanceStatus}</StatusBadge>}
          />
        </section>
      ) : null}

      {tab === "TREND" ? (
        <section className="admin-panel">
          <AdminSectionHeader eyebrow="趨勢 / 比較" title="本月表現比較" description="沒有獨立圖表時，改用排序與分段卡片讓差異更容易看懂。" />
          <div className="admin-summary-grid">
            <article className="admin-summary-card">
              <div className="admin-summary-label">平均總分</div>
              <div className="admin-summary-value">{rows.length ? Math.round(rows.reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / rows.length) : 0}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">平均紀錄數</div>
              <div className="admin-summary-value">{rows.length ? Math.round(rows.reduce((sum, item) => sum + Number(item.logCount || 0), 0) / rows.length) : 0}</div>
            </article>
            <article className="admin-summary-card">
              <div className="admin-summary-label">前 5 名平均</div>
              <div className="admin-summary-value">
                {rankingRows.slice(0, 5).length
                  ? Math.round(rankingRows.slice(0, 5).reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / rankingRows.slice(0, 5).length)
                  : 0}
              </div>
            </article>
          </div>
          <DataTable
            columns={[
              { key: "rank", label: "排名" },
              { key: "staffName", label: "員工" },
              { key: "totalScore", label: "總分" },
              { key: "logCount", label: "紀錄數", mobileHidden: true },
              {
                key: "gap",
                label: "與第一名差距",
                render: (row) => `-${Math.max((rankingRows[0]?.totalScore || 0) - Number(row.totalScore || 0), 0)}`
              }
            ]}
            rows={rankingRows.slice(0, 8)}
            emptyText="目前沒有比較資料。"
            cardTitle={(row) => `第 ${row.rank} 名 ${row.staffName}`}
            cardDescription={(row) => `總分 ${row.totalScore} / 紀錄 ${row.logCount}`}
            cardBadges={(row) => <StatusBadge tone={row.rank <= 3 ? "success" : "info"}>排名 {row.rank}</StatusBadge>}
          />
        </section>
      ) : null}

      <DetailModal
        open={Boolean(detail)}
        title={detail ? detail.staffName : "員工詳情"}
        subtitle={detail ? `${detail.displayRole} / ${detail.attendanceStatus}` : ""}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="admin-detail-layout">
            <div className="admin-split-grid">
              <section className="stack-card">
                <div className="section-title">基本資料</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">姓名</div><div className="field-value">{detail.staffName}</div></div>
                  <div className="field-item"><div className="field-label">角色</div><div className="field-value">{detail.displayRole}</div></div>
                  <div className="field-item"><div className="field-label">是否啟用</div><div className="field-value">{detail.isActive ? "啟用" : "停用"}</div></div>
                  <div className="field-item"><div className="field-label">建立時間</div><div className="field-value">{formatTaipeiDateTime(detail.createdAt)}</div></div>
                </div>
              </section>
              <section className="stack-card">
                <div className="section-title">KPI 摘要</div>
                <div className="field-grid">
                  <div className="field-item"><div className="field-label">總分</div><div className="field-value">{detail.totalScore}</div></div>
                  <div className="field-item"><div className="field-label">紀錄數</div><div className="field-value">{detail.logCount}</div></div>
                  <div className="field-item"><div className="field-label">今日狀態</div><div className="field-value">{detail.attendanceStatus}</div></div>
                  <div className="field-item"><div className="field-label">今日打卡</div><div className="field-value">{formatTaipeiDateTime(detail.checkInAt)}</div></div>
                </div>
              </section>
            </div>
            <section className="stack-card">
              <div className="section-title">今日出勤</div>
              <div className="field-grid">
                <div className="field-item"><div className="field-label">上班時間</div><div className="field-value">{formatTaipeiDateTime(detail.checkInAt)}</div></div>
                <div className="field-item"><div className="field-label">下班時間</div><div className="field-value">{formatTaipeiDateTime(detail.checkOutAt)}</div></div>
                <div className="field-item"><div className="field-label">狀態</div><div className="field-value">{detail.attendanceStatus}</div></div>
              </div>
            </section>
            <div className="action-row">
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

export default KPIPage;
