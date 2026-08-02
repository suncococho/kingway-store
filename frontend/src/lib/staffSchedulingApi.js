import { apiRequest } from "./api";
const json = (method, body) => ({ method, body: JSON.stringify(body) });
export const schedulingApi = {
  profiles: () => apiRequest("/staff-scheduling/employment-profiles"),
  saveProfile: (id, body) => apiRequest(`/staff-scheduling/employment-profiles/${id}`, json("PUT", body)),
  periods: () => apiRequest("/staff-scheduling/periods"),
  createPeriod: (body) => apiRequest("/staff-scheduling/periods", json("POST", body)),
  calendar: (from, to) => apiRequest(`/staff-scheduling/calendar?from=${from}&to=${to}`),
  seedCalendar: (periodId) => apiRequest(`/staff-scheduling/periods/${periodId}/calendar/defaults`, json("POST", {})),
  availability: (periodId) => apiRequest(`/staff-scheduling/me/availability?periodId=${periodId}`),
  saveAvailability: (periodId, body, submit=false) => apiRequest(`/staff-scheduling/me/availability/${periodId}${submit?"/submit":""}`, json(submit?"POST":"PUT",body)),
  timeOff: () => apiRequest("/staff-scheduling/time-off"),
  createTimeOff: (body) => apiRequest("/staff-scheduling/me/time-off", json("POST",body)),
  reviewTimeOff: (id, body) => apiRequest(`/staff-scheduling/time-off/${id}/review`,json("PATCH",body)),
  createRevision: (periodId, body) => apiRequest(`/staff-scheduling/periods/${periodId}/revisions`,json("POST",body)),
  draft: (id) => apiRequest(`/staff-scheduling/revisions/${id}`),
  createShift: (id, body) => apiRequest(`/staff-scheduling/revisions/${id}/shifts`,json("POST",body)),
  assignShift: (id, body) => apiRequest(`/staff-scheduling/shifts/${id}/assignments`,json("POST",body))
};
