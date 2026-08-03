CREATE TABLE scheduling_score_tier_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, tier_code VARCHAR(40) NOT NULL, tier_name VARCHAR(80) NOT NULL,
  minimum_score DECIMAL(6,2) NULL, max_selectable_days SMALLINT UNSIGNED NOT NULL, effective_from DATE NOT NULL, effective_to DATE NULL,
  is_neutral_default TINYINT(1) NOT NULL DEFAULT 0, is_enabled TINYINT(1) NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY(id), UNIQUE KEY uk_score_tier_code_date(store_id,tier_code,effective_from), KEY idx_score_tier_effective(store_id,is_enabled,effective_from,effective_to),
  CONSTRAINT fk_score_tier_store FOREIGN KEY(store_id) REFERENCES stores(id), CONSTRAINT fk_score_tier_created FOREIGN KEY(created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_score_tier_updated FOREIGN KEY(updated_by) REFERENCES staff_users(id), CHECK(max_selectable_days > 0), CHECK(effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE staff_weekly_limit_overrides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL, week_start DATE NULL,
  effective_from DATE NOT NULL, effective_to DATE NOT NULL, max_selectable_days SMALLINT UNSIGNED NOT NULL, reason VARCHAR(500) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, version INT UNSIGNED NOT NULL DEFAULT 1, is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY(id), KEY idx_weekly_override_lookup(store_id,staff_user_id,is_enabled,effective_from,effective_to,week_start),
  CONSTRAINT fk_weekly_override_store FOREIGN KEY(store_id) REFERENCES stores(id), CONSTRAINT fk_weekly_override_staff FOREIGN KEY(staff_user_id) REFERENCES staff_users(id),
  CONSTRAINT fk_weekly_override_created FOREIGN KEY(created_by) REFERENCES staff_users(id), CONSTRAINT fk_weekly_override_updated FOREIGN KEY(updated_by) REFERENCES staff_users(id),
  CHECK(max_selectable_days > 0), CHECK(effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE scheduling_score_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL, score DECIMAL(6,2) NULL,
  status ENUM('VALID','INSUFFICIENT_DATA','ADMIN_ASSIGNED') NOT NULL, tier_rule_id BIGINT UNSIGNED NULL, source_type VARCHAR(60) NOT NULL,
  source_reference VARCHAR(255) NULL, calculated_at DATETIME NOT NULL, effective_from DATE NOT NULL, effective_to DATE NULL, created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, immutable_hash CHAR(64) NULL, source_version VARCHAR(80) NULL,
  PRIMARY KEY(id), KEY idx_score_snapshot_latest(store_id,staff_user_id,effective_from,effective_to,calculated_at), KEY idx_score_snapshot_tier(tier_rule_id),
  CONSTRAINT fk_score_snapshot_store FOREIGN KEY(store_id) REFERENCES stores(id), CONSTRAINT fk_score_snapshot_staff FOREIGN KEY(staff_user_id) REFERENCES staff_users(id),
  CONSTRAINT fk_score_snapshot_tier FOREIGN KEY(tier_rule_id) REFERENCES scheduling_score_tier_rules(id), CONSTRAINT fk_score_snapshot_created FOREIGN KEY(created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
