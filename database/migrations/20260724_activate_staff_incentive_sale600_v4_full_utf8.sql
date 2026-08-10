-- Restore the complete KINGWAY staff sales/service incentive and case responsibility agreement.
-- Staging first. Production requires a full backup, explicit approval, and the pre-apply report.
--
-- Source of the complete agreement text:
--   commit d1719a6
--   database/migrations/20260723_create_case_completion_responsibility_plan.sql
--   version KINGWAY-2026-07-R2-RESPONSIBILITY
--
-- Safety:
-- - Copies the complete, verified R2 agreement_text without rewriting it.
-- - Creates a new plan version; never changes existing signed agreements, PDFs, hashes, or events.
-- - Keeps V2 INACTIVE.
-- - Deactivates V3 only for stores whose V4 text passed the exact SHA-256/length/line checks.

SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE verified_sale600_v4_stores (
  store_id BIGINT UNSIGNED NOT NULL PRIMARY KEY
);

INSERT INTO verified_sale600_v4_stores (store_id)
SELECT r2.store_id
FROM staff_incentive_plan_versions r2
INNER JOIN staff_incentive_plan_versions v2
  ON v2.store_id = r2.store_id
 AND v2.version = 'KINGWAY-2026-07-SALE600-V2'
INNER JOIN staff_incentive_plan_versions v3
  ON v3.store_id = r2.store_id
 AND v3.version = 'KINGWAY-2026-07-SALE600-V3-UTF8'
WHERE r2.version = 'KINGWAY-2026-07-R2-RESPONSIBILITY'
  AND r2.status = 'INACTIVE'
  AND v2.status = 'INACTIVE'
  AND v3.status = 'ACTIVE'
  AND SHA2(r2.agreement_text, 256) =
    'a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a'
  AND CHAR_LENGTH(r2.agreement_text) = 2053
  AND 1 + CHAR_LENGTH(r2.agreement_text)
        - CHAR_LENGTH(REPLACE(r2.agreement_text, CHAR(10), '')) = 78
  AND SHA2(v2.agreement_text, 256) =
    '2d31b13f48135da43a5d8de5ed0dd2c37ab817f2d8203b0ce9238f8063ebc879'
  AND SHA2(v3.agreement_text, 256) =
    '00abd015a532c039f16a21f9a00362c2066e68fa830bbb571a7f178c39ef8fe5'
  AND NOT EXISTS (
    SELECT 1
    FROM staff_incentive_plan_versions existing_v4
    WHERE existing_v4.store_id = r2.store_id
      AND existing_v4.version = 'KINGWAY-2026-07-SALE600-V4-FULL-UTF8'
  );

INSERT INTO staff_incentive_plan_versions (
  store_id,
  version,
  status,
  bike_sale_amount,
  bike_handover_amount,
  bike_followup_amount,
  accessory_rate,
  repair_inspection_amount,
  effective_from,
  effective_to,
  agreement_text,
  created_by_staff_id
)
SELECT
  verified.store_id,
  'KINGWAY-2026-07-SALE600-V4-FULL-UTF8',
  'DRAFT',
  600.00,
  0.00,
  0.00,
  0.100000,
  100.00,
  UTC_TIMESTAMP(),
  NULL,
  r2.agreement_text,
  NULL
FROM verified_sale600_v4_stores verified
INNER JOIN staff_incentive_plan_versions r2
  ON r2.store_id = verified.store_id
 AND r2.version = 'KINGWAY-2026-07-R2-RESPONSIBILITY';

UPDATE staff_incentive_plan_versions v3
INNER JOIN staff_incentive_plan_versions v4
  ON v4.store_id = v3.store_id
 AND v4.version = 'KINGWAY-2026-07-SALE600-V4-FULL-UTF8'
 AND v4.status = 'DRAFT'
 AND SHA2(v4.agreement_text, 256) =
   'a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a'
 AND CHAR_LENGTH(v4.agreement_text) = 2053
 AND 1 + CHAR_LENGTH(v4.agreement_text)
       - CHAR_LENGTH(REPLACE(v4.agreement_text, CHAR(10), '')) = 78
SET
  v3.status = 'INACTIVE',
  v3.effective_to = UTC_TIMESTAMP()
WHERE v3.version = 'KINGWAY-2026-07-SALE600-V3-UTF8'
  AND v3.status = 'ACTIVE';

UPDATE staff_incentive_plan_versions v4
SET
  v4.status = 'ACTIVE',
  v4.effective_from = UTC_TIMESTAMP(),
  v4.effective_to = NULL
WHERE v4.version = 'KINGWAY-2026-07-SALE600-V4-FULL-UTF8'
  AND v4.status = 'DRAFT'
  AND SHA2(v4.agreement_text, 256) =
    'a3ce0bceb393667af49f112b47feeea304a7aaa32c5c200fe084ebc5a12b190a'
  AND CHAR_LENGTH(v4.agreement_text) = 2053
  AND 1 + CHAR_LENGTH(v4.agreement_text)
        - CHAR_LENGTH(REPLACE(v4.agreement_text, CHAR(10), '')) = 78;

DROP TEMPORARY TABLE verified_sale600_v4_stores;

COMMIT;

SELECT
  store_id,
  id AS plan_version_id,
  version,
  status,
  bike_sale_amount,
  bike_handover_amount,
  bike_followup_amount,
  accessory_rate,
  repair_inspection_amount,
  CHAR_LENGTH(agreement_text) AS agreement_text_length,
  1 + CHAR_LENGTH(agreement_text)
      - CHAR_LENGTH(REPLACE(agreement_text, CHAR(10), '')) AS agreement_text_lines,
  SHA2(agreement_text, 256) AS agreement_text_sha256
FROM staff_incentive_plan_versions
WHERE version IN (
  'KINGWAY-2026-07-SALE600-V2',
  'KINGWAY-2026-07-SALE600-V3-UTF8',
  'KINGWAY-2026-07-SALE600-V4-FULL-UTF8'
)
ORDER BY store_id, version;
