import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import StatusBadge from "../components/StatusBadge";
import {
  createTaskSetting,
  fetchTaskSettings,
  seedDefaultTasks,
  updateTaskSetting
} from "../lib/dailyStaffTasksApi";
import { PAGE_HELP } from "../lib/pageHelpContent";

const CATEGORY_OPTIONS = ["OPENING", "MIDDAY", "CLOSING", "CUSTOMER", "INVENTORY", "SAFETY", "GENERAL"];
const PRIORITY_OPTIONS = ["LOW", "NORMAL", "IMPORTANT", "URGENT"];

const CATEGORY_LABELS = {
  OPENING: "開店檢查",
  MIDDAY: "中段檢查",
  CLOSING: "關店檢查",
  CUSTOMER: "客戶/維修",
  INVENTORY: "庫存",
  SAFETY: "安全",
  GENERAL: "一般"
};

function getPriorityTone(priority) {
  if (priority === "URGENT") return "danger";
  if (priority === "IMPORTANT") return "warning";
  if (priority === "LOW") return "neutral";
  return "info";
}

function DailyTaskSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "GENERAL",
    dueTime: "",
    priority: "NORMAL"
  });

  async function loadSettings() {
    try {
      setLoading(true);
      setError("");
      const response = await fetchTaskSettings();
      setSettings(response.settings || []);
      setCanManageSettings(Boolean(response.canManageSettings));
    } catch (err) {
      setSettings([]);
      setError(err?.message || "每日任務設定載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSeedDefaults() {
    try {
      setActionId("seed");
      const response = await seedDefaultTasks();
      window.alert(`已建立 ${response.inserted || 0} 筆預設任務`);
      await loadSettings();
    } catch (err) {
      window.alert(err?.message || "預設任務建立失敗");
    } finally {
      setActionId(null);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    try {
      setActionId("create");
      await createTaskSetting(form);
      setForm({ title: "", description: "", category: "GENERAL", dueTime: "", priority: "NORMAL" });
      await loadSettings();
    } catch (err) {
      window.alert(err?.message || "任務建立失敗");
    } finally {
      setActionId(null);
    }
  }

  async function toggleEnabled(row) {
    try {
      setActionId(row.id);
      await updateTaskSetting(row.id, { enabled: !row.enabled });
      await loadSettings();
    } catch (err) {
      window.alert(err?.message || "任務更新失敗");
    } finally {
      setActionId(null);
    }
  }

  const columns = useMemo(() => [
    {
      key: "title",
      label: "任務",
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          {row.description ? <div className="muted-text">{row.description}</div> : null}
        </div>
      )
    },
    {
      key: "category",
      label: "分類",
      render: (row) => CATEGORY_LABELS[row.category] || row.category
    },
    { key: "dueTime", label: "期限時間", render: (row) => row.dueTime || "-" },
    {
      key: "priority",
      label: "優先",
      render: (row) => <StatusBadge tone={getPriorityTone(row.priority)}>{row.priority}</StatusBadge>
    },
    {
      key: "enabled",
      label: "狀態",
      render: (row) => <StatusBadge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "啟用" : "停用"}</StatusBadge>
    },
    {
      key: "scope",
      label: "範圍",
      render: (row) => row.storeId ? `門市 #${row.storeId}` : row.companyId ? `公司 #${row.companyId}` : row.storeType || "全域"
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <button type="button" className="secondary-button" onClick={() => toggleEnabled(row)} disabled={!canManageSettings || actionId === row.id}>
          {row.enabled ? "停用" : "啟用"}
        </button>
      )
    }
  ], [actionId, canManageSettings]);

  return (
    <div className="page-stack">
      <PageHeader
        title="每日任務設定"
        description="設定每日工作檢查項目、期限與優先級。今日任務會記錄完成人與完成時間。"
      />
      <PageHelpButton help={PAGE_HELP.dailyTaskSettings} />

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>預設任務</h2>
            <p className="muted-text">會建立開店、中段與關店檢查項目；重複項目不會再次建立。</p>
          </div>
          <button type="button" className="primary-button" onClick={handleSeedDefaults} disabled={!canManageSettings || actionId === "seed"}>
            建立預設任務
          </button>
        </div>
      </section>

      {canManageSettings ? (
        <section className="content-card section-panel">
          <div className="section-heading-row">
            <h2>新增任務</h2>
          </div>
          <form className="form-grid" onSubmit={handleCreate}>
            <label>
              任務名稱
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required />
            </label>
            <label>
              分類
              <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>{CATEGORY_LABELS[category] || category}</option>
                ))}
              </select>
            </label>
            <label>
              期限時間
              <input type="time" value={form.dueTime} onChange={(event) => setForm((current) => ({ ...current, dueTime: event.target.value }))} />
            </label>
            <label>
              優先級
              <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <label className="form-grid-full">
              說明
              <textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <div className="form-actions form-grid-full">
              <button type="submit" className="primary-button" disabled={actionId === "create"}>
                新增每日任務
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="content-card section-panel">
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? (
          <div className="empty-state">每日任務設定載入中...</div>
        ) : (
          <DataTable
            rows={settings}
            columns={columns}
            emptyText="目前沒有每日任務設定。"
            cardTitle={(row) => row.title}
            cardDescription={(row) => `${CATEGORY_LABELS[row.category] || row.category} / ${row.dueTime || "無期限"}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={getPriorityTone(row.priority)}>{row.priority}</StatusBadge>
                <StatusBadge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "啟用" : "停用"}</StatusBadge>
              </>
            )}
            cardFooter={(row) => columns.find((column) => column.key === "actions").render(row)}
          />
        )}
      </section>
    </div>
  );
}

export default DailyTaskSettingsPage;
