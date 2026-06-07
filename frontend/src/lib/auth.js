const TOKEN_KEY = "kingway_admin_token";
const USER_KEY = "kingway_admin_user";

const STORE_NAME_DISPLAY_BY_STORE_ID = {
  1: "KINGWAY 台南店"
};

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const rawValue = localStorage.getItem(USER_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
}

export function storeAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredStoreName() {
  const user = getStoredUser();
  if (!user) {
    return "KINGWAY 門市";
  }

  const rawName = user.storeName;
  if (typeof rawName === "string") {
    const trimmedName = rawName.trim();
    if (trimmedName) {
      if (trimmedName === "KINGWAY 台南") {
        return "KINGWAY 台南店";
      }
      return trimmedName;
    }
  }

  const storeId = Number(user.storeId || user.store_id || 0);
  if (storeId === 1 && STORE_NAME_DISPLAY_BY_STORE_ID[storeId]) {
    return STORE_NAME_DISPLAY_BY_STORE_ID[storeId];
  }

  return "KINGWAY 門市";
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
