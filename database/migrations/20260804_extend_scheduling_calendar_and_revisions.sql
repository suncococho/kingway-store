ALTER TABLE store_business_calendars ADD COLUMN max_request_capacity SMALLINT UNSIGNED NULL AFTER required_headcount,
  ADD COLUMN request_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER max_request_capacity, ADD COLUMN request_deadline_at DATETIME NULL AFTER request_locked,
  ADD COLUMN pending_reserves_capacity TINYINT(1) NOT NULL DEFAULT 0 AFTER request_deadline_at,
  ADD COLUMN admin_assignment_counts_toward_limit TINYINT(1) NOT NULL DEFAULT 1 AFTER pending_reserves_capacity,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER admin_assignment_counts_toward_limit;
ALTER TABLE work_schedule_revisions ADD COLUMN published_at DATETIME NULL AFTER change_reason, ADD COLUMN published_by BIGINT UNSIGNED NULL AFTER published_at,
  ADD COLUMN reopened_at DATETIME NULL AFTER published_by, ADD COLUMN reopened_by BIGINT UNSIGNED NULL AFTER reopened_at,
  ADD COLUMN publish_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER reopened_by,
  ADD KEY idx_revision_published_by(published_by), ADD KEY idx_revision_reopened_by(reopened_by),
  ADD CONSTRAINT fk_revision_published_by FOREIGN KEY(published_by) REFERENCES staff_users(id), ADD CONSTRAINT fk_revision_reopened_by FOREIGN KEY(reopened_by) REFERENCES staff_users(id);
