"use strict";

const { pool } = require("./_migrationUtils");

async function main() {
  const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM products");
  const [categoryRows] = await pool.query(
    `
      SELECT category, COUNT(*) AS total
      FROM products
      GROUP BY category
      ORDER BY category
    `
  );
  const [duplicateRows] = await pool.query(
    `
      SELECT sku, COUNT(*) AS total
      FROM products
      GROUP BY sku
      HAVING COUNT(*) > 1
      ORDER BY total DESC, sku ASC
    `
  );
  const [latestRows] = await pool.query(
    `
      SELECT
        id,
        sku,
        name,
        category,
        price,
        stock,
        reorder_level AS reorderLevel,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM products
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `
  );

  console.log(`Product count: ${countRows[0].total}`);
  console.log("Category count:");
  for (const row of categoryRows) {
    console.log(`- ${row.category}: ${row.total}`);
  }

  if (duplicateRows.length === 0) {
    console.log("Duplicate SKU check: none");
  } else {
    console.log("Duplicate SKU check:");
    for (const row of duplicateRows) {
      console.log(`- ${row.sku}: ${row.total}`);
    }
  }

  console.log("Latest 20 products:");
  for (const row of latestRows) {
    console.log(
      `- #${row.id} ${row.sku} | ${row.name} | ${row.category} | price=${row.price} | stock=${row.stock} | active=${row.isActive}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
