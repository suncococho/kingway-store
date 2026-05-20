"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  buildOrderNo,
  buildPlaceholderSku,
  fail,
  mapCategory,
  mapOrderStatus,
  mapPaymentMethod,
  normalizeSku,
  normalizeWhitespace,
  parseCsv,
  parseDateOnly,
  parseInteger,
  parseNumber,
  pickField,
  requireFilePath,
  pool
} = require("./_migrationUtils");

async function resolveCreatedBy() {
  const [staffRows] = await pool.query(
    `
      SELECT id
      FROM staff_users
      WHERE is_active = 1
      ORDER BY
        CASE role
          WHEN 'ADMIN' THEN 1
          WHEN 'MANAGER' THEN 2
          ELSE 3
        END,
        id ASC
      LIMIT 1
    `
  );

  if (!staffRows[0]) {
    fail("No active staff_users row exists. Create at least one staff user before importing order CSV data.");
  }

  return staffRows[0].id;
}

function parseSettlementCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const sourceName = path.basename(filePath);
  const parsedRows = parseCsv(text);
  const headerIndex = findHeaderRowIndex(parsedRows);

  if (headerIndex === -1) {
    fail(`Unable to find a supported header row in ${filePath}`);
  }

  const headers = parsedRows[headerIndex].map((header, index) => mapSettlementHeader(header) || `column${index + 1}`);
  const dataRows = parsedRows.slice(headerIndex + 1);
  const rows = [];
  const stats = {
    sourceRows: dataRows.filter((row) => row.some((cell) => normalizeWhitespace(cell) !== "")).length,
    skippedRows: 0,
    skippedMissingIdentity: 0,
    skippedParseIssues: 0
  };

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    if (!row || row.every((cell) => normalizeWhitespace(cell) === "")) {
      continue;
    }

    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = normalizeWhitespace(row[columnIndex] || "");
    });

    try {
      const sku = normalizeSku(
        pickField(record, ["sku", "productsku", "itemsku", "merchantsku", "model"])
      );
      const productName = normalizeWhitespace(
        pickField(record, ["productname", "name", "itemname", "description", "product"])
      );

      if (!sku && !productName) {
        stats.skippedRows += 1;
        stats.skippedMissingIdentity += 1;
        continue;
      }

      const quantity = Math.max(
        1,
        parseInteger(pickField(record, ["quantity", "qty", "count", "units"]), 1)
      );
      const lineTotal = parseNumber(
        pickField(record, ["linetotal", "total", "subtotal", "netamount", "settlementamount"]),
        0
      );
      const unitPrice = parseNumber(
        pickField(record, ["unitprice", "price", "amount", "itemamount", "wholesaleunitprice"]),
        quantity > 0 ? lineTotal / quantity : 0
      );
      const customerName = normalizeWhitespace(
        pickField(record, ["customername", "buyername", "customer", "buyer"])
      );
      const customerPhone = normalizeWhitespace(
        pickField(record, ["customerphone", "phone", "mobile", "buyerphone"])
      );
      const category = mapCategory(
        pickField(record, ["category", "productcategory", "type", "department", "settlementcategory"]) || productName
      );
      const businessDate = parseDateOnly(
        pickField(record, ["businessdate", "date", "orderdate", "settlementdate", "createdat"])
      );
      const paymentMethod = mapPaymentMethod(
        pickField(record, ["paymentmethod", "payment", "paidby", "paytype"])
      );
      const status = mapOrderStatus(pickField(record, ["status", "orderstatus", "paymentstatus"]));
      const notes = normalizeWhitespace(pickField(record, ["notes", "note", "remark", "remarks"]));
      const explicitOrderSeed = pickField(record, [
        "orderno",
        "ordernumber",
        "orderid",
        "transactionid",
        "settlementno",
        "invoiceno",
        "referenceno",
        "receiptno"
      ]);

      const fallbackSeed = [
        sourceName,
        businessDate,
        customerName,
        customerPhone,
        sku,
        productName,
        lineTotal,
        index + 1
      ].join("|");

      rows.push({
        rowNumber: headerIndex + index + 2,
        sku,
        productName,
        quantity,
        unitPrice,
        lineTotal,
        customerName,
        customerPhone,
        category,
        businessDate,
        paymentMethod,
        status,
        notes,
        orderNo: buildOrderNo(explicitOrderSeed, fallbackSeed),
        sourceHash: crypto.createHash("sha1").update(fallbackSeed).digest("hex").slice(0, 16)
      });
    } catch (error) {
      stats.skippedRows += 1;
      stats.skippedParseIssues += 1;
    }
  }

  return { rows, stats };
}

