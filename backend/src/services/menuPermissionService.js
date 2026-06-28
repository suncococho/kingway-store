const STAFF_ROLES = ["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"];

const MENU_CATALOG = [
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
  { key: "store_replenishment_requests", label: "門市請貨", description: "向本部申請補貨，不需要選擇供應商", preparedOnly: true },
  { key: "store_transfers", label: "門市調撥", preparedOnly: true },
  { key: "inbound_transfers", label: "門市入庫確認", preparedOnly: true }
];

const MENU_KEYS = MENU_CATALOG.map((item) => item.key);

const DEFAULT_ROLE_PERMISSIONS = {
  ADMIN: allPermissions(true),
  MANAGER: {
    ...allPermissions(false),
    dashboard: allow(),
    pos: allow(),
    orders: allow(),
    repairs: allow(),
    customers: allow(),
    products: allow(),
    inventory: allow(),
    suppliers: allow(),
    staff: allow(),
    coupons: allow(),
    line: allow(),
    settings: allow(),
    store_replenishment_requests: allow(),
    store_transfers: allow(),
    inbound_transfers: allow()
  },
  CASHIER: {
    ...allPermissions(false),
    dashboard: allow(),
    pos: allow(),
    orders: allow(),
    customers: allow(),
    coupons: allow()
  },
  REPAIR: {
    ...allPermissions(false),
    dashboard: allow(),
    orders: allow(),
    repairs: allow(),
    customers: allow()
  },
  INVENTORY: {
    ...allPermissions(false),
    dashboard: allow(),
    products: allow(),
    inventory: allow(),
    suppliers: allow(),
    store_replenishment_requests: allow(),
    store_transfers: allow(),
    inbound_transfers: allow()
  }
};

function allow() {
  return { canView: true, canAccess: true };
}

function deny() {
  return { canView: false, canAccess: false };
}

function allPermissions(value) {
  return MENU_KEYS.reduce((map, key) => {
    map[key] = value ? allow() : deny();
    return map;
  }, {});
}

function normalizeStaffRole(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeStoreRole(role) {
  return String(role || "").trim().toLowerCase();
}

function isOwnerStoreRole(storeRole) {
  return normalizeStoreRole(storeRole) === "owner";
}

function isSupportedStaffRole(role) {
  return STAFF_ROLES.includes(normalizeStaffRole(role));
}

function isSupportedMenuKey(menuKey) {
  return MENU_KEYS.includes(String(menuKey || "").trim());
}

function permissionValue(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }
  return Boolean(Number(value));
}

function nullablePermissionValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Boolean(value) ? 1 : 0;
}

function getDefaultRolePermissions(role) {
  const normalizedRole = normalizeStaffRole(role);
  return {
    ...(DEFAULT_ROLE_PERMISSIONS[normalizedRole] || allPermissions(false))
  };
}

function normalizePermissionMap(input = {}) {
  const normalized = {};
  for (const key of MENU_KEYS) {
    const value = input[key] || {};
    normalized[key] = {
      canView: Boolean(value.canView),
      canAccess: Boolean(value.canAccess)
    };
  }
  return normalized;
}

function tableMissing(error) {
  return (
    error?.code === "ER_NO_SUCH_TABLE" &&
    (String(error.message || "").includes("store_role_menu_permissions") ||
      String(error.message || "").includes("store_user_menu_permissions") ||
      String(error.sqlMessage || "").includes("store_role_menu_permissions") ||
      String(error.sqlMessage || "").includes("store_user_menu_permissions"))
  );
}

async function loadRolePermissionRows(connection, storeId, role) {
  const [rows] = await connection.query(
    `
      SELECT menu_key AS menuKey, can_view AS canView, can_access AS canAccess
      FROM store_role_menu_permissions
      WHERE store_id = ?
        AND role = ?
    `,
    [storeId, normalizeStaffRole(role)]
  );
  return rows;
}

async function loadUserOverrideRows(connection, storeId, staffUserId) {
  const [rows] = await connection.query(
    `
      SELECT menu_key AS menuKey, can_view AS canView, can_access AS canAccess
      FROM store_user_menu_permissions
      WHERE store_id = ?
        AND staff_user_id = ?
    `,
    [storeId, staffUserId]
  );
  return rows;
}

function applyRoleRows(base, rows) {
  for (const row of rows) {
    const key = String(row.menuKey || "").trim();
    if (!isSupportedMenuKey(key)) {
      continue;
    }
    base[key] = {
      canView: permissionValue(row.canView),
      canAccess: permissionValue(row.canAccess)
    };
  }
  return base;
}

