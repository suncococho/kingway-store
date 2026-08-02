-- Phase 1 staff scheduling foundation. Do not run without target/backup prechecks.
CREATE TABLE staff_employment_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
  employment_type ENUM('FULL_TIME','PART_TIME','CONTRACT','TEMPORARY') NOT NULL DEFAULT 'PART_TIME',
  hourly_rate DECIMAL(10,2) NULL, contracted_weekly_hours DECIMAL(5,2) NULL, max_weekly_hours DECIMAL(5,2) NULL,
  default_store_id BIGINT UNSIGNED NOT NULL, created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_staff_employment_store_staff (store_id, staff_user_id), KEY idx_staff_employment_staff (staff_user_id),
  CONSTRAINT fk_staff_employment_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_staff_employment_default_store FOREIGN KEY (default_store_id) REFERENCES stores(id),
  CONSTRAINT fk_staff_employment_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id),
  CONSTRAINT fk_staff_employment_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_staff_employment_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_schedule_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, name VARCHAR(120) NOT NULL,
  starts_on DATE NOT NULL, ends_on DATE NOT NULL, input_deadline_at DATETIME NULL, timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
  status ENUM('DRAFT','REVIEW','PUBLISHED','CLOSED') NOT NULL DEFAULT 'DRAFT', version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_schedule_period_store_dates (store_id, starts_on, ends_on), KEY idx_schedule_period_store_status (store_id, status, starts_on),
  CONSTRAINT fk_schedule_period_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_schedule_period_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_schedule_period_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id), CHECK (ends_on >= starts_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE store_business_calendars (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, business_date DATE NOT NULL,
  is_open TINYINT(1) NOT NULL, opens_at TIME NULL, closes_at TIME NULL, required_headcount SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  override_type ENUM('DEFAULT','SPECIAL_OPEN','SPECIAL_CLOSED','HEADCOUNT_OVERRIDE') NOT NULL DEFAULT 'DEFAULT', note VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_business_calendar_store_date (store_id, business_date), KEY idx_business_calendar_store_open (store_id, is_open, business_date),
  CONSTRAINT fk_business_calendar_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_business_calendar_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_business_calendar_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_availability_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, period_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
  revision_no INT UNSIGNED NOT NULL, status ENUM('DRAFT','SUBMITTED') NOT NULL DEFAULT 'DRAFT', submitted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_availability_submission_revision (store_id, period_id, staff_user_id, revision_no),
  KEY idx_availability_submission_lookup (store_id, period_id, staff_user_id, status),
  CONSTRAINT fk_availability_submission_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_availability_submission_period FOREIGN KEY (period_id) REFERENCES staff_schedule_periods(id),
  CONSTRAINT fk_availability_submission_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_availability_windows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, submission_id BIGINT UNSIGNED NOT NULL,
  specific_date DATE NULL, weekday TINYINT UNSIGNED NULL, starts_at TIME NOT NULL, ends_at TIME NOT NULL,
  preference ENUM('AVAILABLE','PREFERRED','NOT_PREFERRED') NOT NULL DEFAULT 'AVAILABLE', note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_availability_window_submission (store_id, submission_id), KEY idx_availability_window_date (store_id, specific_date),
  CONSTRAINT fk_availability_window_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_availability_window_submission FOREIGN KEY (submission_id) REFERENCES staff_availability_submissions(id) ON DELETE CASCADE,
  CHECK ((specific_date IS NOT NULL) <> (weekday IS NOT NULL)), CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6), CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_time_off_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
  leave_type ENUM('ANNUAL','SICK','PERSONAL','STATUTORY','OTHER') NOT NULL, starts_at DATETIME NOT NULL, ends_at DATETIME NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING', public_note VARCHAR(255) NULL,
  private_reason TEXT NULL, attachment_ref VARCHAR(500) NULL, reviewed_by BIGINT UNSIGNED NULL, reviewed_at DATETIME NULL, review_note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_time_off_staff (store_id, staff_user_id, starts_at), KEY idx_time_off_review (store_id, status, starts_at),
  CONSTRAINT fk_time_off_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_time_off_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id),
  CONSTRAINT fk_time_off_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id), CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
