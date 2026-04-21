import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export function useFetchList(path) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

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

    return () => {
      active = false;
    };
  }, [path, reloadKey]);

  return {
    items,
    loading,
    error,
    refetch: () => setReloadKey((current) => current + 1)
  };
}
