import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import {
  fetchPendingNotifications,
  markNotificationDone,
  markNotificationRead,
  snoozeNotification
} from "../lib/staffNotificationsApi";

const SUPPRESS_KEY = "kingway_staff_notification_popup_suppress";
const SUPPRESS_MS = 5 * 60 * 1000;

const PRIORITY_LABELS = {
  LOW: "一般",
  NORMAL: "通知",
  IMPORTANT: "重要",
  URGENT: "緊急"
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

function suppressNotification(id) {
  const suppressed = getSuppressedIds();
  suppressed[String(id)] = Date.now() + SUPPRESS_MS;
  sessionStorage.setItem(SUPPRESS_KEY, JSON.stringify(suppressed));
}

function StaffNotificationPopup() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [activeNotification, setActiveNotification] = useState(null);
  const [busy, setBusy] = useState(false);

  const visibleNotification = useMemo(() => {
    if (activeNotification) return activeNotification;
    const suppressed = getSuppressedIds();
    return notifications.find((notification) => !suppressed[String(notification.id)]) || null;
  }, [activeNotification, notifications]);

  async function loadPending() {
    try {
      const response = await fetchPendingNotifications();
      setNotifications(response.notifications || []);
      setActiveNotification(null);
    } catch (_error) {
      setNotifications([]);
      setActiveNotification(null);
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
    if (visibleNotification && !activeNotification) {
      setActiveNotification(visibleNotification);
    }
  }, [activeNotification, visibleNotification]);

  if (!activeNotification) {
    return null;
  }

  async function completeAction(action) {
    if (busy) return;
    try {
      setBusy(true);
      if (action === "read") {
        await markNotificationRead(activeNotification.id);
      } else if (action === "done") {
        await markNotificationDone(activeNotification.id);
      } else if (action === "snooze") {
        await snoozeNotification(activeNotification.id, 10);
      } else if (action === "go") {
        await markNotificationRead(activeNotification.id);
        if (activeNotification.targetUrl) {
          navigate(activeNotification.targetUrl);
        }
      }
      suppressNotification(activeNotification.id);
      setActiveNotification(null);
      await loadPending();
    } catch (error) {
      window.alert(error?.message || "通知處理失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className="content-card section-panel" role="dialog" aria-modal="true" aria-labelledby="staff-notification-title" style={{ maxWidth: 560, width: "min(560px, calc(100vw - 32px))" }}>
        <div className="section-heading-row">
          <div>
            <StatusBadge tone={getPriorityTone(activeNotification.priority)}>
              {PRIORITY_LABELS[activeNotification.priority] || activeNotification.priority}
            </StatusBadge>
            <h2 id="staff-notification-title" style={{ marginTop: 12 }}>新的系統通知</h2>
          </div>
        </div>
        <div className="stacked-list">
          <article className="notice-card">
            <h3>{activeNotification.title}</h3>
            {activeNotification.message ? <p>{activeNotification.message}</p> : null}
            <div className="muted-text">{activeNotification.createdAt ? `建立時間：${activeNotification.createdAt}` : null}</div>
          </article>
        </div>
        <div className="action-row">
          {activeNotification.targetUrl ? (
            <button type="button" className="primary-button" onClick={() => completeAction("go")} disabled={busy}>
              前往處理
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => completeAction("read")} disabled={busy}>
            已確認
          </button>
          <button type="button" className="secondary-button" onClick={() => completeAction("done")} disabled={busy}>
            完成
          </button>
          <button type="button" className="ghost-button" onClick={() => completeAction("snooze")} disabled={busy}>
            稍後提醒
          </button>
        </div>
      </section>
    </div>
  );
}

export default StaffNotificationPopup;
