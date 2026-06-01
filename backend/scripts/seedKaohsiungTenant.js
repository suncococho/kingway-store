"use strict";

const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { hashPassword } = require("../src/utils/passwords");

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Set();
  const values = new Map();

  for (const arg of args) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, value] = arg.split("=", 2);
      values.set(key.slice(2), value);
      continue;
    }

    if (arg.startsWith("--")) {
      flags.add(arg.slice(2));
    }
  }

  return {
    dryRun: flags.has("dry-run") || flags.has("no-write"),
    storeCode: values.get("storeCode") || "KINGWAY_KAOHSIUNG",
    storeName: values.get("storeName") || "KINGWAY 高雄",
    staffUsername: values.get("staffUsername") || "kaohsiung_owner",
    staffDisplayName: values.get("staffDisplayName") || "KINGWAY 高雄 店長",
    staffRole: (values.get("staffRole") || "ADMIN").toUpperCase(),
    productSku: values.get("productSku") || "KH-TEST-001",
    customerPhone: values.get("customerPhone") || "0900000002",
    customerName: values.get("customerName") || "高雄測試客戶",
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "kingway",
    password: process.env.MYSQL_PASSWORD || "kingway",
    database: process.env.MYSQL_DATABASE || "kingway_store"
  };
}

function randomAlnum(minLength = 18) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(minLength * 2);
  let output = "";
  for (let i = 0; i < bytes.length && output.length < minLength; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return Boolean(rows[0]);
}

function buildFeatureColumns(featureRows) {
  return featureRows
    .map((row) => row.COLUMN_NAME)
    .filter((name) => name.endsWith("_enabled"));
}

async function ensureStore(connection, config, dryRun) {
  const [idRows] = await connection.query(
    `
      SELECT id, code, name, status, plan
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [2]
  );

  const [codeRows] = await connection.query(
    `
      SELECT id, code, name, status, plan
      FROM stores
      WHERE code = ?
      LIMIT 1
    `,
    [config.storeCode]
  );

  if (codeRows[0] && codeRows[0].id !== 2) {
    throw new Error(`Store code ${config.storeCode} already exists on id=${codeRows[0].id}`);
  }

  if (idRows[0] && codeRows[0] && idRows[0].id === 2 && codeRows[0].id === 2) {
    if (
      idRows[0].status !== "active" ||
      idRows[0].plan !== "single_store" ||
      idRows[0].name !== config.storeName
    ) {
      if (!dryRun) {
        await connection.query(
          `
            UPDATE stores
            SET name = ?, status = 'active', plan = 'single_store'
            WHERE id = 2
          `,
          [config.storeName]
        );
      }
      return { action: "updated" };
    }

    return { action: "exists" };
  }

  if (idRows[0] && idRows[0].code !== config.storeCode) {
    throw new Error(`Store id=2 is occupied by code=${idRows[0].code}`);
  }

  if (dryRun) {
    return { action: "would-create" };
  }

  await connection.query(
    `
      INSERT INTO stores (id, code, name, status, plan)
      VALUES (2, ?, ?, 'active', 'single_store')
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        status = VALUES(status),
        plan = VALUES(plan)
    `,
    [config.storeCode, config.storeName]
  );

  return { action: "created" };
}

async function ensureStoreFeatures(connection, dryRun) {
  const [featureRows] = await connection.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_features'
    ORDER BY ORDINAL_POSITION
  `);

  const featureColumns = buildFeatureColumns(featureRows);
  if (featureColumns.length === 0) {
    throw new Error("No feature toggle columns found in store_features");
  }

  const selectColumn = featureColumns.join(", ");
  const placeholders = featureColumns.map(() => "?").join(", ");
  const values = featureColumns.map(() => 1);

  const [row] = await connection.query(
    `SELECT store_id FROM store_features WHERE store_id = ? LIMIT 1`,
    [2]
  );

  if (row[0]) {
    if (dryRun) {
      return { action: "would-update", columns: featureColumns.length, sample: row[0] };
    }

    if (featureColumns.length === 1) {
      await connection.query(`UPDATE store_features SET ${featureColumns[0]} = 1 WHERE store_id = 2`);
      return { action: "updated", columns: featureColumns.length };
    }

    await connection.query(
      `
        UPDATE store_features
        SET ${featureColumns.map((name) => `${name} = 1`).join(", ")}
        WHERE store_id = 2
      `
    );
    return { action: "updated", columns: featureColumns.length };
  }

  if (dryRun) {
    return { action: "would-create", columns: featureColumns.length };
  }

  await connection.query(
    `
      INSERT INTO store_features (store_id, ${selectColumn})
      VALUES (?, ${placeholders})
    `,
    [2, ...values]
  );
  return { action: "created", columns: featureColumns.length };
}

