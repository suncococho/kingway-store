import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { fetchTodayTasks, markTaskDone, skipTask } from "../lib/dailyStaffTasksApi";

const CATEGORY_TABS = [
  { key: "ALL", label: "全部" },
  { key: "OPENING", label: "開店檢查" },
  { key: "MIDDAY", label: "中段檢查" },
  { key: "CLOSING", label: "關店檢查" },
  { key: "CUSTOMER", label: "客戶/維修" },
  { key: "INVENTORY", label: "庫存/安全" }
];

const CATEGORY_LABELS = {
  OPENING: "開店檢查",
  MIDDAY: "中段檢查",
  CLOSING: "關店檢查",
  CUSTOMER: "客戶/維修",
  INVENTORY: "庫存",
  SAFETY: "安全",
  GENERAL: "一般"
};

const STATUS_LABELS = {
  PENDING: "未完成",
  DONE: "已完成",
  SKIPPED: "已略過"
};

const PRIORITY_LABELS = {
  LOW: "低",
  NORMAL: "一般",
  IMPORTANT: "重要",
  URGENT: "緊急"
};

function getStatusTone(task) {
  if (task.status === "DONE") return "success";
  if (task.status === "SKIPPED") return "neutral";
  if (task.isOverdue) return "danger";
  return "warning";
}

function getPriorityTone(priority) {
  if (priority === "URGENT") return "danger";
  if (priority === "IMPORTANT") return "warning";
  if (priority === "LOW") return "neutral";
  return "info";
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className={`summary-value ${tone ? `summary-value-${tone}` : ""}`}>{value}</div>
    </div>
  );
}

function DailyTasksPage() {
  const [category, setCategory] = useState("ALL");
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, done: 0, skipped: 0, overdue: 0 });
  const [taskDate, setTaskDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);

  async function loadTasks() {
    try {
      setLoading(true);
      setError("");
      const response = await fetchTodayTasks();
      setTasks(response.tasks || []);
      setSummary(response.summary || { total: 0, pending: 0, done: 0, skipped: 0, overdue: 0 });
      setTaskDate(response.taskDate || "");
    } catch (err) {
      setTasks([]);
      setError(err?.message || "今日任務載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function runAction(task, action) {
    try {
      setActionId(task.id);
      if (action === "done") {
        const note = window.prompt("完成備註（可留空）", task.note || "") || "";
        await markTaskDone(task.id, note);
      } else if (action === "skip") {
        const note = window.prompt("略過原因（建議填寫）", task.note || "") || "";
        await skipTask(task.id, note);
      }
      await loadTasks();
    } catch (err) {
      window.alert(err?.message || "任務處理失敗");
    } finally {
      setActionId(null);
    }
  }

  const visibleTasks = useMemo(() => {
    if (category === "ALL") return tasks;
    if (category === "INVENTORY") {
      return tasks.filter((task) => task.category === "INVENTORY" || task.category === "SAFETY");
    }
    return tasks.filter((task) => task.category === category);
  }, [category, tasks]);

  const columns = useMemo(() => [
    {
      key: "title",
      label: "任務",
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          {row.description ? <div className="muted-text">{row.description}</div> : null}
          {row.note ? <div className="muted-text">備註：{row.note}</div> : null}
        </div>
      )
    },
    {
      key: "category",
      label: "分類",
      render: (row) => CATEGORY_LABELS[row.category] || row.category
    },
    {
      key: "dueAt",
      label: "期限",
      render: (row) => row.dueAt || "-"
    },
    {
      key: "priority",
      label: "優先",
      render: (row) => (
        <StatusBadge tone={getPriorityTone(row.priority)}>
          {PRIORITY_LABELS[row.priority] || row.priority}
        </StatusBadge>
      )
    },
    {
      key: "status",
      label: "狀態",
      render: (row) => (
        <StatusBadge tone={getStatusTone(row)}>
          {row.isOverdue && row.status === "PENDING" ? "已逾期" : STATUS_LABELS[row.status] || row.status}
        </StatusBadge>
      )
    },
    {
      key: "completedAt",
      label: "處理時間",
      render: (row) => row.completedAt || row.skippedAt || "-"
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="table-actions">
          {row.status === "PENDING" ? (
            <>
              <button type="button" className="primary-button" onClick={() => runAction(row, "done")} disabled={actionId === row.id}>
                完成
              </button>
              <button type="button" className="secondary-button" onClick={() => runAction(row, "skip")} disabled={actionId === row.id}>
                略過
              </button>
            </>
          ) : (
            <span className="muted-text">已處理</span>
          )}
        </div>
      )
    }
  ], [actionId]);

  return (
    <div className="page-stack">
      <PageHeader
        title="今日任務"
        description="確認每日工作檢查項目，完成時間與處理人會保留給後續 KPI / 評價統計。"
      />

      <section className="summary-grid">
        <SummaryCard label="任務日期" value={taskDate || "-"} />
        <SummaryCard label="未完成" value={summary.pending || 0} tone="warning" />
        <SummaryCard label="已完成" value={summary.done || 0} tone="success" />
        <SummaryCard label="已逾期" value={summary.overdue || 0} tone="danger" />
      </section>

      <section className="content-card section-panel">
        <SectionTabs items={CATEGORY_TABS} value={category} onChange={setCategory} />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? (
          <div className="empty-state">今日任務載入中...</div>
        ) : (
          <DataTable
            rows={visibleTasks}
            columns={columns}
            emptyText="目前沒有今日任務。請至每日任務設定建立基本項目。"
            cardTitle={(row) => row.title}
            cardDescription={(row) => `${CATEGORY_LABELS[row.category] || row.category} / ${row.dueAt || "無期限"}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={getPriorityTone(row.priority)}>{PRIORITY_LABELS[row.priority] || row.priority}</StatusBadge>
                <StatusBadge tone={getStatusTone(row)}>
                  {row.isOverdue && row.status === "PENDING" ? "已逾期" : STATUS_LABELS[row.status] || row.status}
                </StatusBadge>
              </>
            )}
            cardFooter={(row) => columns.find((column) => column.key === "actions").render(row)}
          />
        )}
      </section>
    </div>
  );
}

export default DailyTasksPage;
