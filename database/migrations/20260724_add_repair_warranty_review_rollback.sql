DELIMITER $$
CREATE PROCEDURE rollback_20260724_repair_warranty_review()
BEGIN
  IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review') THEN
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:index:idx_repair_orders_warranty_review')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND INDEX_NAME = 'idx_repair_orders_warranty_review') THEN
      ALTER TABLE repair_orders DROP INDEX idx_repair_orders_warranty_review;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_customer_note')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_customer_note') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_customer_note;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_modified')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_modified') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_modified;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_collision_damage')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_collision_damage') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_collision_damage;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_water_ingress')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_water_ingress') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_water_ingress;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_exterior_damage')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_exterior_damage') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_exterior_damage;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_symptom')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_symptom') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_symptom;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_serial_number')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_serial_number') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_serial_number;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_purchase_proof_checked')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_purchase_proof_checked') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_purchase_proof_checked;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_expiration_date')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_expiration_date') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_expiration_date;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_purchase_date')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_purchase_date') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_purchase_date;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_part_name')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_part_name') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_part_name;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_result_attachment_json')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_result_attachment_json') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_result_attachment_json;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_request_attachment_json')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_request_attachment_json') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_request_attachment_json;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_reference')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_reference') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_reference;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_note')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_note') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_note;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_reason')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_reason') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_reason;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_decided_by')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_decided_by') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_decided_by;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_decided_at')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_decided_at') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_decided_at;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_requested_by')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_requested_by') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_requested_by;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_requested_at')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_requested_at') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_requested_at;
    END IF;
    IF EXISTS (SELECT 1 FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review:column:warranty_review_status')
       AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repair_orders' AND COLUMN_NAME = 'warranty_review_status') THEN
      ALTER TABLE repair_orders DROP COLUMN warranty_review_status;
    END IF;
    DELETE FROM kingway_schema_migrations WHERE migration_key LIKE '20260724_add_repair_warranty_review:%';
    DELETE FROM kingway_schema_migrations WHERE migration_key = '20260724_add_repair_warranty_review';
  END IF;
END$$
DELIMITER ;
CALL rollback_20260724_repair_warranty_review();
DROP PROCEDURE rollback_20260724_repair_warranty_review;
