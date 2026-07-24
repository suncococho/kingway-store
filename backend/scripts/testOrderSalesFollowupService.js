const assert = require("assert");

const {
  normalizeFollowupPayload,
  normalizeAttemptedAt,
  addOrderSalesFollowupAttempt,
  saveOrderSalesFollowup
} = require(
  "../src/services/orderSalesFollowupService"
);

function expectError(fn, messagePart) {
  let error = null;

  try {
    fn();
  } catch (caught) {
    error = caught;
  }

  assert(error);
  assert.strictEqual(error.statusCode, 400);
  assert(
    error.message.includes(messagePart),
    error.message
  );
}

function testAttemptedAtValidation() {
  const dayjs = require("dayjs");
  const now = dayjs("2026-07-25T12:00:00+08:00");
  assert.strictEqual(normalizeAttemptedAt("2026-07-25T10:00:00", "2026-07-25T00:00:00.000Z", now), "2026-07-25 02:00:00");
  assert.strictEqual(normalizeAttemptedAt(undefined, "2026-07-25T00:00:00.000Z", now), "2026-07-25 04:00:00");
  expectError(() => normalizeAttemptedAt("2026-07-25T13:00:00", "2026-07-25T00:00:00.000Z", now), "晚於現在");
  expectError(() => normalizeAttemptedAt("2026-07-25T07:00:00", "2026-07-25T00:00:01.000Z", now), "早於交車");
  expectError(() => normalizeAttemptedAt("2026-07-22T11:59:59", "2026-07-20T00:00:00.000Z", now), "72 小時");
}

function testCompletedRequiresContactMethod() {
  expectError(
    () =>
      normalizeFollowupPayload(
        {
          status: "COMPLETED",
          customerResult: "NO_ISSUE"
        },
        8,
        "王小明"
      ),
    "聯絡方式"
  );
}

function testCompletedRequiresCustomerResult() {
  expectError(
    () =>
      normalizeFollowupPayload(
        {
          status: "COMPLETED",
          contactMethod: "LINE"
        },
        8,
        "王小明"
      ),
    "客戶結果"
  );
}

function testCompletedRequiresStaff() {
  expectError(
    () =>
      normalizeFollowupPayload(
        {
          status: "COMPLETED",
          contactMethod: "LINE",
          customerResult: "NO_ISSUE"
        },
        null,
        ""
      ),
    "完成員工"
  );
}

function testNoIssueClearsIssueFlags() {
  const result = normalizeFollowupPayload(
    {
      status: "completed",
      contactMethod: "line",
      customerResult: "no_issue",
      employeeCausedIssue: true,
      unresolvedEmployeeIssue: true
    },
    8,
    "王小明"
  );

  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.contactMethod, "LINE");
  assert.strictEqual(
    result.customerResult,
    "NO_ISSUE"
  );
  assert.strictEqual(
    result.employeeCausedIssue,
    false
  );
  assert.strictEqual(
    result.unresolvedEmployeeIssue,
    false
  );
}

function testResolvedIssueClearsUnresolvedFlag() {
  const result = normalizeFollowupPayload(
    {
      status: "COMPLETED",
      contactMethod: "PHONE",
      customerResult: "ISSUE_RESOLVED",
      employeeCausedIssue: true,
      unresolvedEmployeeIssue: true
    },
    8,
    "王小明"
  );

  assert.strictEqual(
    result.employeeCausedIssue,
    true
  );
  assert.strictEqual(
    result.unresolvedEmployeeIssue,
    false
  );
}

function testUnresolvedRequiresEmployeeCause() {
  expectError(
    () =>
      normalizeFollowupPayload(
        {
          status: "COMPLETED",
          contactMethod: "PHONE",
          customerResult: "ISSUE_UNRESOLVED",
          employeeCausedIssue: false,
          unresolvedEmployeeIssue: true
        },
        8,
        "王小明"
      ),
    "員工造成"
  );
}

