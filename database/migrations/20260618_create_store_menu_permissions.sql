CREATE TABLE store_role_menu_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(40) NOT NULL,
  menu_key VARCHAR(80) NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 1,
  can_access TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_role_menu_permissions (store_id, role, menu_key),
  KEY idx_store_role_menu_permissions_store_role (store_id, role),
  CONSTRAINT fk_store_role_menu_permissions_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE store_user_menu_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  menu_key VARCHAR(80) NOT NULL,
  can_view TINYINT(1) NULL,
  can_access TINYINT(1) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_user_menu_permissions (store_id, staff_user_id, menu_key),
  KEY idx_store_user_menu_permissions_staff (staff_user_id),
  CONSTRAINT fk_store_user_menu_permissions_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_user_menu_permissions_staff
    FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
