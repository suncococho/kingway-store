#!/usr/bin/env node
/*
 * 員工績效補算（KW-2026-11-R1）
 *
 * 預設為 dry-run：只讀取並列出會新增／更新／作廢的績效，不寫入資料庫。
 *
 *   docker exec kingway-backend node scripts/reconcileStaffIncentives.js --month 2026-11
 *   docker exec kingway-backend node scripts/reconcileStaffIncentives.js --month 2026-11 --apply
 *
 * 選項：
 *   --month YYYY-MM   補算月份（依訂單日期／營業日），預設 2026-11
 *   --store <id>      只處理指定門市
 *   --apply           實際寫入
 *
 * 寫入時：
 * - 依新規則建立／更新該訂單的績效（已核准、已支付、爭議中不變更）
 * - 同一訂單中舊版規則建立、但新規則不再產生的「待確認／已取得」績效 → 作廢
 *   （例如維修零件原本記為配件、舊版維修初步檢查）
 */
const { pool, withTransaction } = require("../src/db");
const { getActiveIncentivePlan } = require("../src/services/staffIncentiveService");
const {
  INCENTIVE_RULE_VERSION,
  INCENTIVE_EFFECTIVE_FROM,
  buildOrderSaleIncentiveCandidates,
  loadOrderSaleIncentiveSnapshot,
  reconcileOrderSaleIncentives,
  loadExistingOrderEvents,
  remapCandidatesToExistingEvents,
  isVehicleItem,
  isPurchaseConfirmationComplete,
  isOrderHandoverComplete,
  isRepairLinkedOrder
} = require("../src/services/staffIncentiveEarningService");

const TRIGGER_SOURCE = "BACKFILL_KW_2026_11_R1";
const LEGACY_VOID_REASON = `REPLACED_BY_${INCENTIVE_RULE_VERSION}`;
const OPEN_STATUSES = new Set(["PENDING", "EARNED"]);

function parseArgs(argv) {
  const args = { month: "2026-11", storeId: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--month") args.month = String(argv[++i] || "");
    else if (arg === "--store") args.storeId = Number(argv[++i] || 0) || null;
    else throw new Error(`未知參數：${arg}`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) {
    throw new Error("--month 格式必須為 YYYY-MM");
  }
  return args;
}

function monthRange(month) {
  const [year, mon] = month.split("-").map(Number);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const start = `${month}-01`;
  const end = `${nextYear}-${String(nextMon).padStart(2, "0")}-01`;
  if (new Date(`${end}T00:00:00+08:00`) <= INCENTIVE_EFFECTIVE_FROM) {
    throw new Error(`${month} 在規則生效日之前，不處理`);
  }
  return { start, end };
}

function eventKey(event) {
  return [
    Number(event.staffUserId),
    event.incentiveType,
    event.earningStage,
    event.sourceType,
    Number(event.sourceId),
    Number(event.sourceLineId || 0),
    String(event.sourceUnitKey || "")
  ].join("|");
}

async function loadExistingEvents(connection, order) {
  const repairOrderId = Number(order.repairOrderId || 0) || null;
  const [rows] = await connection.query(
    `
      SELECT
        id,
        staff_user_id AS staffUserId,
        plan_version_id AS planVersionId,
        incentive_type AS incentiveType,
        earning_stage AS earningStage,
        source_type AS sourceType,
        source_id AS sourceId,
        source_line_id AS sourceLineId,
        source_unit_key AS sourceUnitKey,
        product_name_snapshot AS productNameSnapshot,
        final_amount AS finalAmount,
        earned_at AS earnedAt,
        status
      FROM staff_incentive_events
      WHERE store_id = ?
        AND (
          (source_type IN ('ORDER', 'ORDER_ITEM') AND source_id = ?)
          OR (? IS NOT NULL AND source_type = 'REPAIR' AND source_id = ?)
        )
      ORDER BY id ASC
    `,
    [order.storeId, order.id, repairOrderId, repairOrderId]
  );
  return rows;
}

async function voidLegacyEvents(connection, order, keptIds) {
  const repairOrderId = Number(order.repairOrderId || 0) || null;
  const params = [LEGACY_VOID_REASON, order.storeId, order.id, repairOrderId, repairOrderId];
  let keepSql = "";
  if (keptIds.length) {
    keepSql = `AND id NOT IN (${keptIds.map(() => "?").join(", ")})`;
    params.push(...keptIds);
  }
  const [result] = await connection.query(
    `
      UPDATE staff_incentive_events
      SET status = 'VOID',
          void_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ?
        AND (
          (source_type IN ('ORDER', 'ORDER_ITEM') AND source_id = ?)
          OR (? IS NOT NULL AND source_type = 'REPAIR' AND source_id = ?)
        )
        AND status IN ('PENDING', 'EARNED')
        ${keepSql}
    `,
    params
  );
  return Number(result?.affectedRows || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hourCycle: "h23" });
}

