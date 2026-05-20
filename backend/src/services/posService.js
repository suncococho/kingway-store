const { pool } = require("../db");

// 상품 검색 (이게 핵심)
async function searchProduct(keyword) {
  const [rows] = await pool.query(
    "SELECT id, name, sku, price, stock FROM products WHERE name LIKE ? OR sku LIKE ? LIMIT 5",
    [`%${keyword}%`, `%${keyword}%`]
  );
  return rows;
}

module.exports = {
  searchProduct
};
