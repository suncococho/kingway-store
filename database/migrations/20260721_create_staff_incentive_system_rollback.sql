-- STAGING rollback only.
-- Do not execute in production without separate approval and backup.

DROP TABLE IF EXISTS staff_incentive_disputes;
DROP TABLE IF EXISTS staff_incentive_adjustments;
DROP TABLE IF EXISTS staff_incentive_events;
DROP TABLE IF EXISTS staff_incentive_payouts;
DROP TABLE IF EXISTS staff_incentive_agreements;
DROP TABLE IF EXISTS staff_incentive_plan_versions;
