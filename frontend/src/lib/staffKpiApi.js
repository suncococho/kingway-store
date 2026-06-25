import { apiRequest } from "./api";

function buildParams(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  return params;
}

export function fetchStaffKpiSummary(filters = {}) {
  const query = buildParams(filters).toString();
  return apiRequest(`/staff-kpi/summary${query ? `?${query}` : ""}`);
}

export function fetchStaffKpiEvents(filters = {}) {
  const query = buildParams(filters).toString();
  return apiRequest(`/staff-kpi/events${query ? `?${query}` : ""}`);
}

export function getStaffKpiSummaryExportUrl(filters = {}) {
  const params = buildParams({ ...filters, export: "xlsx" });
  return `/api/staff-kpi/summary?${params.toString()}`;
}

export function getStaffKpiEventsExportUrl(filters = {}) {
  const params = buildParams({ ...filters, export: "xlsx" });
  return `/api/staff-kpi/events?${params.toString()}`;
}
