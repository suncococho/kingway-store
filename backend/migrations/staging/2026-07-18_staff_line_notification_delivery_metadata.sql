-- Adds explicit delivery metadata for staff LINE notification auditability.
-- Do not run automatically; apply only after staging backup and approval.

ALTER TABLE staff_line_notifications
  ADD COLUMN attempted_at DATETIME NULL AFTER status,
  ADD COLUMN sent_at DATETIME NULL AFTER attempted_at,
  ADD COLUMN destination_line_group_id VARCHAR(255) NULL AFTER line_group_registration_id,
  ADD COLUMN failure_reason VARCHAR(255) NULL AFTER last_error_code;

CREATE INDEX idx_staff_line_notifications_repair_event
  ON staff_line_notifications (store_id, related_type, related_id, event_type);
