const TOKEN_KEY = "kingway_admin_token";
const USER_KEY = "kingway_admin_user";

const STORE_NAME_DISPLAY_BY_STORE_ID = {
  1: "KINGWAY 台南店"
};

function decodeLatin1Mojibake(value) {
  if (typeof value !== "string") {
    return "";
  }

  if ([...value].every((char) => char.codePointAt(0) <= 0xff)) {
    try {
      const bytes = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i += 1) {
        bytes[i] = value.charCodeAt(i) & 0xff;
      }
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded !== value && /[^\x00-\x7f]/.test(decoded)) {
        return decoded;
      }
    } catch (error) {
      // fallback to original
    }
  }

  return value;
}

function normalizeStoreName(rawName, storeId) {
  const candidateName = decodeLatin1Mojibake(rawName).trim();
  if (!candidateName) {
    return "";
  }

  const fallbackName = STORE_NAME_DISPLAY_BY_STORE_ID[storeId] || "";
  if (!fallbackName) {
    return candidateName;
  }

  if (candidateName === "KINGWAY 台南") {
    return fallbackName;
  }

  if (candidateName.includes("台南") || candidateName.includes("臺南")) {
    return candidateName;
  }

  if (candidateName.startsWith("KINGWAY")) {
    return fallbackName;
  }

  return candidateName;
}

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

  const storeId = Number(user.storeId || user.store_id || 0);
  const normalizedStoreName = normalizeStoreName(user.storeName, storeId);
  if (normalizedStoreName) {
    return normalizedStoreName;
  }

  if (storeId === 1 && STORE_NAME_DISPLAY_BY_STORE_ID[storeId]) {
    return STORE_NAME_DISPLAY_BY_STORE_ID[storeId];
  }

  return "KINGWAY 門市";
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
