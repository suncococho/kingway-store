function getCellValue(column, row) {
  return column.render ? column.render(row) : row[column.key] ?? "-";
}

function DataTable({
  columns,
  rows,
  emptyText = "目前沒有資料。",
  cardTitle,
  cardDescription,
  cardFooter,
  cardBadges
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="responsive-data-view">
      <div className="table-wrapper desktop-only">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id || index}>
                {columns.map((column) => (
                  <td key={column.key}>{getCellValue(column, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="data-card-list mobile-only">
        {rows.map((row, index) => (
          <article key={row.id || index} className="data-card">
            {cardTitle || cardDescription || cardBadges ? (
              <div className="data-card-header">
                <div className="data-card-heading">
                  {cardTitle ? <div className="data-card-title">{cardTitle(row)}</div> : null}
                  {cardDescription ? <div className="data-card-description">{cardDescription(row)}</div> : null}
                </div>
                {cardBadges ? <div className="data-card-badges">{cardBadges(row)}</div> : null}
              </div>
            ) : null}
            <div className="data-card-grid">
              {columns
                .filter((column) => !column.mobileHidden)
                .map((column) => (
                  <div key={column.key} className="data-card-field">
                    <div className="data-card-label">{column.label}</div>
                    <div className="data-card-value">{getCellValue(column, row)}</div>
                  </div>
                ))}
            </div>
            {cardFooter ? <div className="data-card-footer">{cardFooter(row)}</div> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

export default DataTable;
