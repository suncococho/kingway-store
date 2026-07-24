-- READ-ONLY: 기존 미지급 420/120/60 event를 신규 600 기준으로 전환하기 전 차이 보고.
-- 이 파일은 UPDATE/INSERT/DELETE를 수행하지 않는다.
SELECT
  e.store_id,
  e.status,
  COUNT(*) AS legacy_event_count,
  SUM(e.final_amount) AS legacy_total_amount,
  SUM(CASE
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage = 'SALE'
      THEN 600.00 * e.quantity * e.assigned_ratio
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage IN ('HANDOVER', 'FOLLOWUP')
      THEN 0.00
    ELSE e.final_amount
  END) AS proposed_total_amount,
  SUM(CASE
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage = 'SALE'
      THEN 600.00 * e.quantity * e.assigned_ratio
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage IN ('HANDOVER', 'FOLLOWUP')
      THEN 0.00
    ELSE e.final_amount
  END) - SUM(e.final_amount) AS amount_difference
FROM staff_incentive_events e
JOIN staff_incentive_plan_versions p ON p.id = e.plan_version_id
WHERE p.version <> 'KINGWAY-2026-07-SALE600-V2'
  AND e.status IN ('PENDING', 'EARNED')
GROUP BY e.store_id, e.status
ORDER BY e.store_id, e.status;

SELECT
  e.id, e.store_id, e.staff_user_id, e.status,
  e.incentive_type, e.earning_stage, e.source_type, e.source_id, e.source_line_id,
  e.quantity, e.assigned_ratio, e.final_amount AS legacy_amount,
  CASE
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage = 'SALE'
      THEN 600.00 * e.quantity * e.assigned_ratio
    WHEN e.incentive_type = 'BIKE' AND e.earning_stage IN ('HANDOVER', 'FOLLOWUP')
      THEN 0.00
    ELSE e.final_amount
  END AS proposed_amount
FROM staff_incentive_events e
JOIN staff_incentive_plan_versions p ON p.id = e.plan_version_id
WHERE p.version <> 'KINGWAY-2026-07-SALE600-V2'
  AND e.status IN ('PENDING', 'EARNED')
ORDER BY e.store_id, e.id;
