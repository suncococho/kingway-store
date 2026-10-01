-- Staging-only data migration.
--
-- Before this change, products.is_active = 0 meant "deleted" and
-- products.deleted_at was never populated. Preserve those existing rows as
-- trash records before introducing a distinct unpublished state.
--
-- New state model:
--   active:      is_active = 1 AND deleted_at IS NULL
--   unpublished: is_active = 0 AND deleted_at IS NULL
--   deleted:     is_active = 0 AND deleted_at IS NOT NULL

START TRANSACTION;

UPDATE products
SET deleted_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE is_active = 0
  AND deleted_at IS NULL;

SELECT
  is_active,
  CASE WHEN deleted_at IS NULL THEN 'not_deleted' ELSE 'deleted' END AS deletion_state,
  COUNT(*) AS product_count
FROM products
GROUP BY is_active, deletion_state
ORDER BY is_active DESC, deletion_state;

COMMIT;
