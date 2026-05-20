function FilterChips({ items, value, onChange }) {
  return (
    <div className="admin-chip-row">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`admin-filter-chip ${value === item.key ? "admin-filter-chip-active" : ""}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default FilterChips;
