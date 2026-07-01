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

export function fetchTodayTasks(filters = {}, options = {}) {
  return apiRequest(`/daily-staff-tasks/today${toQuery(filters)}`, options);
}

export function fetchTaskInstances(filters = {}, options = {}) {
  return apiRequest(`/daily-staff-tasks${toQuery(filters)}`, options);
}

export function fetchTaskSettings() {
  return apiRequest("/daily-staff-tasks/settings");
}

export function seedDefaultTasks() {
  return apiRequest("/daily-staff-tasks/settings/seed-defaults", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function createTaskSetting(payload) {
  return apiRequest("/daily-staff-tasks/settings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTaskSetting(id, payload) {
  return apiRequest(`/daily-staff-tasks/settings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function markTaskDone(instanceId, note = "") {
  return apiRequest(`/daily-staff-tasks/${instanceId}/done`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function skipTask(instanceId, note = "") {
  return apiRequest(`/daily-staff-tasks/${instanceId}/skip`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}
