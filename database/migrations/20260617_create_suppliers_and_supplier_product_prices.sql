CREATE TABLE suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  line_contact VARCHAR(120) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  tax_id VARCHAR(40) NULL,
  note TEXT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  deleted_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_suppliers_store_name (store_id, name),
  KEY idx_suppliers_store_status (store_id, status, is_active),
  KEY idx_suppliers_store_deleted (store_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_product_prices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  supplier_sku VARCHAR(120) NULL,
  default_unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_product_prices_store_supplier_product (store_id, supplier_id, product_id),
  KEY idx_supplier_product_prices_store_supplier (store_id, supplier_id, is_active),
  KEY idx_supplier_product_prices_store_product (store_id, product_id, is_active),
  CONSTRAINT fk_supplier_product_prices_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_product_prices_product
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
