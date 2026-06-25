import { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import PageHelpButton from "../components/PageHelpButton";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import { PAGE_HELP } from "../lib/pageHelpContent";
import {
  createInternalMessage,
  fetchMessageRecipients,
  fetchMessages,
  markMessageRead
} from "../lib/internalMessagesApi";

const TABS = [
  { key: "UNREAD", label: "未讀" },
  { key: "ALL", label: "全部" },
  { key: "READ", label: "已讀" },
  { key: "IMPORTANT", label: "重要" }
];

const PRIORITY_LABELS = {
  NORMAL: "一般",
  IMPORTANT: "重要",
  URGENT: "緊急"
};

function getPriorityTone(priority) {
  if (priority === "URGENT") return "danger";
  if (priority === "IMPORTANT") return "warning";
  return "info";
}

function formatTarget(row) {
  if (row.toAllStores) return "全部門市";
  if (row.toStoreName) return row.toStoreName;
  return "本部";
}

function getSender(row) {
  return row.fromStoreName || row.fromStaffDisplayName || row.fromStaffUsername || "-";
}

function MessagesPage() {
  const [tab, setTab] = useState("UNREAD");
  const [messages, setMessages] = useState([]);
  const [recipients, setRecipients] = useState({ mode: "STORE_TO_HQ", canSendToStores: false, stores: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);
  const [showComposer, setShowComposer] = useState(false);
  const [form, setForm] = useState({
    toAllStores: false,
    toStoreId: "",
    title: "",
    body: "",
    priority: "NORMAL"
  });

  const filters = useMemo(() => {
    if (tab === "UNREAD") return { unread: "1", limit: 80 };
    if (tab === "READ") return { read: "1", limit: 80 };
    if (tab === "IMPORTANT") return { priority: "IMPORTANT", limit: 80 };
    return { limit: 80 };
  }, [tab]);

  async function loadMessages() {
    try {
      setLoading(true);
      setError("");
      const response = await fetchMessages(filters);
      setMessages(response.messages || []);
    } catch (err) {
      setMessages([]);
      setError(err?.message || "訊息載入失敗");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecipients() {
    try {
      const response = await fetchMessageRecipients();
      setRecipients(response || { mode: "STORE_TO_HQ", canSendToStores: false, stores: [] });
    } catch (_error) {
      setRecipients({ mode: "STORE_TO_HQ", canSendToStores: false, stores: [] });
    }
  }

  useEffect(() => {
    loadMessages();
  }, [filters]);

  useEffect(() => {
    loadRecipients();
  }, []);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitMessage(event) {
    event.preventDefault();
    try {
      setActionId("create");
      const payload = {
        title: form.title,
        body: form.body,
        priority: form.priority
      };
      if (recipients.canSendToStores) {
        payload.toAllStores = Boolean(form.toAllStores);
        if (!payload.toAllStores) {
          payload.toStoreId = Number(form.toStoreId || 0);
        }
      }
      await createInternalMessage(payload);
      setForm({ toAllStores: false, toStoreId: "", title: "", body: "", priority: "NORMAL" });
      setShowComposer(false);
      await loadMessages();
      window.alert("訊息已送出。");
    } catch (err) {
      window.alert(err?.message || "訊息發送失敗");
    } finally {
      setActionId(null);
    }
  }

  async function readMessage(row) {
    try {
      setActionId(row.id);
      await markMessageRead(row.id);
      await loadMessages();
    } catch (err) {
      window.alert(err?.message || "讀取處理失敗");
    } finally {
      setActionId(null);
    }
  }

  const columns = [
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
      key: "title",
      label: "訊息",
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          <div className="muted-text">{row.body}</div>
        </div>
      )
    },
    { key: "from", label: "發送者", render: getSender },
    { key: "to", label: "收件", render: formatTarget },
    {
      key: "read",
      label: "狀態",
      render: (row) => (
        <StatusBadge tone={row.isRead ? "success" : "warning"}>
          {row.isRead ? "已讀" : "未讀"}
        </StatusBadge>
      )
    },
    { key: "createdAt", label: "時間" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="table-actions">
          {!row.isRead ? (
            <button type="button" className="primary-button" onClick={() => readMessage(row)} disabled={actionId === row.id}>
              標記已讀
            </button>
          ) : null}
        </div>
      )
    }
  ];

  const recipientDescription = recipients.canSendToStores
    ? "本部可發送給全部門市或指定門市。"
    : recipients.mode === "INDEPENDENT"
      ? "獨立店家可建立店內訊息紀錄。"
      : "門市訊息會送往本部。";

  return (
    <div className="page-stack">
      <PageHeader title="訊息中心" description="本部與門市之間的直接訊息、公告與讀取紀錄。" />
      <PageHelpButton help={PAGE_HELP.messages} />

      <section className="content-card section-panel">
        <div className="section-heading-row">
          <div>
            <h2>訊息列表</h2>
            <p className="muted-text">{recipientDescription}</p>
          </div>
          <button type="button" className="primary-button" onClick={() => setShowComposer((value) => !value)}>
            新增訊息
          </button>
        </div>

        {showComposer ? (
          <form className="stacked-list" onSubmit={submitMessage}>
            <div className="grid-form compact-grid">
              {recipients.canSendToStores ? (
                <>
                  <label className="form-field checkbox-field">
                    <input
                      type="checkbox"
                      checked={form.toAllStores}
                      onChange={(event) => updateForm("toAllStores", event.target.checked)}
                    />
                    <span>發送給全部門市</span>
                  </label>
                  {!form.toAllStores ? (
                    <label className="form-field">
                      <span>收件門市</span>
                      <select value={form.toStoreId} onChange={(event) => updateForm("toStoreId", event.target.value)} required>
                        <option value="">請選擇門市</option>
                        {(recipients.stores || []).map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name} / {store.relationshipType}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">{recipients.mode === "INDEPENDENT" ? "收件：本店內部" : "收件：本部"}</div>
              )}
              <label className="form-field">
                <span>優先</span>
                <select value={form.priority} onChange={(event) => updateForm("priority", event.target.value)}>
                  <option value="NORMAL">一般</option>
                  <option value="IMPORTANT">重要</option>
                  <option value="URGENT">緊急</option>
                </select>
              </label>
              <label className="form-field form-field-wide">
                <span>標題</span>
                <input value={form.title} onChange={(event) => updateForm("title", event.target.value)} required />
              </label>
              <label className="form-field form-field-wide">
                <span>內容</span>
                <textarea rows="4" value={form.body} onChange={(event) => updateForm("body", event.target.value)} required />
              </label>
            </div>
            <div className="action-row">
              <button type="submit" className="primary-button" disabled={actionId === "create"}>
                發送
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowComposer(false)}>
                取消
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="content-card section-panel">
        <SectionTabs items={TABS} value={tab} onChange={setTab} />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? (
          <div className="empty-state">訊息載入中...</div>
        ) : (
          <DataTable
            columns={columns}
            rows={messages}
            emptyText="目前沒有訊息。"
            cardTitle={(row) => row.title}
            cardDescription={(row) => `${getSender(row)} → ${formatTarget(row)}`}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={getPriorityTone(row.priority)}>{PRIORITY_LABELS[row.priority] || row.priority}</StatusBadge>
                <StatusBadge tone={row.isRead ? "success" : "warning"}>{row.isRead ? "已讀" : "未讀"}</StatusBadge>
              </>
            )}
            cardFooter={(row) => columns.find((column) => column.key === "actions").render(row)}
          />
        )}
      </section>
    </div>
  );
}

export default MessagesPage;
