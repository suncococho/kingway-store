import { apiRequest } from "./api";

export const DEFAULT_LINE_BINDING_STORE_CODE = "KINGWAY_TAINAN";
const CACHE_KEY = "kw_line_binding_cache_v1";

function normalizeText(value) {
  return String(value || "").trim();
}

function parseStoredValue(storage) {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      lineUserId: normalizeText(parsed.lineUserId),
      customerId: Number(parsed.customerId || 0) || null,
      name: normalizeText(parsed.name),
      phone: normalizeText(parsed.phone),
      storeId: Number(parsed.storeId || 0) || null,
      storeCode: normalizeText(parsed.storeCode),
      updatedAt: Number(parsed.updatedAt || 0) || 0
    };
  } catch (error) {
    return null;
  }
}

function persistStoredValue(storage, value) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch (error) {
    // ignore
  }
}

function toCustomerFromCache(cache) {
  if (!cache) {
    return null;
  }

  return {
    id: cache.customerId || null,
    name: cache.name || "",
    phone: cache.phone || "",
    lineUserId: cache.lineUserId,
    storeId: cache.storeId || null
  };
}

export function getLineBindingCache(lineUserId = "") {
  const target = normalizeText(lineUserId);
  const storages = [];

  if (typeof window !== "undefined") {
    if (window.sessionStorage) storages.push(window.sessionStorage);
    if (window.localStorage) storages.push(window.localStorage);
  }

  for (const storage of storages) {
    const cached = parseStoredValue(storage);
    if (!cached?.lineUserId) {
      continue;
    }

    if (target && cached.lineUserId !== target) {
      continue;
    }

    return cached;
  }

  return null;
}

export function saveLineBindingCache({ lineUserId, customer, storeCode }) {
  const normalizedLineUserId = normalizeText(lineUserId || customer?.lineUserId);
  if (!normalizedLineUserId) {
    return;
  }

  const record = {
    lineUserId: normalizedLineUserId,
    customerId: Number(customer?.id || 0) || null,
    name: normalizeText(customer?.name),
    phone: normalizeText(customer?.phone),
    storeId: Number(customer?.storeId || 0) || null,
    storeCode: normalizeText(storeCode || DEFAULT_LINE_BINDING_STORE_CODE),
    updatedAt: Date.now()
  };

  if (!record.phone && !record.name && !record.customerId) {
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  persistStoredValue(window.sessionStorage, record);
  persistStoredValue(window.localStorage, record);
}

export function cacheLineCustomerToObject(cache) {
  return toCustomerFromCache(cache);
}

export async function fetchLineBindingSnapshot({
  lineUserId,
  displayName = "",
  endpoint,
  storeCode = ""
}) {
  const normalizedLineUserId = normalizeText(lineUserId);
  if (!normalizedLineUserId || !endpoint) {
    return null;
  }

  const query = new URLSearchParams();
  query.set("lineUserId", normalizedLineUserId);
  if (displayName) query.set("displayName", normalizeText(displayName));
  if (storeCode) query.set("store", normalizeText(storeCode));

  try {
    const response = await apiRequest(`${endpoint}?${query.toString()}`);
    if (!response || typeof response !== "object") {
      return null;
    }

    return response;
  } catch (error) {
    return null;
  }
}
