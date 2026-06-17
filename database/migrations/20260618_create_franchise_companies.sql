CREATE TABLE companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_companies_code (code),
  KEY idx_companies_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE company_stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  relationship_type ENUM('HEADQUARTERS','WAREHOUSE','DIRECT_STORE','FRANCHISE_STORE') NOT NULL DEFAULT 'FRANCHISE_STORE',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_stores_company_store (company_id, store_id),
  KEY idx_company_stores_store (store_id),
  KEY idx_company_stores_company_type (company_id, relationship_type, status),
  CONSTRAINT fk_company_stores_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_company_stores_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE company_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('company_owner','hq_admin','finance','inventory_manager','viewer') NOT NULL DEFAULT 'viewer',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_memberships_company_user (company_id, staff_user_id),
  KEY idx_company_memberships_user (staff_user_id, status),
  KEY idx_company_memberships_company_role (company_id, role, status),
  CONSTRAINT fk_company_memberships_company
    FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_company_memberships_user
    FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
