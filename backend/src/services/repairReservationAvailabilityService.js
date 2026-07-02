const { createError } = require("../utils/errors");
const { getPublicStoreSettings } = require("./settingsService");

const TAIPEI_OFFSET_HOURS = 8;
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAY_NAMES = {
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday"
};
const WEEKDAY_LABELS = {
  SUN: "星期日",
  MON: "星期一",
  TUE: "星期二",
  WED: "星期三",
  THU: "星期四",
  FRI: "星期五",
  SAT: "星期六"
};
const DEFAULT_ENABLED_WEEKDAYS = ["TUE", "WED", "SUN"];
const DEFAULT_MAX_DAYS_AHEAD = 30;
const MAX_DAYS_AHEAD_LIMIT = 60;

function formatTaipeiDateFromDate(date) {
  const taipei = new Date(date.getTime() + TAIPEI_OFFSET_HOURS * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTaipeiTodayDate() {
  return formatTaipeiDateFromDate(new Date());
}

function parseDateString(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function addDays(dateValue, offset) {
  const date = parseDateString(dateValue);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(offset || 0));
  return formatTaipeiDateFromDate(new Date(date.getTime() - TAIPEI_OFFSET_HOURS * 60 * 60 * 1000));
}

function getWeekdayCode(dateValue) {
  const date = parseDateString(dateValue);
  if (!date) return null;
  return WEEKDAY_CODES[date.getUTCDay()] || null;
}

function normalizeWeekdays(value, fallback = DEFAULT_ENABLED_WEEKDAYS) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => WEEKDAY_CODES.includes(item));
  return normalized.length ? Array.from(new Set(normalized)) : [...DEFAULT_ENABLED_WEEKDAYS];
}

function normalizeDateArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter((item) => parseDateString(item)))).sort();
}

function normalizeMaxDaysAhead(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_DAYS_AHEAD;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_DAYS_AHEAD_LIMIT);
}

async function getRepairReservationSettings(storeId) {
  const store = await getPublicStoreSettings(storeId);
  return {
    timezone: "Asia/Taipei",
    enabledWeekdays: normalizeWeekdays(store.repairReservationWeekdays),
    disabledDates: normalizeDateArray(store.repairReservationDisabledDates),
    enabledDates: normalizeDateArray(store.repairReservationEnabledDates),
    maxDaysAhead: normalizeMaxDaysAhead(store.repairReservationMaxDaysAhead),
    isEnabled: store.repairReservationEnabled !== false
  };
}

function evaluateRepairReservationDate(settings, dateValue, fromDate = getTaipeiTodayDate()) {
  const date = String(dateValue || "").trim();
  const parsed = parseDateString(date);
  const weekday = getWeekdayCode(date);
  const maxDate = addDays(fromDate, Number(settings.maxDaysAhead || DEFAULT_MAX_DAYS_AHEAD) - 1);

  if (!parsed || !weekday) {
    return { date, weekday, weekdayName: null, weekdayLabel: null, available: false, reason: "INVALID_DATE" };
  }

  if (date < fromDate) {
    return { date, weekday, weekdayName: WEEKDAY_NAMES[weekday], weekdayLabel: WEEKDAY_LABELS[weekday], available: false, reason: "PAST_DATE" };
  }

  if (maxDate && date > maxDate) {
    return { date, weekday, weekdayName: WEEKDAY_NAMES[weekday], weekdayLabel: WEEKDAY_LABELS[weekday], available: false, reason: "OUT_OF_RANGE" };
  }

  if (!settings.isEnabled) {
    return { date, weekday, weekdayName: WEEKDAY_NAMES[weekday], weekdayLabel: WEEKDAY_LABELS[weekday], available: false, reason: "DISABLED" };
  }

  if ((settings.disabledDates || []).includes(date)) {
    return { date, weekday, weekdayName: WEEKDAY_NAMES[weekday], weekdayLabel: WEEKDAY_LABELS[weekday], available: false, reason: "DISABLED_DATE" };
  }

  if ((settings.enabledDates || []).includes(date)) {
    return { date, weekday, weekdayName: WEEKDAY_NAMES[weekday], weekdayLabel: WEEKDAY_LABELS[weekday], available: true, reason: null };
  }

  const available = (settings.enabledWeekdays || DEFAULT_ENABLED_WEEKDAYS).includes(weekday);
  return {
    date,
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    weekdayLabel: WEEKDAY_LABELS[weekday],
    available,
    reason: available ? null : "WEEKDAY_DISABLED"
  };
}

async function getAvailableRepairReservationDates(storeId, options = {}) {
  const settings = await getRepairReservationSettings(storeId);
  const fromDate = options.fromDate && parseDateString(options.fromDate) ? String(options.fromDate).trim() : getTaipeiTodayDate();
  const maxDaysAhead = normalizeMaxDaysAhead(options.maxDaysAhead || settings.maxDaysAhead);
  const dates = [];

  for (let index = 0; index < maxDaysAhead; index += 1) {
    const date = addDays(fromDate, index);
    const result = evaluateRepairReservationDate({ ...settings, maxDaysAhead }, date, fromDate);
    if (result.available) {
      dates.push({
        date: result.date,
        weekday: result.weekday,
        weekdayName: result.weekdayName,
        weekdayLabel: result.weekdayLabel,
        available: true
      });
    }
  }

  return {
    timezone: settings.timezone,
    enabledWeekdays: settings.enabledWeekdays,
    disabledDates: settings.disabledDates,
    enabledDates: settings.enabledDates,
    maxDaysAhead,
    availableDates: dates
  };
}

async function assertRepairReservationDateAvailable(storeId, dateValue) {
  const settings = await getRepairReservationSettings(storeId);
  const result = evaluateRepairReservationDate(settings, dateValue);
  if (!result.available) {
    throw createError("此日期無法預約維修，請選擇其他日期。", 400);
  }
  return result;
}

module.exports = {
  DEFAULT_ENABLED_WEEKDAYS,
  DEFAULT_MAX_DAYS_AHEAD,
  WEEKDAY_CODES,
  WEEKDAY_LABELS,
  getTaipeiTodayDate,
  getRepairReservationSettings,
  getAvailableRepairReservationDates,
  assertRepairReservationDateAvailable,
  evaluateRepairReservationDate
};
