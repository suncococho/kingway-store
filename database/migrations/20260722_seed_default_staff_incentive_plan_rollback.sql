-- Roll back only the seeded KINGWAY default plan when it has no linked records.
DELETE p
FROM staff_incentive_plan_versions p
WHERE p.version = 'KINGWAY-2026-07-V1'
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_events e WHERE e.plan_version_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM staff_incentive_agreements a WHERE a.plan_version_id = p.id);
