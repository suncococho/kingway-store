const mysql = require("mysql2/promise");
const config = require("./config");
const {
  assertReadOnlySqlAllowed,
  assertRuntimeWriteAllowed
} = require("./runtime/validationMode");

const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z"
});

const guardedConnection = Symbol("guardedReadOnlyValidationConnection");
const originalPoolQuery = pool.query.bind(pool);
const originalPoolExecute = pool.execute.bind(pool);
const originalGetConnection = pool.getConnection.bind(pool);

pool.query = function guardedPoolQuery(sql, ...args) {
  assertReadOnlySqlAllowed(sql);
  return originalPoolQuery(sql, ...args);
};

pool.execute = function guardedPoolExecute(sql, ...args) {
  assertReadOnlySqlAllowed(sql);
  return originalPoolExecute(sql, ...args);
};

function guardConnection(connection) {
  if (!connection || connection[guardedConnection]) return connection;

  const originalQuery = connection.query.bind(connection);
  const originalExecute = connection.execute.bind(connection);
  const originalBeginTransaction = connection.beginTransaction.bind(connection);

  connection.query = function guardedQuery(sql, ...args) {
    assertReadOnlySqlAllowed(sql);
    return originalQuery(sql, ...args);
  };
  connection.execute = function guardedExecute(sql, ...args) {
    assertReadOnlySqlAllowed(sql);
    return originalExecute(sql, ...args);
  };
  connection.beginTransaction = function guardedBeginTransaction(...args) {
    assertRuntimeWriteAllowed("database transaction");
    return originalBeginTransaction(...args);
  };
  Object.defineProperty(connection, guardedConnection, { value: true });
  return connection;
}

pool.getConnection = async function guardedGetConnection(...args) {
  return guardConnection(await originalGetConnection(...args));
};

async function withTransaction(handler) {
  assertRuntimeWriteAllowed("database transaction");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  withTransaction
};
