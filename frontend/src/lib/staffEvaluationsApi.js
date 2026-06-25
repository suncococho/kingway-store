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

export function fetchEvaluationNotes(filters = {}) {
  return apiRequest(`/staff-evaluations/notes${buildQuery(filters)}`);
}

export function createEvaluationNote(payload = {}) {
  return apiRequest("/staff-evaluations/notes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