function createSaveMockConnection({
  handoverConfirmedAt,
  actorRole = "ADMIN",
  attemptRows = []
}) {
  const queries = [];
  let savedRow = null;

  return {
    queries,

    async query(sql, params = []) {
      const normalizedSql = String(sql)
        .replace(/\s+/g, " ")
        .trim();

      queries.push({
        sql: normalizedSql,
        params
      });

      if (
        normalizedSql.includes(
          "FROM INFORMATION_SCHEMA.TABLES"
        )
      ) {
        return [[{ existsFlag: 1 }]];
      }

      if (
        normalizedSql.includes("FROM orders")
      ) {
        return [[{
          id: 100,
          handoverConfirmedAt,
          salesStaffId: 8,
          salesSupportStaffId: null
        }]];
      }

      if (normalizedSql.includes("FROM staff_users")) {
        return [[{ id: 8, role: actorRole }]];
      }

      if (normalizedSql.includes("SELECT id FROM order_sales_followups")) {
        return [[]];
      }

      if (normalizedSql.includes("FROM order_sales_followup_attempts")) {
        return [attemptRows];
      }

      if (
        normalizedSql.includes(
          "INSERT INTO order_sales_followups"
        )
      ) {
        savedRow = {
          id: 51,
          storeId: params[0],
          orderId: params[1],
          status: params[2],
          contactMethod: params[3],
          customerResult: params[4],
          employeeCausedIssue: params[5],
          unresolvedEmployeeIssue: params[6],
          note: params[7],
          completedByStaffId: params[8],
          completedByStaffName: params[9],
          completedAt:
            "2026-07-22T10:00:00.000Z",
          createdByStaffId: params[11],
          updatedByStaffId: params[12],
          noResponseApprovedBy: params[13] || savedRow?.noResponseApprovedBy || null,
          noResponseApprovedAt: params[13] ? "2026-07-25T04:00:00.000Z" : savedRow?.noResponseApprovedAt || null,
          noResponseApprovalReason: params[15] || savedRow?.noResponseApprovalReason || null
        };

        return [{
          affectedRows: 1,
          insertId: 51
        }];
      }

      if (
        normalizedSql.includes(
          "FROM order_sales_followups"
        )
      ) {
        return [[savedRow].filter(Boolean)];
      }

      throw new Error(
        `Unexpected query: ${normalizedSql}`
      );
    }
  };
}

async function testCannotCompleteBeforeHandover() {
  const connection =
    createSaveMockConnection({
      handoverConfirmedAt: null
    });

  let error = null;

  try {
    await saveOrderSalesFollowup(
      100,
      1,
      {
        status: "completed",
        contactMethod: "line",
        customerResult: "no_issue"
      },
      8,
      "王小明",
      connection
    );
  } catch (caught) {
    error = caught;
  }

  assert(error);
  assert.strictEqual(error.statusCode, 409);
  assert(error.message.includes("先完成交車"));

  assert.strictEqual(
    connection.queries.some(
      (entry) =>
        entry.sql.includes(
          "INSERT INTO order_sales_followups"
        )
    ),
    false
  );
}

async function testCompletedFollowupIsSaved() {
  const connection =
    createSaveMockConnection({
      handoverConfirmedAt:
        "2026-07-21T10:00:00.000Z"
    });

  const result =
    await saveOrderSalesFollowup(
      100,
      1,
      {
        status: "completed",
        contactMethod: "phone",
        customerResult: "issue_resolved",
        employeeCausedIssue: true,
        unresolvedEmployeeIssue: true,
        note: "已向客戶說明並處理完成"
      },
      8,
      "王小明",
      connection
    );

  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.contactMethod, "PHONE");
  assert.strictEqual(
    result.customerResult,
    "ISSUE_RESOLVED"
  );
  assert.strictEqual(
    result.employeeCausedIssue,
    true
  );
  assert.strictEqual(
    result.unresolvedEmployeeIssue,
    false
  );
  assert.strictEqual(
    result.completedByStaffId,
    8
  );
  assert.strictEqual(
    result.completedByStaffName,
    "王小明"
  );

  const insertQuery = connection.queries.find(
    (entry) =>
      entry.sql.includes(
        "INSERT INTO order_sales_followups"
      )
  );

  assert(insertQuery);
  assert.strictEqual(insertQuery.params[0], 1);
  assert.strictEqual(insertQuery.params[1], 100);
  assert.strictEqual(
    insertQuery.params[2],
    "COMPLETED"
  );
  assert.strictEqual(insertQuery.params[3], "PHONE");
  assert.strictEqual(
    insertQuery.params[4],
    "ISSUE_RESOLVED"
  );
  assert.strictEqual(insertQuery.params[5], 1);
  assert.strictEqual(insertQuery.params[6], 0);
  assert.strictEqual(insertQuery.params[8], 8);
  assert.strictEqual(
    insertQuery.params[9],
    "王小明"
  );
}

