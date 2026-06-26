import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import {
  fetchPendingNotifications,
  markNotificationDone,
  markNotificationRead,
  snoozeNotification
} from "../lib/staffNotificationsApi";
import {
  fetchPendingMessages,
  markMessageRead
} from "../lib/internalMessagesApi";

const SUPPRESS_KEY = "kingway_staff_notification_popup_suppress";
const ACTION_SUPPRESS_MS = 5 * 60 * 1000;
const CLOSE_SUPPRESS_MS = 30 * 60 * 1000;

const PRIORITY_LABELS = {
  LOW: "一般",
  NORMAL: "通知",
  IMPORTANT: "重要",
  URGENT: "緊急"
};

const PRIORITY_RANK = {
  URGENT: 6,
  IMPORTANT: 4,
  NORMAL: 2,
  LOW: 1
};

function getPriorityTone(priority) {
  if (priority === "URGENT") return "danger";
  if (priority === "IMPORTANT") return "warning";
  if (priority === "LOW") return "neutral";
  return "info";
}

function getSuppressedIds() {
  try {
    const raw = sessionStorage.getItem(SUPPRESS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, expiresAt]) => Number(expiresAt || 0) > now)
    );
  } catch (_error) {
    return {};
  }
}

function getSuppressId(item) {
  return `${item.kind}:${item.id}`;
}

function suppressNotification(item, durationMs = ACTION_SUPPRESS_MS) {
  const suppressed = getSuppressedIds();
  suppressed[getSuppressId(item)] = Date.now() + durationMs;
  sessionStorage.setItem(SUPPRESS_KEY, JSON.stringify(suppressed));
}

function normalizeNotificationItem(notification) {
  return {
    kind: "NOTIFICATION",
    id: notification.id,
    priority: notification.priority,
    title: notification.title,
    message: notification.message,
    targetUrl: notification.targetUrl,
    createdAt: notification.createdAt,
    sortRank: (PRIORITY_RANK[notification.priority] || 0) + 0.2,
    raw: notification
  };
}

function normalizeMessageItem(message) {
  return {
    kind: "MESSAGE",
    id: message.id,
    priority: message.priority,
    title: message.title,
    message: message.body || "本部或門市傳來新的訊息，請確認。",
    targetUrl: `/messages?messageId=${message.id}`,
    createdAt: message.createdAt,
    sortRank: PRIORITY_RANK[message.priority] || 0,
    raw: message
  };
}

function StaffNotificationPopup() {
  const navigate = useNavigate();
  const [pendingItems, setPendingItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [busy, setBusy] = useState(false);

  const visibleItem = useMemo(() => {
    if (activeItem) return activeItem;
    const suppressed = getSuppressedIds();
    return pendingItems.find((item) => !suppressed[getSuppressId(item)]) || null;
  }, [activeItem, pendingItems]);

  async function loadPending() {
    try {
      const [notificationResponse, messageResponse] = await Promise.all([
        fetchPendingNotifications(),
        fetchPendingMessages()
      ]);
      const items = [
        ...(notificationResponse.notifications || []).map(normalizeNotificationItem),
        ...(messageResponse.messages || []).map(normalizeMessageItem)
      ].sort((a, b) => {
        if (b.sortRank !== a.sortRank) return b.sortRank - a.sortRank;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });
      setPendingItems(items);
      setActiveItem(null);
    } catch (_error) {
      setPendingItems([]);
      setActiveItem(null);
    }
  }

  useEffect(() => {
    let active = true;
    async function poll() {
      if (active) {
        await loadPending();
      }
    }
    poll();
    const timer = window.setInterval(poll, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (visibleItem && !activeItem) {
      setActiveItem(visibleItem);
    }
  }, [activeItem, visibleItem]);

  if (!activeItem) {
    return null;
  }

  const isDailyTaskNotification = activeItem.kind === "NOTIFICATION"
    && String(activeItem.raw?.type || "").startsWith("DAILY_TASK_");

  function closeOnly() {
    if (busy || !activeItem) return;
    suppressNotification(activeItem, CLOSE_SUPPRESS_MS);
    setActiveItem(null);
  }

  async function completeAction(action) {
    if (busy) return;
    try {
      setBusy(true);
      if (activeItem.kind === "MESSAGE") {
        if (action === "read" || action === "go") {
          await markMessageRead(activeItem.id);
        }
        if (action === "go") {
          navigate(activeItem.targetUrl || "/messages");
        }
      } else if (action === "read") {
        await markNotificationRead(activeItem.id);
      } else if (action === "done") {
        await markNotificationDone(activeItem.id);
      } else if (action === "snooze") {
        await snoozeNotification(activeItem.id, 10);
      } else if (action === "go") {
        await markNotificationRead(activeItem.id);
        if (activeItem.targetUrl) {
          navigate(activeItem.targetUrl);
        }
      }
      suppressNotification(activeItem);
      setActiveItem(null);
      await loadPending();
    } catch (error) {
      window.alert(error?.message || "訊息處理失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className="content-card section-panel staff-popup-panel" role="dialog" aria-modal="true" aria-labelledby="staff-notification-title">
        <button
          type="button"
          className="staff-popup-close"
          onClick={closeOnly}
          disabled={busy}
          aria-label="關閉提醒"
          title="只關閉此提醒，不會標記完成。"
        >
          ×
        </button>
        <div className="section-heading-row">
          <div>
            <StatusBadge tone={getPriorityTone(activeItem.priority)}>
              {PRIORITY_LABELS[activeItem.priority] || activeItem.priority}
            </StatusBadge>
            <h2 id="staff-notification-title" style={{ marginTop: 12 }}>
              {activeItem.kind === "MESSAGE" ? "新的訊息" : "新的系統通知"}
            </h2>
          </div>
        </div>
        <div className="stacked-list">
          <article className="notice-card">
            <h3>{activeItem.title}</h3>
            {activeItem.message ? <p>{activeItem.message}</p> : null}
            <div className="muted-text">{activeItem.createdAt ? `建立時間：${activeItem.createdAt}` : null}</div>
          </article>
        </div>
        <div className="action-row">
          <div className="staff-popup-action-note">只關閉此提醒，不會標記完成。</div>
          {activeItem.targetUrl ? (
            <button type="button" className="primary-button" onClick={() => completeAction("go")} disabled={busy}>
              {activeItem.kind === "MESSAGE" ? "查看訊息" : "前往處理"}
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => completeAction("read")} disabled={busy}>
            {activeItem.kind === "MESSAGE" ? "標記已讀" : "已確認"}
          </button>
          {activeItem.kind === "NOTIFICATION" && !isDailyTaskNotification ? (
            <button type="button" className="secondary-button" onClick={() => completeAction("done")} disabled={busy}>
              完成
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={() => completeAction("snooze")} disabled={busy}>
            稍後提醒
          </button>
          <button type="button" className="ghost-button" onClick={closeOnly} disabled={busy} title="只關閉此提醒，不會標記完成。">
            關閉
          </button>
        </div>
      </section>
    </div>
  );
}

export default StaffNotificationPopup;
