const { pool } = require("../db");

// 상품 검색 (이게 핵심)
async function searchProduct(keyword, storeId = null) {
  const normalizedStoreId = Number(storeId || 0);
  const hasStoreIdFilter = Number.isSafeInteger(normalizedStoreId) && normalizedStoreId > 0;
  const [rows] = await pool.query(
    `SELECT id, name, sku, price, stock
     FROM products
     WHERE (name LIKE ? OR sku LIKE ?)
       ${hasStoreIdFilter ? "AND store_id = ?" : ""}
     LIMIT 5`,
    hasStoreIdFilter
      ? [`%${keyword}%`, `%${keyword}%`, normalizedStoreId]
      : [`%${keyword}%`, `%${keyword}%`]
  );
  return rows;
}

module.exports = {
  searchProduct
};
