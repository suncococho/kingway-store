"use strict";

function dateOnly(value) {
  const result = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("effectiveDate 格式不正確");
  return result;
}

function mapResult(row, overrides = {}) {
  const maxSelectableDays = Number(overrides.maxSelectableDays ?? row.maxSelectableDays);
  if (!Number.isInteger(maxSelectableDays) || maxSelectableDays <= 0) throw new Error("排班級距的每週上限不正確");
  return {
    status: overrides.status || row.status,
    score: row.score == null ? null : Number(row.score),
    tierId: row.tierId == null ? null : Number(row.tierId),
    tierCode: row.tierCode || null,
    tierName: row.tierName || "中性級距",
    maxSelectableDays,
    source: overrides.source || row.sourceType || "SCORE_SNAPSHOT",
    calculatedAt: row.calculatedAt || null
  };
}

async function getLatestSchedulingScore({ connection, storeId, staffUserId, effectiveDate }) {
  if (!connection || typeof connection.query !== "function") throw new TypeError("需要資料庫連線");
  const date = dateOnly(effectiveDate);
  const [valid] = await connection.query(
    `SELECT ss.status,ss.score,ss.tier_rule_id tierId,tr.tier_code tierCode,tr.tier_name tierName,
            tr.max_selectable_days maxSelectableDays,ss.source_type sourceType,ss.calculated_at calculatedAt
       FROM scheduling_score_snapshots ss JOIN scheduling_score_tier_rules tr ON tr.id=ss.tier_rule_id AND tr.store_id=ss.store_id
      WHERE ss.store_id=? AND ss.staff_user_id=? AND ss.status='VALID' AND ss.effective_from<=?
        AND (ss.effective_to IS NULL OR ss.effective_to>=?) AND tr.is_enabled=1
      ORDER BY ss.calculated_at DESC,ss.id DESC LIMIT 1`, [storeId, staffUserId, date, date]);
  if (valid[0]) return mapResult(valid[0]);

  const [overrides] = await connection.query(
    `SELECT max_selectable_days maxSelectableDays,updated_at calculatedAt
       FROM staff_weekly_limit_overrides
      WHERE store_id=? AND staff_user_id=? AND is_enabled=1 AND effective_from<=? AND effective_to>=?
        AND (week_start IS NULL OR week_start=DATE_SUB(?,INTERVAL WEEKDAY(?) DAY))
      ORDER BY (week_start IS NOT NULL) DESC,updated_at DESC,id DESC LIMIT 1`, [storeId, staffUserId, date, date, date, date]);

  const [assigned] = await connection.query(
    `SELECT ss.status,ss.score,ss.tier_rule_id tierId,tr.tier_code tierCode,tr.tier_name tierName,
            tr.max_selectable_days maxSelectableDays,ss.source_type sourceType,ss.calculated_at calculatedAt
       FROM scheduling_score_snapshots ss JOIN scheduling_score_tier_rules tr ON tr.id=ss.tier_rule_id AND tr.store_id=ss.store_id
      WHERE ss.store_id=? AND ss.staff_user_id=? AND ss.status='ADMIN_ASSIGNED' AND ss.effective_from<=?
        AND (ss.effective_to IS NULL OR ss.effective_to>=?) AND tr.is_enabled=1
      ORDER BY ss.calculated_at DESC,ss.id DESC LIMIT 1`, [storeId, staffUserId, date, date]);

  const [neutral] = await connection.query(
    `SELECT 'INSUFFICIENT_DATA' status,NULL score,id tierId,tier_code tierCode,tier_name tierName,
            max_selectable_days maxSelectableDays,'NEUTRAL_DEFAULT' sourceType,NULL calculatedAt
       FROM scheduling_score_tier_rules
      WHERE store_id=? AND is_neutral_default=1 AND is_enabled=1 AND effective_from<=?
        AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id DESC`, [storeId, date, date]);
  if (!neutral[0] && !assigned[0]) throw new Error("門市尚未設定有效的中性排班級距");
  if (neutral.length > 1) throw new Error("門市存在重疊的中性排班級距");
  const base = assigned[0] || neutral[0];
  if (overrides[0]) return mapResult(base, { status: assigned[0] ? "ADMIN_ASSIGNED" : "INSUFFICIENT_DATA", maxSelectableDays: overrides[0].maxSelectableDays, source: "WEEKLY_LIMIT_OVERRIDE" });
  if (assigned[0]) return mapResult(assigned[0]);
  return mapResult(neutral[0]);
}

module.exports = { getLatestSchedulingScore, dateOnly, mapResult };
