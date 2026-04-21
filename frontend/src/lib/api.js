import { clearAuth, getStoredToken } from "./auth";

export const API_BASE_URL = "http://localhost:3000";

async function parseJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

export async function apiRequest(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const data = await parseJson(response);
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
    }

    throw new Error(data.message || "Request failed");
  }

  return data;
}
