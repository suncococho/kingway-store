const DEMO_KEYWORDS = ["prod demo", "demo", "test data", "測試資料", "rehearsal"];

function isExcludeDemoRequested(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function buildDemoKeywordCondition(columns, params) {
  const safeColumns = columns.filter(Boolean);
  if (!safeColumns.length) return "0 = 1";

  const clauses = [];
  for (const column of safeColumns) {
    for (const keyword of DEMO_KEYWORDS) {
      clauses.push(`LOWER(COALESCE(${column}, '')) LIKE ?`);
      params.push(`%${keyword}%`);
    }
  }
  return `(${clauses.join(" OR ")})`;
}

function buildDemoExclusionCondition(columns, params) {
  return `NOT ${buildDemoKeywordCondition(columns, params)}`;
}

module.exports = {
  DEMO_KEYWORDS,
  buildDemoKeywordCondition,
  buildDemoExclusionCondition,
  isExcludeDemoRequested
};
