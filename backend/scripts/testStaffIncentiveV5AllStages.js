const assert = require("assert");
const {
  buildOrderSaleIncentiveCandidates,
  reconcileOrderSaleIncentives
} = require("../src/services/staffIncentiveEarningService");

const plan = {
  id: 5,
  bikeTotalAmount: 600,
  payoutMode: "ALL_STAGES_COMPLETED",
  bikeSaleAmount: 0,
  bikeHandoverAmount: 0,
  bikeFollowupAmount: 0,
  accessoryRate: 0.1,
  repairInspectionAmount: 100
};

function order(overrides = {}) {
  return {
    id: 10, storeId: 1, salesStaffId: 8, salesStaffValid: 1,
    status: "COMPLETED", source: "WEB", orderType: "GENERAL",
    finalPaymentStatus: "PAID", unpaidBalance: 0, totalAmount: 50000,
    handoverConfirmedAt: null, deletedAt: null, ...overrides
  };
}

function vehicle(overrides = {}) {
  return {
    id: 20, productId: 30, skuSnapshot: "B-EB-001",
    productNameSnapshot: "電動自行車", productCategorySnapshot: "EBIKE",
    masterCategory: "EB", quantity: 1, unitPrice: 50000,
    lineTotal: 50000, ...overrides
  };
}

const confirmation = {
  id: 40, status: "COMPLETED", submittedAt: "2026-07-25 09:00:00",
  finalConfirmationAccepted: 1
};
const followup = {
  id: 50, status: "COMPLETED", customerResult: "NO_ISSUE",
  completedAt: "2026-07-26 09:00:00", unresolvedEmployeeIssue: false
};

function evaluate(orderOverrides = {}, snapshotOverrides = {}) {
  return buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: order(orderOverrides), purchaseConfirmation: confirmation,
      orderSalesFollowup: null, items: [vehicle()], ...snapshotOverrides
    },
    plan
  });
}

function testStagesGate() {
  const saleOnly = evaluate();
  assert.strictEqual(saleOnly.candidates.filter((e) => e.incentiveType === "BIKE").length, 0);

  const handedOver = evaluate({ handoverConfirmedAt: "2026-07-25 12:00:00" });
  assert.strictEqual(handedOver.candidates.filter((e) => e.incentiveType === "BIKE").length, 0);

  const complete = evaluate(
    { handoverConfirmedAt: "2026-07-25 12:00:00" },
    { orderSalesFollowup: followup }
  );
  const bikeEvents = complete.candidates.filter((e) => e.incentiveType === "BIKE");
  assert.strictEqual(bikeEvents.length, 1);
  assert.strictEqual(bikeEvents[0].earningStage, "ALL_STAGES");
  assert.strictEqual(bikeEvents[0].finalAmount, 600);
}

function testNoResponseApprovalGate() {
  const base = { ...followup, customerResult: "NO_RESPONSE" };
  const denied = evaluate({ handoverConfirmedAt: "2026-07-25 12:00:00" }, { orderSalesFollowup: base });
  assert.strictEqual(denied.candidates.filter((e) => e.incentiveType === "BIKE").length, 0);
  const approved = evaluate({ handoverConfirmedAt: "2026-07-25 12:00:00" }, { orderSalesFollowup: { ...base, noResponseApprovedBy: 1, noResponseApprovedAt: "2026-07-26 10:00:00", noResponseApprovalReason: "已完成兩次聯絡" } });
  assert.strictEqual(approved.candidates.filter((e) => e.incentiveType === "BIKE")[0].finalAmount, 600);
}

function testLargeQuantityIdentity() {
  const result = evaluate({ handoverConfirmedAt: "2026-07-25 12:00:00" }, { orderSalesFollowup: followup, items: [vehicle({ quantity: 1001, lineTotal: 50050000 })] });
  const keys = result.candidates.filter((e) => e.incentiveType === "BIKE").map((e) => e.sourceUnitKey);
  assert.strictEqual(keys.length, 1001);
  assert.strictEqual(new Set(keys).size, 1001);
}

function testTwoVehicles() {
  const result = evaluate(
    { handoverConfirmedAt: "2026-07-25 12:00:00", totalAmount: 100000 },
    { orderSalesFollowup: followup, items: [vehicle({ quantity: 2, lineTotal: 100000 })] }
  );
  const bikes = result.candidates.filter((e) => e.incentiveType === "BIKE");
  assert.strictEqual(bikes.length, 2);
  assert.strictEqual(new Set(bikes.map((e) => e.sourceUnitKey)).size, 2);
  assert.strictEqual(bikes.reduce((sum, e) => sum + e.finalAmount, 0), 1200);
}

function testSharedSale() {
  const result = evaluate(
    {
      handoverConfirmedAt: "2026-07-25 12:00:00",
      salesSupportStaffId: 9, salesSupportStaffName: "協助員工"
    },
    { orderSalesFollowup: followup }
  );
  const bikes = result.candidates.filter((e) => e.incentiveType === "BIKE");
  assert.deepStrictEqual(bikes.map((e) => e.finalAmount).sort((a, b) => a - b), [180, 420]);
  assert.strictEqual(bikes.reduce((sum, e) => sum + e.finalAmount, 0), 600);
  assert.strictEqual(
    new Set(bikes.map((e) => e.metadata.vehiclePayoutKey)).size,
    1
  );
}

function testAccessoryAndCanceled() {
  const accessory = {
    id: 21, productId: 31, skuSnapshot: "AC-001",
    productNameSnapshot: "配件", productCategorySnapshot: "ACCESSORY",
    masterCategory: "AC", quantity: 1, unitPrice: 1000, lineTotal: 800
  };
  const result = buildOrderSaleIncentiveCandidates({
    snapshot: { order: order({ totalAmount: 800 }), purchaseConfirmation: null, items: [accessory] },
    plan
  });
  assert.strictEqual(result.candidates[0].finalAmount, 80);
  assert.strictEqual(evaluate({ status: "CANCELED" }).candidates.length, 0);
}

async function testIdempotentAndCancellationReconciliation() {
  const saved = new Map();
  const completeSnapshot = {
    order: order({ handoverConfirmedAt: "2026-07-25 12:00:00" }),
    purchaseConfirmation: confirmation, orderSalesFollowup: followup,
    items: [vehicle()]
  };
  const dependencies = {
    loadOrderSaleIncentiveSnapshot: async () => completeSnapshot,
    getActiveIncentivePlan: async () => plan,
    upsertIncentiveEvent: async (_connection, event) => {
      const key = `${event.staffUserId}:${event.sourceLineId}:${event.earningStage}`;
      saved.set(key, event);
      return { action: saved.has(key) ? "UPSERTED" : "CREATED", event };
    }
  };
  const connection = { query: async () => [[]] };
  await reconcileOrderSaleIncentives({ connection, storeId: 1, orderId: 10, dependencies });
  await reconcileOrderSaleIncentives({ connection, storeId: 1, orderId: 10, dependencies });
  assert.strictEqual(saved.size, 1);

  dependencies.loadOrderSaleIncentiveSnapshot = async () => ({ ...completeSnapshot, order: order({ status: "CANCELED" }) });
  const canceled = await reconcileOrderSaleIncentives({ connection, storeId: 1, orderId: 10, dependencies });
  assert.strictEqual(canceled.managerAdjustmentRequired, false);
}

async function main() {
  testStagesGate();
  testNoResponseApprovalGate();
  testLargeQuantityIdentity();
  testTwoVehicles();
  testSharedSale();
  testAccessoryAndCanceled();
  await testIdempotentAndCancellationReconciliation();
  console.log("staff incentive V5 all-stages tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
