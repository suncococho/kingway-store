ALTER TABLE suppliers
  ADD COLUMN owner_type ENUM('STORE','COMPANY','PLATFORM') NOT NULL DEFAULT 'STORE' AFTER store_id,
  ADD COLUMN owner_store_id BIGINT UNSIGNED NULL AFTER owner_type,
  ADD COLUMN owner_company_id BIGINT UNSIGNED NULL AFTER owner_store_id,
  ADD COLUMN visibility ENUM('PRIVATE','COMPANY_VISIBLE','PLATFORM_VISIBLE') NOT NULL DEFAULT 'PRIVATE' AFTER owner_company_id;

UPDATE suppliers
SET owner_type = 'STORE',
    owner_store_id = store_id,
    owner_company_id = NULL,
    visibility = 'PRIVATE'
WHERE owner_store_id IS NULL
  AND store_id IS NOT NULL;

ALTER TABLE suppliers
  ADD KEY idx_suppliers_owner_store (owner_type, owner_store_id),
  ADD KEY idx_suppliers_owner_company (owner_type, owner_company_id),
  ADD KEY idx_suppliers_status (status, is_active, deleted_at);
