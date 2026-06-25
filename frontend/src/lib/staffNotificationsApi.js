import { apiRequest } from "./api";

export function fetchPendingNotifications() {
  return apiRequest("/staff-notifications/pending");
}

export function fetchNotifications(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest(`/staff-notifications${suffix}`);
}

export function fetchUnreadSummary() {
  return apiRequest("/staff-dashboard/unread-summary");
}

export function markNotificationRead(id) {
  return apiRequest(`/staff-notifications/${id}/read`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function markNotificationDone(id) {
  return apiRequest(`/staff-notifications/${id}/done`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function dismissNotification(id) {
  return apiRequest(`/staff-notifications/${id}/dismiss`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function snoozeNotification(id, minutes = 10) {
  return apiRequest(`/staff-notifications/${id}/snooze`, {
    method: "POST",
    body: JSON.stringify({ minutes })
  });
}
