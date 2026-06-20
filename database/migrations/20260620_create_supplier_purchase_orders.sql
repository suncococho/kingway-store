CREATE TABLE supplier_purchase_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_no VARCHAR(80) NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  buyer_type ENUM('STORE','COMPANY') NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NULL,
  status ENUM('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  payment_status ENUM('UNPAID','PARTIALLY_PAID','PAID') NOT NULL DEFAULT 'UNPAID',
  settlement_month CHAR(7) NULL,
  total_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_received_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ordered_at DATETIME NULL,
  first_received_at DATETIME NULL,
  fully_received_at DATETIME NULL,
  paid_at DATETIME NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  updated_by_staff_id BIGINT UNSIGNED NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_purchase_orders_po_no (po_no),
  KEY idx_supplier_purchase_orders_supplier (supplier_id),
  KEY idx_supplier_purchase_orders_store (store_id),
  KEY idx_supplier_purchase_orders_company (company_id),
  KEY idx_supplier_purchase_orders_status (status),
  KEY idx_supplier_purchase_orders_payment_status (payment_status),
  KEY idx_supplier_purchase_orders_settlement_month (settlement_month),
  CONSTRAINT fk_supplier_purchase_orders_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_purchase_orders_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_supplier_purchase_orders_company
    FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_purchase_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  sku_snapshot VARCHAR(120) NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  quantity_ordered INT UNSIGNED NOT NULL,
  quantity_received INT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_received_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_supplier_purchase_order_items_po (purchase_order_id),
  KEY idx_supplier_purchase_order_items_supplier (supplier_id),
  KEY idx_supplier_purchase_order_items_product (product_id),
  KEY idx_supplier_purchase_order_items_store (store_id),
  CONSTRAINT fk_supplier_purchase_order_items_po
    FOREIGN KEY (purchase_order_id) REFERENCES supplier_purchase_orders(id),
  CONSTRAINT fk_supplier_purchase_order_items_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_purchase_order_items_product
    FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_supplier_purchase_order_items_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_purchase_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(80) NOT NULL,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NULL,
  total_received_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  received_by_staff_id BIGINT UNSIGNED NULL,
  received_at DATETIME NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_purchase_receipts_no (receipt_no),
  KEY idx_supplier_purchase_receipts_po (purchase_order_id),
  KEY idx_supplier_purchase_receipts_supplier (supplier_id),
  KEY idx_supplier_purchase_receipts_store (store_id),
  KEY idx_supplier_purchase_receipts_received_at (received_at),
  CONSTRAINT fk_supplier_purchase_receipts_po
    FOREIGN KEY (purchase_order_id) REFERENCES supplier_purchase_orders(id),
  CONSTRAINT fk_supplier_purchase_receipts_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_purchase_receipts_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_supplier_purchase_receipts_company
    FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_purchase_receipt_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT UNSIGNED NOT NULL,
  purchase_order_item_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity_received_delta INT UNSIGNED NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_received_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_supplier_purchase_receipt_items_receipt (receipt_id),
  KEY idx_supplier_purchase_receipt_items_po_item (purchase_order_item_id),
  KEY idx_supplier_purchase_receipt_items_product (product_id),
  CONSTRAINT fk_supplier_purchase_receipt_items_receipt
    FOREIGN KEY (receipt_id) REFERENCES supplier_purchase_receipts(id),
  CONSTRAINT fk_supplier_purchase_receipt_items_po_item
    FOREIGN KEY (purchase_order_item_id) REFERENCES supplier_purchase_order_items(id),
  CONSTRAINT fk_supplier_purchase_receipt_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
