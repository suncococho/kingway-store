ALTER TABLE stores
  ADD COLUMN trial_ends_at DATETIME NULL AFTER plan,
  ADD COLUMN subscription_ends_at DATETIME NULL AFTER trial_ends_at,
  ADD COLUMN payment_status ENUM('NONE','UNPAID','PAID','PAST_DUE') NOT NULL DEFAULT 'NONE' AFTER subscription_ends_at,
  ADD COLUMN billing_note TEXT NULL AFTER payment_status,
  ADD COLUMN last_plan_changed_at DATETIME NULL AFTER billing_note;

ALTER TABLE stores
  ADD KEY idx_stores_plan_status (plan, status),
  ADD KEY idx_stores_trial_ends_at (trial_ends_at),
  ADD KEY idx_stores_subscription_ends_at (subscription_ends_at),
  ADD KEY idx_stores_payment_status (payment_status);
