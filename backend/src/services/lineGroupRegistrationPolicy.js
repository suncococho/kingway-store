const LINE_GROUP_REGISTRATION_DENIED_MESSAGE = "無權限註冊群組，請由門市管理員操作。";
const LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE = "無權限註冊此類群組，請由門市管理員操作。";
const ADMIN_LINE_GROUP_REGISTRATION_TYPES = new Set(["daily", "admin", "repair"]);
const STAFF_LINE_GROUP_REGISTRATION_ROLES = new Set(["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"]);

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function isActiveStaffValue(isActive) {
  return isActive === true || isActive === 1 || isActive === "1";
}

function canRegisterLineGroup({
  role,
  isActive,
  staffStoreId,
  targetStoreId,
  registrationType
}) {
  if (!isActiveStaffValue(isActive)) return false;
  if (!staffStoreId || !targetStoreId || Number(staffStoreId) !== Number(targetStoreId)) return false;

  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "ADMIN") return true;
  if (registrationType === "staff" && STAFF_LINE_GROUP_REGISTRATION_ROLES.has(normalizedRole)) return true;

  return false;
}

function getLineGroupRegistrationDeniedMessage({ role, isActive, staffStoreId, targetStoreId, registrationType } = {}) {
  if (
    isActiveStaffValue(isActive) &&
    Number(staffStoreId) === Number(targetStoreId) &&
    STAFF_LINE_GROUP_REGISTRATION_ROLES.has(normalizeRole(role)) &&
    ADMIN_LINE_GROUP_REGISTRATION_TYPES.has(registrationType)
  ) {
    return LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE;
  }

  return LINE_GROUP_REGISTRATION_DENIED_MESSAGE;
}

module.exports = {
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
  STAFF_LINE_GROUP_REGISTRATION_ROLES,
  canRegisterLineGroup,
  getLineGroupRegistrationDeniedMessage
};
