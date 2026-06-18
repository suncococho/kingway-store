import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { getFallbackMenuPermissions, normalizeMenuPermissions } from "../lib/menuPermissions";

export function useMenuPermissions(user) {
  const [permissions, setPermissions] = useState(() => normalizeMenuPermissions(null, user));
  const [meta, setMeta] = useState({ loading: true, error: "", source: "fallback" });

  useEffect(() => {
    let active = true;

    async function loadPermissions() {
      setMeta({ loading: true, error: "", source: "fallback" });
      try {
        const response = await apiRequest("/permissions/menu");
        if (!active) {
          return;
        }
        setPermissions(normalizeMenuPermissions(response.menus, user));
        setMeta({ loading: false, error: "", source: "api" });
      } catch (error) {
        if (!active) {
          return;
        }
        setPermissions(getFallbackMenuPermissions(user));
        setMeta({ loading: false, error: error.message || "權限設定讀取失敗", source: "fallback" });
      }
    }

    loadPermissions();
    return () => {
      active = false;
    };
  }, [user?.id, user?.role, user?.storeRole, user?.storeId]);

  return { permissions, ...meta };
}
