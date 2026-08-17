#!/usr/bin/env node
"use strict";

const { isReadOnlyValidationMode } = require("../src/runtime/validationMode");

function buildRoleGetValidationPlan(actors, endpoints) {
  return actors.flatMap((actor) => endpoints.map((path) => ({
    method: "GET",
    path,
    actor: {
      id: actor.id,
      role: actor.role,
      storeId: actor.storeId,
      storeRole: actor.storeRole || null
    }
  })));
}

async function runRoleGetValidation({ actors, endpoints, signToken, request, env = process.env }) {
  if (!isReadOnlyValidationMode(env)) {
    throw new Error("BACKEND_VALIDATION_MODE=read-only is required");
  }

  const plan = buildRoleGetValidationPlan(actors, endpoints);
  const results = [];
  for (const item of plan) {
    const token = await signToken(item.actor);
    const response = await request({
      method: item.method,
      path: item.path,
      authorization: `Bearer ${token}`
    });
    results.push({
      role: item.actor.role,
      storeRole: item.actor.storeRole,
      path: item.path,
      status: response.status
    });
  }
  return results;
}

async function runFixture() {
  const actors = [
    { id: 101, role: "ADMIN", storeId: 1, storeRole: "admin" },
    { id: 102, role: "MANAGER", storeId: 1, storeRole: "manager" },
    { id: 103, role: "STAFF", storeId: 1, storeRole: "staff" }
  ];
  const endpoints = ["/api/staff-incentives/me", "/api/staff-scheduling/periods"];
  const results = await runRoleGetValidation({
    actors,
    endpoints,
    env: { BACKEND_VALIDATION_MODE: "read-only" },
    signToken: async (actor) => `fixture-token-for-${actor.id}`,
    request: async ({ method, authorization }) => {
      if (method !== "GET" || !authorization.startsWith("Bearer fixture-token-for-")) {
        throw new Error("fixture runner attempted a non-GET or unsigned request");
      }
      return { status: 200 };
    }
  });
  console.log(JSON.stringify({ fixture: true, requests: results.length, tokenLogged: false }));
}

if (require.main === module) {
  if (process.argv[2] !== "--fixture") {
    console.error("Only --fixture is enabled. A separately reviewed SELECT-only actor adapter is required for staging execution.");
    process.exit(2);
  }
  runFixture().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { buildRoleGetValidationPlan, runRoleGetValidation };
