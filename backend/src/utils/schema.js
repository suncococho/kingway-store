const tableColumnCache = new Map();

function escapeIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, "``")}\``;
}

async function getTableColumns(db, tableName) {
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName);
  }

  const [rows] = await db.query(`SHOW COLUMNS FROM ${escapeIdentifier(tableName)}`);
  const columns = new Set(rows.map((row) => row.Field));
  tableColumnCache.set(tableName, columns);
  return columns;
}

function hasColumn(columns, columnName) {
  return columns.has(columnName);
}

function selectColumn(columns, tableAlias, columnName, alias, fallback = "NULL") {
  const expression = hasColumn(columns, columnName)
    ? `${tableAlias}.${escapeIdentifier(columnName)}`
    : fallback;
  return `${expression} AS ${escapeIdentifier(alias)}`;
}

module.exports = {
  getTableColumns,
  hasColumn,
  selectColumn
};
