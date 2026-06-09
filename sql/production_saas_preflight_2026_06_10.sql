-- Draft only. Read-only preflight.
-- Target: production MySQL 3306 / kingway_store
-- Date: 2026-06-10
--
-- Do not run against production without explicit approval.
-- This file contains SELECT statements only.

SELECT
  DATABASE() AS current_database,
  @@hostname AS hostname,
  @@port AS port,
  NOW() AS checked_at;

-- ============================================================================
-- 1. Table / column / index readiness
-- ============================================================================

SELECT
  t.table_name,
  CASE WHEN it.table_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status
FROM (
  SELECT 'stores' AS table_name
  UNION ALL SELECT 'products'
  UNION ALL SELECT 'product_categories'
  UNION ALL SELECT 'inventory_movements'
  UNION ALL SELECT 'app_settings'
  UNION ALL SELECT 'store_hostnames'
  UNION ALL SELECT 'store_liff_apps'
  UNION ALL SELECT 'store_line_channels'
) t
LEFT JOIN information_schema.tables it
  ON it.table_schema = DATABASE()
 AND it.table_name = t.table_name
ORDER BY t.table_name;

SELECT
  c.table_name,
  c.column_name,
  CASE WHEN ic.column_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status
FROM (
  SELECT 'products' AS table_name, 'store_id' AS column_name
  UNION ALL SELECT 'products', 'sku'
  UNION ALL SELECT 'products', 'category'
  UNION ALL SELECT 'products', 'category_id'
  UNION ALL SELECT 'inventory_movements', 'product_id'
  UNION ALL SELECT 'inventory_movements', 'store_id'
  UNION ALL SELECT 'app_settings', 'store_id'
  UNION ALL SELECT 'app_settings', 'setting_scope'
) c
LEFT JOIN information_schema.columns ic
  ON ic.table_schema = DATABASE()
 AND ic.table_name = c.table_name
 AND ic.column_name = c.column_name
ORDER BY c.table_name, c.column_name;

SELECT
  s.table_name,
  s.index_name,
  GROUP_CONCAT(s.column_name ORDER BY s.seq_in_index) AS columns_in_index,
  MIN(s.non_unique) AS non_unique
FROM information_schema.statistics s
WHERE s.table_schema = DATABASE()
  AND s.table_name IN ('products', 'inventory_movements', 'app_settings')
GROUP BY s.table_name, s.index_name
ORDER BY s.table_name, s.index_name;

-- ============================================================================
-- 2. products.sku full duplicate check
-- Expected: zero rows.
-- Required for rollback safety because rollback may restore UNIQUE(sku).
-- ============================================================================

SELECT
  sku,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(id ORDER BY id) AS product_ids
FROM products
WHERE sku IS NOT NULL
  AND sku <> ''
GROUP BY sku
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, sku
LIMIT 100;

-- ============================================================================
-- 3. products(store_id, sku) duplicate check
-- Expected: zero rows.
-- Required before adding UNIQUE(store_id, sku).
-- ============================================================================

SELECT
  store_id,
  sku,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(id ORDER BY id) AS product_ids
FROM products
WHERE sku IS NOT NULL
  AND sku <> ''
GROUP BY store_id, sku
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, store_id, sku
LIMIT 100;

-- Expected: zero rows before SKU index transition.
SELECT
  id,
  sku,
  name,
  store_id
FROM products
WHERE store_id IS NULL
ORDER BY id
LIMIT 100;

-- ============================================================================
-- 4. app_settings(store_id, setting_scope) duplicate check
-- Expected: zero rows.
-- Required before adding UNIQUE(store_id, setting_scope).
-- ============================================================================

SELECT
  store_id,
  setting_scope,
  COUNT(*) AS duplicate_count
FROM app_settings
GROUP BY store_id, setting_scope
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, store_id, setting_scope
LIMIT 100;

-- Expected: zero rows before app_settings primary-key transition.
SELECT
  setting_scope,
  store_id
FROM app_settings
WHERE store_id IS NULL
ORDER BY setting_scope
LIMIT 100;

-- ============================================================================
-- 5. Category backfill impossible products
-- Expected: zero rows.
-- This detects products that cannot be safely assigned to seeded categories.
-- ============================================================================

