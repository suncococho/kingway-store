-- Phase 1 manual DRAFT schedules. Do not run without target/backup prechecks.
CREATE TABLE work_schedule_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, period_id BIGINT UNSIGNED NOT NULL,
  revision_no INT UNSIGNED NOT NULL, status ENUM('DRAFT','REVIEW','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  previous_revision_id BIGINT UNSIGNED NULL, change_reason VARCHAR(500) NULL, created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_work_schedule_revision (store_id, period_id, revision_no), KEY idx_work_schedule_period_status (store_id, period_id, status),
  CONSTRAINT fk_work_schedule_revision_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_work_schedule_revision_period FOREIGN KEY (period_id) REFERENCES staff_schedule_periods(id),
  CONSTRAINT fk_work_schedule_previous FOREIGN KEY (previous_revision_id) REFERENCES work_schedule_revisions(id),
  CONSTRAINT fk_work_schedule_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id), CONSTRAINT fk_work_schedule_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE work_shifts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, revision_id BIGINT UNSIGNED NOT NULL,
  business_calendar_id BIGINT UNSIGNED NOT NULL, shift_date DATE NOT NULL, starts_at TIME NOT NULL, ends_at TIME NOT NULL,
  required_headcount SMALLINT UNSIGNED NOT NULL DEFAULT 1, required_role VARCHAR(40) NULL, note VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_work_shift_revision_date (store_id, revision_id, shift_date),
  CONSTRAINT fk_work_shift_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_work_shift_revision FOREIGN KEY (revision_id) REFERENCES work_schedule_revisions(id) ON DELETE CASCADE,
  CONSTRAINT fk_work_shift_calendar FOREIGN KEY (business_calendar_id) REFERENCES store_business_calendars(id),
  CONSTRAINT fk_work_shift_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id), CONSTRAINT fk_work_shift_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id), CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE work_shift_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, shift_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('DRAFT','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'DRAFT', assigned_by BIGINT UNSIGNED NOT NULL,
  assignment_reason VARCHAR(500) NULL, is_manual TINYINT(1) NOT NULL DEFAULT 1, version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_shift_assignment_staff (store_id, shift_id, staff_user_id), KEY idx_shift_assignment_staff (store_id, staff_user_id, status),
  CONSTRAINT fk_shift_assignment_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_shift_assignment_shift FOREIGN KEY (shift_id) REFERENCES work_shifts(id) ON DELETE CASCADE,
  CONSTRAINT fk_shift_assignment_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id), CONSTRAINT fk_shift_assignment_by FOREIGN KEY (assigned_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
