-- Phase B request lineage. Additive only; do not backfill from assignments.
CREATE TABLE staff_workday_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, period_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('DRAFT','PENDING','PARTIALLY_APPROVED','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT', revision_no INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME NULL, reviewed_at DATETIME NULL, reviewed_by BIGINT UNSIGNED NULL, review_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id), UNIQUE KEY uk_workday_request_staff_period (store_id,period_id,staff_user_id), KEY idx_workday_request_period_status (store_id,period_id,status),
  KEY idx_workday_request_staff_status (store_id,staff_user_id,status), KEY idx_workday_request_reviewer (reviewed_by),
  CONSTRAINT fk_workday_request_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_workday_request_period FOREIGN KEY (period_id) REFERENCES staff_schedule_periods(id),
  CONSTRAINT fk_workday_request_staff FOREIGN KEY (staff_user_id) REFERENCES staff_users(id), CONSTRAINT fk_workday_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_workday_request_days (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, request_id BIGINT UNSIGNED NOT NULL, work_date DATE NOT NULL,
  status ENUM('DRAFT','PENDING','APPROVED','REJECTED','ADJUSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT', requested_source ENUM('EMPLOYEE','ADMIN') NOT NULL DEFAULT 'EMPLOYEE',
  approved_shift_id BIGINT UNSIGNED NULL, admin_note VARCHAR(500) NULL, reviewed_by BIGINT UNSIGNED NULL, reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id), UNIQUE KEY uk_workday_request_day (store_id,request_id,work_date), KEY idx_workday_day_status (store_id,work_date,status),
  KEY idx_workday_day_request (store_id,request_id), KEY idx_workday_day_shift (approved_shift_id),
  CONSTRAINT fk_workday_day_store FOREIGN KEY (store_id) REFERENCES stores(id), CONSTRAINT fk_workday_day_request FOREIGN KEY (request_id) REFERENCES staff_workday_requests(id),
  CONSTRAINT fk_workday_day_shift FOREIGN KEY (approved_shift_id) REFERENCES work_shifts(id), CONSTRAINT fk_workday_day_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
