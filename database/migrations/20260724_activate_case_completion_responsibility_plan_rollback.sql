-- Roll back the activation correction only. Signed agreement records remain preserved.
SET NAMES utf8mb4;
START TRANSACTION;

UPDATE staff_incentive_plan_versions
SET status = 'INACTIVE',
    effective_to = COALESCE(effective_to, NOW())
WHERE version = 'KINGWAY-2026-07-R2-RESPONSIBILITY';

UPDATE staff_incentive_plan_versions previous_plan
INNER JOIN (
  SELECT p.store_id, MAX(p.id) AS id
  FROM staff_incentive_plan_versions p
  WHERE p.version <> 'KINGWAY-2026-07-R2-RESPONSIBILITY'
    AND p.status = 'INACTIVE'
  GROUP BY p.store_id
) latest ON latest.id = previous_plan.id
SET previous_plan.status = 'ACTIVE',
    previous_plan.effective_to = NULL;

COMMIT;
