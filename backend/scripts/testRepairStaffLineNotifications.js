const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "mysql2/promise") {
    return {
      createPool() {
        return {
          async query() { throw new Error("Unexpected pool query in unit test"); },
          async getConnection() { throw new Error("Unexpected DB connection in unit test"); }
        };
      }
    };
  }
  if (request === "dotenv") {
    return { config() { return {}; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};


process.env.LINE_MESSAGING_ENABLED = "false";

const {
  buildRepairStaffWorkflowNotification,
  isStaffLineNotifySuppressed,
  resolveStaffLineGroupTarget,
  resolveStaffLineGroupTargets
} = require("../src/services/staffLineNotify");
const {
  createStaffLineNotification
} = require("../src/services/staffLineNotificationService");

function flattenNotification(notification) {
  return [notification.title, notification.altText, ...(notification.bodyLines || [])].join("\n");
}

async function testStaffGroupSelection() {
  const connection = {
    async query(sql, params) {
      assert(sql.includes("WHERE store_id = ?"));
      assert(sql.includes("registration_type IN (?)"));
      assert(!sql.includes("LIMIT 1"));
      assert.deepStrictEqual(params, [10, ["staff"]]);
      return [[
        {
          id: 8,
          lineGroupId: "Cstaff-store10-b",
          registrationType: "staff",
          groupName: "門市員工 B"
        },
        {
          id: 7,
          lineGroupId: "Cstaff-store10-a",
          registrationType: "staff",
          groupName: "門市員工 A"
        },
        {
          id: 6,
          lineGroupId: "Cstaff-store10-a",
          registrationType: "staff",
          groupName: "重複 destination"
        }
      ]];
    }
  };
  const targets = await resolveStaffLineGroupTargets(connection, ["staff"], { storeId: 10 });
  assert.strictEqual(targets.length, 2);
  assert.deepStrictEqual(targets.map((target) => target.lineGroupId), ["Cstaff-store10-b", "Cstaff-store10-a"]);
  assert(targets.every((target) => target.registrationType === "staff"));

  const target = await resolveStaffLineGroupTarget(connection, ["staff"], { storeId: 10 });
  assert.strictEqual(target.registrationType, "staff");
  assert.strictEqual(target.lineGroupId, "Cstaff-store10-b");
}

async function testDuplicateRecordOnce() {
  const records = new Map();
  let nextId = 1;
  const connection = {
    async query(sql, params) {
      if (sql.includes("information_schema.TABLES")) return [[{ existsFlag: 1 }]];
      if (sql.includes("SELECT") && sql.includes("FROM staff_line_notifications") && sql.includes("WHERE idempotency_key")) {
        const key = params[0];
        const row = records.get(key);
        return [row ? [row] : []];
      }
      if (sql.includes("INSERT INTO staff_line_notifications")) {
        const [storeId, eventType, relatedType, relatedId, lineGroupRegistrationId, idempotencyKey, payloadJson] = params;
        const status = "PENDING";
        records.set(idempotencyKey, {
          id: nextId++,
          storeId,
          eventType,
          relatedType,
          relatedId,
          status,
          assignedStaffId: null,
          assignedStaffName: null,
          acknowledgedBy: null,
          acknowledgedName: null,
          acknowledgedAt: null,
          customerMessageSentAt: null,
          customerMessageSentBy: null,
          lineGroupRegistrationId,
          lineMessageId: null,
          idempotencyKey,
          payloadJson,
          lastErrorCode: null,
          sendingStartedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        return [{ affectedRows: 1, insertId: nextId - 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  const input = {
    storeId: 10,
    eventType: "REPAIR_STARTED",
    relatedType: "REPAIR",
    relatedId: 42,
    idempotencyKey: "repair:42:repair_started:group:7",
    lineGroupRegistrationId: 7
  };
  const first = await createStaffLineNotification(input, connection);
  const second = await createStaffLineNotification(input, connection);
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(second.shouldSend, false);
  assert.strictEqual(records.size, 1);
}

function testMessages() {
  const cases = [
    ["reservation_created", "【新維修預約】", "repair:42:reservation_created"],
    ["reservation_confirmed", "【維修預約已確認】", "repair:42:reservation_confirmed"],
    ["diagnosis_saved", "【初步診斷已完成】", "repair:42:diagnosis_saved:2026-07-18T01:02:03.000Z"],
    ["quote_draft_saved", "【維修報價草稿已儲存】", "repair:42:quote_draft_saved:2026-07-18T01:02:03.000Z"],
    ["cross_check_approved", "【交叉確認完成】", "repair:42:cross_check:2026-07-18T01:02:03.000Z"],
    ["cross_check_needs_revision", "【交叉確認結果】", "repair:42:cross_check:2026-07-18T01:02:03.000Z"],
    ["quote_sent_to_customer", "【維修報價已發送】", "repair:42:quote_sent_to_customer:2026-07-18T01:02:03.000Z"],
    ["customer_approved", "【客戶已同意維修報價】", "repair:42:customer_approved"],
    ["customer_rejected", "【客戶拒絕維修報價】", "repair:42:customer_rejected"],
    ["repair_started", "【維修已開始】", "repair:42:repair_started"],
    ["repair_completed", "【維修已完成】", "repair:42:repair_completed"],
    ["picked_up", "【客戶已取車】", "repair:42:picked_up"]
  ];

  for (const [event, title, key] of cases) {
    const notification = buildRepairStaffWorkflowNotification({
      event,
      repairId: 42,
      bikeModel: "A車款",
      reservationDate: "2026-07-19",
      staffName: "王小明",
      amount: 1500,
      note: "需要調整煞車",
      diagnosisSummary: "前輪異音，需要檢查煞車與輪組。請勿把完整客訴長文全部貼出。",
      updatedAt: "2026-07-18T01:02:03.000Z"
    });
    assert(notification, event);
    assert.strictEqual(notification.title, title);
    assert.strictEqual(notification.idempotencyKey, key);
    const text = flattenNotification(notification);
    assert(!text.includes("0912345678"));
    assert(!text.includes("U1234567890abcdef"));
    assert(!text.includes("地址"));
    assert(!text.includes("客戶："));
    assert(!text.includes("電話："));
  }
}

async function main() {
  assert.strictEqual(isStaffLineNotifySuppressed(), true);
  await testStaffGroupSelection();
  await testDuplicateRecordOnce();
  testMessages();
  console.log("repair staff LINE notification tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
