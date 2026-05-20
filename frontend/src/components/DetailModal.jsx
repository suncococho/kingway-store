import { createPortal } from "react-dom";

function DetailModal({ open, title, subtitle, onClose, children }) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div className="admin-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="muted-text">{subtitle}</p> : null}
          </div>
          <button type="button" className="pos-icon-button" onClick={onClose} aria-label="關閉視窗">
            ×
          </button>
        </div>
        <div className="admin-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export default DetailModal;
