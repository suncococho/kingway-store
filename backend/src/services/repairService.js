const dayjs = require("dayjs");
const { createError } = require("../utils/errors");

const ALLOWED_REPAIR_DAYS = ["Tuesday", "Wednesday", "Sunday"];
const BASE_FEE = 400;
const STORAGE_FEE_PER_DAY = 80;
const TAIPEI_OFFSET = "+08:00";
const REPAIR_RESERVATION_SLOT_EXPIRED_CODE = "REPAIR_RESERVATION_SLOT_EXPIRED";
const REPAIR_RESERVATION_SLOT_EXPIRED_MESSAGE = "選擇的預約時段已經過去，請重新選擇未來時段。";

function createRepairReservationError(message, statusCode = 400, code = null) {
  const error = createError(message, statusCode);
  if (code) {
    error.code = code;
  }
  return error;
}

function formatTaipeiDate(now = new Date()) {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRepairReservationDateValue(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw createRepairReservationError("預約日期格式不正確", 400);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw createRepairReservationError("預約日期格式不正確", 400);
  }

  return normalized;
}

function normalizeRepairReservationTime(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw createRepairReservationError("預約時間格式不正確", 400);
  }

  return `${match[1]}:${match[2]}`;
}

function buildTaipeiReservationDateTime(dateValue, timeValue) {
  const date = normalizeRepairReservationDateValue(dateValue);
  const time = normalizeRepairReservationTime(timeValue);
  const dateTime = new Date(`${date}T${time}:00${TAIPEI_OFFSET}`);
  if (Number.isNaN(dateTime.getTime())) {
    throw createRepairReservationError("預約日期或時間格式不正確", 400);
  }
  return dateTime;
}

function isPastReservationSlot(dateValue, timeValue, now = new Date()) {
  const reservationAt = buildTaipeiReservationDateTime(dateValue, timeValue);
  return reservationAt.getTime() < now.getTime();
}

function assertFutureRepairReservationSlot(dateValue, timeValue, now = new Date()) {
  if (isPastReservationSlot(dateValue, timeValue, now)) {
    throw createRepairReservationError(
      REPAIR_RESERVATION_SLOT_EXPIRED_MESSAGE,
      400,
      REPAIR_RESERVATION_SLOT_EXPIRED_CODE
    );
  }
}

function validateRepairReservationDate(dateValue) {
  const date = dayjs(dateValue);
  if (!date.isValid()) {
    throw createError("預約日期格式不正確", 400);
  }

  const reservationDay = date.format("dddd");
  if (!ALLOWED_REPAIR_DAYS.includes(reservationDay)) {
    throw createError("維修預約僅開放星期二、星期三與星期日", 400);
  }

  return reservationDay;
}

function calculateStorageFee(completedAt, pickedUpAt) {
  if (!completedAt) {
    return 0;
  }

  const completed = dayjs(completedAt);
  const end = pickedUpAt ? dayjs(pickedUpAt) : dayjs();
  const days = end.diff(completed, "day");
  if (days <= 3) {
    return 0;
  }

  return (days - 3) * STORAGE_FEE_PER_DAY;
}

module.exports = {
  ALLOWED_REPAIR_DAYS,
  BASE_FEE,
  STORAGE_FEE_PER_DAY,
  REPAIR_RESERVATION_SLOT_EXPIRED_CODE,
  REPAIR_RESERVATION_SLOT_EXPIRED_MESSAGE,
  formatTaipeiDate,
  normalizeRepairReservationDateValue,
  normalizeRepairReservationTime,
  buildTaipeiReservationDateTime,
  isPastReservationSlot,
  assertFutureRepairReservationSlot,
  validateRepairReservationDate,
  calculateStorageFee
};