// 已交車但沒有產生車輛績效時，說明原因
function explainMissingBike(snapshot, evaluation) {
  const order = snapshot?.order || {};
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  if (!isOrderHandoverComplete(order)) return [];
  if (evaluation.candidates.some((c) => c.incentiveType === "BIKE")) return [];
  const notes = [];
  if (isRepairLinkedOrder(snapshot)) {
    notes.push("維修訂單，不計車輛績效");
    return notes;
  }
  const vehicles = items.filter(isVehicleItem);
  if (!vehicles.length) {
    notes.push("找不到電動自行車品項（EB 分類或 B-EB- SKU）。品項：");
    for (const item of items) {
      notes.push(`    - ${item.productNameSnapshot || "-"}｜分類快照 ${item.productCategorySnapshot || "-"}｜商品分類 ${item.masterCategory || "-"}｜SKU ${item.skuSnapshot || "-"}`);
    }
  }
  const pc = snapshot?.purchaseConfirmation || null;
  if (!isPurchaseConfirmationComplete(pc)) {
    notes.push(
      pc
        ? `購車確認書未完成（狀態 ${pc.status || "-"}、送出 ${pc.submittedAt ? formatDate(pc.submittedAt) : "未送出"}、最終確認 ${Number(pc.finalConfirmationAccepted) === 1 ? "是" : "否"}）`
        : "沒有購車確認書"
    );
  }
  return notes;
}

