-- KINGWAY production activation correction for the case-completion responsibility plan.
-- Keeps the new R2 plan active for every store and avoids timezone/month-boundary
-- lookup gaps by setting the effective time safely before the current instant.
SET NAMES utf8mb4;
START TRANSACTION;

UPDATE staff_incentive_plan_versions previous_plan
INNER JOIN staff_incentive_plan_versions responsibility_plan
  ON responsibility_plan.store_id = previous_plan.store_id
 AND responsibility_plan.version = 'KINGWAY-2026-07-R2-RESPONSIBILITY'
SET previous_plan.status = 'INACTIVE',
    previous_plan.effective_to = COALESCE(
      previous_plan.effective_to,
      DATE_SUB(NOW(), INTERVAL 1 SECOND)
    )
WHERE previous_plan.id <> responsibility_plan.id
  AND previous_plan.status = 'ACTIVE';

UPDATE staff_incentive_plan_versions
SET status = 'ACTIVE',
    effective_from = DATE_SUB(NOW(), INTERVAL 1 DAY),
    effective_to = NULL
WHERE version = 'KINGWAY-2026-07-R2-RESPONSIBILITY';

COMMIT;

SELECT
  store_id,
  id AS plan_version_id,
  version,
  status,
  effective_from,
  effective_to,
  CHAR_LENGTH(agreement_text) AS agreement_text_length
FROM staff_incentive_plan_versions
WHERE version = 'KINGWAY-2026-07-R2-RESPONSIBILITY'
ORDER BY store_id;
