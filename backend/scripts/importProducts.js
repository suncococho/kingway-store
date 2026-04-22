"use strict";

const fs = require("fs");
const path = require("path");
const {
  csvRowsToRecords,
  fail,
  mapCategory,
  normalizeSku,
  normalizeWhitespace,
  parseBoolean,
  parseCsv,
  parseInteger,
  parseNumber,
  parseSqlValueTuples,
  pickField,
  printProductSummary,
  requireFilePath,
  pool
} = require("./_migrationUtils");

async function upsertProducts(products) {
  let imported = 0;

  for (const product of products) {
    if (!product.sku || !product.name) {
      continue;
    }

    await pool.query(
      `
        INSERT INTO products (sku, name, category, price, stock, reorder_level, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          category = VALUES(category),
          price = VALUES(price),
          stock = VALUES(stock),
          reorder_level = VALUES(reorder_level),
          is_active = VALUES(is_active)
      `,
      [
        product.sku,
        product.name,
        product.category,
        product.price,
        product.stock,
        product.reorderLevel,
        product.isActive
      ]
    );

    imported += 1;
  }

  return imported;
}

function parseProductsCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const records = csvRowsToRecords(parseCsv(text));

  return records
    .map((record) => {
      const sku = normalizeSku(pickField(record, ["sku", "productsku", "itemsku", "code", "productcode"]));
      const name = normalizeWhitespace(pickField(record, ["name", "productname", "title", "itemname"]));
      if (!sku || !name) {
        return null;
      }

      return {
        sku,
        name,
        category: mapCategory(pickField(record, ["category", "categories", "productcategory", "type"])),
        price: parseNumber(pickField(record, ["price", "regularprice", "saleprice", "unitprice"]), 0),
        stock: parseInteger(pickField(record, ["stock", "stockquantity", "qty", "quantity"]), 0),
        reorderLevel: parseInteger(pickField(record, ["reorderlevel", "reorderpoint", "minstock"]), 0),
        isActive: parseBoolean(pickField(record, ["isactive", "enabled", "published", "status"]), true) ? 1 : 0
      };
    })
    .filter(Boolean);
}