function money(value) {
  return `NT$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const range = monthRange(args.month);
  console.log(`[${args.apply ? "APPLY" : "DRY-RUN"}] 規則 ${INCENTIVE_RULE_VERSION}，訂單日期 ${range.start} ~ ${range.end}（不含）`);

  const storeSql = args.storeId ? "AND store_id = ?" : "";
  const [orders] = await pool.query(
    `
      SELECT id, store_id AS storeId, order_no AS orderNo, repair_order_id AS repairOrderId
      FROM orders
      WHERE deleted_at IS NULL
        AND final_payment_status = 'PAID'
        AND sales_staff_id IS NOT NULL
        AND COALESCE(business_date, DATE(created_at)) >= ?
        AND COALESCE(business_date, DATE(created_at)) < ?
        ${storeSql}
      ORDER BY store_id ASC, id ASC
    `,
    [range.start, range.end, ...(args.storeId ? [args.storeId] : [])]
  );
  console.log(`符合條件的訂單：${orders.length} 筆（已完款且已指定銷售人員）`);

  const [unassigned] = await pool.query(
    `
      SELECT id, order_no AS orderNo, handover_confirmed_at AS handoverConfirmedAt
      FROM orders
      WHERE deleted_at IS NULL
        AND final_payment_status = 'PAID'
        AND sales_staff_id IS NULL
        AND COALESCE(business_date, DATE(created_at)) >= ?
        AND COALESCE(business_date, DATE(created_at)) < ?
        ${storeSql}
      ORDER BY id ASC
    `,
    [range.start, range.end, ...(args.storeId ? [args.storeId] : [])]
  );
  if (unassigned.length) {
    console.log(`⚠ 已完款但未指定銷售人員（不計算，請在訂單管理指定後再執行）：${unassigned.length} 筆`);
    for (const row of unassigned) {
      console.log(`  訂單 #${row.id} ${row.orderNo || ""}${row.handoverConfirmedAt ? "（已交車）" : ""}`);
    }
  }

  const planCache = new Map();
  const staffTotals = new Map();
  const totals = { create: 0, update: 0, same: 0, locked: 0, planReview: 0, voidLegacy: 0, failed: 0 };

  for (const order of orders) {
    try {
      if (!planCache.has(order.storeId)) {
        planCache.set(order.storeId, await getActiveIncentivePlan(pool, order.storeId, new Date()));
      }
      const plan = planCache.get(order.storeId);
      const snapshot = await loadOrderSaleIncentiveSnapshot(pool, order.storeId, order.id);
      const evaluation = buildOrderSaleIncentiveCandidates({ snapshot, plan, triggerSource: TRIGGER_SOURCE });
      if (!["BEFORE_EFFECTIVE_FROM", "ACTIVE_PLAN_NOT_FOUND"].includes(evaluation.reason)) {
        remapCandidatesToExistingEvents(
          evaluation.candidates,
          await loadExistingOrderEvents(pool, { storeId: order.storeId, orderId: order.id })
        );
      }
      const existing = await loadExistingEvents(pool, order);
      const existingByKey = new Map(existing.map((row) => [eventKey(row), row]));
      const matchedIds = new Set();
      const lines = [];

      for (const candidate of evaluation.candidates) {
        const found = existingByKey.get(eventKey(candidate));
        let action = "新增";
        if (found) {
          matchedIds.add(Number(found.id));
          if (!OPEN_STATUSES.has(found.status)) {
            action = `不變(${found.status})`;
            totals.locked += 1;
          } else if (Number(found.planVersionId || 0) > 0 && plan && Number(found.planVersionId) !== Number(plan.id)) {
            action = "不變(辦法版本不同，需人工確認)";
            totals.planReview += 1;
          } else if (Number(found.finalAmount) !== Number(candidate.finalAmount)) {
            action = `更新(${money(found.finalAmount)}→)`;
            totals.update += 1;
          } else if (
            candidate.earnedAt &&
            (!found.earnedAt || Math.abs(new Date(found.earnedAt).getTime() - new Date(candidate.earnedAt).getTime()) > 60000)
          ) {
            action = `更新日期(${formatDate(found.earnedAt)}→${formatDate(candidate.earnedAt)})`;
            totals.update += 1;
          } else {
            action = "相同";
            totals.same += 1;
          }
        } else {
          totals.create += 1;
        }
        const staffTotal = staffTotals.get(candidate.staffUserId) || 0;
        staffTotals.set(candidate.staffUserId, staffTotal + Number(candidate.finalAmount || 0));
        lines.push(`  ${action} 員工#${candidate.staffUserId} ${candidate.incentiveType}/${candidate.earningStage} ${candidate.productNameSnapshot || "-"} ${money(candidate.finalAmount)}`);
      }

      const outOfScope =
        evaluation.reason === "BEFORE_EFFECTIVE_FROM" ||
        evaluation.reason === "ACTIVE_PLAN_NOT_FOUND" ||
        evaluation.reason === "SALES_STAFF_NOT_ASSIGNED";
      const legacy = outOfScope
        ? []
        : existing.filter((row) => OPEN_STATUSES.has(row.status) && !matchedIds.has(Number(row.id)));
      for (const row of legacy) {
        lines.push(`  作廢 #${row.id} 員工#${row.staffUserId} ${row.incentiveType}/${row.earningStage} ${row.productNameSnapshot || "-"} ${money(row.finalAmount)}`);
      }

      for (const note of explainMissingBike(snapshot, evaluation)) {
        lines.push(note.startsWith("    -") ? `  ${note}` : `  ⚠ 未計車輛：${note}`);
      }

      if (lines.length) {
        console.log(`訂單 #${order.id} ${order.orderNo || ""}（門市 ${order.storeId}）${evaluation.reason ? ` [${evaluation.reason}]` : ""}`);
        lines.forEach((line) => console.log(line));
      }

      if (args.apply) {
        const voided = await withTransaction(async (connection) => {
          const result = await reconcileOrderSaleIncentives({
            connection,
            storeId: order.storeId,
            orderId: order.id,
            triggerSource: TRIGGER_SOURCE
          });
          if (["ACTIVE_PLAN_NOT_FOUND", "BEFORE_EFFECTIVE_FROM", "SALES_STAFF_NOT_ASSIGNED"].includes(result.reason)) return 0;
          const keptIds = (result.results || [])
            .map((item) => Number(item?.event?.id || 0))
            .filter((id) => id > 0);
          return voidLegacyEvents(connection, order, keptIds);
        });
        totals.voidLegacy += voided;
      } else {
        totals.voidLegacy += legacy.length;
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`訂單 #${order.id} 失敗：${error.message}`);
    }
  }

  console.log("---- 合計 ----");
  console.log(`新增 ${totals.create}、更新 ${totals.update}、相同 ${totals.same}、鎖定不變 ${totals.locked}、需人工確認 ${totals.planReview}、作廢舊紀錄 ${totals.voidLegacy}、失敗 ${totals.failed}`);
  for (const [staffUserId, amount] of [...staffTotals.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`員工#${staffUserId} 新規則績效合計 ${money(amount)}`);
  }
  if (!args.apply) console.log("這是 dry-run，沒有寫入資料。確認無誤後加上 --apply 執行。");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
