
// ===== 상품 검색 함수 =====
async function findProduct(keyword) {
  const [rows] = await db.query(
    "SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 5",
    [`%${keyword}%`, `%${keyword}%`]
  );
  return rows;
}

