import { useEffect, useState } from "react";
import { WRITE_PROCESSING_EVENT } from "../lib/api";
import ProcessingOverlay from "./ProcessingOverlay";

function GlobalProcessingOverlay() {
  const [state, setState] = useState({
    active: false,
    message: "處理中",
    description: "系統正在處理，請勿重複點擊。"
  });

  useEffect(() => {
    function handleProcessingChange(event) {
      const detail = event.detail || {};
      setState({
        active: Boolean(detail.active),
        message: detail.message || "處理中",
        description: detail.description || "系統正在處理，請勿重複點擊。"
      });
    }

    window.addEventListener(WRITE_PROCESSING_EVENT, handleProcessingChange);
    return () => window.removeEventListener(WRITE_PROCESSING_EVENT, handleProcessingChange);
  }, []);

  return (
    <ProcessingOverlay
      active={state.active}
      message={state.message}
      description={state.description}
    />
  );
}

export default GlobalProcessingOverlay;