function parseProductsSql(filePath) {
  const sql = fs.readFileSync(filePath, "utf8");

  const posts = new Map();
  const postMeta = new Map();
  const terms = new Map();
  const termTaxonomy = new Map();
  const termRelationships = new Map();
  const kwCategories = new Map();
  const kwProducts = [];

  for (const statement of extractInsertStatements(sql)) {
    const rawTableName = statement.tableName.replace(/`/g, "");
    const tableName = rawTableName.split(".").pop();
    const columns = statement.columns.split(",").map((column) => column.replace(/`/g, "").trim());
    const columnIndex = new Map(columns.map((column, index) => [column, index]));
    const tuples = parseSqlValueTuples(statement.values);

    if (/posts$/i.test(tableName)) {
      const idIndex = columnIndex.get("ID");
      const typeIndex = columnIndex.get("post_type");
      const statusIndex = columnIndex.get("post_status");
      const titleIndex = columnIndex.get("post_title");
      if ([idIndex, typeIndex, statusIndex, titleIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        const id = tuple[idIndex];
        const postType = normalizeWhitespace(tuple[typeIndex]);
        if (!["product", "product_variation"].includes(postType)) {
          continue;
        }

        posts.set(Number(id), {
          id: Number(id),
          postType,
          status: normalizeWhitespace(tuple[statusIndex]),
          title: normalizeWhitespace(tuple[titleIndex])
        });
      }
      continue;
    }

    if (/postmeta$/i.test(tableName)) {
      const postIdIndex = columnIndex.get("post_id");
      const keyIndex = columnIndex.get("meta_key");
      const valueIndex = columnIndex.get("meta_value");
      if ([postIdIndex, keyIndex, valueIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        const postId = Number(tuple[postIdIndex]);
        const metaKey = normalizeWhitespace(tuple[keyIndex]);
        if (!["_sku", "_price", "_regular_price", "_stock", "_stock_status", "_manage_stock"].includes(metaKey)) {
          continue;
        }

        if (!postMeta.has(postId)) {
          postMeta.set(postId, {});
        }
        postMeta.get(postId)[metaKey] = tuple[valueIndex];
      }
      continue;
    }

    if (/terms$/i.test(tableName)) {
      const termIdIndex = columnIndex.get("term_id");
      const nameIndex = columnIndex.get("name");
      if ([termIdIndex, nameIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        terms.set(Number(tuple[termIdIndex]), normalizeWhitespace(tuple[nameIndex]));
      }
      continue;
    }

    if (/term_taxonomy$/i.test(tableName)) {
      const taxonomyIdIndex = columnIndex.get("term_taxonomy_id");
      const termIdIndex = columnIndex.get("term_id");
      const taxonomyIndex = columnIndex.get("taxonomy");
      if ([taxonomyIdIndex, termIdIndex, taxonomyIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        termTaxonomy.set(Number(tuple[taxonomyIdIndex]), {
          termId: Number(tuple[termIdIndex]),
          taxonomy: normalizeWhitespace(tuple[taxonomyIndex])
        });
      }
      continue;
    }

    if (/term_relationships$/i.test(tableName)) {
      const objectIdIndex = columnIndex.get("object_id");
      const taxonomyIdIndex = columnIndex.get("term_taxonomy_id");
      if ([objectIdIndex, taxonomyIdIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        const objectId = Number(tuple[objectIdIndex]);
        const taxonomyId = Number(tuple[taxonomyIdIndex]);
        if (!termRelationships.has(objectId)) {
          termRelationships.set(objectId, []);
        }
        termRelationships.get(objectId).push(taxonomyId);
      }
      continue;
    }

    if (/kw_categories$/i.test(tableName)) {
      const idIndex = columnIndex.get("id");
      const nameIndex = columnIndex.get("name");
      if ([idIndex, nameIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        kwCategories.set(Number(tuple[idIndex]), normalizeWhitespace(tuple[nameIndex]));
      }
      continue;
    }

    if (/kw_products$/i.test(tableName)) {
      const skuIndex = columnIndex.get("sku");
      const nameIndex = columnIndex.get("name");
      const categoryIdIndex = columnIndex.get("category_id");
      const priceIndex = columnIndex.get("price");
      const stockIndex = columnIndex.get("stock");
      const stockAlertIndex = columnIndex.get("stock_alert");
      const isActiveIndex = columnIndex.get("is_active");
      if ([skuIndex, nameIndex, categoryIdIndex].some((index) => index === undefined)) {
        continue;
      }

      for (const tuple of tuples) {
        kwProducts.push({
          sku: normalizeSku(tuple[skuIndex]),
          name: normalizeWhitespace(tuple[nameIndex]),
          categoryId: Number(tuple[categoryIdIndex]),
          price: parseNumber(tuple[priceIndex], 0),
          stock: parseInteger(tuple[stockIndex], 0),
          reorderLevel: parseInteger(tuple[stockAlertIndex], 0),
          isActive: parseBoolean(tuple[isActiveIndex], true) ? 1 : 0
        });
      }
    }
  }

  if (kwProducts.length > 0) {
    return kwProducts
      .filter((product) => product.sku && product.name)
      .map((product) => ({
        sku: product.sku,
        name: product.name,
        category: mapCategory(kwCategories.get(product.categoryId) || ""),
        price: product.price,
        stock: product.stock,
        reorderLevel: product.reorderLevel,
        isActive: product.isActive
      }));
  }

  const products = [];
  for (const post of posts.values()) {
    if (["trash", "auto-draft"].includes(post.status)) {
      continue;
    }

    const meta = postMeta.get(post.id) || {};
    const sku = normalizeSku(meta._sku);
    const name = post.title || sku;
    if (!sku || !name) {
      continue;
    }

    const categoryNames = (termRelationships.get(post.id) || [])
      .map((taxonomyId) => termTaxonomy.get(taxonomyId))
      .filter((taxonomy) => taxonomy && taxonomy.taxonomy === "product_cat")
      .map((taxonomy) => terms.get(taxonomy.termId))
      .filter(Boolean);

    const stockStatus = normalizeWhitespace(meta._stock_status).toLowerCase();
    const stock = parseInteger(meta._stock, stockStatus === "instock" ? 1 : 0);
    const price = parseNumber(meta._price, parseNumber(meta._regular_price, 0));

    products.push({
      sku,
      name,
      category: mapCategory(categoryNames.join(" ")),
      price,
      stock,
      reorderLevel: 0,
      isActive: parseBoolean(post.status === "publish" ? "publish" : stockStatus || "publish", true) ? 1 : 0
    });
  }

  return products;
}

function extractInsertStatements(sql) {
  const statements = [];
  const marker = "INSERT INTO";
  let cursor = 0;

  while (cursor < sql.length) {
    const start = sql.indexOf(marker, cursor);
    if (start === -1) {
      break;
    }

    let index = start + marker.length;
    while (index < sql.length && /\s/.test(sql[index])) {
      index += 1;
    }

    let tableName = "";
    while (index < sql.length && sql[index] !== "(") {
      tableName += sql[index];
      index += 1;
    }

    if (sql[index] !== "(") {
      cursor = start + marker.length;
      continue;
    }

    index += 1;
    const columnsStart = index;
    while (index < sql.length && sql[index] !== ")") {
      index += 1;
    }

    if (index >= sql.length) {
      break;
    }

    const columns = sql.slice(columnsStart, index);
    index += 1;

    while (index < sql.length && /\s/.test(sql[index])) {
      index += 1;
    }

    if (sql.slice(index, index + 6).toUpperCase() !== "VALUES") {
      cursor = start + marker.length;
      continue;
    }

    index += 6;
    while (index < sql.length && /\s/.test(sql[index])) {
      index += 1;
    }

    const valuesStart = index;
    let inQuotes = false;
    let escaped = false;

    while (index < sql.length) {
      const char = sql[index];

      if (inQuotes) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "'") {
          inQuotes = false;
        }
      } else if (char === "'") {
        inQuotes = true;
      } else if (char === ";") {
        break;
      }

      index += 1;
    }

    if (index >= sql.length) {
      break;
    }

    statements.push({
      tableName: tableName.trim(),
      columns,
      values: sql.slice(valuesStart, index)
    });

    cursor = index + 1;
  }

  return statements;
}

async function main() {
  const inputPath = requireFilePath(process.argv[2]);
  const extension = path.extname(inputPath).toLowerCase();

  let products;
  if (extension === ".csv") {
    products = parseProductsCsv(inputPath);
  } else if (extension === ".sql") {
    products = parseProductsSql(inputPath);
  } else {
    fail("Unsupported file type. Use a .csv or .sql file.");
  }

  if (products.length === 0) {
    fail("No products found in the source file.");
  }

  const imported = await upsertProducts(products);
  console.log(`Imported or updated ${imported} products from ${inputPath}`);
  await printProductSummary();
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
