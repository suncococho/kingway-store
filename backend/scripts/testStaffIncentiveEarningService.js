const assert = require("assert");

const {
  isVehicleItem,
  isAccessoryItem,
  allocateOrderActualSaleAmounts,
  isPurchaseConfirmationComplete,
  buildOrderSaleIncentiveCandidates,
  reconcileOrderSaleIncentives
} = require("../src/services/staffIncentiveEarningService");

const plan = {
  id: 3,
  bikeSaleAmount: 420,
  bikeHandoverAmount: 120,
  bikeFollowupAmount: 60,
  accessoryRate: 0.1,
  repairInspectionAmount: 100
};

function createPaidOrder(overrides = {}) {
  return {
    id: 100,
    storeId: 1,
    salesStaffId: 8,
    salesStaffName: "王小明",
    status: "COMPLETED",
    orderType: "GENERAL",
    source: "WEB",
    repairOrderId: null,
    finalPaymentStatus: "PAID",
    unpaidBalance: 0,
    deletedAt: null,
    ...overrides
  };
}

function createCompletedConfirmation() {
  return {
    id: 50,
    status: "COMPLETED",
    submittedAt: "2026-07-21 10:00:00",
    finalConfirmationAccepted: 1
  };
}

function createVehicleItem(overrides = {}) {
  return {
    id: 501,
    productId: 21,
    skuSnapshot: "B-EB-001",
    productNameSnapshot: "KINGWAY 電動自行車",
    productCategorySnapshot: "EBIKE",
    masterCategory: "EB",
    quantity: 1,
    unitPrice: 50000,
    lineTotal: 50000,
    ...overrides
  };
}

function createAccessoryItem(overrides = {}) {
  return {
    id: 601,
    productId: 31,
    skuSnapshot: "AC-BASKET",
    productNameSnapshot: "前車籃",
    productCategorySnapshot: "ACCESSORY",
    masterCategory: "AC",
    quantity: 1,
    unitPrice: 1000,
    lineTotal: 1000,
    ...overrides
  };
}

function testClassification() {
  assert.strictEqual(isVehicleItem(createVehicleItem()), true);
  assert.strictEqual(
    isVehicleItem({
      productCategorySnapshot: "PT",
      skuSnapshot: "PT-001"
    }),
    false
  );
  assert.strictEqual(isAccessoryItem(createAccessoryItem()), true);
  assert.strictEqual(
    isAccessoryItem({
      productCategorySnapshot: "PT",
      masterCategory: "AC"
    }),
    true
  );
}

function testPurchaseConfirmationCompletion() {
  assert.strictEqual(
    isPurchaseConfirmationComplete(createCompletedConfirmation()),
    true
  );
  assert.strictEqual(
    isPurchaseConfirmationComplete({
      status: "PENDING",
      submittedAt: "2026-07-21 10:00:00",
      finalConfirmationAccepted: 1
    }),
    true
  );
  assert.strictEqual(
    isPurchaseConfirmationComplete({
      status: "PENDING",
      submittedAt: null,
      finalConfirmationAccepted: 0
    }),
    false
  );
}

function testAccessoryEarnsAfterPaymentWithoutConfirmation() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder(),
      purchaseConfirmation: null,
      items: [createAccessoryItem()]
    },
    plan,
    triggerSource: "PAYMENT_COMPLETED"
  });

  assert.strictEqual(evaluation.eligible, true);
  assert.strictEqual(evaluation.candidates.length, 1);

  const event = evaluation.candidates[0];
  assert.strictEqual(event.incentiveType, "ACCESSORY");
  assert.strictEqual(event.earningStage, "ITEM");
  assert.strictEqual(event.sourceLineId, 601);
  assert.strictEqual(event.actualSaleAmount, 1000);
  assert.strictEqual(event.finalAmount, 100);
}

function testBikeWaitsForPurchaseConfirmation() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder(),
      purchaseConfirmation: null,
      items: [createVehicleItem()]
    },
    plan
  });

  assert.strictEqual(evaluation.eligible, false);
  assert.strictEqual(evaluation.candidates.length, 0);
}

function testBikeEarns420PerVehicle() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder(),
      purchaseConfirmation: createCompletedConfirmation(),
      items: [
        createVehicleItem({
          quantity: 2,
          lineTotal: 100000
        })
      ]
    },
    plan,
    triggerSource: "PURCHASE_CONFIRMATION_SUBMITTED"
  });

  assert.strictEqual(evaluation.eligible, true);
  assert.strictEqual(evaluation.candidates.length, 1);

  const event = evaluation.candidates[0];
  assert.strictEqual(event.incentiveType, "BIKE");
  assert.strictEqual(event.earningStage, "SALE");
  assert.strictEqual(event.quantity, 2);
  assert.strictEqual(event.calculatedAmount, 840);
  assert.strictEqual(event.finalAmount, 840);
}

