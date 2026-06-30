const STAFF_MANAGER_ROLES = new Set(["ADMIN", "MANAGER"]);
const STORE_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const COMPANY_MANAGER_ROLES = new Set(["company_owner", "hq_admin", "admin", "owner", "manager"]);

function normalizeStaffRole(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeScopedRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getUserRole(user = {}) {
  return normalizeStaffRole(user.role || user.staffRole || user.staff_role);
}

function getStoreRole(user = {}) {
  return normalizeScopedRole(user.storeRole || user.store_role || user.membershipRole || user.membership_role);
}

function getCompanyRole(user = {}) {
  return normalizeScopedRole(
    user.companyRole ||
      user.company_role ||
      user.companyAccessRole ||
      user.company_access_role ||
      user.company?.role
  );
}

function canViewSensitiveCost(user = {}) {
  return (
    STAFF_MANAGER_ROLES.has(getUserRole(user)) ||
    STORE_MANAGER_ROLES.has(getStoreRole(user)) ||
    COMPANY_MANAGER_ROLES.has(getCompanyRole(user))
  );
}

function canEditSensitiveCost(user = {}) {
  return canViewSensitiveCost(user);
}

function canViewSalesManagement(user = {}) {
  return canViewSensitiveCost(user);
}

function canEditPaymentCompletionDate(user = {}) {
  return canViewSensitiveCost(user);
}

function requireSensitiveCostAccess(req, res, next) {
  if (!canViewSensitiveCost(req.user || {})) {
    return res.status(403).json({ message: "供應商價格僅限店長以上權限查看或修改" });
  }
  return next();
}

function requireSalesManagementAccess(req, res, next) {
  if (!canViewSalesManagement(req.user || {})) {
    return res.status(403).json({ message: "銷售管理僅限店長以上權限查看" });
  }
  return next();
}

module.exports = {
  canViewSensitiveCost,
  canEditSensitiveCost,
  canViewSalesManagement,
  canEditPaymentCompletionDate,
  requireSensitiveCostAccess,
  requireSalesManagementAccess
};
