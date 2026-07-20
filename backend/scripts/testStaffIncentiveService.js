const assert = require("assert");

const {
  getActiveIncentivePlan,
  upsertIncentiveEvent,
  resolveVisibleStaffId,
  listIncentiveEvents
} = require("../src/services/staffIncentiveService");

function createMockConnection(responses) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({
        sql: String(sql).replace(/\s+/g, " ").trim(),
        params
      });

      if (!responses.length) {
        throw new Error("Unexpected mock DB query");
      }

      return responses.shift();
    }
  };
}

async function testActivePlan() {
  const connection = createMockConnection([
    [[{
      id: 3,
      storeId: 1,
      version: "2026-01",
      status: "ACTIVE",
      bikeSaleAmount: "420.00",
      bikeHandoverAmount: "120.00",
      bikeFollowupAmount: "60.00",
      accessoryRate: "0.100000",
      repairInspectionAmount: "100.00",
      effectiveFrom: "2026-07-21 00:00:00",
      effectiveTo: null,
      agreementText: "test"
    }]]
  ]);

  const plan = await getActiveIncentivePlan(
    connection,
    1,
    new Date("2026-07-21T00:00:00Z")
  );

  assert.strictEqual(plan.id, 3);
  assert.strictEqual(plan.bikeSaleAmount, 420);
  assert.strictEqual(plan.accessoryRate, 0.1);
  assert.strictEqual(connection.calls.length, 1);
}

async function testCreateEvent() {
  const connection = createMockConnection([
    [[]],
    [{ insertId: 77 }],
    [[{
      id: 77,
      storeId: 1,
      staffUserId: 8,
      staffDisplayName: "王小明",
      planVersionId: 3,
      payoutId: null,
      incentiveType: "ACCESSORY",
      earningStage: "ITEM",
      sourceType: "ORDER_ITEM",
      sourceId: 90,
      sourceLineId: 501,
      productId: 12,
      productNameSnapshot: "前車籃",
      quantity: 1,
      actualSaleAmount: "888.00",
      rate: "0.100000",
      calculatedAmount: "88.80",
      assignedRatio: "1.000000",
      finalAmount: "88.80",
      status: "EARNED",
      pendingReason: null,
      voidReason: null,
      metadataJson: "{}",
      earnedAt: "2026-07-21 10:00:00",
      approvedByStaffId: null,
      approvedAt: null,
      payrollMonth: null,
      paidAt: null,
      createdAt: "2026-07-21 10:00:00",
      updatedAt: "2026-07-21 10:00:00"
    }]]
  ]);

  const result = await upsertIncentiveEvent(connection, {
    storeId: 1,
    staffUserId: 8,
    planVersionId: 3,
    incentiveType: "ACCESSORY",
    earningStage: "ITEM",
    sourceType: "ORDER_ITEM",
    sourceId: 90,
    sourceLineId: 501,
    productId: 12,
    productNameSnapshot: "前車籃",
    quantity: 1,
    actualSaleAmount: 888,
    rate: 0.1,
    calculatedAmount: 88.8,
    assignedRatio: 1,
    finalAmount: 88.8,
    status: "EARNED",
    metadata: {}
  });

  assert.strictEqual(result.action, "CREATED");
  assert.strictEqual(result.event.id, 77);
  assert.strictEqual(result.event.finalAmount, 88.8);
  assert.strictEqual(connection.calls.length, 3);
}

async function testUpdatePendingEvent() {
  const connection = createMockConnection([
    [[{
      id: 42,
      status: "PENDING"
    }]],
    [{ affectedRows: 1 }],
    [[{
      id: 42,
      storeId: 1,
      staffUserId: 8,
      staffDisplayName: "王小明",
      planVersionId: 3,
      payoutId: null,
      incentiveType: "BIKE",
      earningStage: "SALE",
      sourceType: "ORDER",
      sourceId: 90,
      sourceLineId: 0,
      productId: null,
      productNameSnapshot: null,
      quantity: 1,
      actualSaleAmount: "0.00",
      rate: "0.000000",
      calculatedAmount: "420.00",
      assignedRatio: "1.000000",
      finalAmount: "420.00",
      status: "EARNED",
      pendingReason: null,
      voidReason: null,
      metadataJson: null,
      earnedAt: "2026-07-21 10:00:00",
      approvedByStaffId: null,
      approvedAt: null,
      payrollMonth: null,
      paidAt: null,
      createdAt: "2026-07-21 09:00:00",
      updatedAt: "2026-07-21 10:00:00"
    }]]
  ]);

  const result = await upsertIncentiveEvent(connection, {
    storeId: 1,
    staffUserId: 8,
    planVersionId: 3,
    incentiveType: "BIKE",
    earningStage: "SALE",
    sourceType: "ORDER",
    sourceId: 90,
    sourceLineId: 0,
    calculatedAmount: 420,
    assignedRatio: 1,
    finalAmount: 420,
    status: "EARNED"
  });

  assert.strictEqual(result.action, "UPDATED");
  assert.strictEqual(result.event.status, "EARNED");
  assert.strictEqual(connection.calls.length, 3);
}

