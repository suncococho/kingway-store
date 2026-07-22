const assert = require("assert");
const {
  buildRepairInspectionCandidate
} = require("../src/services/staffIncentiveEarningService");

const plan = {
  id: 3,
  repairInspectionAmount: 100
};

function baseOrder(overrides = {}) {
  return {
    id: 90,
    storeId: 1,
    source: "REPAIR_QUOTE",
    orderType: "REPAIR",
    finalPaymentStatus: "PAID",
    unpaidBalance: 0,
    ...overrides
  };
}

function baseRepair(overrides = {}) {
  return {
    id: 22,
    repairStaffId: 8,
    repairStaffName: "王小明",
    bikeModel: "測試車",
    inspectionFee: 400,
    inspectionNotes: "已完成初步診斷",
    ...overrides
  };
}

const eligible = buildRepairInspectionCandidate({
  order: baseOrder(),
  repairOrder: baseRepair(),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(eligible.reason, null);
assert.strictEqual(eligible.candidate.incentiveType, "REPAIR_INSPECTION");
assert.strictEqual(eligible.candidate.earningStage, "INSPECTION");
assert.strictEqual(eligible.candidate.sourceType, "REPAIR");
assert.strictEqual(eligible.candidate.sourceId, 22);
assert.strictEqual(eligible.candidate.staffUserId, 8);
assert.strictEqual(eligible.candidate.actualSaleAmount, 400);
assert.strictEqual(eligible.candidate.finalAmount, 100);

const unpaid = buildRepairInspectionCandidate({
  order: baseOrder({ finalPaymentStatus: "UNPAID", unpaidBalance: 400 }),
  repairOrder: baseRepair(),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(unpaid.reason, "UNPAID");
assert.strictEqual(unpaid.candidate, null);

const noDiagnosis = buildRepairInspectionCandidate({
  order: baseOrder(),
  repairOrder: baseRepair({ inspectionNotes: "" }),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(noDiagnosis.reason, "DIAGNOSIS_NOT_COMPLETED");

const noStaff = buildRepairInspectionCandidate({
  order: baseOrder(),
  repairOrder: baseRepair({ repairStaffId: null }),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(noStaff.reason, "REPAIR_STAFF_NOT_ASSIGNED");

const freeInspection = buildRepairInspectionCandidate({
  order: baseOrder(),
  repairOrder: baseRepair({ inspectionFee: 0 }),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(freeInspection.reason, "FREE_INSPECTION");

const warranty = buildRepairInspectionCandidate({
  order: baseOrder({ source: "WARRANTY_REPAIR" }),
  repairOrder: baseRepair(),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(warranty.reason, "WARRANTY");

const repeat = buildRepairInspectionCandidate({
  order: baseOrder({ source: "REPEAT_REPAIR" }),
  repairOrder: baseRepair(),
  plan,
  triggerSource: "TEST"
});
assert.strictEqual(repeat.reason, "REPEAT_REPAIR");

console.log("repair inspection incentive earning tests passed");
