-- Rollback 신규 NT$600 plan. Event/agreement가 연결된 plan은 삭제하지 않는다.
START TRANSACTION;

DELETE p
FROM staff_incentive_plan_versions p
WHERE p.version = 'KINGWAY-2026-07-SALE600-V2'
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_events e WHERE e.plan_version_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_agreements a WHERE a.plan_version_id = p.id);

UPDATE staff_incentive_plan_versions previous
JOIN (
  SELECT store_id, MAX(id) AS id
  FROM staff_incentive_plan_versions
  WHERE version <> 'KINGWAY-2026-07-SALE600-V2'
    AND effective_from < '2026-07-24 00:00:00'
  GROUP BY store_id
) latest ON latest.id = previous.id
SET previous.status = 'ACTIVE',
    previous.effective_to = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM staff_incentive_plan_versions current_plan
  WHERE current_plan.store_id = previous.store_id
    AND current_plan.version = 'KINGWAY-2026-07-SALE600-V2'
);

COMMIT;
