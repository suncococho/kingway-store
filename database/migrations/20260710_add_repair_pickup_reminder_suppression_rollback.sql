ALTER TABLE repair_orders
  DROP COLUMN IF EXISTS pickup_reminder_suppressed_by,
  DROP COLUMN IF EXISTS pickup_reminder_suppressed_at,
  DROP COLUMN IF EXISTS pickup_reminder_suppressed;
