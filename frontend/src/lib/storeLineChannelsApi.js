import { apiRequest } from "./api";

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchStoreLineChannels(filters = {}) {
  return apiRequest(`/store-line-channels${buildQuery(filters)}`);
}

export function fetchStoreLineChannel(id) {
  return apiRequest(`/store-line-channels/${id}`);
}

export function createStoreLineChannel(payload) {
  return apiRequest("/store-line-channels", {
    method: "POST",
    body: JSON.stringify(payload),
    processingMessage: "儲存 LINE Channel",
    processingDescription: "正在儲存門市 LINE Channel 設定，請勿重複送出。"
  });
}

export function updateStoreLineChannel(id, payload) {
  return apiRequest(`/store-line-channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    processingMessage: "更新 LINE Channel",
    processingDescription: "正在更新門市 LINE Channel 設定，請勿重複送出。"
  });
}

export function dryRunStoreLineChannel(id) {
  return apiRequest(`/store-line-channels/${id}/dry-run-test`, {
    method: "POST",
    processingMessage: "Dry-run 測試",
    processingDescription: "僅驗證設定完整性，不會呼叫 LINE API 或發送訊息。"
  });
}

export function fetchWebhookPreview(params = {}) {
  return apiRequest(`/store-line-channels/webhook-preview${buildQuery(params)}`);
}
