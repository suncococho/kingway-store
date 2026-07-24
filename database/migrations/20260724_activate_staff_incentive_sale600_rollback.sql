-- Rollback 신규 NT$600 plan.
-- Event/agreement가 연결된 plan과 기존 event, APPROVED/PAID 기록은 변경하지 않는다.
-- V2 plan이 제거된 store만 2026-07-24 이전의 가장 최근 plan을 ACTIVE로 복구한다.
-- 모든 V2 plan이 제거되어 rollback이 완료된 경우에만 migration marker를 삭제한다.
START TRANSACTION;

CREATE TEMPORARY TABLE rollback_sale600_stores (
  store_id BIGINT UNSIGNED NOT NULL PRIMARY KEY
);

INSERT IGNORE INTO rollback_sale600_stores (store_id)
SELECT p.store_id
FROM staff_incentive_plan_versions p
WHERE p.version = 'KINGWAY-2026-07-SALE600-V2'
  AND EXISTS (
    SELECT 1
    FROM kingway_schema_migrations
    WHERE migration_key = '20260724_activate_staff_incentive_sale600'
  )
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_events e WHERE e.plan_version_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_agreements a WHERE a.plan_version_id = p.id);

DELETE p
FROM staff_incentive_plan_versions p
JOIN rollback_sale600_stores rollback_store ON rollback_store.store_id = p.store_id
WHERE p.version = 'KINGWAY-2026-07-SALE600-V2';

UPDATE staff_incentive_plan_versions previous
JOIN (
  SELECT candidate.store_id, MAX(candidate.id) AS id
  FROM staff_incentive_plan_versions candidate
  JOIN rollback_sale600_stores rollback_store ON rollback_store.store_id = candidate.store_id
  WHERE candidate.version <> 'KINGWAY-2026-07-SALE600-V2'
    AND effective_from < '2026-07-24 00:00:00'
  GROUP BY candidate.store_id
) latest ON latest.id = previous.id
SET previous.status = 'ACTIVE',
    previous.effective_to = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM staff_incentive_plan_versions current_plan
  WHERE current_plan.store_id = previous.store_id
    AND current_plan.version = 'KINGWAY-2026-07-SALE600-V2'
)
  AND EXISTS (
    SELECT 1
    FROM kingway_schema_migrations
    WHERE migration_key = '20260724_activate_staff_incentive_sale600'
  );

DROP TEMPORARY TABLE rollback_sale600_stores;

DELETE FROM kingway_schema_migrations
WHERE migration_key = '20260724_activate_staff_incentive_sale600'
  AND NOT EXISTS (
    SELECT 1
    FROM staff_incentive_plan_versions
    WHERE version = 'KINGWAY-2026-07-SALE600-V2'
  );

COMMIT;
