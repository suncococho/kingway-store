-- Repair the mojibake agreement text introduced while activating SALE600 V2.
-- Apply to staging first. Production requires a full backup and explicit approval.
--
-- Safety:
-- - Creates a new plan version so signed agreement snapshots/PDFs/hashes stay immutable.
-- - Only stores that have an ACTIVE SALE600 V2 are eligible.
-- - Does not update staff_incentive_agreements or existing incentive events.

START TRANSACTION;

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
  v2.store_id,
  'KINGWAY-2026-07-SALE600-V3-UTF8',
  'DRAFT',
  600.00,
  0.00,
  0.00,
  0.100000,
  100.00,
  UTC_TIMESTAMP(),
  NULL,
  CONCAT(
    'KINGWAY 銷售服務績效辦法（車輛銷售 NT$600 版）\n\n',
    '一、符合完成條件的電動自行車，每台銷售績效 NT$600。\n',
    '二、交車確認與售後追蹤為金額 NT$0 的工作紀錄，不作為 NT$600 的給付或扣減條件。\n',
    '三、配件按各品項折扣後實際付款金額 10% 計算；整單折扣按有價品項比例分配。\n',
    '四、免費、取消、退款、電動自行車本體、一般自行車零件、維修零件、工資及運費不列入配件績效。\n',
    '五、實收檢查費滿 NT$400，每件給付 NT$100；未收款、免費、保固及重複維修不列入。\n',
    '六、既有已核准或已支付紀錄不得自動變更。未支付舊制紀錄須先提出件數及金額差異報告。'
  ),
  NULL
FROM staff_incentive_plan_versions v2
WHERE v2.version = 'KINGWAY-2026-07-SALE600-V2'
  AND v2.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM staff_incentive_plan_versions v3
    WHERE v3.store_id = v2.store_id
      AND v3.version = 'KINGWAY-2026-07-SALE600-V3-UTF8'
  );

UPDATE staff_incentive_plan_versions
SET
  status = 'INACTIVE',
  effective_to = UTC_TIMESTAMP()
WHERE version = 'KINGWAY-2026-07-SALE600-V2'
  AND status = 'ACTIVE'
  AND EXISTS (
    SELECT 1
    FROM (
      SELECT store_id
      FROM staff_incentive_plan_versions
      WHERE version = 'KINGWAY-2026-07-SALE600-V3-UTF8'
        AND status IN ('DRAFT', 'ACTIVE')
    ) eligible_v3
    WHERE eligible_v3.store_id = staff_incentive_plan_versions.store_id
  );

UPDATE staff_incentive_plan_versions
SET
  status = 'ACTIVE',
  effective_from = UTC_TIMESTAMP(),
  effective_to = NULL
WHERE version = 'KINGWAY-2026-07-SALE600-V3-UTF8'
  AND status = 'DRAFT';

COMMIT;
