import { apiRequest } from "./api";
const json = (method, body) => ({ method, body: JSON.stringify(body) });
const request = async (path, options) => { try { return await apiRequest(path, options); } catch (error) { error.errorCode = error.data?.errorCode; error.details = error.data?.details || error.data; throw error; } };
const array = (value) => Array.isArray(value) ? value : [];
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
  assignShift: (id, body) => apiRequest(`/staff-scheduling/shifts/${id}/assignments`,json("POST",body)),
  workdayCalendar: async (month, signal) => { const data=await request(`/staff-scheduling/me/workday-calendar?month=${encodeURIComponent(month)}`,{signal}); return {...data,days:array(data?.days)}; },
  workdaySummary: (periodId, effectiveDate, signal) => request(`/staff-scheduling/me/workday-summary?periodId=${periodId}&effectiveDate=${effectiveDate}`,{signal}),
  saveWorkdayDraft: (body) => request("/staff-scheduling/me/workday-selection",json("PUT",body)),
  submitWorkdayRequest: (body) => request("/staff-scheduling/me/workday-selection/submit",json("POST",body)),
  removeWorkdayDate: (date, body={}) => request(`/staff-scheduling/me/workday-selection/${date}`,json("DELETE",body)),
  workdayRequests: async () => array(await request("/staff-scheduling/me/workday-requests")),
  adminWorkdayCalendar: async (month, signal) => { const data=await request(`/staff-scheduling/admin/workday-calendar?month=${encodeURIComponent(month)}`,{signal}); return {...data,days:array(data?.days)}; },
  adminWorkdayRequests: async (periodId) => array(await request(`/staff-scheduling/admin/workday-requests?periodId=${periodId||""}`)),
  reviewWorkdayRequest: (id, body) => request(`/staff-scheduling/admin/workday-requests/${id}/review`,json("PATCH",body)),
  bulkReviewWorkdayRequests: (body) => request("/staff-scheduling/admin/workday-requests/bulk-review",json("POST",body)),
  updateDateCapacity: (date, body) => request(`/staff-scheduling/admin/capacity/${date}`,json("PUT",body)),
  scoreTierRules: async () => array(await request("/staff-scheduling/admin/score-tier-rules")),
  saveScoreTierRules: (body) => request("/staff-scheduling/admin/score-tier-rules",json("PUT",body)),
  updateWeeklyLimit: (staffUserId, body) => request(`/staff-scheduling/admin/staff/${staffUserId}/weekly-limit`,json("PUT",body))
};