function findHeaderRowIndex(rows) {
  const requiredHeaders = ["orderdate", "orderno", "productname", "sku", "quantity"];

  for (let index = 0; index < rows.length; index += 1) {
    const normalizedRow = rows[index].map((cell) => mapSettlementHeader(cell));
    const hasAllHeaders = requiredHeaders.every((header) => normalizedRow.includes(header));
    if (hasAllHeaders) {
      return index;
    }
  }

  return -1;
}

function mapSettlementHeader(header) {
  const normalized = normalizeWhitespace(header).toLowerCase();
  const aliases = new Map([
    ["訂單日期", "orderdate"],
    ["年", "year"],
    ["月", "month"],
    ["訂單編號", "orderno"],
    ["客戶", "customer"],
    ["付款方式", "paymentmethod"],
    ["商品名稱", "productname"],
    ["sku", "sku"],
    ["SKU", "sku"],
    ["數量", "quantity"],
    ["商品分類", "productcategory"],
    ["結算分類", "settlementcategory"],
    ["銷售淨額", "netamount"],
    ["供應商", "supplier"],
    ["單位批發價", "wholesaleunitprice"],
    ["供應商應收", "supplieramount"],
    ["KINGWAY 毛利", "grossprofit"],
    ["備註", "notes"]
  ]);

  if (aliases.has(header)) {
    return aliases.get(header);
  }

  if (aliases.has(normalized)) {
    return aliases.get(normalized);
  }

  return normalized
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

async function resolveCustomer(connection, row) {
  if (!row.customerName && !row.customerPhone) {
    return null;
  }

  const [matches] = await connection.query(
    `
      SELECT id
      FROM customers
      WHERE (? <> '' AND phone = ?) OR (? <> '' AND name = ?)
      ORDER BY id DESC
      LIMIT 1
    `,
    [row.customerPhone, row.customerPhone, row.customerName, row.customerName]
  );

  if (matches[0]) {
    return { id: matches[0].id, created: false };
  }

  const [result] = await connection.query(
    `
      INSERT INTO customers (name, phone, notes)
      VALUES (?, ?, ?)
    `,
    [row.customerName || "Migrated Customer", row.customerPhone || null, "Created by order CSV migration"]
  );

  return { id: result.insertId, created: true };
}

async function resolveProduct(connection, row) {
  let product = null;

  if (row.sku) {
    const [skuRows] = await connection.query(
      `
        SELECT id, sku, name, category, price
        FROM products
        WHERE sku = ?
        LIMIT 1
      `,
      [row.sku]
    );
    product = skuRows[0] || null;
  }

  if (!product && row.productName) {
    const [nameRows] = await connection.query(
      `
        SELECT id, sku, name, category, price
        FROM products
        WHERE LOWER(name) = LOWER(?)
        ORDER BY id ASC
        LIMIT 1
      `,
      [row.productName]
    );
    product = nameRows[0] || null;
  }

  if (product) {
    return { product, created: false };
  }

  const placeholderSku = row.sku || buildPlaceholderSku(row.productName || "MIGRATED ITEM", row.sourceHash);
  const placeholderName = row.productName || placeholderSku;
  const category = row.category || mapCategory(placeholderName);
  const price = row.unitPrice || 0;

  const [beforeRows] = await connection.query(
    `
      SELECT id
      FROM products
      WHERE sku = ?
      LIMIT 1
    `,
    [placeholderSku]
  );

  await connection.query(
    `
      INSERT INTO products (sku, name, category, price, stock, reorder_level, is_active)
      VALUES (?, ?, ?, ?, 0, 0, 1)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        category = VALUES(category),
        price = VALUES(price)
    `,
    [placeholderSku, placeholderName, category, price]
  );

  const [rows] = await connection.query(
    `
      SELECT id, sku, name, category, price
      FROM products
      WHERE sku = ?
      LIMIT 1
    `,
    [placeholderSku]
  );

  return {
    product: rows[0] || { sku: placeholderSku, name: placeholderName, category, price },
    created: beforeRows.length === 0
  };
}

async function resolveOrder(connection, row, customerId, createdBy) {
  const [existingRows] = await connection.query(
    `
      SELECT id
      FROM orders
      WHERE order_no = ?
      LIMIT 1
    `,
    [row.orderNo]
  );

  if (existingRows[0]) {
    return { id: existingRows[0].id, created: false };
  }

  const [result] = await connection.query(
    `
      INSERT INTO orders (
        order_no,
        customer_id,
        customer_name,
        customer_phone,
        total_amount,
        payment_method,
        status,
        notes,
        created_by,
        business_date
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `,
    [
      row.orderNo,
      customerId,
      row.customerName || null,
      row.customerPhone || null,
      row.paymentMethod,
      row.status,
      row.notes || "Imported from supplier settlement CSV",
      createdBy,
      row.businessDate
    ]
  );

  return { id: result.insertId, created: true };
}

async function orderItemExists(connection, orderId, product, row) {
  const [existingRows] = await connection.query(
    `
      SELECT id
      FROM order_items
      WHERE order_id = ?
        AND product_id = ?
        AND sku_snapshot = ?
        AND product_name_snapshot = ?
        AND quantity = ?
        AND unit_price = ?
        AND line_total = ?
      LIMIT 1
    `,
    [orderId, product.id, product.sku, product.name, row.quantity, row.unitPrice, row.lineTotal]
  );

  return Boolean(existingRows[0]);
}

async function refreshOrderTotal(connection, orderId) {
  const [sumRows] = await connection.query(
    `
      SELECT COALESCE(SUM(line_total), 0) AS total
      FROM order_items
      WHERE order_id = ?
    `,
    [orderId]
  );

  await connection.query(
    `
      UPDATE orders
      SET total_amount = ?
      WHERE id = ?
    `,
    [sumRows[0].total, orderId]
  );
}

async function main() {
  const inputPath = requireFilePath(process.argv[2]);
  if (path.extname(inputPath).toLowerCase() !== ".csv") {
    fail("Order item migration only supports .csv input.");
  }

  const { rows, stats } = parseSettlementCsv(inputPath);
  if (rows.length === 0) {
    fail("No usable order rows found in the CSV file.");
  }

  const createdBy = await resolveCreatedBy();
  let importedOrders = 0;
  let importedItems = 0;
  let placeholderProducts = 0;
  let createdCustomers = 0;
  let duplicateItemsSkipped = 0;
  const touchedOrders = new Set();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const row of rows) {
      const customer = await resolveCustomer(connection, row);
      const customerId = customer ? customer.id : null;
      if (customer && customer.created) {
        createdCustomers += 1;
      }
      const { product, created: placeholderCreated } = await resolveProduct(connection, row);
      if (placeholderCreated) {
        placeholderProducts += 1;
      }

      const order = await resolveOrder(connection, row, customerId, createdBy);
      const orderId = order.id;
      if (!touchedOrders.has(orderId)) {
        touchedOrders.add(orderId);
      }
      if (order.created) {
        importedOrders += 1;
      }

      const exists = await orderItemExists(connection, orderId, product, row);
      if (!exists) {
        await connection.query(
          `
            INSERT INTO order_items (
              order_id,
              product_id,
              sku_snapshot,
              product_name_snapshot,
              product_category_snapshot,
              quantity,
              unit_price,
              line_total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            orderId,
            product.id,
            product.sku,
            product.name,
            product.category || row.category || "OTHER",
            row.quantity,
            row.unitPrice,
            row.lineTotal
          ]
        );
        importedItems += 1;
      } else {
        duplicateItemsSkipped += 1;
      }

      await refreshOrderTotal(connection, orderId);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  console.log(`Processed ${rows.length} importable CSV rows from ${inputPath}`);
  console.log(`Source data rows: ${stats.sourceRows}`);
  console.log(`Skipped rows: ${stats.skippedRows}`);
  console.log(`Skipped rows due to missing SKU and product name: ${stats.skippedMissingIdentity}`);
  console.log(`Skipped rows due to parse issues: ${stats.skippedParseIssues}`);
  console.log(`Orders created: ${importedOrders}`);
  console.log(`Orders touched: ${touchedOrders.size}`);
  console.log(`New order_items inserted: ${importedItems}`);
  console.log(`Duplicate-prevented existing order_items skipped: ${duplicateItemsSkipped}`);
  console.log(`Customers created: ${createdCustomers}`);
  console.log(`Placeholder products created: ${placeholderProducts}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
