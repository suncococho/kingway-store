import { apiRequest } from "./api";

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchVisitRecords(filters = {}) {
  return apiRequest(`/store-visit-records${buildQuery(filters)}`);
}

export function fetchVisitRecord(id) {
  return apiRequest(`/store-visit-records/${id}`);
}

export function fetchVisitRecordSummary(filters = {}) {
  return apiRequest(`/store-visit-records/summary${buildQuery(filters)}`);
}

export function createVisitRecord(payload) {
  return apiRequest("/store-visit-records", {
    method: "POST",
    body: JSON.stringify(payload),
    processingMessage: "儲存來店紀錄",
    processingDescription: "正在記錄來店資料，請勿重複送出。"
  });
}

export function updateVisitRecord(id, payload) {
  return apiRequest(`/store-visit-records/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    processingMessage: "更新來店紀錄",
    processingDescription: "正在更新來店資料，請勿重複送出。"
  });
}
