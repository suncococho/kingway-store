const LINE_GROUP_REGISTRATION_DENIED_MESSAGE = "無權限註冊群組，請由門市管理員操作。";
const LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE = "無權限註冊此類群組，請由門市管理員操作。";

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
  if (normalizedRole === "STAFF" && registrationType === "staff") return true;

  return false;
}

function getLineGroupRegistrationDeniedMessage({ role, isActive, staffStoreId, targetStoreId, registrationType } = {}) {
  if (
    isActiveStaffValue(isActive) &&
    Number(staffStoreId) === Number(targetStoreId) &&
    normalizeRole(role) === "STAFF" &&
    (registrationType === "daily" || registrationType === "admin")
  ) {
    return LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE;
  }

  return LINE_GROUP_REGISTRATION_DENIED_MESSAGE;
}

module.exports = {
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
  canRegisterLineGroup,
  getLineGroupRegistrationDeniedMessage
};
