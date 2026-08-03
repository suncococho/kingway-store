-- WARNING: Do not remove publish lineage after any real published revision.
ALTER TABLE work_schedule_revisions DROP FOREIGN KEY fk_revision_reopened_by, DROP FOREIGN KEY fk_revision_published_by,
  DROP INDEX idx_revision_reopened_by, DROP INDEX idx_revision_published_by, DROP COLUMN publish_version, DROP COLUMN reopened_by,
  DROP COLUMN reopened_at, DROP COLUMN published_by, DROP COLUMN published_at;
ALTER TABLE store_business_calendars DROP COLUMN version, DROP COLUMN admin_assignment_counts_toward_limit,
  DROP COLUMN pending_reserves_capacity, DROP COLUMN request_deadline_at, DROP COLUMN request_locked, DROP COLUMN max_request_capacity;
