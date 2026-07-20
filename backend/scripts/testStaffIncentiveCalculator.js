const assert = require("assert");

const {
  splitFixedAmount,
  isAccessoryCategory,
  calculateBikeStageIncentive,
  calculateAccessoryIncentive,
  calculateRepairInspectionIncentive
} = require("../src/services/staffIncentiveCalculator");

const bikeSale = calculateBikeStageIncentive({ stage: "SALE" });
const bikeHandover = calculateBikeStageIncentive({ stage: "HANDOVER" });
const bikeFollowup = calculateBikeStageIncentive({ stage: "FOLLOWUP" });

assert.strictEqual(bikeSale.finalAmount, 420);
assert.strictEqual(bikeHandover.finalAmount, 120);
assert.strictEqual(bikeFollowup.finalAmount, 60);

assert.strictEqual(
  bikeSale.finalAmount +
    bikeHandover.finalAmount +
    bikeFollowup.finalAmount,
  600
);

const sharedBike = splitFixedAmount(600, 0.7);
assert.deepStrictEqual(sharedBike, {
  totalAmount: 600,
  primaryAmount: 420,
  supportAmount: 180,
  primaryRatio: 0.7,
  supportRatio: 0.3
});

assert.strictEqual(
  calculateBikeStageIncentive({
    stage: "SALE",
    assignedRatio: 0.7
  }).finalAmount,
  294
);

assert.strictEqual(
  calculateBikeStageIncentive({
    stage: "SALE",
    assignedRatio: 0.3
  }).finalAmount,
  126
);

assert.strictEqual(isAccessoryCategory("ACCESSORY"), true);
assert.strictEqual(isAccessoryCategory("AC"), true);
assert.strictEqual(isAccessoryCategory("PT"), false);
assert.strictEqual(isAccessoryCategory("LK"), false);
assert.strictEqual(isAccessoryCategory("REPAIR"), false);

const accessory = calculateAccessoryIncentive({
  category: "ACCESSORY",
  quantity: 2,
  unitPrice: 600,
  lineTotal: 1200,
  isPaid: true
});

assert.strictEqual(accessory.eligible, true);
assert.strictEqual(accessory.actualSaleAmount, 1200);
assert.strictEqual(accessory.calculatedAmount, 120);
assert.strictEqual(accessory.finalAmount, 120);

const accessoryCustomPrice = calculateAccessoryIncentive({
  category: "AC",
  quantity: 1,
  unitPrice: 1200,
  lineTotal: 888,
  isPaid: true
});

assert.strictEqual(accessoryCustomPrice.finalAmount, 88.8);

const sharedAccessory = calculateAccessoryIncentive({
  category: "ACCESSORY",
  quantity: 1,
  lineTotal: 1000,
  isPaid: true,
  assignedRatio: 0.7
});

assert.strictEqual(sharedAccessory.finalAmount, 70);

assert.strictEqual(
  calculateAccessoryIncentive({
    category: "PT",
    lineTotal: 1000,
    isPaid: true
  }).reason,
  "NOT_ACCESSORY"
);

assert.strictEqual(
  calculateAccessoryIncentive({
    category: "ACCESSORY",
    lineTotal: 1000,
    isPaid: false
  }).reason,
  "UNPAID"
);

assert.strictEqual(
  calculateAccessoryIncentive({
    category: "ACCESSORY",
    lineTotal: 0,
    isPaid: true
  }).reason,
  "NO_POSITIVE_SALE_AMOUNT"
);

assert.strictEqual(
  calculateAccessoryIncentive({
    category: "ACCESSORY",
    lineTotal: 1000,
    isPaid: true,
    isRefunded: true
  }).reason,
  "REFUNDED"
);

const inspection = calculateRepairInspectionIncentive({
  inspectionFee: 400,
  collectedAmount: 400,
  inspectionNotes: "控制器與線路檢查完成",
  isPaid: true
});

assert.strictEqual(inspection.eligible, true);
assert.strictEqual(inspection.finalAmount, 100);

assert.strictEqual(
  calculateRepairInspectionIncentive({
    inspectionFee: 400,
    collectedAmount: 400,
    inspectionNotes: "",
    isPaid: true
  }).reason,
  "DIAGNOSIS_NOT_COMPLETED"
);

assert.strictEqual(
  calculateRepairInspectionIncentive({
    inspectionFee: 400,
    collectedAmount: 0,
    inspectionNotes: "檢查完成",
    isPaid: false
  }).reason,
  "UNPAID"
);

assert.strictEqual(
  calculateRepairInspectionIncentive({
    inspectionFee: 400,
    collectedAmount: 400,
    inspectionNotes: "檢查完成",
    isPaid: true,
    isWarranty: true
  }).reason,
  "WARRANTY"
);

assert.throws(
  () =>
    calculateBikeStageIncentive({
      stage: "SALE",
      assignedRatio: 1.1
    }),
  RangeError
);

console.log("staff incentive calculator tests passed");
