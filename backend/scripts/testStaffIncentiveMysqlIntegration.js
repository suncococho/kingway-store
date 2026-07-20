const assert = require("assert");
const mysql = require("mysql2/promise");

const {
  getActiveIncentivePlan,
  upsertIncentiveEvent,
  listIncentiveEvents
} = require("../src/services/staffIncentiveService");

async function run() {
  const port = Number(process.env.TEST_DB_PORT);
  const user = String(process.env.TEST_DB_USER || "").trim();
  const password = String(process.env.TEST_DB_PASSWORD || "");

  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error("TEST_DB_PORT is required");
  }

  if (!user) {
    throw new Error("TEST_DB_USER is required");
  }

  if (!password) {
    throw new Error("TEST_DB_PASSWORD is required");
  }

  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST || "127.0.0.1",
    port,
    user,
    password,
    database: "kingway_incentive_test",
    decimalNumbers: false,
    timezone: "Z"
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id BIGINT UNSIGNED NOT NULL,
        username VARCHAR(100) NOT NULL,
        display_name VARCHAR(100) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      INSERT INTO staff_users (
        id,
        username,
        display_name
      )
      VALUES
        (8, 'staff8', '王小明'),
        (9, 'staff9', '李小華')
    `);

    const [planResult] = await connection.query(
      `
        INSERT INTO staff_incentive_plan_versions (
          store_id,
          version,
          status,
          bike_sale_amount,
          bike_handover_amount,
          bike_followup_amount,
          accessory_rate,
          repair_inspection_amount,
          effective_from,
          effective_to,
          agreement_text
        )
        VALUES (
          1,
          'integration-test-v1',
          'ACTIVE',
          420.00,
          120.00,
          60.00,
          0.100000,
          100.00,
          '2026-07-21 00:00:00',
          NULL,
          'integration test'
        )
      `
    );

    const plan = await getActiveIncentivePlan(
      connection,
      1,
      new Date("2026-07-21T12:00:00Z")
    );

    assert(plan, "active incentive plan must be found");
    assert.strictEqual(plan.id, planResult.insertId);
    assert.strictEqual(plan.bikeSaleAmount, 420);
    assert.strictEqual(plan.accessoryRate, 0.1);

    await connection.beginTransaction();

    const created = await upsertIncentiveEvent(connection, {
      storeId: 1,
      staffUserId: 8,
      planVersionId: plan.id,
      incentiveType: "BIKE",
      earningStage: "SALE",
      sourceType: "ORDER",
      sourceId: 100,
      sourceLineId: 0,
      quantity: 1,
      actualSaleAmount: 0,
      rate: 0,
      calculatedAmount: 420,
      assignedRatio: 1,
      finalAmount: 420,
      status: "EARNED",
      metadata: {
        test: true
      }
    });

    assert.strictEqual(created.action, "CREATED");
    assert.strictEqual(created.event.staffUserId, 8);
    assert.strictEqual(created.event.finalAmount, 420);
    assert.strictEqual(created.event.status, "EARNED");

    const updated = await upsertIncentiveEvent(connection, {
      storeId: 1,
      staffUserId: 8,
      planVersionId: plan.id,
      incentiveType: "BIKE",
      earningStage: "SALE",
      sourceType: "ORDER",
      sourceId: 100,
      sourceLineId: 0,
      quantity: 1,
      actualSaleAmount: 0,
      rate: 0,
      calculatedAmount: 420,
      assignedRatio: 1,
      finalAmount: 420,
      status: "EARNED",
      metadata: {
        test: "updated"
      }
    });

    assert.strictEqual(updated.action, "UPDATED");
    assert.strictEqual(updated.event.id, created.event.id);

    await connection.query(
      `
        UPDATE staff_incentive_events
        SET status = 'PAID',
            paid_at = CURRENT_TIMESTAMP,
            payroll_month = '2026-07'
        WHERE id = ?
      `,
      [created.event.id]
    );

    const locked = await upsertIncentiveEvent(connection, {
      storeId: 1,
      staffUserId: 8,
      planVersionId: plan.id,
      incentiveType: "BIKE",
      earningStage: "SALE",
      sourceType: "ORDER",
      sourceId: 100,
      sourceLineId: 0,
      quantity: 1,
      actualSaleAmount: 0,
      rate: 0,
      calculatedAmount: 0,
      assignedRatio: 1,
      finalAmount: 0,
      status: "PENDING"
    });

    assert.strictEqual(locked.action, "UNCHANGED_LOCKED");
    assert.strictEqual(locked.event.status, "PAID");
    assert.strictEqual(locked.event.finalAmount, 420);

    const secondStaff = await upsertIncentiveEvent(connection, {
      storeId: 1,
      staffUserId: 9,
      planVersionId: plan.id,
      incentiveType: "ACCESSORY",
      earningStage: "ITEM",
      sourceType: "ORDER_ITEM",
      sourceId: 100,
      sourceLineId: 501,
      productId: null,
      productNameSnapshot: "前車籃",
      quantity: 1,
      actualSaleAmount: 1000,
      rate: 0.1,
      calculatedAmount: 100,
      assignedRatio: 1,
      finalAmount: 100,
      status: "EARNED"
    });

    assert.strictEqual(secondStaff.action, "CREATED");

    const staffView = await listIncentiveEvents(connection, {
      storeId: 1,
      requesterRole: "CASHIER",
      requesterStaffUserId: 8,
      staffUserId: 9,
      limit: 100,
      offset: 0
    });

    assert.strictEqual(staffView.length, 1);
    assert.strictEqual(staffView[0].staffUserId, 8);

    const adminView = await listIncentiveEvents(connection, {
      storeId: 1,
      requesterRole: "ADMIN",
      requesterStaffUserId: 1,
      limit: 100,
      offset: 0
    });

    assert.strictEqual(adminView.length, 2);
    assert.deepStrictEqual(
      new Set(adminView.map((event) => event.staffUserId)),
      new Set([8, 9])
    );

    await connection.rollback();

    console.log("staff incentive MySQL integration tests passed");
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {
      // Ignore cleanup failure and preserve the original error.
    }

    throw error;
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
