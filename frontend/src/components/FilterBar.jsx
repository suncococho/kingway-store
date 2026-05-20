function FilterBar({ children, compact = false }) {
  return <div className={`filter-bar${compact ? " filter-bar-compact" : ""}`}>{children}</div>;
}

export default FilterBar;
