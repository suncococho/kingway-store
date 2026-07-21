const {
  moneyToCents,
  centsToMoney,
  splitFixedAmount,
  calculateBikeStageIncentive,
  calculateAccessoryIncentive
} = require("./staffIncentiveCalculator");

const {
  getActiveIncentivePlan,
  upsertIncentiveEvent
} = require("./staffIncentiveService");

function normalizePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return 1;
  return quantity;
}

function normalizeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function buildSalesAssignmentShares(order = {}) {
  const primaryStaffId = normalizePositiveId(
    order.salesStaffId ?? order.sales_staff_id
  );

  const supportStaffId = normalizePositiveId(
    order.salesSupportStaffId ??
    order.sales_support_staff_id
  );

  if (!primaryStaffId) {
    return [];
  }

  const primaryStaffName =
    order.salesStaffName ??
    order.sales_staff_name ??
    null;

  const supportStaffName =
    order.salesSupportStaffName ??
    order.sales_support_staff_name ??
    null;

  if (
    !supportStaffId ||
    supportStaffId === primaryStaffId
  ) {
    return [
      {
        staffUserId: primaryStaffId,
        staffName: primaryStaffName,
        assignmentRole: "PRIMARY",
        assignedRatio: 1
      }
    ];
  }

  return [
    {
      staffUserId: primaryStaffId,
      staffName: primaryStaffName,
      assignmentRole: "PRIMARY",
      assignedRatio: 0.7
    },
    {
      staffUserId: supportStaffId,
      staffName: supportStaffName,
      assignmentRole: "SUPPORT",
      assignedRatio: 0.3
    }
  ];
}

function splitCandidateBySalesAssignments(
  candidate,
  order
) {
  if (!candidate) return [];

  const shares = buildSalesAssignmentShares(order);

  if (!shares.length) {
    return [];
  }

  if (shares.length === 1) {
    const share = shares[0];

    return [
      {
        ...candidate,
        staffUserId: share.staffUserId,
        assignedRatio: 1,
        metadata: {
          ...(candidate.metadata || {}),
          sharedSale: false,
          salesAssignmentRole:
            share.assignmentRole,
          assignedStaffName:
            share.staffName || null
        }
      }
    ];
  }

  const split = splitFixedAmount(
    candidate.finalAmount,
    0.7
  );

  return shares.map((share) => ({
    ...candidate,
    staffUserId: share.staffUserId,
    assignedRatio: share.assignedRatio,
    finalAmount:
      share.assignmentRole === "PRIMARY"
        ? split.primaryAmount
        : split.supportAmount,
    metadata: {
      ...(candidate.metadata || {}),
      sharedSale: true,
      salesAssignmentRole:
        share.assignmentRole,
      assignedStaffName:
        share.staffName || null,
      primarySalesStaffId:
        shares[0].staffUserId,
      supportSalesStaffId:
        shares[1].staffUserId
    }
  }));
}

function allocateOrderActualSaleAmounts(
  items = [],
  orderTotalAmount
) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => ({
      item,
      lineCents: Math.max(
        0,
        moneyToCents(item?.lineTotal || 0)
      )
    }))
    .filter((row) => row.lineCents > 0);

  const itemTotalCents = rows.reduce(
    (sum, row) => sum + row.lineCents,
    0
  );

  const result = new Map();

  if (itemTotalCents <= 0) {
    return result;
  }

  const requestedTotalCents =
    orderTotalAmount === undefined ||
    orderTotalAmount === null
      ? itemTotalCents
      : Math.max(0, moneyToCents(orderTotalAmount));

  const targetCents = Math.min(
    itemTotalCents,
    requestedTotalCents
  );

  let allocatedCents = 0;

  rows.forEach((row, index) => {
    const cents = index === rows.length - 1
      ? targetCents - allocatedCents
      : Math.floor(
          row.lineCents * targetCents / itemTotalCents
        );

    allocatedCents += cents;
    result.set(row.item, centsToMoney(cents));
  });

  return result;
}

