import { clearAuth, getStoredToken } from "./auth";

export const API_BASE_URL = "/api";

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

export async function apiUploadImage(path, file) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": file.name || "product-image"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: file
  });

  const data = await parseJson(response);
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
    }

    throw new Error(data.message || "圖片上傳失敗");
  }

  return data;
}
