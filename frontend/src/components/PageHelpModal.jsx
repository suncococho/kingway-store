function PageHelpModal({ help, onClose }) {
  if (!help) return null;

  const steps = Array.isArray(help.steps) ? help.steps : [];
  const warnings = Array.isArray(help.warnings) ? help.warnings : [];

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <section className="admin-modal page-help-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={help.title}>
        <div className="admin-modal-header">
          <div>
            <h2>{help.title}</h2>
            {help.description ? <p className="muted-text">{help.description}</p> : null}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>關閉</button>
        </div>
        <div className="admin-modal-body">
          {steps.length ? (
            <section className="page-help-section">
              <h3>操作步驟</h3>
              <ol>
                {steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </section>
          ) : null}
          {warnings.length ? (
            <section className="page-help-section page-help-warning">
              <h3>注意事項</h3>
              <ul>
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="admin-modal-footer">
          <button type="button" className="primary-button" onClick={onClose}>我知道了</button>
        </div>
      </section>
    </div>
  );
}

export default PageHelpModal;
