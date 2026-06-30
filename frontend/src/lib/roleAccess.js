const STAFF_MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const COMPANY_MANAGER_ROLES = new Set(["company_owner", "hq_admin", "admin", "owner", "manager"]);

function normalizeStaffRole(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeScopedRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function isManagerOrAboveUser(user = {}) {
  const staffRole = normalizeStaffRole(user?.role || user?.staffRole || user?.staff_role);
  const storeRole = normalizeScopedRole(user?.storeRole || user?.store_role || user?.membershipRole || user?.membership_role);
  const companyRole = normalizeScopedRole(
    user?.companyRole ||
      user?.company_role ||
      user?.companyAccessRole ||
      user?.company_access_role ||
      user?.company?.role
  );

  return STAFF_MANAGER_ROLES.has(staffRole) || STORE_MANAGER_ROLES.has(storeRole) || COMPANY_MANAGER_ROLES.has(companyRole);
}

export function canViewSensitiveCost(user = {}) {
  return isManagerOrAboveUser(user);
}

export function canEditSensitiveCost(user = {}) {
  return canViewSensitiveCost(user);
}

export function canViewSalesManagement(user = {}) {
  return isManagerOrAboveUser(user);
}

export function canEditPaymentCompletionDate(user = {}) {
  return isManagerOrAboveUser(user);
}
