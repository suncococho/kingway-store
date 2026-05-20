import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export function useFetchList(path, options = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const refreshIntervalMs = Number(options.refreshIntervalMs || 0);

  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await apiRequest(path);
        if (active) {
          setItems(Array.isArray(data) ? data : []);
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    if (refreshIntervalMs > 0) {
      intervalId = window.setInterval(() => {
        load();
      }, refreshIntervalMs);
    }

    return () => {
      active = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [path, reloadKey, refreshIntervalMs]);

  return {
    items,
    loading,
    error,
    refetch: () => setReloadKey((current) => current + 1)
  };
}
