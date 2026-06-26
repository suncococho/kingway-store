import { apiRequest } from "./api";

export function fetchStoreLineNotificationSettings() {
  return apiRequest("/line-notification-settings/store");
}

export function updateStoreLineNotificationSettings(payload) {
  return apiRequest("/line-notification-settings/store", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function fetchSupplierLineNotificationSettings() {
  return apiRequest("/line-notification-settings/suppliers");
}

export function fetchLineGroupCandidates() {
  return apiRequest("/line-notification-settings/group-candidates");
}

export function updateSupplierLineNotificationSettings(supplierId, payload) {
  return apiRequest(`/line-notification-settings/suppliers/${supplierId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function testStoreLineNotification(payload) {
  return apiRequest("/line-notification-settings/test-store", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function testSupplierLineNotification(supplierId, payload) {
  return apiRequest(`/line-notification-settings/test-supplier/${supplierId}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function linkLineGroupCandidateToStore(candidateId, payload) {
  return apiRequest(`/line-notification-settings/group-candidates/${candidateId}/link-store`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function linkLineGroupCandidateToSupplier(candidateId, payload) {
  return apiRequest(`/line-notification-settings/group-candidates/${candidateId}/link-supplier`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function ignoreLineGroupCandidate(candidateId) {
  return apiRequest(`/line-notification-settings/group-candidates/${candidateId}/ignore`, {
    method: "POST"
  });
}
