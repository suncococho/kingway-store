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

export function fetchCashReports(filters = {}) {
  return apiRequest(`/store-cash-reports${buildQuery(filters)}`);
}

export function fetchTodayCashReport(filters = {}) {
  return apiRequest(`/store-cash-reports/today${buildQuery(filters)}`);
}

export function fetchCashReportSummary(filters = {}) {
  return apiRequest(`/store-cash-reports/summary${buildQuery(filters)}`);
}

export function fetchCashReportReference(filters = {}) {
  return apiRequest(`/store-cash-reports/reference${buildQuery(filters)}`);
}

export function saveCashReport(payload) {
  return apiRequest("/store-cash-reports", {
    method: "POST",
    body: JSON.stringify(payload),
    processingMessage: "儲存現金日報",
    processingDescription: "正在記錄門市現金資料，請勿重複送出。"
  });
}
