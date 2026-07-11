ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS pickup_reminder_suppressed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_reminder_suppressed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS pickup_reminder_suppressed_by VARCHAR(191) NULL;
