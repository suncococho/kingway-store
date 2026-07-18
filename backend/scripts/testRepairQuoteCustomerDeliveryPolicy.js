const assert = require("assert");
const config = require("../src/config");
const { sendRepairQuoteConfirmationIfNeeded } = require("../src/services/lineWorkflowService");

const ORIGINAL_LINE_TOKEN = config.line.channelAccessToken;
config.line.channelAccessToken = "test-token";

function createRepair(overrides = {}) {
  return {
    id: 115,
    status: "reserved",
    reservationStatus: "approved",
    estimateSentAt: null,
    completedAt: null,
    pickedUpAt: null,
    bikeModel: "測試車款",
    issueDescription: "測試問題",
    estimateAmount: 400,
    estimateDetails: "測試報價",
    inspectionFee: 0,
    partsFee: 0,
    laborFee: 400,
    quoteStatus: "pending",
    quoteNotes: "",
    quoteItemsJson: "[]",
    inspectionNotes: "初步診斷內容",
    crossCheckStatus: "APPROVED",
    crossCheckedAt: new Date("2026-07-18T09:00:00Z"),
    customerConfirmedAt: null,
    customerEstimateResponse: "pending",
    customerEstimateRespondedAt: null,
    storeId: 1,
    customerName: "測試客戶",
    customerPhone: "0900000000",
    lineUserId: "Utest-line-user",
    ...overrides
  };
}

function createConnection(initialRepair) {
  const state = {
    repair: { ...initialRepair },
    logs: [],
    updates: [],
    sentLogs: []
  };

  return {
    state,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SHOW COLUMNS FROM")) {
        return [[
          "id", "status", "reservation_status", "estimate_sent_at", "completed_at", "picked_up_at",
          "bike_model", "issue_description", "estimate_amount", "estimate_details", "inspection_fee",
          "parts_fee", "labor_fee", "quote_status", "quote_notes", "quote_items_json",
          "inspection_notes", "cross_check_status", "cross_checked_at", "customer_confirmed_at",
          "customer_estimate_response", "customer_estimate_responded_at", "store_id", "customer_id", "updated_at"
        ].map((Field) => ({ Field }))];
      }
      if (normalized.includes("FROM INFORMATION_SCHEMA.COLUMNS")) {
        return [[{ COLUMN_TYPE: "enum('reserved','checking','estimate_pending_approval','estimate_approved','estimate_rejected','repairing','completed_waiting_pickup','picked_up','canceled')" }]];
      }
      if (normalized.includes("FROM repair_orders ro") && normalized.includes("INNER JOIN customers")) {
        return [[{ ...state.repair }]];
      }
      if (normalized.includes("FROM repair_logs") && normalized.includes("action = 'quote_confirmation_sent'")) {
        return [[...state.sentLogs].sort((a, b) => b.id - a.id).slice(0, 1)];
      }
      if (normalized.startsWith("INSERT INTO repair_logs")) {
        const [repairId, action, note] = params;
        const log = { id: state.logs.length + state.sentLogs.length + 1, repairId, action, note, createdAt: new Date() };
        state.logs.push(log);
        if (action === "quote_confirmation_sent") {
          state.sentLogs.push(log);
        }
        return [{ insertId: log.id }];
      }
      if (normalized.startsWith("UPDATE repair_orders SET")) {
        state.updates.push({ sql, params });
        state.repair.status = params[0];
        state.repair.estimateSentAt = new Date();
        state.repair.customerEstimateResponse = "pending";
        state.repair.customerEstimateRespondedAt = null;
        if (normalized.includes("quote_status = 'sent'")) {
          state.repair.quoteStatus = "sent";
        }
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    }
  };
}

function sentLogCount(connection) {
  return connection.state.logs.filter((log) => log.action === "quote_confirmation_sent").length;
}

async function run() {
  try {
    {
      const connection = createConnection(createRepair());
      const pushes = [];
      const result = await sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
        connection,
        source: "unit_test",
        sendLineMessage: async (_config, to, messages) => pushes.push({ to, messages })
      });
      assert.strictEqual(result.sent, true);
      assert.strictEqual(pushes.length, 1);
      assert.strictEqual(pushes[0].messages[0].altText, "維修報價確認");
      assert.deepStrictEqual(pushes[0].messages[0].contents.footer.contents.map((item) => item.action.label), ["同意報價", "拒絕報價", "查看維修進度"]);
      assert.strictEqual(connection.state.repair.status, "estimate_pending_approval");
      assert.strictEqual(connection.state.repair.quoteStatus, "sent");
      assert.ok(connection.state.repair.estimateSentAt);
      assert.strictEqual(sentLogCount(connection), 1);
    }

    {
      const connection = createConnection(createRepair({ lineUserId: null }));
      await assert.rejects(
        () => sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
          connection,
          sendLineMessage: async () => { throw new Error("should not send"); }
        }),
        /找不到此客戶的 LINE 綁定資料/
      );
      assert.strictEqual(connection.state.updates.length, 0);
      assert.strictEqual(sentLogCount(connection), 0);
    }

    {
      const connection = createConnection(createRepair());
      await assert.rejects(
        () => sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
          connection,
          sendLineMessage: async () => { throw new Error("push failed"); }
        }),
        /LINE 維修報價通知發送失敗/
      );
      assert.strictEqual(connection.state.updates.length, 0);
      assert.strictEqual(sentLogCount(connection), 0);
    }

    {
      const connection = createConnection(createRepair());
      let pushCount = 0;
      await sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
        connection,
        sendLineMessage: async () => { pushCount += 1; }
      });
      const second = await sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
        connection,
        sendLineMessage: async () => { pushCount += 1; }
      });
      assert.strictEqual(pushCount, 1);
      assert.strictEqual(second.reused, true);
    }

    {
      const connection = createConnection(createRepair());
      let pushCount = 0;
      await sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
        connection,
        sendLineMessage: async () => { pushCount += 1; }
      });
      connection.state.repair.status = "reserved";
      connection.state.repair.quoteStatus = "pending";
      connection.state.repair.estimateSentAt = null;
      connection.state.repair.estimateAmount = 500;
      await sendRepairQuoteConfirmationIfNeeded(115, 1, 7, {
        connection,
        sendLineMessage: async () => { pushCount += 1; }
      });
      assert.strictEqual(pushCount, 2);
      assert.strictEqual(sentLogCount(connection), 2);
    }

    console.log("repair quote customer delivery policy tests passed");
  } finally {
    config.line.channelAccessToken = ORIGINAL_LINE_TOKEN;
  }
}

run().catch((error) => {
  config.line.channelAccessToken = ORIGINAL_LINE_TOKEN;
  console.error(error);
  process.exit(1);
});