function applyUserOverrideRows(base, rows) {
  for (const row of rows) {
    const key = String(row.menuKey || "").trim();
    if (!isSupportedMenuKey(key)) {
      continue;
    }
    base[key] = {
      canView: row.canView === null || row.canView === undefined ? base[key].canView : permissionValue(row.canView),
      canAccess: row.canAccess === null || row.canAccess === undefined ? base[key].canAccess : permissionValue(row.canAccess)
    };
  }
  return base;
}

async function resolveMenuPermissions(connection, { storeId, staffUserId, staffRole, storeRole }) {
  const isOwner = isOwnerStoreRole(storeRole);
  if (isOwner) {
    return normalizePermissionMap(allPermissions(true));
  }

  const normalizedRole = normalizeStaffRole(staffRole);
  const permissions = getDefaultRolePermissions(normalizedRole);

  try {
    const roleRows = await loadRolePermissionRows(connection, storeId, normalizedRole);
    applyRoleRows(permissions, roleRows);

    if (staffUserId) {
      const overrideRows = await loadUserOverrideRows(connection, storeId, staffUserId);
      applyUserOverrideRows(permissions, overrideRows);
    }
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
    }
  }

  return normalizePermissionMap(permissions);
}

async function loadRolePermissionsForManagement(connection, storeId) {
  const result = {};
  for (const role of STAFF_ROLES) {
    result[role] = getDefaultRolePermissions(role);
  }

  try {
    const [rows] = await connection.query(
      `
        SELECT role, menu_key AS menuKey, can_view AS canView, can_access AS canAccess
        FROM store_role_menu_permissions
        WHERE store_id = ?
      `,
      [storeId]
    );

    for (const row of rows) {
      const role = normalizeStaffRole(row.role);
      const key = String(row.menuKey || "").trim();
      if (!isSupportedStaffRole(role) || !isSupportedMenuKey(key)) {
        continue;
      }
      result[role][key] = {
        canView: permissionValue(row.canView),
        canAccess: permissionValue(row.canAccess)
      };
    }
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
    }
  }

  return Object.fromEntries(
    Object.entries(result).map(([role, permissions]) => [role, normalizePermissionMap(permissions)])
  );
}

async function loadUserOverridesForManagement(connection, storeId) {
  try {
    const [rows] = await connection.query(
      `
        SELECT staff_user_id AS staffUserId, menu_key AS menuKey, can_view AS canView, can_access AS canAccess
        FROM store_user_menu_permissions
        WHERE store_id = ?
      `,
      [storeId]
    );

    return rows.reduce((map, row) => {
      const key = String(row.menuKey || "").trim();
      if (!isSupportedMenuKey(key)) {
        return map;
      }
      const staffUserId = Number(row.staffUserId);
      if (!map[staffUserId]) {
        map[staffUserId] = {};
      }
      map[staffUserId][key] = {
        canView: row.canView === null || row.canView === undefined ? null : permissionValue(row.canView),
        canAccess: row.canAccess === null || row.canAccess === undefined ? null : permissionValue(row.canAccess)
      };
      return map;
    }, {});
  } catch (error) {
    if (tableMissing(error)) {
      return {};
    }
    throw error;
  }
}

function normalizeRolePermissionPayload(permissions) {
  if (!Array.isArray(permissions)) {
    const error = new Error("請提供權限設定");
    error.statusCode = 400;
    throw error;
  }

  return permissions
    .map((item) => ({
      menuKey: String(item?.menuKey || item?.menu_key || "").trim(),
      canView: Boolean(item?.canView ?? item?.can_view),
      canAccess: Boolean(item?.canAccess ?? item?.can_access)
    }))
    .filter((item) => isSupportedMenuKey(item.menuKey));
}

function normalizeUserPermissionPayload(permissions) {
  if (!Array.isArray(permissions)) {
    const error = new Error("請提供權限設定");
    error.statusCode = 400;
    throw error;
  }

  return permissions
    .map((item) => ({
      menuKey: String(item?.menuKey || item?.menu_key || "").trim(),
      canView: nullablePermissionValue(item?.canView ?? item?.can_view),
      canAccess: nullablePermissionValue(item?.canAccess ?? item?.can_access)
    }))
    .filter((item) => isSupportedMenuKey(item.menuKey));
}

module.exports = {
  STAFF_ROLES,
  MENU_CATALOG,
  MENU_KEYS,
  getDefaultRolePermissions,
  isOwnerStoreRole,
  isSupportedStaffRole,
  isSupportedMenuKey,
  normalizeStaffRole,
  normalizePermissionMap,
  normalizeRolePermissionPayload,
  normalizeUserPermissionPayload,
  resolveMenuPermissions,
  loadRolePermissionsForManagement,
  loadUserOverridesForManagement
};
