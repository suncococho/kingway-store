ALTER TABLE stores
  DROP KEY idx_stores_plan_status,
  DROP KEY idx_stores_trial_ends_at,
  DROP KEY idx_stores_subscription_ends_at,
  DROP KEY idx_stores_payment_status;

ALTER TABLE stores
  DROP COLUMN last_plan_changed_at,
  DROP COLUMN billing_note,
  DROP COLUMN payment_status,
  DROP COLUMN subscription_ends_at,
  DROP COLUMN trial_ends_at;
