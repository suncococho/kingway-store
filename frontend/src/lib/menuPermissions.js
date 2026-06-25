export const MENU_CATALOG = [
  { key: "dashboard", label: "儀表板" },
  { key: "pos", label: "POS 銷售" },
  { key: "orders", label: "訂單管理" },
  { key: "repairs", label: "維修管理" },
  { key: "customers", label: "客戶管理" },
  { key: "products", label: "商品管理" },
  { key: "inventory", label: "庫存管理" },
  { key: "suppliers", label: "供應商管理" },
  { key: "staff", label: "員工管理" },
  { key: "coupons", label: "優惠券" },
  { key: "line", label: "LINE 管理" },
  { key: "settings", label: "系統設定" },
  { key: "store_transfers", label: "門市調撥", preparedOnly: true },
  { key: "inbound_transfers", label: "門市入庫確認", preparedOnly: true }
];

export const STAFF_ROLES = ["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"];

export const ROLE_LABELS = {
  ADMIN: "管理員",
  MANAGER: "店長",
  CASHIER: "收銀",
  REPAIR: "維修",
  INVENTORY: "庫存"
};

export const PATH_MENU_KEY_MAP = [
  { path: "/dashboard", key: "dashboard" },
  { path: "/notifications", key: "dashboard" },
  { path: "/customer-status", key: "dashboard" },
  { path: "/sales", key: "dashboard" },
  { path: "/pos", key: "pos" },
  { path: "/orders", key: "orders" },
  { path: "/purchase-confirmations", key: "orders" },
  { path: "/repairs", key: "repairs" },
  { path: "/surveys", key: "repairs" },
  { path: "/customers", key: "customers" },
  { path: "/products", key: "products" },
  { path: "/inventory", key: "inventory" },
  { path: "/suppliers", key: "suppliers" },
  { path: "/store-replenishment-requests", key: "inbound_transfers" },
  { path: "/hq-replenishment-requests", key: "store_transfers" },
  { path: "/hq-transfer-report", key: "store_transfers" },
  { path: "/staff", key: "staff" },
  { path: "/staff-attendance", key: "staff" },
  { path: "/attendance", key: "staff" },
  { path: "/kpi", key: "staff" },
  { path: "/payroll", key: "staff" },
  { path: "/coupons", key: "coupons" },
  { path: "/settings/line", key: "line" },
  { path: "/settings/store", key: "settings" },
  { path: "/settings", key: "settings" },
  { path: "/trash", key: "settings" },
  { path: "/store-transfers", key: "store_transfers" },
  { path: "/company-store-settlements", key: "store_transfers" },
  { path: "/inbound-transfers", key: "inbound_transfers" }
];

function allow() {
  return { canView: true, canAccess: true };
}

function deny() {
  return { canView: false, canAccess: false };
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeStoreRole(role) {
  return String(role || "").trim().toLowerCase();
}

function allPermissions(value) {
  return MENU_CATALOG.reduce((map, item) => {
    map[item.key] = value ? allow() : deny();
    return map;
  }, {});
}

export function isOwnerUser(user) {
  return normalizeStoreRole(user?.storeRole || user?.store_role) === "owner";
}

export function getFallbackMenuPermissions(user) {
  if (isOwnerUser(user) || normalizeRole(user?.role) === "ADMIN") {
    return allPermissions(true);
  }

  const map = allPermissions(false);
  const role = normalizeRole(user?.role);
  const enabledByRole = {
    MANAGER: ["dashboard", "pos", "orders", "repairs", "customers", "products", "inventory", "suppliers", "staff", "coupons", "line", "settings", "store_transfers", "inbound_transfers"],
    CASHIER: ["dashboard", "pos", "orders", "customers", "coupons"],
    REPAIR: ["dashboard", "orders", "repairs", "customers"],
    INVENTORY: ["dashboard", "products", "inventory", "suppliers", "store_transfers", "inbound_transfers"]
  };

  for (const key of enabledByRole[role] || ["dashboard"]) {
    map[key] = allow();
  }

  return map;
}

export function normalizeMenuPermissions(rawPermissions, user) {
  const fallback = getFallbackMenuPermissions(user);
  const source = rawPermissions && typeof rawPermissions === "object" ? rawPermissions : {};

  return MENU_CATALOG.reduce((map, item) => {
    const value = source[item.key] || fallback[item.key] || deny();
    map[item.key] = {
      canView: Boolean(value.canView),
      canAccess: Boolean(value.canAccess)
    };
    return map;
  }, {});
}

export function getMenuPermission(permissions, menuKey, user) {
  if (!menuKey) {
    return allow();
  }
  if (isOwnerUser(user)) {
    return allow();
  }

  const normalized = normalizeMenuPermissions(permissions, user);
  return normalized[menuKey] || deny();
}

export function getMenuKeyForPath(pathname) {
  const path = String(pathname || "").split("?")[0];
  const match = PATH_MENU_KEY_MAP
    .slice()
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => path === item.path || path.startsWith(`${item.path}/`));
  return match?.key || null;
}

export function canAccessPath(pathname, permissions, user) {
  const menuKey = getMenuKeyForPath(pathname);
  if (!menuKey) {
    return true;
  }
  return getMenuPermission(permissions, menuKey, user).canAccess;
}
