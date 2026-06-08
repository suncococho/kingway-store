function ProcessingOverlay({
  active,
  message = "處理中，請稍候...",
  description = "請勿關閉頁面或重複點擊"
}) {
  if (!active) {
    return null;
  }

  return (
    <div className="processing-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div className="processing-overlay-card">
        <div className="processing-spinner" aria-hidden="true" />
        <div>
          <div className="processing-overlay-title">{message}</div>
          <div className="processing-overlay-text">{description}</div>
        </div>
      </div>
    </div>
  );
}

export default ProcessingOverlay;
