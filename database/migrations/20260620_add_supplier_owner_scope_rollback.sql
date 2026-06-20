ALTER TABLE suppliers
  DROP KEY idx_suppliers_status,
  DROP KEY idx_suppliers_owner_company,
  DROP KEY idx_suppliers_owner_store;

ALTER TABLE suppliers
  DROP COLUMN visibility,
  DROP COLUMN owner_company_id,
  DROP COLUMN owner_store_id,
  DROP COLUMN owner_type;
