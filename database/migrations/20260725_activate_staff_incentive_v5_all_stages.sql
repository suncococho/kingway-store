-- STAGING ONLY. Production requires backup and explicit approval.
SET NAMES utf8mb4;
DROP PROCEDURE IF EXISTS kw_v5_require_utf8mb4;
DELIMITER $$
CREATE PROCEDURE kw_v5_require_utf8mb4() BEGIN
 IF @@character_set_client <> 'utf8mb4' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='utf8mb4 client required'; END IF;
END$$
DELIMITER ;
CALL kw_v5_require_utf8mb4(); DROP PROCEDURE kw_v5_require_utf8mb4;

-- Each DDL is independent/re-runnable because MySQL DDL implicitly commits.
DROP PROCEDURE IF EXISTS kw_v5_add_column;
DELIMITER $$
CREATE PROCEDURE kw_v5_add_column(IN t VARCHAR(64),IN c VARCHAR(64),IN ddl TEXT) BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=t AND column_name=c) THEN
  SET @ddl=ddl; PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
 END IF;
END$$
DELIMITER ;
CALL kw_v5_add_column('staff_incentive_plan_versions','bike_total_amount','ALTER TABLE staff_incentive_plan_versions ADD bike_total_amount DECIMAL(12,2) NOT NULL DEFAULT 600.00 AFTER status');
CALL kw_v5_add_column('staff_incentive_plan_versions','payout_mode','ALTER TABLE staff_incentive_plan_versions ADD payout_mode VARCHAR(40) NOT NULL DEFAULT ''ALL_STAGES_COMPLETED'' AFTER bike_total_amount');
CALL kw_v5_add_column('order_sales_followups','no_response_approved_by','ALTER TABLE order_sales_followups ADD no_response_approved_by BIGINT UNSIGNED NULL AFTER completed_at');
CALL kw_v5_add_column('order_sales_followups','no_response_approved_at','ALTER TABLE order_sales_followups ADD no_response_approved_at DATETIME NULL AFTER no_response_approved_by');
CALL kw_v5_add_column('order_sales_followups','no_response_approval_reason','ALTER TABLE order_sales_followups ADD no_response_approval_reason TEXT NULL AFTER no_response_approved_at');
CALL kw_v5_add_column('staff_incentive_events','source_unit_key','ALTER TABLE staff_incentive_events ADD source_unit_key VARCHAR(191) NOT NULL DEFAULT '''' AFTER source_line_id');
DROP PROCEDURE kw_v5_add_column;
ALTER TABLE staff_incentive_events MODIFY earning_stage ENUM('SALE','HANDOVER','FOLLOWUP','ALL_STAGES','ITEM','INSPECTION') NOT NULL;

CREATE TABLE IF NOT EXISTS order_sales_followup_attempts(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, order_id BIGINT UNSIGNED NOT NULL, store_id BIGINT UNSIGNED NOT NULL, staff_user_id BIGINT UNSIGNED NOT NULL,
 client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, attempted_at DATETIME NOT NULL COMMENT 'UTC; display Asia/Taipei',
 contact_method ENUM('LINE','PHONE','IN_PERSON','OTHER') NOT NULL, result ENUM('NO_ISSUE','ISSUE_RESOLVED','ISSUE_UNRESOLVED','NO_RESPONSE','OTHER') NOT NULL,
 note TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id),
 UNIQUE KEY uq_followup_attempt_request(store_id,client_request_id), KEY idx_followup_attempt_order(store_id,order_id,attempted_at), KEY idx_followup_attempt_staff(store_id,staff_user_id,attempted_at),
 CONSTRAINT fk_followup_attempt_order FOREIGN KEY(order_id) REFERENCES orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT fk_followup_attempt_store FOREIGN KEY(store_id) REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT fk_followup_attempt_staff FOREIGN KEY(staff_user_id) REFERENCES staff_users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS kw_v5_event_unique;
DELIMITER $$
CREATE PROCEDURE kw_v5_event_unique() BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='staff_incentive_events' AND index_name='uk_staff_incentive_event_source') THEN ALTER TABLE staff_incentive_events DROP INDEX uk_staff_incentive_event_source; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='staff_incentive_events' AND index_name='uk_staff_incentive_event_source_unit') THEN ALTER TABLE staff_incentive_events ADD UNIQUE KEY uk_staff_incentive_event_source_unit(store_id,staff_user_id,incentive_type,earning_stage,source_type,source_id,source_line_id,source_unit_key); END IF;
END$$
DELIMITER ;
CALL kw_v5_event_unique(); DROP PROCEDURE kw_v5_event_unique;

INSERT INTO staff_incentive_plan_versions(store_id,version,status,bike_total_amount,payout_mode,bike_sale_amount,bike_handover_amount,bike_followup_amount,accessory_rate,repair_inspection_amount,effective_from,effective_to,agreement_text,created_by_staff_id)
SELECT v4.store_id,'KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8','INACTIVE',600,'ALL_STAGES_COMPLETED',0,0,0,0.1,100,'2026-07-25 00:00:00',NULL,v4.agreement_text,NULL
FROM staff_incentive_plan_versions v4 WHERE v4.version='KINGWAY-2026-07-SALE600-V4-FULL-UTF8'
 AND SHA2(CONVERT(v4.agreement_text USING utf8mb4),256)='a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a'
 AND CHAR_LENGTH(v4.agreement_text)=2053 AND CHAR_LENGTH(v4.agreement_text)-CHAR_LENGTH(REPLACE(v4.agreement_text,CHAR(10),''))+1=78
 AND NOT EXISTS(SELECT 1 FROM staff_incentive_plan_versions x WHERE x.store_id=v4.store_id AND x.version='KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8');
DROP PROCEDURE IF EXISTS kw_v5_activate;
DELIMITER $$
CREATE PROCEDURE kw_v5_activate() BEGIN
 IF EXISTS(SELECT 1 FROM staff_incentive_plan_versions v4 LEFT JOIN staff_incentive_plan_versions v5 ON v5.store_id=v4.store_id AND v5.version='KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8' WHERE v4.version='KINGWAY-2026-07-SALE600-V4-FULL-UTF8' AND (SHA2(CONVERT(v4.agreement_text USING utf8mb4),256)<>'a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a' OR CHAR_LENGTH(v4.agreement_text)<>2053 OR CHAR_LENGTH(v4.agreement_text)-CHAR_LENGTH(REPLACE(v4.agreement_text,CHAR(10),''))+1<>78 OR v5.id IS NULL)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='V4 validation failed; V4 remains ACTIVE'; END IF;
 UPDATE staff_incentive_plan_versions SET status='INACTIVE' WHERE version IN('KINGWAY-2026-07-SALE600-V2','KINGWAY-2026-07-SALE600-V3-UTF8');
 UPDATE staff_incentive_plan_versions SET status='INACTIVE',effective_to='2026-07-24 23:59:59' WHERE version='KINGWAY-2026-07-SALE600-V4-FULL-UTF8';
 UPDATE staff_incentive_plan_versions SET status='ACTIVE',effective_to=NULL WHERE version='KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8';
 IF EXISTS(SELECT store_id FROM staff_incentive_plan_versions WHERE status='ACTIVE' GROUP BY store_id HAVING SUM(version='KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8')<>1 OR COUNT(*)<>1) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='exactly one ACTIVE V5 required per store'; END IF;
END$$
DELIMITER ;
START TRANSACTION;
CALL kw_v5_activate(); DROP PROCEDURE kw_v5_activate;
COMMIT;
SELECT store_id,version,status,SHA2(CONVERT(agreement_text USING utf8mb4),256) agreement_sha256,CHAR_LENGTH(agreement_text) agreement_chars,CHAR_LENGTH(agreement_text)-CHAR_LENGTH(REPLACE(agreement_text,CHAR(10),''))+1 agreement_lines FROM staff_incentive_plan_versions WHERE version LIKE 'KINGWAY-2026-07-SALE600-V%' ORDER BY store_id,id;
