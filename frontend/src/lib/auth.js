const TOKEN_KEY = "kingway_admin_token";
const USER_KEY = "kingway_admin_user";
const IMPERSONATION_SESSION_KEY = "kingway_staff_impersonation_session";
const IMPERSONATION_BACKUP_TOKEN_KEY = "kingway_admin_token_impersonation_backup";
const IMPERSONATION_BACKUP_USER_KEY = "kingway_admin_user_impersonation_backup";
const IMPERSONATION_TTL_MS = 2 * 60 * 60 * 1000;

const STORE_NAME_DISPLAY_BY_STORE_ID = {
  1: "KINGWAY 台南店"
};

function toNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseJsonValue(rawValue, fallback = null) {
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallback;
  }
}

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

export function getImpersonationSession() {
  const rawSession = localStorage.getItem(IMPERSONATION_SESSION_KEY);
  const session = parseJsonValue(rawSession, null);
  if (!session || typeof session !== "object") {
    return null;
  }

  const expiresAt = toNumber(session.expiresAt);
  return {
    ...session,
    active: Boolean(session.active),
    expiresAt,
    expired: expiresAt !== null ? expiresAt <= Date.now() : false
  };
}

export function startImpersonationSession(staffToken, staffUser, metadata = {}) {
  const now = Date.now();
  const startedAt = toNumber(metadata.startedAt) || now;
  const expiresAt = toNumber(metadata.expiresAt) || (now + IMPERSONATION_TTL_MS);

  const currentToken = getStoredToken();
  const currentUser = getStoredUser();

  if (currentToken) {
    localStorage.setItem(IMPERSONATION_BACKUP_TOKEN_KEY, currentToken);
  } else {
    localStorage.removeItem(IMPERSONATION_BACKUP_TOKEN_KEY);
  }

  if (currentUser) {
    localStorage.setItem(IMPERSONATION_BACKUP_USER_KEY, JSON.stringify(currentUser));
  } else {
    localStorage.removeItem(IMPERSONATION_BACKUP_USER_KEY);
  }

  storeAuth(staffToken, staffUser);
  localStorage.setItem(
    IMPERSONATION_SESSION_KEY,
    JSON.stringify({
      active: true,
      startedAt,
      expiresAt,
      platformAdminId: metadata.platformAdminId || null,
      platformAdminEmail: metadata.platformAdminEmail || "",
      storeId: metadata.storeId,
      targetStaffUserId: metadata.targetStaffUserId,
      targetUsername: metadata.targetUsername || "",
      targetStoreRole: metadata.targetStoreRole || "",
      storeName: metadata.storeName || "",
      reason: metadata.reason || ""
    })
  );

  return getImpersonationSession();
}

export function stopImpersonationSession() {
  const backupToken = localStorage.getItem(IMPERSONATION_BACKUP_TOKEN_KEY);
  const backupUser = parseJsonValue(localStorage.getItem(IMPERSONATION_BACKUP_USER_KEY), null);

  localStorage.removeItem(IMPERSONATION_SESSION_KEY);
  localStorage.removeItem(IMPERSONATION_BACKUP_TOKEN_KEY);
  localStorage.removeItem(IMPERSONATION_BACKUP_USER_KEY);

  if (backupToken) {
    storeAuth(backupToken, backupUser);
    return true;
  }

  clearAuth();
  return false;
}

export function clearImpersonationState() {
  localStorage.removeItem(IMPERSONATION_SESSION_KEY);
  localStorage.removeItem(IMPERSONATION_BACKUP_TOKEN_KEY);
  localStorage.removeItem(IMPERSONATION_BACKUP_USER_KEY);
}
