const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routePath = path.resolve(
  __dirname,
  "../src/routes/orders.js"
);

const source = fs.readFileSync(
  routePath,
  "utf8"
);

function requireText(text, label) {
  assert(
    source.includes(text),
    `Missing ${label}: ${text}`
  );
}

function requireOrder(before, after, label) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);

  assert(beforeIndex >= 0, `Missing ${label} start`);
  assert(afterIndex >= 0, `Missing ${label} end`);
  assert(
    beforeIndex < afterIndex,
    `${label} order is incorrect`
  );
}

requireText(
  'require("../services/orderSalesFollowupService")',
  "follow-up service import"
);

requireText(
  '"/:id/sales-followup"',
  "sales follow-up route"
);

requireText(
  "getOrderSalesFollowup(",
  "follow-up read call"
);

requireText(
  "saveOrderSalesFollowup(",
  "follow-up save call"
);

requireText(
  'triggerSource:\n            "ORDER_SALES_FOLLOWUP_COMPLETED"',
  "follow-up incentive trigger"
);

requireText(
  '"order_sales_followup_updated"',
  "workflow event"
);

requireOrder(
  'router.get(\n  "/:id/sales-followup"',
  'router.get("/:id", requireOrderManagementFeature',
  "GET follow-up route before generic order route"
);

requireOrder(
  'router.put(\n  "/:id/sales-followup"',
  'router.get("/:id", requireOrderManagementFeature',
  "PUT follow-up route before generic order route"
);

const putStart = source.indexOf(
  'router.put(\n  "/:id/sales-followup"'
);
const genericStart = source.indexOf(
  'router.get("/:id", requireOrderManagementFeature'
);
const putBlock = source.slice(
  putStart,
  genericStart
);

assert(
  putBlock.includes("withTransaction("),
  "PUT route must save inside a transaction"
);

assert(
  putBlock.includes(
    'followup.status === "COMPLETED"'
  ),
  "PUT route must reconcile only after completion"
);

assert(
  putBlock.indexOf("saveOrderSalesFollowup(") <
    putBlock.indexOf(
      "reconcileOrderSaleIncentivesSafely("
    ),
  "Save must happen before incentive reconciliation"
);

console.log(
  "order sales follow-up route tests passed"
);