async function testPaidEventCannotBeChanged() {
  const connection = createMockConnection([
    [[{
      id: 15,
      status: "PAID"
    }]],
    [[{
      id: 15,
      storeId: 1,
      staffUserId: 8,
      staffDisplayName: "王小明",
      planVersionId: 3,
      payoutId: 9,
      incentiveType: "BIKE",
      earningStage: "SALE",
      sourceType: "ORDER",
      sourceId: 55,
      sourceLineId: 0,
      productId: null,
      productNameSnapshot: null,
      quantity: 1,
      actualSaleAmount: "0.00",
      rate: "0.000000",
      calculatedAmount: "420.00",
      assignedRatio: "1.000000",
      finalAmount: "420.00",
      status: "PAID",
      pendingReason: null,
      voidReason: null,
      metadataJson: null,
      earnedAt: "2026-07-10 10:00:00",
      approvedByStaffId: 1,
      approvedAt: "2026-07-11 10:00:00",
      payrollMonth: "2026-07",
      paidAt: "2026-07-15 10:00:00",
      createdAt: "2026-07-10 10:00:00",
      updatedAt: "2026-07-15 10:00:00"
    }]]
  ]);

  const result = await upsertIncentiveEvent(connection, {
    storeId: 1,
    staffUserId: 8,
    planVersionId: 3,
    incentiveType: "BIKE",
    earningStage: "SALE",
    sourceType: "ORDER",
    sourceId: 55,
    finalAmount: 0,
    status: "PENDING"
  });

  assert.strictEqual(result.action, "UNCHANGED_LOCKED");
  assert.strictEqual(result.event.status, "PAID");
  assert.strictEqual(result.event.finalAmount, 420);
  assert.strictEqual(connection.calls.length, 2);
}

async function testVisibility() {
  assert.strictEqual(
    resolveVisibleStaffId({
      requesterRole: "CASHIER",
      requesterStaffUserId: 8,
      requestedStaffUserId: 9
    }),
    8
  );

  assert.strictEqual(
    resolveVisibleStaffId({
      requesterRole: "ADMIN",
      requesterStaffUserId: 1,
      requestedStaffUserId: 9
    }),
    9
  );

  assert.strictEqual(
    resolveVisibleStaffId({
      requesterRole: "ADMIN",
      requesterStaffUserId: 1
    }),
    null
  );
}

async function testStaffListIsSelfOnly() {
  const connection = createMockConnection([
    [[]]
  ]);

  await listIncentiveEvents(connection, {
    storeId: 1,
    requesterRole: "CASHIER",
    requesterStaffUserId: 8,
    staffUserId: 99,
    statuses: ["EARNED"],
    limit: 20,
    offset: 0
  });

  const params = connection.calls[0].params;

  assert.strictEqual(params[0], 1);
  assert.strictEqual(params[1], 8);
  assert.deepStrictEqual(params[2], ["EARNED"]);
  assert.strictEqual(params[3], 20);
  assert.strictEqual(params[4], 0);
}

async function testInvalidEventPayloads() {
  const connection = createMockConnection([]);

  const baseEvent = {
    storeId: 1,
    staffUserId: 8,
    incentiveType: "ACCESSORY",
    earningStage: "ITEM",
    sourceType: "ORDER_ITEM",
    sourceId: 90,
    sourceLineId: 501,
    quantity: 1,
    actualSaleAmount: 1000,
    rate: 0.1,
    calculatedAmount: 100,
    assignedRatio: 1,
    finalAmount: 100,
    status: "EARNED"
  };

  await assert.rejects(
    () => upsertIncentiveEvent(connection, {
      ...baseEvent,
      quantity: "invalid"
    }),
    /數量/
  );

  await assert.rejects(
    () => upsertIncentiveEvent(connection, {
      ...baseEvent,
      sourceLineId: "invalid"
    }),
    /來源明細/
  );

  await assert.rejects(
    () => upsertIncentiveEvent(connection, {
      ...baseEvent,
      finalAmount: -100
    }),
    /最終績效金額/
  );

  assert.strictEqual(
    connection.calls.length,
    0,
    "invalid payload must fail before any DB query"
  );
}

async function run() {
  await testActivePlan();
  await testCreateEvent();
  await testUpdatePendingEvent();
  await testPaidEventCannotBeChanged();
  await testVisibility();
  await testStaffListIsSelfOnly();
  await testInvalidEventPayloads();

  console.log("staff incentive service tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