async function testNoResponseApprovalRules() {
  const payload = { status: "COMPLETED", contactMethod: "LINE", customerResult: "NO_RESPONSE", noResponseApprovalReason: "已依規定聯絡兩次" };
  const attempt = async (options) => {
    let error;
    try { await saveOrderSalesFollowup(100, 1, payload, 8, "管理員", createSaveMockConnection({ handoverConfirmedAt: "2026-07-24T00:00:00.000Z", ...options })); } catch (caught) { error = caught; }
    return error;
  };
  let error = await attempt({ attemptRows: [{ id: 1, attemptedAt: "2026-07-25T01:00:00.000Z" }] });
  assert.strictEqual(error.statusCode, 409);
  error = await attempt({ attemptRows: [{ id: 1, attemptedAt: "2026-07-25T01:00:00.000Z" }, { id: 2, attemptedAt: "2026-07-25T06:59:59.000Z" }] });
  assert.strictEqual(error.statusCode, 409);

  const connection = createSaveMockConnection({ handoverConfirmedAt: "2026-07-24T00:00:00.000Z", actorRole: "ADMIN", attemptRows: [{ id: 1, attemptedAt: "2026-07-25T01:00:00.000Z" }, { id: 2, attemptedAt: "2026-07-25T07:00:00.000Z" }] });
  const approved = await saveOrderSalesFollowup(100, 1, payload, 8, "管理員", connection);
  assert.strictEqual(approved.status, "COMPLETED");
  assert.strictEqual(approved.customerResult, "NO_RESPONSE");
  assert.strictEqual(approved.noResponseApprovedBy, 8);
  assert(approved.noResponseApprovedAt);
  assert.strictEqual(approved.noResponseApprovalReason, "已依規定聯絡兩次");

  const ordinary = await saveOrderSalesFollowup(100, 1, { status: "COMPLETED", contactMethod: "PHONE", customerResult: "NO_ISSUE" }, 8, "管理員", connection);
  assert.strictEqual(ordinary.noResponseApprovedBy, 8);
  assert.strictEqual(ordinary.noResponseApprovalReason, "已依規定聯絡兩次");
}

async function testDuplicateClientRequestIdIsIdempotent() {
  const seen = new Set();
  let rowCount = 0;
  const connection = { async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.includes("INFORMATION_SCHEMA.TABLES")) return [[{ existsFlag: 1 }]];
    if (text.includes("FROM orders")) return [[{ id: 100, handoverConfirmedAt: "2026-07-24T00:00:00.000Z", salesStaffId: 8, salesSupportStaffId: null }]];
    if (text.includes("FROM staff_users")) return [[{ id: 8, role: "STAFF" }]];
    if (text.includes("SELECT id FROM order_sales_followups")) return [[]];
    if (text.includes("INSERT INTO order_sales_followup_attempts")) { if (!seen.has(params[3])) { seen.add(params[3]); rowCount += 1; } return [{ affectedRows: 1, insertId: 61 }]; }
    if (text.includes("FROM order_sales_followups")) return [[{ id: 51, storeId: 1, orderId: 100, status: "PENDING" }]];
    if (text.includes("FROM order_sales_followup_attempts")) return [[{ id: 61, clientRequestId: [...seen][0], staffUserId: 8 }]];
    throw new Error(`Unexpected query: `);
  } };
  const payload = { clientRequestId: "123e4567-e89b-42d3-a456-426614174000", contactMethod: "LINE", result: "NO_RESPONSE" };
  await addOrderSalesFollowupAttempt(100, 1, payload, 8, connection);
  await addOrderSalesFollowupAttempt(100, 1, payload, 8, connection);
  assert.strictEqual(rowCount, 1);
}

async function run() {
  testAttemptedAtValidation();
  testCompletedRequiresContactMethod();
  testCompletedRequiresCustomerResult();
  testCompletedRequiresStaff();
  testNoIssueClearsIssueFlags();
  testResolvedIssueClearsUnresolvedFlag();
  testUnresolvedRequiresEmployeeCause();
  await testCannotCompleteBeforeHandover();
  await testCompletedFollowupIsSaved();
  await testNoResponseApprovalRules();
  await testDuplicateClientRequestIdIsIdempotent();

  console.log(
    "order sales follow-up service tests passed"
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