function normalizeCategory(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function isVehicleItem(item = {}) {
  const snapshotCategory = normalizeCategory(
    item.productCategorySnapshot ?? item.category
  );
  const masterCategory = normalizeCategory(item.masterCategory);
  const sku = normalizeSku(item.skuSnapshot ?? item.sku);

  return (
    ["EB", "EBIKE"].includes(snapshotCategory) ||
    ["EB", "EBIKE"].includes(masterCategory) ||
    String(
      item.productCategorySnapshot ?? item.category ?? ""
    ).includes("電動自行車") ||
    sku.startsWith("B-EB-")
  );
}

function isAccessoryItem(item = {}) {
  const snapshotCategory = normalizeCategory(
    item.productCategorySnapshot ?? item.category
  );
  const masterCategory = normalizeCategory(item.masterCategory);
  return snapshotCategory === "ACCESSORY" || masterCategory === "AC";
}

function isRepairItem(item = {}) {
  const snapshotCategory = normalizeCategory(
    item.productCategorySnapshot ?? item.category
  );
  const masterCategory = normalizeCategory(item.masterCategory);
  return (
    ["RP", "REPAIR"].includes(snapshotCategory) ||
    ["RP", "REPAIR"].includes(masterCategory)
  );
}

function isOrderPaid(order = {}) {
  const status = normalizeCategory(
    order.finalPaymentStatus ?? order.final_payment_status
  );
  const unpaidBalance = Number(
    order.unpaidBalance ?? order.unpaid_balance ?? 0
  );

  return (
    status === "PAID" &&
    Number.isFinite(unpaidBalance) &&
    unpaidBalance <= 0
  );
}

function isPurchaseConfirmationComplete(confirmation = {}) {
  confirmation = confirmation || {};
  const status = normalizeCategory(confirmation.status);
  const submittedAt =
    confirmation.submittedAt ?? confirmation.submitted_at ?? null;
  const finalAccepted = Number(
    confirmation.finalConfirmationAccepted ??
    confirmation.final_confirmation_accepted ??
    0
  ) === 1;

  return status === "COMPLETED" || Boolean(submittedAt && finalAccepted);
}

function isExcludedOrder(order = {}) {
  if (order.deletedAt || order.deleted_at) return true;

  const status = normalizeCategory(order.status);
  const source = normalizeCategory(order.source);
  const orderType = normalizeCategory(order.orderType ?? order.order_type);

  if (
    ["CANCELED", "CANCELLED", "REFUNDED", "VOID", "DELETED"].includes(status)
  ) {
    return true;
  }

  return (
    source.includes("INTERNAL") ||
    source.includes("TEST") ||
    orderType.includes("INTERNAL") ||
    orderType.includes("TEST")
  );
}

function isOrderHandoverComplete(order = {}) {
  return Boolean(
    order.handoverConfirmedAt ??
    order.handover_confirmed_at
  );
}

function isRepairLinkedOrder(snapshot = {}) {
  const order = snapshot.order || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const source = normalizeCategory(order.source);

  return (
    Boolean(order.repairOrderId ?? order.repair_order_id) ||
    source === "REPAIR_QUOTE" ||
    items.some(isRepairItem)
  );
}

function buildBikeSaleCandidate({
  order,
  item,
  plan,
  triggerSource,
  confirmation
}) {
  const quantity = normalizeQuantity(item.quantity);
  const calculation = calculateBikeStageIncentive({
    stage: "SALE",
    assignedRatio: 1,
    plan
  });
  const calculatedAmount = normalizeMoney(calculation.baseAmount * quantity);
  const finalAmount = normalizeMoney(calculation.finalAmount * quantity);

  return {
    storeId: normalizePositiveId(order.storeId),
    staffUserId: normalizePositiveId(order.salesStaffId),
    planVersionId: normalizePositiveId(plan.id),
    incentiveType: "BIKE",
    earningStage: "SALE",
    sourceType: "ORDER_ITEM",
    sourceId: normalizePositiveId(order.id),
    sourceLineId: normalizePositiveId(item.id),
    productId: normalizePositiveId(item.productId),
    productNameSnapshot:
      item.productNameSnapshot || item.name || null,
    quantity,
    actualSaleAmount: normalizeMoney(item.lineTotal),
    rate: 0,
    calculatedAmount,
    assignedRatio: 1,
    finalAmount,
    status: "EARNED",
    metadata: {
      triggerSource,
      orderId: Number(order.id),
      orderItemId: Number(item.id),
      purchaseConfirmationId: normalizePositiveId(confirmation?.id),
      purchaseConfirmationCompleted: true,
      vehicleCategorySnapshot:
        item.productCategorySnapshot || item.category || null,
      vehicleMasterCategory: item.masterCategory || null,
      vehicleSku: item.skuSnapshot || item.sku || null
    }
  };
}

function buildBikeHandoverCandidate({
  order,
  item,
  plan,
  triggerSource,
  confirmation
}) {
  const quantity = normalizeQuantity(item.quantity);

  const calculation =
    calculateBikeStageIncentive({
      stage: "HANDOVER",
      assignedRatio: 1,
      plan
    });

  const calculatedAmount = normalizeMoney(
    calculation.baseAmount * quantity
  );

  const finalAmount = normalizeMoney(
    calculation.finalAmount * quantity
  );

  return {
    storeId: normalizePositiveId(order.storeId),
    staffUserId:
      normalizePositiveId(order.salesStaffId),
    planVersionId: normalizePositiveId(plan.id),
    incentiveType: "BIKE",
    earningStage: "HANDOVER",
    sourceType: "ORDER_ITEM",
    sourceId: normalizePositiveId(order.id),
    sourceLineId: normalizePositiveId(item.id),
    productId: normalizePositiveId(item.productId),
    productNameSnapshot:
      item.productNameSnapshot ||
      item.name ||
      null,
    quantity,
    actualSaleAmount:
      normalizeMoney(item.lineTotal),
    rate: 0,
    calculatedAmount,
    assignedRatio: 1,
    finalAmount,
    status: "EARNED",
    metadata: {
      triggerSource,
      orderId: Number(order.id),
      orderItemId: Number(item.id),
      purchaseConfirmationId:
        normalizePositiveId(confirmation?.id),
      purchaseConfirmationCompleted: true,
      handoverConfirmedAt:
        order.handoverConfirmedAt ??
        order.handover_confirmed_at ??
        null
    }
  };
}

function buildAccessoryCandidate({
  order,
  item,
  plan,
  triggerSource,
  actualSaleAmount
}) {
  const calculation = calculateAccessoryIncentive({
    category: "ACCESSORY",
    quantity: normalizeQuantity(item.quantity),
    unitPrice: normalizeMoney(item.unitPrice),
    lineTotal: normalizeMoney(actualSaleAmount),
    isCanceled: false,
    isRefunded: false,
    isFree: normalizeMoney(actualSaleAmount) <= 0,
    isInternal: false,
    isTest: false,
    isPaid: true,
    assignedRatio: 1,
    rate: plan.accessoryRate
  });

  if (!calculation.eligible) return null;

  return {
    storeId: normalizePositiveId(order.storeId),
    staffUserId: normalizePositiveId(order.salesStaffId),
    planVersionId: normalizePositiveId(plan.id),
    incentiveType: "ACCESSORY",
    earningStage: "ITEM",
    sourceType: "ORDER_ITEM",
    sourceId: normalizePositiveId(order.id),
    sourceLineId: normalizePositiveId(item.id),
    productId: normalizePositiveId(item.productId),
    productNameSnapshot:
      item.productNameSnapshot || item.name || null,
    quantity: calculation.quantity,
    actualSaleAmount: calculation.actualSaleAmount,
    rate: calculation.rate,
    calculatedAmount: calculation.calculatedAmount,
    assignedRatio: calculation.assignedRatio,
    finalAmount: calculation.finalAmount,
    status: "EARNED",
    metadata: {
      triggerSource,
      orderId: Number(order.id),
      orderItemId: Number(item.id),
      categorySnapshot:
        item.productCategorySnapshot || item.category || null,
      masterCategory: item.masterCategory || null,
      sku: item.skuSnapshot || item.sku || null
    }
  };
}

function buildOrderSaleIncentiveCandidates({
  snapshot,
  plan,
  triggerSource = "ORDER_RECONCILE"
}) {
  const order = snapshot?.order || null;
  const confirmation = snapshot?.purchaseConfirmation || null;
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];

  if (!order) {
    return { eligible: false, reason: "ORDER_NOT_FOUND", candidates: [] };
  }

  if (!normalizePositiveId(order.salesStaffId)) {
    return {
      eligible: false,
      reason: "SALES_STAFF_NOT_ASSIGNED",
      candidates: []
    };
  }

  if (isExcludedOrder(order)) {
    return { eligible: false, reason: "ORDER_EXCLUDED", candidates: [] };
  }

  if (!isOrderPaid(order)) {
    return { eligible: false, reason: "ORDER_NOT_PAID", candidates: [] };
  }

  if (!plan || !normalizePositiveId(plan.id)) {
    return {
      eligible: false,
      reason: "ACTIVE_PLAN_NOT_FOUND",
      candidates: []
    };
  }

  const candidates = [];
  const repairLinked = isRepairLinkedOrder(snapshot);

  const actualSaleAmounts =
    allocateOrderActualSaleAmounts(
      items,
      order.totalAmount ??
      order.total_amount
    );

  if (!repairLinked) {
    for (const item of items.filter(isAccessoryItem)) {
      const candidate = buildAccessoryCandidate({
        order,
        item,
        plan,
        triggerSource,
        actualSaleAmount:
          actualSaleAmounts.get(item) ??
          normalizeMoney(item.lineTotal)
      });
      if (candidate) {
        candidates.push(
          ...splitCandidateBySalesAssignments(
            candidate,
            order
          )
        );
      }
    }
  }

  if (isPurchaseConfirmationComplete(confirmation)) {
    for (const item of items.filter(isVehicleItem)) {
      const candidate = buildBikeSaleCandidate({
        order,
        item,
        plan,
        triggerSource,
        confirmation
      });

      candidates.push(
        ...splitCandidateBySalesAssignments(
          candidate,
          order
        )
      );

      if (isOrderHandoverComplete(order)) {
        const handoverCandidate =
          buildBikeHandoverCandidate({
            order,
            item,
            plan,
            triggerSource,
            confirmation
          });

        candidates.push(
          ...splitCandidateBySalesAssignments(
            handoverCandidate,
            order
          )
        );
      }
    }
  }

  return {
    eligible: candidates.length > 0,
    reason:
      candidates.length > 0
        ? null
        : repairLinked
          ? "REPAIR_ORDER_EXCLUDED"
          : "NO_ELIGIBLE_ITEMS",
    candidates
  };
}

