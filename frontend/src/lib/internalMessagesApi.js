import { apiRequest } from "./api";

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const suffix = params.toString();
  return suffix ? `?${suffix}` : "";
}

export function fetchMessages(filters = {}) {
  return apiRequest(`/internal-messages${toQuery(filters)}`);
}

export function fetchPendingMessages() {
  return apiRequest("/internal-messages/pending");
}

export function fetchMessageUnreadCount() {
  return apiRequest("/internal-messages/unread-count");
}

export function fetchMessageRecipients() {
  return apiRequest("/internal-messages/recipients");
}

export function createInternalMessage(payload) {
  return apiRequest("/internal-messages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function markMessageRead(id) {
  return apiRequest(`/internal-messages/${id}/read`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function archiveMessage(id) {
  return apiRequest(`/internal-messages/${id}/archive`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
