-- Draft only. Do not execute without explicit approval.
-- Target: production MySQL 3306 / kingway_store
-- Goal: seed missing production product row for SKU C-EB-001-S1 / T1
--
-- Safety:
-- 1) Read preview SELECTs first.
-- 2) Do not run together with staging merge SQL until approved.
-- 3) Use conservative stock seed = 0 for the initial product row.
-- 4) COMMIT is commented out on purpose.

START TRANSACTION;

-- ============================================================================
-- Preview 1: environment
-- ============================================================================

SELECT DATABASE() AS current_database, @@hostname AS hostname, @@port AS port, NOW() AS db_time;

-- ============================================================================
-- Preview 2: exact-match existence check
-- Stop if the row already exists.
-- ============================================================================

SELECT id, sku, name, category, price, stock, reorder_level, is_active, store_id,
       created_at, updated_at, source, deleted_at
FROM products
WHERE sku = 'C-EB-001-S1'
   OR (name = 'T1' AND category = 'EB' AND store_id = 1)
ORDER BY sku, id;

-- ============================================================================
-- Preview 3: similar SKU / name check for manual review context
-- ============================================================================

SELECT id, sku, name, category, price, stock, store_id, is_active
FROM products
WHERE sku LIKE 'C-EB-%'
   OR sku LIKE '%EB-001%'
   OR name = 'T1'
   OR name LIKE '%T1%'
ORDER BY sku, id;

-- ============================================================================
-- Preview 4: downstream merge rows blocked by missing product mapping
-- Expected affected rows = 4 before product seed execution.
-- ============================================================================

SELECT order_no, sku_snapshot, quantity, unit_price, line_total
FROM (
  SELECT 'POS-20260604-195007-858' AS order_no, 'C-EB-001-S1' AS sku_snapshot, 1 AS quantity, 47000.00 AS unit_price, 47000.00 AS line_total
  UNION ALL
  SELECT 'POS-20260604-195011-413', 'C-EB-001-S1', 1, 47000.00, 47000.00
  UNION ALL
  SELECT 'POS-20260604-195640-286', 'C-EB-001-S1', 1, 47000.00, 47000.00
  UNION ALL
  SELECT 'POS-20260604-195644-098', 'C-EB-001-S1', 1, 47000.00, 47000.00
) merge_blocked_order_items
ORDER BY order_no;

-- ============================================================================
-- Phase 1: seed product row only if SKU does not exist already
-- Stock policy:
-- - seed stock = 0
-- - do not copy staging stock = -3 directly into production
-- - stock reconciliation should be handled separately after merge approval
-- ============================================================================

INSERT INTO products (
  sku,
  name,
  category,
  price,
  stock,
  reorder_level,
  is_active,
  created_at,
  updated_at,
  description,
  image_url,
  cost_price,
  location,
  inputter_name,
  source,
  deleted_at,
  deleted_by,
  store_id
)
SELECT
  'C-EB-001-S1',
  'T1',
  'EB',
  47000.00,
  0,
  0,
  1,
  '2026-05-27 13:07:41',
  '2026-06-04 19:56:54',
  '',
  '',
  0.00,
  '',
  NULL,
  'production_t1_seed_draft',
  NULL,
  NULL,
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM products
  WHERE sku = 'C-EB-001-S1'
);

-- ============================================================================
-- Preview 5: post-insert verification in current transaction
-- ============================================================================

SELECT id, sku, name, category, price, stock, reorder_level, is_active, store_id,
       created_at, updated_at, source, deleted_at
FROM products
WHERE sku = 'C-EB-001-S1';

-- Final action must be chosen manually after preview validation.
-- COMMIT;
-- ROLLBACK;
