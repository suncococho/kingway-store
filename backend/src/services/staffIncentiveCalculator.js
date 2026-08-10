const DEFAULT_INCENTIVE_PLAN = Object.freeze({
  bikeTotalAmount: 600,
  payoutMode: "ALL_STAGES_COMPLETED",
  bikeSaleAmount: 0,
  bikeHandoverAmount: 0,
  bikeFollowupAmount: 0,
  accessoryRate: 0.1,
  repairInspectionAmount: 100,
  requiredInspectionCollection: 400
});

const ACCESSORY_CATEGORIES = new Set(["AC", "ACCESSORY"]);

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function moneyToCents(value) {
  return Math.round(toFiniteNumber(value) * 100);
}

function centsToMoney(value) {
  return Number((toFiniteNumber(value) / 100).toFixed(2));
}

function normalizeAssignedRatio(value = 1) {
  const ratio = toFiniteNumber(value, 1);
  if (ratio < 0 || ratio > 1) {
    throw new RangeError("assignedRatio must be between 0 and 1");
  }
  return ratio;
}

function applyAssignedRatio(amount, assignedRatio = 1) {
  const amountCents = moneyToCents(amount);
  const ratio = normalizeAssignedRatio(assignedRatio);
  return centsToMoney(Math.round(amountCents * ratio));
}

function splitFixedAmount(amount, primaryRatio = 0.7) {
  const totalCents = moneyToCents(amount);
  const ratio = normalizeAssignedRatio(primaryRatio);
  const primaryCents = Math.round(totalCents * ratio);
  const supportCents = totalCents - primaryCents;

  return {
    totalAmount: centsToMoney(totalCents),
    primaryAmount: centsToMoney(primaryCents),
    supportAmount: centsToMoney(supportCents),
    primaryRatio: ratio,
    supportRatio: Number((1 - ratio).toFixed(6))
  };
}

function isAccessoryCategory(category) {
  return ACCESSORY_CATEGORIES.has(
    String(category || "").trim().toUpperCase()
  );
}

function calculateBikeStageIncentive({
  stage,
  assignedRatio = 1,
  plan = DEFAULT_INCENTIVE_PLAN
}) {
  const normalizedStage = String(stage || "").trim().toUpperCase();

  const amountByStage = {
    ALL_STAGES: toFiniteNumber(
      plan.bikeTotalAmount ?? DEFAULT_INCENTIVE_PLAN.bikeTotalAmount
    ),
    SALE: toFiniteNumber(plan.bikeSaleAmount),
    HANDOVER: toFiniteNumber(plan.bikeHandoverAmount),
    FOLLOWUP: toFiniteNumber(plan.bikeFollowupAmount)
  };

  if (!Object.prototype.hasOwnProperty.call(amountByStage, normalizedStage)) {
    return {
      eligible: false,
      reason: "INVALID_BIKE_STAGE",
      stage: normalizedStage,
      finalAmount: 0
    };
  }

  const baseAmount = amountByStage[normalizedStage];

  return {
    eligible: true,
    reason: null,
    incentiveType: "BIKE",
    stage: normalizedStage,
    baseAmount,
    assignedRatio: normalizeAssignedRatio(assignedRatio),
    finalAmount: applyAssignedRatio(baseAmount, assignedRatio)
  };
}