function testDiscountAllocation() {
  const vehicle = createVehicleItem();
  const accessory = createAccessoryItem();

  const allocations =
    allocateOrderActualSaleAmounts(
      [vehicle, accessory],
      45900
    );

  assert.strictEqual(
    allocations.get(vehicle),
    45000
  );

  assert.strictEqual(
    allocations.get(accessory),
    900
  );
}

function testAccessoryUsesDiscountedAmount() {
  const evaluation =
    buildOrderSaleIncentiveCandidates({
      snapshot: {
        order: createPaidOrder({
          totalAmount: 45900
        }),
        purchaseConfirmation: null,
        items: [
          createVehicleItem(),
          createAccessoryItem()
        ]
      },
      plan,
      triggerSource: "PAYMENT_COMPLETED"
    });

  assert.strictEqual(evaluation.eligible, true);
  assert.strictEqual(
    evaluation.candidates.length,
    1
  );

  const event = evaluation.candidates[0];

  assert.strictEqual(
    event.incentiveType,
    "ACCESSORY"
  );

  assert.strictEqual(
    event.actualSaleAmount,
    900
  );

  assert.strictEqual(
    event.finalAmount,
    90
  );
}

function testSharedBikeSaleSplitsSeventyThirty() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder({
        salesSupportStaffId: 9,
        salesSupportStaffName: "李協助"
      }),
      purchaseConfirmation: createCompletedConfirmation(),
      items: [createVehicleItem()]
    },
    plan,
    triggerSource: "PURCHASE_CONFIRMATION_SUBMITTED"
  });

  assert.strictEqual(evaluation.eligible, true);
  assert.strictEqual(evaluation.candidates.length, 2);

  const primary = evaluation.candidates.find(
    (event) => event.staffUserId === 8
  );
  const support = evaluation.candidates.find(
    (event) => event.staffUserId === 9
  );

  assert(primary);
  assert(support);

  assert.strictEqual(primary.incentiveType, "BIKE");
  assert.strictEqual(primary.calculatedAmount, 420);
  assert.strictEqual(primary.assignedRatio, 0.7);
  assert.strictEqual(primary.finalAmount, 294);
  assert.strictEqual(
    primary.metadata.salesAssignmentRole,
    "PRIMARY"
  );

  assert.strictEqual(support.incentiveType, "BIKE");
  assert.strictEqual(support.calculatedAmount, 420);
  assert.strictEqual(support.assignedRatio, 0.3);
  assert.strictEqual(support.finalAmount, 126);
  assert.strictEqual(
    support.metadata.salesAssignmentRole,
    "SUPPORT"
  );

  assert.strictEqual(
    primary.finalAmount + support.finalAmount,
    420
  );
}

function testSharedAccessorySplitsSeventyThirty() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder({
        salesSupportStaffId: 9,
        salesSupportStaffName: "李協助"
      }),
      purchaseConfirmation: null,
      items: [createAccessoryItem()]
    },
    plan,
    triggerSource: "PAYMENT_COMPLETED"
  });

  assert.strictEqual(evaluation.eligible, true);
  assert.strictEqual(evaluation.candidates.length, 2);

  const primary = evaluation.candidates.find(
    (event) => event.staffUserId === 8
  );
  const support = evaluation.candidates.find(
    (event) => event.staffUserId === 9
  );

  assert(primary);
  assert(support);

  assert.strictEqual(primary.incentiveType, "ACCESSORY");
  assert.strictEqual(primary.calculatedAmount, 100);
  assert.strictEqual(primary.assignedRatio, 0.7);
  assert.strictEqual(primary.finalAmount, 70);

  assert.strictEqual(support.incentiveType, "ACCESSORY");
  assert.strictEqual(support.calculatedAmount, 100);
  assert.strictEqual(support.assignedRatio, 0.3);
  assert.strictEqual(support.finalAmount, 30);

  assert.strictEqual(
    primary.finalAmount + support.finalAmount,
    100
  );
}

