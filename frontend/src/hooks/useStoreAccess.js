import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

const DEFAULT_ACCESS = {
  effectiveStatus: "ACTIVE",
  enabledFeatures: [],
  lockedFeatures: [],
  warningMessage: null
};

export function useStoreAccess(user = null) {
  const [access, setAccess] = useState(DEFAULT_ACCESS);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setAccess(DEFAULT_ACCESS);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError("");

    apiRequest("/store-access/me")
      .then((response) => {
        if (!active) return;
        setAccess(response?.access || DEFAULT_ACCESS);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message || "讀取方案權限失敗");
        setAccess(DEFAULT_ACCESS);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.storeId]);

  return { access, loading, error };
}
