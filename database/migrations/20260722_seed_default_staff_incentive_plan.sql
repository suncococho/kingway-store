-- KINGWAY default staff sales/service incentive plan
-- Staging-safe and idempotent: inserts only when a store has no ACTIVE plan.
-- Production execution requires a separate backup and explicit approval.

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
  s.id,
  'KINGWAY-2026-07-V1',
  'ACTIVE',
  420.00,
  120.00,
  60.00,
  0.100000,
  100.00,
  '2026-07-01 00:00:00',
  NULL,
  CONCAT(
    'KINGWAY 銷售服務績效辦法（2026-07）\n\n',
    '一、車輛完整績效共 NT$600：完成付款 NT$420、完成交車 NT$120、售後追蹤 NT$60。\n',
    '二、共同銷售須事前指定，主要人員 70%、協助人員 30%，總額不超過原績效。\n',
    '三、配件依每一個符合資格品項的實際成交價計算 10%，不得以整月銷售總額直接乘算。\n',
    '四、一般自行車零件、維修零件、工資、安裝費、檢查費、運費、免費品、內部或測試交易不列入配件績效。\n',
    '五、維修初步檢查須完成診斷、實際收取檢查費 NT$400，方取得 NT$100；免費、保固、重複維修或未收款不列入。\n',
    '六、員工不得因工作無績效而拒絕一般職務。\n',
    '七、員工僅可查看本人績效，管理員可依職務查看全店資料，不設公開排行榜。\n',
    '八、已核准或已支付績效不會自動扣回；如需更正，須以有稽核紀錄的調整程序處理。'
  ),
  NULL
FROM stores s
WHERE NOT EXISTS (
  SELECT 1
  FROM staff_incentive_plan_versions p
  WHERE p.store_id = s.id
    AND p.status = 'ACTIVE'
    AND p.effective_from <= NOW()
    AND (p.effective_to IS NULL OR p.effective_to >= NOW())
)
AND NOT EXISTS (
  SELECT 1
  FROM staff_incentive_plan_versions same_version
  WHERE same_version.store_id = s.id
    AND same_version.version = 'KINGWAY-2026-07-V1'
);
