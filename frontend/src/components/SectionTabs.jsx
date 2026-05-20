function SectionTabs({ items, value, onChange, label = "子功能切換" }) {
  return (
    <div className="section-tabs-wrap">
      <div className="section-tabs-mobile">
        <label className="form-field">
          <span>{label}</span>
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            {items.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-tabs" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={value === item.key}
            className={`section-tab${value === item.key ? " section-tab-active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SectionTabs;
