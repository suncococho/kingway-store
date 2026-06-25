import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DataTable from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import SectionTabs from "../components/SectionTabs";
import StatusBadge from "../components/StatusBadge";
import {
  fetchNotifications,
  markNotificationDone,
  markNotificationRead,
  snoozeNotification
} from "../lib/staffNotificationsApi";

const TABS = [
  { key: "PENDING", label: "未處理" },
  { key: "READ", label: "已確認" },
  { key: "DONE", label: "已完成" },
  { key: "ALL", label: "全部紀錄" }
];

const STATUS_LABELS = {
  UNREAD: "未讀",
  READ: "已確認",
  DONE: "已完成",
  DISMISSED: "已忽略",
  SNOOZED: "稍後提醒"
};

const PRIORITY_LABELS = {
  LOW: "低",
  NORMAL: "一般",
  IMPORTANT: "重要",
  URGENT: "緊急"
};

function getStatusTone(status) {
  if (status === "UNREAD" || status === "SNOOZED") return "warning";
  if (status === "DONE") return "success";
  if (status === "DISMISSED") return "neutral";
  return "info";
}

function getPriorityTone(priority) {
  if (priority === "URGENT") return "danger";
  if (priority === "IMPORTANT") return "warning";
  if (priority === "LOW") return "neutral";
  return "info";
}

function NotificationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("PENDING");
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);

  const queryStatus = tab === "ALL" ? "" : tab;

  async function loadNotifications() {
    try {
      setLoading(true);
      setError("");
      const response = await fetchNotifications({
        status: queryStatus,
        limit: 80
      });
      setNotifications(response.notifications || []);
    } catch (err) {
      setNotifications([]);
      setError(err?.message || "通知載入失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotifications();
  }, [queryStatus]);

  async function runAction(notification, action) {
    try {
      setActionId(notification.id);
      if (action === "read") {
        await markNotificationRead(notification.id);
      } else if (action === "done") {
        await markNotificationDone(notification.id);
      } else if (action === "snooze") {
        await snoozeNotification(notification.id, 10);
      } else if (action === "go") {
        await markNotificationRead(notification.id);
        if (notification.targetUrl) {
          navigate(notification.targetUrl);
          return;
        }
      }
      await loadNotifications();
    } catch (err) {
      window.alert(err?.message || "通知處理失敗");
    } finally {
      setActionId(null);
    }
  }

  const columns = useMemo(() => [
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
      label: "通知",
      render: (row) => (
        <div>
          <strong>{row.title}</strong>
          {row.message ? <div className="muted-text">{row.message}</div> : null}
        </div>
      )
    },
    {
      key: "status",
      label: "狀態",
      render: (row) => (
        <StatusBadge tone={getStatusTone(row.status)}>
          {STATUS_LABELS[row.status] || row.status}
        </StatusBadge>
      )
    },
    { key: "type", label: "類型" },
    { key: "createdAt", label: "建立時間" },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="table-actions">
          {row.targetUrl ? (
            <button type="button" className="secondary-button" onClick={() => runAction(row, "go")} disabled={actionId === row.id}>
              前往處理
            </button>
          ) : null}
          {row.status !== "READ" && row.status !== "DONE" ? (
            <button type="button" className="secondary-button" onClick={() => runAction(row, "read")} disabled={actionId === row.id}>
              已確認
            </button>
          ) : null}
          {row.status !== "DONE" ? (
            <button type="button" className="primary-button" onClick={() => runAction(row, "done")} disabled={actionId === row.id}>
              完成
            </button>
          ) : null}
          {row.status === "UNREAD" ? (
            <button type="button" className="ghost-button" onClick={() => runAction(row, "snooze")} disabled={actionId === row.id}>
              稍後提醒
            </button>
          ) : null}
        </div>
      )
    }
  ], [actionId]);

  return (
    <div className="page-stack">
      <PageHeader
        title="通知中心"
        description="集中查看 POS 系統通知、待處理提醒與已完成紀錄。"
      />

      <section className="content-card section-panel">
        <SectionTabs items={TABS} value={tab} onChange={setTab} />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? (
          <div className="empty-state">通知載入中...</div>
        ) : (
          <DataTable
            rows={notifications}
            columns={columns}
            emptyText="目前沒有通知。"
            cardTitle={(row) => row.title}
            cardDescription={(row) => row.message || row.type}
            cardBadges={(row) => (
              <>
                <StatusBadge tone={getPriorityTone(row.priority)}>{PRIORITY_LABELS[row.priority] || row.priority}</StatusBadge>
                <StatusBadge tone={getStatusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</StatusBadge>
              </>
            )}
            cardFooter={(row) => columns.find((column) => column.key === "actions").render(row)}
          />
        )}
      </section>
    </div>
  );
}

export default NotificationsPage;
