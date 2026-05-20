import { useEffect } from "react";
import { createPortal } from "react-dom";

function MobileQuickActionModal({ open, title, subtitle, actions, onClose, onSelectAction }) {
  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="mobile-quick-action-backdrop" onClick={onClose} role="presentation">
      <div
        className="mobile-quick-action-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-quick-action-title"
        aria-describedby="mobile-quick-action-subtitle"
      >
        <div className="mobile-quick-action-header">
          <div className="mobile-quick-action-copy">
            <h2 id="mobile-quick-action-title">{title}</h2>
            <p id="mobile-quick-action-subtitle">{subtitle}</p>
          </div>
          <button type="button" className="mobile-quick-action-close" onClick={onClose} aria-label="關閉">
            關閉
          </button>
        </div>
        <div className="mobile-quick-action-grid">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`mobile-quick-action-button mobile-quick-action-button-${action.tone || "neutral"}${action.primary ? " mobile-quick-action-button-primary" : ""}`}
              onClick={() => onSelectAction(action)}
            >
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MobileQuickActionModal;
