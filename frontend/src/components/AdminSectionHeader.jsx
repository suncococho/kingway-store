function AdminSectionHeader({ eyebrow, title, description, badges = null, actions = null }) {
  return (
    <div className="admin-section-header">
      <div className="admin-section-heading">
        {eyebrow ? <div className="admin-section-eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
        {description ? <p className="muted-text">{description}</p> : null}
      </div>
      {badges || actions ? (
        <div className="admin-section-meta">
          {badges ? <div className="admin-section-badges">{badges}</div> : null}
          {actions ? <div className="admin-section-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default AdminSectionHeader;
