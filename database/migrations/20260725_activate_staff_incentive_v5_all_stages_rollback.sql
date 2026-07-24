-- STAGING rollback only. Preserve attempts, new columns, agreements, PDFs, signatures, hashes and all events.
SET NAMES utf8mb4;
DROP PROCEDURE IF EXISTS kw_v5_rollback;
DELIMITER $$
CREATE PROCEDURE kw_v5_rollback() BEGIN
 IF EXISTS(SELECT 1 FROM staff_incentive_plan_versions WHERE version='KINGWAY-2026-07-SALE600-V4-FULL-UTF8' AND (SHA2(CONVERT(agreement_text USING utf8mb4),256)<>'a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a' OR CHAR_LENGTH(agreement_text)<>2053 OR CHAR_LENGTH(agreement_text)-CHAR_LENGTH(REPLACE(agreement_text,CHAR(10),''))+1<>78)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='V4 validation failed; rollback aborted'; END IF;
 UPDATE staff_incentive_plan_versions SET status='INACTIVE' WHERE version IN('KINGWAY-2026-07-SALE600-V2','KINGWAY-2026-07-SALE600-V3-UTF8','KINGWAY-2026-07-SALE600-V5-ALL-STAGES-FULL-UTF8');
 UPDATE staff_incentive_plan_versions SET status='ACTIVE',effective_to=NULL WHERE version='KINGWAY-2026-07-SALE600-V4-FULL-UTF8';
END$$
DELIMITER ;
START TRANSACTION;
CALL kw_v5_rollback(); DROP PROCEDURE kw_v5_rollback;
COMMIT;
-- ALL_STAGES APPROVED/PAID remain immutable. PENDING/EARNED also remain for manager review; none are deleted or auto-voided.
-- Runtime remains query-compatible because all new columns/tables and source_unit_key are retained.
SELECT status,COUNT(*) event_count FROM staff_incentive_events WHERE earning_stage='ALL_STAGES' GROUP BY status;
