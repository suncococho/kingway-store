import DetailModal from "./DetailModal";

function ActionModal({ open, tone = "info", title, message, confirmText = "知道了", cancelText, onConfirm, onCancel, children }) {
  function handleConfirm() {
    if (onConfirm) {
      onConfirm();
    }
  }

  return (
    <DetailModal open={open} title={title} onClose={onCancel || handleConfirm}>
      <div className={`action-modal action-modal-${tone}`}>
        {message ? <p>{message}</p> : null}
        {children}
        <div className="action-row action-modal-actions">
          {cancelText ? (
            <button type="button" className="secondary-button" onClick={onCancel}>
              {cancelText}
            </button>
          ) : null}
          <button type="button" className="primary-button inline-submit" onClick={handleConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </DetailModal>
  );
}

export default ActionModal;