async function loadOrderSaleIncentiveSnapshot(connection, storeId, orderId) {
  const normalizedStoreId = normalizePositiveId(storeId);
  const normalizedOrderId = normalizePositiveId(orderId);

  if (!normalizedStoreId || !normalizedOrderId) {
    throw new TypeError("storeId and orderId must be positive integers");
  }

  const [orderRows] = await connection.query(
    `
      SELECT
        id,
        store_id AS storeId,
        sales_staff_id AS salesStaffId,
        sales_staff_name AS salesStaffName,
        sales_support_staff_id AS salesSupportStaffId,
        sales_support_staff_name AS salesSupportStaffName,
        status,
        order_type AS orderType,
        total_amount AS totalAmount,
        source,
        repair_order_id AS repairOrderId,
        final_payment_status AS finalPaymentStatus,
        unpaid_balance AS unpaidBalance,
        business_date AS businessDate,
        handover_confirmed_at AS handoverConfirmedAt,
        deleted_at AS deletedAt
      FROM orders
      WHERE id = ?
        AND store_id = ?
      LIMIT 1
    `,
    [normalizedOrderId, normalizedStoreId]
  );

  const order = orderRows[0] || null;

  if (!order) {
    return { order: null, purchaseConfirmation: null, items: [] };
  }

  const [confirmationRows] = await connection.query(
    `
      SELECT
        id,
        status,
        submitted_at AS submittedAt,
        final_confirmation_accepted AS finalConfirmationAccepted
      FROM purchase_confirmations
      WHERE order_id = ?
        AND store_id = ?
      ORDER BY
        CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END,
        submitted_at DESC,
        id DESC
      LIMIT 1
    `,
    [normalizedOrderId, normalizedStoreId]
  );

  const [itemRows] = await connection.query(
    `
      SELECT
        oi.id,
        oi.product_id AS productId,
        oi.sku_snapshot AS skuSnapshot,
        oi.product_name_snapshot AS productNameSnapshot,
        oi.product_category_snapshot AS productCategorySnapshot,
        oi.quantity,
        oi.unit_price AS unitPrice,
        oi.line_total AS lineTotal,
        p.category AS masterCategory
      FROM order_items oi
      LEFT JOIN products p
        ON p.id = oi.product_id
       AND p.store_id = oi.store_id
      WHERE oi.order_id = ?
        AND oi.store_id = ?
      ORDER BY oi.id ASC
    `,
    [normalizedOrderId, normalizedStoreId]
  );

  return {
    order,
    purchaseConfirmation: confirmationRows[0] || null,
    items: itemRows
  };
}

