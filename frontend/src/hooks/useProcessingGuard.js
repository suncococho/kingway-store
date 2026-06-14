import { useCallback, useEffect, useRef, useState } from "react";

function setLocalProcessingActive(delta) {
  if (typeof window === "undefined") {
    return;
  }

  window.__kingwayLocalProcessingCount = Math.max(
    0,
    Number(window.__kingwayLocalProcessingCount || 0) + delta
  );
}

export function useProcessingGuard() {
  const [pendingAction, setPendingAction] = useState(null);
  const lockedActionsRef = useRef(new Set());
  const isProcessing = Boolean(pendingAction);

  useEffect(() => {
    if (!isProcessing) {
      return undefined;
    }

    function warnBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isProcessing]);

  const runWithProcessing = useCallback(
    async (action, pendingMeta = {}) => {
      const actionId = pendingMeta.id || "page";
      if (lockedActionsRef.current.has(actionId)) {
        return undefined;
      }

      lockedActionsRef.current.add(actionId);
      setLocalProcessingActive(1);
      setPendingAction({
        id: actionId,
        label: pendingMeta.label || "處理中",
        description: pendingMeta.description || "系統正在處理，請勿重複點擊。"
      });

      try {
        return await action();
      } finally {
        lockedActionsRef.current.delete(actionId);
        setLocalProcessingActive(-1);
        setPendingAction(null);
      }
    },
    []
  );

  return {
    isProcessing,
    pendingAction,
    runWithProcessing
  };
}