function calculateAccessoryIncentive({
  category,
  quantity = 1,
  unitPrice = 0,
  lineTotal,
  isCanceled = false,
  isRefunded = false,
  isFree = false,
  isInternal = false,
  isTest = false,
  isPaid = false,
  assignedRatio = 1,
  rate = DEFAULT_INCENTIVE_PLAN.accessoryRate
}) {
  if (!isAccessoryCategory(category)) {
    return {
      eligible: false,
      reason: "NOT_ACCESSORY",
      finalAmount: 0
    };
  }

  if (isCanceled) {
    return { eligible: false, reason: "CANCELED", finalAmount: 0 };
  }

  if (isRefunded) {
    return { eligible: false, reason: "REFUNDED", finalAmount: 0 };
  }

  if (isFree) {
    return { eligible: false, reason: "FREE_ITEM", finalAmount: 0 };
  }

  if (isInternal) {
    return { eligible: false, reason: "INTERNAL_ITEM", finalAmount: 0 };
  }

  if (isTest) {
    return { eligible: false, reason: "TEST_ITEM", finalAmount: 0 };
  }

  if (!isPaid) {
    return { eligible: false, reason: "UNPAID", finalAmount: 0 };
  }

  const normalizedQuantity = Math.max(
    Math.trunc(toFiniteNumber(quantity)),
    0
  );

  const actualSaleAmount =
    lineTotal === undefined || lineTotal === null
      ? centsToMoney(
          moneyToCents(unitPrice) * normalizedQuantity
        )
      : centsToMoney(moneyToCents(lineTotal));

  if (normalizedQuantity <= 0 || actualSaleAmount <= 0) {
    return {
      eligible: false,
      reason: "NO_POSITIVE_SALE_AMOUNT",
      finalAmount: 0
    };
  }

  const normalizedRate = toFiniteNumber(rate);
  if (normalizedRate < 0 || normalizedRate > 1) {
    throw new RangeError("accessory rate must be between 0 and 1");
  }

  const calculatedCents = Math.round(
    moneyToCents(actualSaleAmount) * normalizedRate
  );
  const calculatedAmount = centsToMoney(calculatedCents);

  return {
    eligible: true,
    reason: null,
    incentiveType: "ACCESSORY",
    stage: "ITEM",
    quantity: normalizedQuantity,
    actualSaleAmount,
    rate: normalizedRate,
    calculatedAmount,
    assignedRatio: normalizeAssignedRatio(assignedRatio),
    finalAmount: applyAssignedRatio(
      calculatedAmount,
      assignedRatio
    )
  };
}

function calculateRepairInspectionIncentive({
  inspectionFee = 0,
  collectedAmount = 0,
  inspectionNotes = "",
  isPaid = false,
  isFree = false,
  isWarranty = false,
  isRepeat = false,
  assignedRatio = 1,
  plan = DEFAULT_INCENTIVE_PLAN
}) {
  if (isFree) {
    return { eligible: false, reason: "FREE_INSPECTION", finalAmount: 0 };
  }

  if (isWarranty) {
    return { eligible: false, reason: "WARRANTY", finalAmount: 0 };
  }

  if (isRepeat) {
    return { eligible: false, reason: "REPEAT_REPAIR", finalAmount: 0 };
  }

  if (!String(inspectionNotes || "").trim()) {
    return {
      eligible: false,
      reason: "DIAGNOSIS_NOT_COMPLETED",
      finalAmount: 0
    };
  }

  if (!isPaid) {
    return { eligible: false, reason: "UNPAID", finalAmount: 0 };
  }

  const requiredCollection = toFiniteNumber(
    plan.requiredInspectionCollection,
    400
  );

  if (
    toFiniteNumber(inspectionFee) < requiredCollection ||
    toFiniteNumber(collectedAmount) < requiredCollection
  ) {
    return {
      eligible: false,
      reason: "INSUFFICIENT_INSPECTION_COLLECTION",
      finalAmount: 0
    };
  }

  const baseAmount = toFiniteNumber(
    plan.repairInspectionAmount,
    100
  );

  return {
    eligible: true,
    reason: null,
    incentiveType: "REPAIR_INSPECTION",
    stage: "INSPECTION",
    baseAmount,
    assignedRatio: normalizeAssignedRatio(assignedRatio),
    finalAmount: applyAssignedRatio(baseAmount, assignedRatio)
  };
}

module.exports = {
  DEFAULT_INCENTIVE_PLAN,
  ACCESSORY_CATEGORIES,
  moneyToCents,
  centsToMoney,
  normalizeAssignedRatio,
  applyAssignedRatio,
  splitFixedAmount,
  isAccessoryCategory,
  calculateBikeStageIncentive,
  calculateAccessoryIncentive,
  calculateRepairInspectionIncentive
};