async function ensureStaff(connection, config, plainPassword, passwordHash, dryRun) {
  const [rows] = await connection.query(
    `
      SELECT id, username, store_id, role
      FROM staff_users
      WHERE username = ?
      LIMIT 1
    `,
    [config.staffUsername]
  );

  const role = config.staffRole === "MANAGER" ? "MANAGER" : "ADMIN";

  if (rows[0]) {
    const needsUpdate = rows[0].store_id !== 2 || rows[0].role !== role;

    if (dryRun) {
      return {
        action: needsUpdate ? "would-update" : "exists",
        staffId: rows[0].id,
        username: config.staffUsername,
        plainPassword
      };
    }

    if (!needsUpdate) {
      await connection.query(
        `
          UPDATE staff_users
          SET display_name = ?, is_active = 1, password_hash = ?
          WHERE id = ?
        `,
        [config.staffDisplayName, passwordHash, rows[0].id]
      );
      return {
        action: "updated-password",
        staffId: rows[0].id,
        username: config.staffUsername,
        plainPassword
      };
    }

    await connection.query(
      `
        UPDATE staff_users
        SET display_name = ?, store_id = 2, role = ?, is_active = 1, password_hash = ?
        WHERE id = ?
      `,
      [config.staffDisplayName, role, passwordHash, rows[0].id]
    );

    return {
      action: "updated",
      staffId: rows[0].id,
      username: config.staffUsername,
      plainPassword
    };
  }

  if (dryRun) {
    return {
      action: "would-create",
      username: config.staffUsername,
      plainPassword
    };
  }

  await connection.query(
    `
      INSERT INTO staff_users (username, password_hash, display_name, role, is_active, store_id)
      VALUES (?, ?, ?, ?, 1, 2)
    `,
    [config.staffUsername, passwordHash, config.staffDisplayName, role]
  );

  const [createdRows] = await connection.query(
    `
      SELECT id
      FROM staff_users
      WHERE username = ?
      LIMIT 1
    `,
    [config.staffUsername]
  );

  return {
    action: "created",
    staffId: createdRows[0]?.id || null,
    username: config.staffUsername,
    plainPassword
  };
}

async function ensureSampleProduct(connection, config, dryRun) {
  const [rows] = await connection.query(
    `
      SELECT id, sku, store_id
      FROM products
      WHERE sku = ?
      LIMIT 1
    `,
    [config.productSku]
  );

  if (rows[0]) {
    if (rows[0].store_id !== 2) {
      throw new Error(`SKU ${config.productSku} already exists under store_id=${rows[0].store_id}`);
    }

    if (dryRun) {
      return { action: "exists", sku: config.productSku };
    }

    await connection.query(
      `
        UPDATE products
        SET name = ?, category = 'OT', price = 100, stock = 10, is_active = 1
        WHERE id = ?
      `,
      ["高雄測試商品", rows[0].id]
    );

    return { action: "updated", sku: config.productSku };
  }

  if (dryRun) {
    return { action: "would-create", sku: config.productSku };
  }

  await connection.query(
    `
      INSERT INTO products (sku, name, category, price, stock, reorder_level, is_active, store_id)
      VALUES (?, '高雄測試商品', 'OT', 100, 10, 0, 1, 2)
    `,
    [config.productSku]
  );

  return { action: "created", sku: config.productSku };
}

async function ensureSampleCustomer(connection, config, dryRun) {
  const [rows] = await connection.query(
    `
      SELECT id, phone, store_id
      FROM customers
      WHERE phone = ?
      LIMIT 1
    `,
    [config.customerPhone]
  );

  if (rows[0]) {
    if (rows[0].store_id !== 2) {
      throw new Error(`Customer phone ${config.customerPhone} already exists under store_id=${rows[0].store_id}`);
    }

    return { action: "exists", customerPhone: config.customerPhone };
  }

  if (dryRun) {
    return { action: "would-create", customerPhone: config.customerPhone };
  }

  await connection.query(
    `
      INSERT INTO customers (name, phone, customer_type, store_id)
      VALUES (?, ?, 'OFFLINE_WITH_PHONE', 2)
    `,
    [config.customerName, config.customerPhone]
  );

  return { action: "created", customerPhone: config.customerPhone };
}

async function main() {
  const config = parseArgs();
  if (!config.storeCode || !config.storeName) {
    throw new Error("storeCode and storeName are required");
  }

  console.log(`Target DB: ${config.host}:${config.port}/${config.database}`);
  console.log(`Dry run: ${config.dryRun ? "enabled" : "disabled"}`);

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0
  });

  const connection = await pool.getConnection();

  const plainPassword = randomAlnum(18);
  const passwordHash = await hashPassword(plainPassword);

  const needsStoreIdColumn =
    await hasColumn(connection, "staff_users", "store_id") &&
    await hasColumn(connection, "products", "store_id") &&
    await hasColumn(connection, "customers", "store_id") &&
    await hasColumn(connection, "store_features", "store_id");

  if (!needsStoreIdColumn) {
    throw new Error("One or more required store_id columns are missing");
  }

  try {
    await connection.beginTransaction();

    const store = await ensureStore(connection, config, config.dryRun);
    const features = await ensureStoreFeatures(connection, config.dryRun);
    const staff = await ensureStaff(connection, config, plainPassword, passwordHash, config.dryRun);
    const product = await ensureSampleProduct(connection, config, config.dryRun);
    const customer = await ensureSampleCustomer(connection, config, config.dryRun);

    if (config.dryRun) {
      await connection.rollback();
      console.log("[DRY RUN] No changes written.");
    } else {
      await connection.commit();
    }

    console.log("Seed summary:");
    console.log(JSON.stringify({
      store,
      features,
      staff,
      product,
      customer
    }, null, 2));

    if (!config.dryRun) {
      console.log(`Temporary staff password: ${plainPassword}`);
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
