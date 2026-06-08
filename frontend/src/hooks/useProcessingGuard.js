import { useCallback, useEffect, useState } from "react";

export function useProcessingGuard() {
  const [pendingAction, setPendingAction] = useState(null);
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
      if (isProcessing) {
        return undefined;
      }

      setPendingAction({
        id: pendingMeta.id || "page",
        label: pendingMeta.label || "處理中..."
      });

      try {
        return await action();
      } finally {
        setPendingAction(null);
      }
    },
    [isProcessing]
  );

  return {
    isProcessing,
    pendingAction,
    runWithProcessing
  };
}
