import { apiRequest } from "./api";

export function fetchStaffKpiSummary(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return apiRequest(`/staff-kpi/summary${query ? `?${query}` : ""}`);
}

export function fetchStaffKpiEvents(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return apiRequest(`/staff-kpi/events${query ? `?${query}` : ""}`);
}
