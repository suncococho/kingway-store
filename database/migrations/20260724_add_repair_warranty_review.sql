CREATE TABLE IF NOT EXISTS kingway_schema_migrations (
  migration_key VARCHAR(190) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
CREATE PROCEDURE apply_20260724_repair_warranty_review()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_status') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_status VARCHAR(40) NOT NULL DEFAULT 'NOT_REQUESTED' COMMENT '保固審查狀態' AFTER inspection_notes;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_status');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_requested_at') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_requested_at DATETIME NULL AFTER warranty_review_status;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_requested_at');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_requested_by') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_requested_by BIGINT UNSIGNED NULL AFTER warranty_review_requested_at;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_requested_by');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_decided_at') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_decided_at DATETIME NULL AFTER warranty_review_requested_by;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_decided_at');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_decided_by') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_decided_by BIGINT UNSIGNED NULL AFTER warranty_review_decided_at;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_decided_by');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_reason') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_reason TEXT NULL AFTER warranty_review_decided_by;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_reason');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_note') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_note TEXT NULL AFTER warranty_review_reason;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_note');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_reference') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_reference VARCHAR(160) NULL AFTER warranty_review_note;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_reference');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_request_attachment_json') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_request_attachment_json LONGTEXT NULL AFTER warranty_review_reference;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_request_attachment_json');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_result_attachment_json') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_review_result_attachment_json LONGTEXT NULL AFTER warranty_review_request_attachment_json;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_review_result_attachment_json');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_part_name') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_part_name VARCHAR(255) NULL AFTER warranty_review_result_attachment_json;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_part_name');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_purchase_date') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_purchase_date DATE NULL AFTER warranty_part_name;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_purchase_date');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_expiration_date') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_expiration_date DATE NULL AFTER warranty_purchase_date;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_expiration_date');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_purchase_proof_checked') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_purchase_proof_checked TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_expiration_date;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_purchase_proof_checked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_serial_number') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_serial_number VARCHAR(180) NULL AFTER warranty_purchase_proof_checked;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_serial_number');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_symptom') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_symptom TEXT NULL AFTER warranty_serial_number;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_symptom');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_exterior_damage') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_exterior_damage TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_symptom;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_exterior_damage');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_water_ingress') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_water_ingress TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_exterior_damage;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_water_ingress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_collision_damage') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_collision_damage TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_water_ingress;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_collision_damage');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_modified') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_modified TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_collision_damage;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_modified');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_customer_note') THEN
    ALTER TABLE repair_orders ADD COLUMN warranty_customer_note TEXT NULL AFTER warranty_modified;
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:column:warranty_customer_note');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND INDEX_NAME = 'idx_repair_orders_warranty_review') THEN
    ALTER TABLE repair_orders ADD INDEX idx_repair_orders_warranty_review (store_id, warranty_review_status, warranty_review_requested_at);
    INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review:index:idx_repair_orders_warranty_review');
  END IF;
  INSERT IGNORE INTO kingway_schema_migrations (migration_key) VALUES ('20260724_add_repair_warranty_review');
END$$
DELIMITER ;
CALL apply_20260724_repair_warranty_review();
DROP PROCEDURE apply_20260724_repair_warranty_review;
