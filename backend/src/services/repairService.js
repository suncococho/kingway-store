const dayjs = require("dayjs");
const { createError } = require("../utils/errors");

const ALLOWED_REPAIR_DAYS = ["Tuesday", "Wednesday", "Sunday"];
const BASE_FEE = 400;
const STORAGE_FEE_PER_DAY = 80;

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
  validateRepairReservationDate,
  calculateStorageFee
};
