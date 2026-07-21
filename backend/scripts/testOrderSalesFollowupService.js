const assert = require("assert");

const {
  normalizeFollowupPayload,
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
  handoverConfirmedAt
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
          handoverConfirmedAt
        }]];
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
          updatedByStaffId: params[12]
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

async function run() {
  testCompletedRequiresContactMethod();
  testCompletedRequiresCustomerResult();
  testCompletedRequiresStaff();
  testNoIssueClearsIssueFlags();
  testResolvedIssueClearsUnresolvedFlag();
  testUnresolvedRequiresEmployeeCause();
  await testCannotCompleteBeforeHandover();
  await testCompletedFollowupIsSaved();

  console.log(
    "order sales follow-up service tests passed"
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