WITH category_seed AS (
  SELECT 'EB' AS code, '電動自行車' AS name
  UNION ALL SELECT 'RP', '維修'
  UNION ALL SELECT 'PT', '配件'
  UNION ALL SELECT 'AC', '改裝套件'
  UNION ALL SELECT 'TR', '輪胎'
  UNION ALL SELECT 'LT', '燈具'
  UNION ALL SELECT 'LK', '鎖具'
  UNION ALL SELECT 'SE', '椅子'
  UNION ALL SELECT 'HB', '車把握把腳踏'
  UNION ALL SELECT 'CR', '載具'
  UNION ALL SELECT 'OT', '其他'
),
product_category_target AS (
  SELECT
    p.id,
    p.store_id,
    p.sku,
    p.name,
    p.category,
    CASE
      WHEN UPPER(COALESCE(p.category, '')) IN ('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT') THEN UPPER(p.category)
      WHEN UPPER(COALESCE(p.category, '')) = 'EBIKE' THEN 'EB'
      WHEN UPPER(COALESCE(p.category, '')) = 'REPAIR' THEN 'RP'
      WHEN UPPER(COALESCE(p.category, '')) = 'ACCESSORY' THEN 'PT'
      WHEN UPPER(COALESCE(p.category, '')) = 'OTHER' THEN 'OT'
      WHEN UPPER(COALESCE(p.category, '')) IN ('FK','BG','CL','FP') THEN 'PT'
      WHEN UPPER(COALESCE(p.category, '')) = 'TN' THEN 'AC'
      WHEN UPPER(COALESCE(p.category, '')) = 'ST' THEN 'SE'
      WHEN UPPER(COALESCE(p.category, '')) = 'HG' THEN 'HB'
      WHEN UPPER(COALESCE(p.category, '')) = 'LC' THEN 'LK'
      WHEN UPPER(COALESCE(p.category, '')) IN ('TY','EX') THEN 'OT'
      WHEN SUBSTRING_INDEX(SUBSTRING_INDEX(UPPER(COALESCE(p.sku, '')), '-', 2), '-', -1) IN ('EB','RP','PT','AC','TR','LT','LK','SE','HB','CR','OT')
        THEN SUBSTRING_INDEX(SUBSTRING_INDEX(UPPER(COALESCE(p.sku, '')), '-', 2), '-', -1)
      ELSE 'OT'
    END AS target_category_code
  FROM products p
)
SELECT
  pct.id,
  pct.store_id,
  pct.sku,
  pct.name,
  pct.category,
  pct.target_category_code,
  CASE
    WHEN pct.store_id IS NULL THEN 'products.store_id is NULL'
    WHEN s.id IS NULL THEN 'store row missing'
    WHEN cs.code IS NULL THEN 'target category code not in seed'
    ELSE 'unknown'
  END AS reason
FROM product_category_target pct
LEFT JOIN stores s
  ON s.id = pct.store_id
LEFT JOIN category_seed cs
  ON cs.code = pct.target_category_code
WHERE pct.store_id IS NULL
   OR s.id IS NULL
   OR cs.code IS NULL
ORDER BY pct.id
LIMIT 100;

-- ============================================================================
-- 6. inventory_movements product_id based store_id backfill impossible rows
-- Expected: zero rows.
-- ============================================================================

SELECT
  im.id AS inventory_movement_id,
  im.product_id,
  p.store_id AS product_store_id,
  CASE
    WHEN p.id IS NULL THEN 'product row missing'
    WHEN p.store_id IS NULL THEN 'product.store_id is NULL'
    ELSE 'unknown'
  END AS reason
FROM inventory_movements im
LEFT JOIN products p
  ON p.id = im.product_id
WHERE p.id IS NULL
   OR p.store_id IS NULL
ORDER BY im.id
LIMIT 100;

-- ============================================================================
-- 7. Migration impact counts
-- ============================================================================

SELECT
  'products category_id candidate rows' AS metric,
  COUNT(*) AS row_count
FROM products;

SELECT
  'inventory_movements store_id candidate rows' AS metric,
  COUNT(*) AS row_count
FROM inventory_movements;

SELECT
  'stores candidate rows for category seed' AS metric,
  COUNT(*) AS row_count
FROM stores;