async function reconcileOrderSaleIncentives({
  connection,
  storeId,
  orderId,
  triggerSource = "ORDER_RECONCILE",
  dependencies = {}
}) {
  if (!connection) throw new TypeError("connection is required");

  const loadSnapshot =
    dependencies.loadOrderSaleIncentiveSnapshot ||
    loadOrderSaleIncentiveSnapshot;
  const loadPlan =
    dependencies.getActiveIncentivePlan || getActiveIncentivePlan;
  const saveEvent =
    dependencies.upsertIncentiveEvent || upsertIncentiveEvent;

  const snapshot = await loadSnapshot(connection, storeId, orderId);

  if (!snapshot.order) {
    return {
      eligible: false,
      reason: "ORDER_NOT_FOUND",
      candidates: [],
      results: []
    };
  }

  const plan = await loadPlan(connection, storeId, new Date());
  const evaluation = buildOrderSaleIncentiveCandidates({
    snapshot,
    plan,
    triggerSource
  });

  if (!evaluation.eligible) {
    return { ...evaluation, results: [] };
  }

  const results = [];
  for (const candidate of evaluation.candidates) {
    results.push(await saveEvent(connection, candidate));
  }

  return { ...evaluation, results };
}

async function reconcileOrderSaleIncentivesSafely(input = {}) {
  try {
    return await reconcileOrderSaleIncentives(input);
  } catch (error) {
    console.warn("[staff-incentive] order reconciliation failed", {
      storeId: input.storeId || null,
      orderId: input.orderId || null,
      triggerSource: input.triggerSource || null,
      message: error.message
    });

    return {
      eligible: false,
      reason: "RECONCILIATION_ERROR",
      candidates: [],
      results: [],
      error: error.message
    };
  }
}

module.exports = {
  normalizePositiveId,
  buildSalesAssignmentShares,
  splitCandidateBySalesAssignments,
  allocateOrderActualSaleAmounts,
  isVehicleItem,
  isAccessoryItem,
  isRepairItem,
  isOrderPaid,
  isPurchaseConfirmationComplete,
  isOrderHandoverComplete,
  isExcludedOrder,
  isRepairLinkedOrder,
  buildBikeHandoverCandidate,
  buildOrderSaleIncentiveCandidates,
  loadOrderSaleIncentiveSnapshot,
  reconcileOrderSaleIncentives,
  reconcileOrderSaleIncentivesSafely
};
