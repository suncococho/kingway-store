import { clearAuth, getStoredToken } from "./auth";

export const API_BASE_URL = "/api";
export const WRITE_PROCESSING_EVENT = "kingway:write-processing";

const writeLocks = new Map();
let activeWriteCount = 0;

function isMutatingMethod(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "GET").toUpperCase());
}

function getWriteLockKey(path, method, options) {
  const explicitKey = options.actionKey || options.writeLockKey;
  if (explicitKey) {
    return String(explicitKey);
  }
  const body = typeof options.body === "string" ? options.body : "";
  return `${String(method || "GET").toUpperCase()}:${path}:${body}`;
}

function emitWriteProcessing(active, meta = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(WRITE_PROCESSING_EVENT, {
      detail: {
        active,
        message: meta.message || "處理中",
        description: meta.description || "系統正在處理，請勿重複點擊。"
      }
    })
  );
}

function beginWriteProcessing(meta = {}) {
  if (
    typeof window !== "undefined" &&
    Number(window.__kingwayLocalProcessingCount || 0) > 0 &&
    !meta.forceGlobalProcessing
  ) {
    return () => {};
  }

  activeWriteCount += 1;
  emitWriteProcessing(true, meta);

  return () => {
    activeWriteCount = Math.max(0, activeWriteCount - 1);
    if (activeWriteCount === 0) {
      emitWriteProcessing(false);
    }
  };
}

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
  const method = String(options.method || "GET").toUpperCase();
  const shouldLockWrite = isMutatingMethod(method);
  const lockKey = shouldLockWrite ? getWriteLockKey(path, method, options) : null;

  if (lockKey && writeLocks.has(lockKey)) {
    return writeLocks.get(lockKey);
  }

  const releaseWriteProcessing = shouldLockWrite
    ? beginWriteProcessing({
        message: options.processingMessage || "處理中",
        description: options.processingDescription || "系統正在處理，請勿重複點擊。",
        forceGlobalProcessing: Boolean(options.forceGlobalProcessing)
      })
    : null;

  const requestPromise = executeApiRequest(path, options, method, releaseWriteProcessing);

  if (lockKey) {
    writeLocks.set(lockKey, requestPromise);
    requestPromise.finally(() => {
      if (writeLocks.get(lockKey) === requestPromise) {
        writeLocks.delete(lockKey);
      }
    }).catch(() => {});
  }

  return requestPromise;
}

async function executeApiRequest(path, options = {}, method = "GET", releaseWriteProcessing = null) {
  const token = getStoredToken();
  const {
    actionKey,
    writeLockKey,
    processingMessage,
    processingDescription,
    forceGlobalProcessing,
    ...fetchOptions
  } = options;
  const headers = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      method,
      headers
    });
    const data = await parseJson(response);
    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }

      const error = new Error(data.message || "Request failed");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    if (releaseWriteProcessing) {
      releaseWriteProcessing();
    }
  }
}

export async function apiUploadFile(path, file, extraHeaders = {}) {
  const lockKey = `POST:${path}:${file?.name || "file"}:${file?.size || 0}`;
  if (writeLocks.has(lockKey)) {
    return writeLocks.get(lockKey);
  }

  const releaseWriteProcessing = beginWriteProcessing({
    message: "檔案上傳中",
    description: "照片或影片正在上傳，請勿重複送出。"
  });
  const uploadPromise = executeApiUploadFile(path, file, extraHeaders, releaseWriteProcessing);
  writeLocks.set(lockKey, uploadPromise);
  uploadPromise.finally(() => {
    if (writeLocks.get(lockKey) === uploadPromise) {
      writeLocks.delete(lockKey);
    }
  }).catch(() => {});

  return uploadPromise;
}

async function executeApiUploadFile(path, file, extraHeaders = {}, releaseWriteProcessing) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": file.name || "upload-file",
    ...extraHeaders
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
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

      const error = new Error(data.message || "檔案上傳失敗");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    releaseWriteProcessing();
  }
}

export async function apiUploadImage(path, file) {
  const lockKey = `POST:${path}:${file?.name || "image"}:${file?.size || 0}`;
  if (writeLocks.has(lockKey)) {
    return writeLocks.get(lockKey);
  }

  const releaseWriteProcessing = beginWriteProcessing({
    message: "處理中",
    description: "系統正在處理，請勿重複點擊。"
  });
  const uploadPromise = executeApiUploadImage(path, file, releaseWriteProcessing);
  writeLocks.set(lockKey, uploadPromise);
  uploadPromise.finally(() => {
    if (writeLocks.get(lockKey) === uploadPromise) {
      writeLocks.delete(lockKey);
    }
  }).catch(() => {});

  return uploadPromise;
}

async function executeApiUploadImage(path, file, releaseWriteProcessing) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": file.name || "product-image"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
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

      const error = new Error(data.message || "圖片上傳失敗");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    releaseWriteProcessing();
  }
}

export async function apiOpenFile(path) {
  const token = getStoredToken();
  const popup = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      if (response.status === 401) clearAuth();
      const data = await parseJson(response);
      throw new Error(data.message || "檔案開啟失敗");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (popup) {
      popup.location.href = url;
    } else if (typeof document !== "undefined") {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch (error) {
    popup?.close?.();
    throw error;
  }
}