async function testSharedReconciliationCreatesSeparateEvents() {
  const saved = [];

  const dependencies = {
    async loadOrderSaleIncentiveSnapshot() {
      return {
        order: createPaidOrder({
          salesSupportStaffId: 9,
          salesSupportStaffName: "李協助"
        }),
        purchaseConfirmation: createCompletedConfirmation(),
        items: [
          createVehicleItem(),
          createAccessoryItem()
        ]
      };
    },

    async getActiveIncentivePlan() {
      return plan;
    },

    async upsertIncentiveEvent(connection, event) {
      saved.push(event);
      return {
        action: "CREATED",
        event
      };
    }
  };

  const result = await reconcileOrderSaleIncentives({
    connection: {},
    storeId: 1,
    orderId: 100,
    triggerSource: "SHARED_SALE_TEST",
    dependencies
  });

  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.results.length, 4);
  assert.strictEqual(saved.length, 4);

  const keys = saved.map((event) => [
    event.staffUserId,
    event.incentiveType,
    event.earningStage,
    event.sourceType,
    event.sourceId,
    event.sourceLineId
  ].join(":"));

  assert.strictEqual(
    new Set(keys).size,
    keys.length
  );

  const bikeEvents = saved.filter(
    (event) => event.incentiveType === "BIKE"
  );

  const accessoryEvents = saved.filter(
    (event) => event.incentiveType === "ACCESSORY"
  );

  assert.strictEqual(bikeEvents.length, 2);
  assert.strictEqual(accessoryEvents.length, 2);

  assert.strictEqual(
    bikeEvents.reduce(
      (sum, event) => sum + event.finalAmount,
      0
    ),
    420
  );

  assert.strictEqual(
    accessoryEvents.reduce(
      (sum, event) => sum + event.finalAmount,
      0
    ),
    100
  );
}

function testUnpaidOrderEarnsNothing() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder({
        finalPaymentStatus: "PARTIAL",
        unpaidBalance: 1000
      }),
      purchaseConfirmation: createCompletedConfirmation(),
      items: [createVehicleItem(), createAccessoryItem()]
    },
    plan
  });

  assert.strictEqual(evaluation.eligible, false);
  assert.strictEqual(evaluation.reason, "ORDER_NOT_PAID");
}

function testRepairOrderAccessoriesExcluded() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder({
        source: "repair_quote",
        repairOrderId: 77
      }),
      purchaseConfirmation: null,
      items: [createAccessoryItem()]
    },
    plan
  });

  assert.strictEqual(evaluation.eligible, false);
  assert.strictEqual(evaluation.reason, "REPAIR_ORDER_EXCLUDED");
}

function testOrdinaryPartsExcluded() {
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot: {
      order: createPaidOrder(),
      purchaseConfirmation: null,
      items: [
        {
          id: 700,
          productId: 40,
          productNameSnapshot: "一般煞車皮",
          productCategorySnapshot: "PT",
          masterCategory: "PT",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500
        }
      ]
    },
    plan
  });

  assert.strictEqual(evaluation.eligible, false);
  assert.strictEqual(evaluation.candidates.length, 0);
}

async function testReconciliationUsesIdempotentKeys() {
  const saved = [];

  const dependencies = {
    async loadOrderSaleIncentiveSnapshot() {
      return {
        order: createPaidOrder(),
        purchaseConfirmation: createCompletedConfirmation(),
        items: [createVehicleItem(), createAccessoryItem()]
      };
    },

    async getActiveIncentivePlan() {
      return plan;
    },

    async upsertIncentiveEvent(connection, event) {
      saved.push(event);
      return { action: "CREATED", event };
    }
  };

  const result = await reconcileOrderSaleIncentives({
    connection: {},
    storeId: 1,
    orderId: 100,
    triggerSource: "TEST",
    dependencies
  });

  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(saved.length, 2);

  const keys = saved.map((event) => [
    event.staffUserId,
    event.incentiveType,
    event.earningStage,
    event.sourceType,
    event.sourceId,
    event.sourceLineId
  ].join(":"));

  assert.strictEqual(new Set(keys).size, keys.length);
  assert.deepStrictEqual(
    new Set(saved.map((event) => event.incentiveType)),
    new Set(["BIKE", "ACCESSORY"])
  );
}

async function run() {
  testClassification();
  testPurchaseConfirmationCompletion();
  testAccessoryEarnsAfterPaymentWithoutConfirmation();
  testBikeWaitsForPurchaseConfirmation();
  testBikeEarns420PerVehicle();
  testDiscountAllocation();
  testAccessoryUsesDiscountedAmount();
  testSharedBikeSaleSplitsSeventyThirty();
  testSharedAccessorySplitsSeventyThirty();
  testUnpaidOrderEarnsNothing();
  testRepairOrderAccessoriesExcluded();
  testOrdinaryPartsExcluded();
  await testReconciliationUsesIdempotentKeys();
  await testSharedReconciliationCreatesSeparateEvents();

  console.log("staff incentive earning service tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
