"use strict";

const { pool } = require("../src/db");
const {
  normalizeProductSku,
  parseProductSku,
  PRODUCT_CATEGORY_LABELS
} = require("../src/utils/productCategories");

async function ensureProductCategoryEnum() {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'category'
      LIMIT 1
    `
  );

  const columnType = String(rows[0]?.COLUMN_TYPE || "");
  const definition = "ENUM('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT') NOT NULL DEFAULT 'OT'";
  if (columnType.toLowerCase() === definition.toLowerCase()) {
    return;
  }

  await pool.query(
    `
      ALTER TABLE products
      MODIFY COLUMN category ${definition}
    `
  );
}

function getResolvedCategory(sku) {
  const normalizedSku = normalizeProductSku(sku);
  const parsed = parseProductSku(normalizedSku);
  if (!parsed) {
    return "OT";
  }
  return PRODUCT_CATEGORY_LABELS[parsed.category] ? parsed.category : "OT";
}

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureProductCategoryEnum();
  const [rows] = await pool.query(
    `
      SELECT id, sku, category
      FROM products
      ORDER BY id ASC
    `
  );

  const updates = [];
  for (const row of rows) {
    const normalizedSku = normalizeProductSku(row.sku);
    const resolvedCategory = getResolvedCategory(normalizedSku);
    if (String(row.category || "").trim().toUpperCase() !== resolvedCategory) {
      updates.push({
        id: row.id,
        sku: normalizedSku,
        from: row.category || null,
        to: resolvedCategory,
        label: PRODUCT_CATEGORY_LABELS[resolvedCategory] || "其他"
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        total: rows.length,
        changes: updates.length,
        preview: updates.slice(0, 20)
      },
      null,
      2
    )
  );

  if (!apply || updates.length === 0) {
    return;
  }

  for (const update of updates) {
    await pool.query(
      `
        UPDATE products
        SET category = ?
        WHERE id = ?
      `,
      [update.to, update.id]
    );
  }

  console.log(`Updated ${updates.length} product category rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
