const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toPort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function toTextLower(value, fallback = "") {
  return toText(value, fallback).trim().toLowerCase();
}

function resolveRuntimePortProfile(req) {
  const appEnv = toTextLower(process.env.APP_ENV);
  const nodeEnv = toTextLower(process.env.NODE_ENV);

  const configuredBackendPort = toPort(process.env.BACKEND_PORT);
  const configuredFrontendPort = toPort(process.env.FRONTEND_PORT);
  const headerHostPort = toPort(toText(req?.headers?.host, "").split(":")[1]);
  const forwardedHostPort = toPort(toText(req?.headers?.["x-forwarded-host"], "").split(":")[1]);
  const forwardedPort = toPort(req?.headers?.["x-forwarded-port"]);

  const runtimePorts = [
    configuredBackendPort,
    configuredFrontendPort,
    headerHostPort,
    forwardedHostPort,
    forwardedPort,
    toPort(req?.socket?.localPort)
  ].filter((port) => port !== null);

  const isStaging = appEnv.includes("staging") ||
    appEnv.includes("restore") ||
    nodeEnv.includes("staging") ||
    nodeEnv.includes("restore") ||
    runtimePorts.includes(3010) ||
    runtimePorts.includes(5180);

  if (isStaging) {
    return { environment: "staging", frontend: 5180, backend: 3010 };
  }

  return { environment: "production", frontend: 5173, backend: 3000 };
}

router.get("/saas-status", async (req, res, next) => {
  try {
    const storeId = toNumber(req.storeId || req.user?.store_id || req.user?.storeId || 1, 1);
    const runtimeProfile = resolveRuntimePortProfile(req);

    const [[storeRow]] = await pool.query(
      `
        SELECT id, code, name, status, plan
        FROM stores
        WHERE id = ?
        LIMIT 1
      `,
      [storeId]
    );

    const [[countsRow]] = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM products WHERE store_id = ?) AS productCount,
          (SELECT COUNT(*) FROM customers WHERE store_id = ?) AS customerCount,
          (SELECT COUNT(*) FROM orders WHERE store_id = ?) AS orderCount,
          (SELECT COUNT(*) FROM repair_orders WHERE store_id = ?) AS repairCount
      `,
      [storeId, storeId, storeId, storeId]
    );

    const store = storeRow
      ? {
          id: toNumber(storeRow.id, storeId),
          code: toText(storeRow.code, "UNKNOWN"),
          name: toText(storeRow.name, "UNKNOWN"),
          status: toText(storeRow.status, "unknown"),
          plan: toText(storeRow.plan, "unknown")
        }
      : {
          id: storeId,
          code: "UNKNOWN",
          name: "UNKNOWN",
          status: "unknown",
          plan: "unknown"
        };

    const counts = {
      productCount: toNumber(countsRow?.productCount, 0),
      customerCount: toNumber(countsRow?.customerCount, 0),
      orderCount: toNumber(countsRow?.orderCount, 0),
      repairCount: toNumber(countsRow?.repairCount, 0)
    };

    return res.json({
      ok: true,
      environment: runtimeProfile.environment,
      schemaGuard: {
        requireStoreIdSchema: String(process.env.REQUIRE_STORE_ID_SCHEMA || "").toLowerCase() === "true",
        status: "STRICT_ON"
      },
      store,
      counts,
      ports: {
        frontend: runtimeProfile.frontend,
        backend: runtimeProfile.backend
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
