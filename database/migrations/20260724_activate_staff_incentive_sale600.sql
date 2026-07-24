-- KINGWAY 신규 직원 성과급 plan: 판매완료 차량당 NT$600
-- 기존 420/120/60 event는 일절 수정하지 않는다.
-- Production 실행은 backup 및 명시적 승인 후에만 허용한다.

CREATE TABLE IF NOT EXISTS kingway_schema_migrations (
  migration_key VARCHAR(190) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

UPDATE staff_incentive_plan_versions
SET status = 'INACTIVE',
    effective_to = CASE
      WHEN effective_to IS NULL OR effective_to >= '2026-07-24 00:00:00'
        THEN '2026-07-23 23:59:59'
      ELSE effective_to
    END
WHERE status = 'ACTIVE'
  AND version <> 'KINGWAY-2026-07-SALE600-V2';

INSERT INTO staff_incentive_plan_versions (
  store_id, version, status,
  bike_sale_amount, bike_handover_amount, bike_followup_amount,
  accessory_rate, repair_inspection_amount,
  effective_from, effective_to, agreement_text, created_by_staff_id
)
SELECT
  s.id, 'KINGWAY-2026-07-SALE600-V2', 'ACTIVE',
  600.00, 0.00, 0.00,
  0.100000, 100.00,
  '2026-07-24 00:00:00', NULL,
  CONCAT(
    'KINGWAY 銷售服務績效辦法（車輛銷售 NT$600 版）\n\n',
    '一、符合完成條件的電動自行車，每台銷售績效 NT$600。\n',
    '二、交車確認與售後追蹤為金額 0 的工作紀錄，不作為 NT$600 的給付或扣減條件。\n',
    '三、配件按各品項折扣後實際付款金額 10% 計算；整單折扣按有價品項比例分配。\n',
    '四、免費、取消、退款、自行車本體、自行車零件及維修零件不列入配件績效。\n',
    '五、實收檢查費滿 NT$400，每件給付 NT$100；未收款、免費、保固及重複維修不列入。\n',
    '六、既有已核准或已支付紀錄不得自動變更。未支付舊制紀錄須先提出件數及金額差異報告。'
  ),
  NULL
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM staff_incentive_plan_versions p
  WHERE p.store_id = s.id
    AND p.version = 'KINGWAY-2026-07-SALE600-V2'
);

INSERT IGNORE INTO kingway_schema_migrations (migration_key)
VALUES ('20260724_activate_staff_incentive_sale600');

COMMIT;
