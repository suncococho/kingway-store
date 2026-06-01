import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export const DEFAULT_STORE_FEATURES = {
  sales_dashboard_enabled: true,
  coupons_enabled: true,
  suppliers_enabled: true,
  inventory_enabled: true,
  purchase_confirmations_enabled: true,
  repairs_enabled: true,
  staff_management_enabled: true,
  orders_enabled: true
};

function normalizeFeatures(features) {
  return Object.keys(DEFAULT_STORE_FEATURES).reduce((normalized, key) => {
    normalized[key] =
      features?.[key] === undefined || features?.[key] === null
        ? DEFAULT_STORE_FEATURES[key]
        : Boolean(features[key]);
    return normalized;
  }, {});
}

export function useStoreFeatures() {
  const [features, setFeatures] = useState(DEFAULT_STORE_FEATURES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadFeatures() {
      setLoading(true);
      setError("");

      try {
        const response = await apiRequest("/store-features/me");
        if (active) {
          setFeatures(normalizeFeatures(response.features));
        }
      } catch (requestError) {
        if (active) {
          setFeatures(DEFAULT_STORE_FEATURES);
          setError(requestError.message || "店鋪功能設定讀取失敗");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadFeatures();

    return () => {
      active = false;
    };
  }, []);

  return { features, loading, error };
}
