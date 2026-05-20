const CASHIER_ALLOWED_ROUTES = ["/pos", "/products", "/repairs", "/inventory", "/suppliers", "/customers"];
const CASHIER_ALLOWED_PERMISSIONS = ["POS", "PRODUCTS", "REPAIRS", "INVENTORY"];

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizePermissions(permissions) {
  return Array.isArray(permissions)
    ? permissions.map((permission) => String(permission || "").trim().toUpperCase()).filter(Boolean)
    : [];
}

function hasCashierLimitedPermissions(user) {
  const permissions = normalizePermissions(user?.permissions);
  return CASHIER_ALLOWED_PERMISSIONS.every((permission) => permissions.includes(permission));
}

export function isStaffLimitedUser(user) {
  const role = normalizeRole(user?.role);

  if (role === "CASHIER") {
    return true;
  }

  return role === "STAFF" && hasCashierLimitedPermissions(user);
}

export function getDefaultRouteForUser(user) {
  return isStaffLimitedUser(user) ? "/pos" : "/dashboard";
}

export function canAccessProtectedRoute(user, pathname) {
  if (!isStaffLimitedUser(user)) {
    return true;
  }

  return CASHIER_ALLOWED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function filterMenuItemsForUser(items, user) {
  if (!isStaffLimitedUser(user)) {
    return items;
  }

  return items.filter((item) => item.to && canAccessProtectedRoute(user, item.to.split("?")[0]));
}
