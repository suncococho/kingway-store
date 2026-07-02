const express = require("express");
const { authenticate, authorize, requireStoreScope, requireStoreRole } = require("../middleware/auth");
const { getSettingsSnapshot, saveSettingsScope } = require("../services/settingsService");
const {
  getAvailableRepairReservationDates,
  getRepairReservationSettings,
  WEEKDAY_CODES
} = require("../services/repairReservationAvailabilityService");

const router = express.Router();

function normalizeDateArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || "").trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
  )).sort();
}

function normalizeWeekdays(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => WEEKDAY_CODES.includes(item));
  return Array.from(new Set(normalized));
}

function normalizeMaxDaysAhead(value, fallback = 30) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 60);
}

router.use(authenticate, authorize(["ADMIN", "MANAGER"]), requireStoreScope());

router.get("/", async (req, res, next) => {
  try {
    const settings = await getRepairReservationSettings(req.storeId);
    const availability = await getAvailableRepairReservationDates(req.storeId);
    return res.json({ ...settings, availableDates: availability.availableDates });
  } catch (error) {
    return next(error);
  }
});

router.patch("/", requireStoreRole(["owner", "admin", "manager"]), async (req, res, next) => {
  try {
    const snapshot = await getSettingsSnapshot(req.storeId);
    const currentStore = snapshot.store || {};
    const enabledWeekdays = normalizeWeekdays(req.body?.enabledWeekdays, currentStore.repairReservationWeekdays);
    const payload = {
      ...currentStore,
      repairReservationWeekdays: enabledWeekdays.length ? enabledWeekdays : currentStore.repairReservationWeekdays,
      repairReservationDisabledDates: normalizeDateArray(req.body?.disabledDates),
      repairReservationEnabledDates: normalizeDateArray(req.body?.enabledDates),
      repairReservationMaxDaysAhead: normalizeMaxDaysAhead(req.body?.maxDaysAhead, currentStore.repairReservationMaxDaysAhead || 30)
    };

    await saveSettingsScope(req.storeId, "STORE", payload, req.user?.id || null);
    const settings = await getRepairReservationSettings(req.storeId);
    const availability = await getAvailableRepairReservationDates(req.storeId);
    return res.json({ ...settings, availableDates: availability.availableDates });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
