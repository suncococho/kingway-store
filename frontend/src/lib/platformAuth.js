import { API_BASE_URL } from "./api";

const PLATFORM_TOKEN_KEY = "kingway_platform_admin_token";
const PLATFORM_USER_KEY = "kingway_platform_admin_user";

export function getStoredPlatformToken() {
  return localStorage.getItem(PLATFORM_TOKEN_KEY);
}

export function getStoredPlatformUser() {
  const rawValue = localStorage.getItem(PLATFORM_USER_KEY);
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
}

export function storePlatformAuth(token, user) {
  localStorage.setItem(PLATFORM_TOKEN_KEY, token);
  localStorage.setItem(PLATFORM_USER_KEY, JSON.stringify(user));
}

export function clearPlatformAuth() {
  localStorage.removeItem(PLATFORM_TOKEN_KEY);
  localStorage.removeItem(PLATFORM_USER_KEY);
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

export async function platformRequest(path, options = {}) {
  const token = getStoredPlatformToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers
  });
  const data = await parseJson(response);

  if (!response.ok) {
    if (response.status === 401) {
      clearPlatformAuth();
    }
    throw new Error(data.message || "請重新登入平台管理中心");
  }

  return data;
}

export async function platformLogin(credentials) {
  const response = await fetch(API_BASE_URL + "/platform-auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials)
  });
  const data = await parseJson(response);

  if (!response.ok) {
    throw new Error(data.message || "登入失敗");
  }

  storePlatformAuth(data.token, data.user);
  return data;
}
