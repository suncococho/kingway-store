const assert = require("assert");
const {
  normalizeMonth,
  getMonthRange,
  summarizeEvents,
  createDispute,
  updateAdminDispute
} = require("../src/services/staffIncentiveDashboardService");

function mockConnection(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (!responses.length) throw new Error("Unexpected DB query");
      return responses.shift();
    }
  };
}

function testMonthValidation() {
  assert.strictEqual(normalizeMonth("2026-07"), "2026-07");
  assert.deepStrictEqual(getMonthRange("2026-12"), {
    month: "2026-12",
    start: "2026-12-01 00:00:00",
    end: "2027-01-01 00:00:00"
  });
  assert.throws(() => normalizeMonth("2026-13"), /YYYY-MM/);
  assert.throws(() => normalizeMonth("2026/07"), /YYYY-MM/);
}

function testSummary() {
  const aggregate = summarizeEvents([
    { finalAmount: 420, status: "EARNED", incentiveType: "BIKE", earningStage: "SALE" },
    { finalAmount: 120, status: "APPROVED", incentiveType: "BIKE", earningStage: "HANDOVER" },
    { finalAmount: 60, status: "PAID", incentiveType: "BIKE", earningStage: "FOLLOWUP" },
    { finalAmount: 88.8, status: "PENDING", incentiveType: "ACCESSORY", earningStage: "ITEM" },
    { finalAmount: 100, status: "DISPUTED", incentiveType: "REPAIR_INSPECTION", earningStage: "INSPECTION" },
    { finalAmount: 999, status: "VOID", incentiveType: "ACCESSORY", earningStage: "ITEM" }
  ]);
  assert.strictEqual(aggregate.summary.totalAmount, 788.8);
  assert.strictEqual(aggregate.summary.pendingAmount, 88.8);
  assert.strictEqual(aggregate.summary.earnedAmount, 420);
  assert.strictEqual(aggregate.summary.approvedAmount, 120);
  assert.strictEqual(aggregate.summary.paidAmount, 60);
  assert.strictEqual(aggregate.summary.disputedAmount, 100);
  assert.strictEqual(aggregate.summary.bikeAmount, 600);
  assert.strictEqual(aggregate.summary.accessoryAmount, 88.8);
  assert.strictEqual(aggregate.summary.repairInspectionAmount, 100);
  assert.strictEqual(aggregate.statusCounts.VOID.count, 1);
  assert.strictEqual(aggregate.typeCounts.ACCESSORY.amount, 88.8);
}

async function testCreateDisputeSelfOnlyAndNoClawback() {
  const connection = mockConnection([
    [[
      { tableName: "staff_incentive_plan_versions" },
      { tableName: "staff_incentive_agreements" },
      { tableName: "staff_incentive_payouts" },
      { tableName: "staff_incentive_events" },
      { tableName: "staff_incentive_adjustments" },
      { tableName: "staff_incentive_disputes" }
    ]],
    [[{ id: 77, status: "PAID", finalAmount: "420.00" }]],
    [[]],
    [{ insertId: 9 }]
  ]);
  const result = await createDispute(connection, {
    storeId: 1,
    staffUserId: 8,
    eventId: 77,
    reason: "此筆歸屬需要確認"
  });
  assert.strictEqual(result.status, "OPEN");
  assert.strictEqual(result.eventStatus, "PAID");
  assert.strictEqual(result.eventAmount, 420);
  const eventLookup = connection.calls[1];
  assert.deepStrictEqual(eventLookup.params, [77, 1, 8]);
  assert(!connection.calls.some((call) => /UPDATE staff_incentive_events/i.test(call.sql)), "dispute must not claw back or rewrite event");
}

async function testDuplicateDisputeBlocked() {
  const connection = mockConnection([
    [[
      { tableName: "staff_incentive_plan_versions" },
      { tableName: "staff_incentive_agreements" },
      { tableName: "staff_incentive_payouts" },
      { tableName: "staff_incentive_events" },
      { tableName: "staff_incentive_adjustments" },
      { tableName: "staff_incentive_disputes" }
    ]],
    [[{ id: 77, status: "EARNED", finalAmount: "60.00" }]],
    [[{ id: 3 }]]
  ]);
  await assert.rejects(
    () => createDispute(connection, { storeId: 1, staffUserId: 8, eventId: 77, reason: "重複異議測試" }),
    (error) => error.statusCode === 409
  );
}

async function testAdminResolutionRequiresResponse() {
  const connection = mockConnection([
    [[
      { tableName: "staff_incentive_plan_versions" },
      { tableName: "staff_incentive_agreements" },
      { tableName: "staff_incentive_payouts" },
      { tableName: "staff_incentive_events" },
      { tableName: "staff_incentive_adjustments" },
      { tableName: "staff_incentive_disputes" }
    ]]
  ]);
  await assert.rejects(
    () => updateAdminDispute(connection, {
      storeId: 1,
      disputeId: 2,
      adminStaffUserId: 1,
      status: "RESOLVED",
      adminResponse: ""
    }),
    /必須填寫/
  );
}

async function run() {
  testMonthValidation();
  testSummary();
  await testCreateDisputeSelfOnlyAndNoClawback();
  await testDuplicateDisputeBlocked();
  await testAdminResolutionRequiresResponse();
  console.log("staff incentive dashboard service tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
