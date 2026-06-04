-- Draft only. Do not execute without explicit approval.
-- Goal: merge only the 36 rows marked "merge recommended" in
-- docs/STAGING_TO_PRODUCTION_MERGE_REVIEW.md
--
-- Scope included:
--   customers: 13
--   orders: 20
--   order_items for the 20 approved orders: 48 dependent rows
--   repair_orders: 2
--   purchase_confirmations: 1
--
-- Scope excluded:
--   manual review 32 rows: excluded from this SQL
--   review-level exclude 4 rows: excluded from this SQL
--   test-like 20 rows in excluded_test_like.csv: excluded from this SQL
--
-- Hard prerequisites before any execution:
-- 1) production full backup completed
-- 2) target tables already have store_id column
--    - customers.store_id
--    - orders.store_id
--    - order_items.store_id
--    - repair_orders.store_id
--    - purchase_confirmations.store_id
-- 3) product SKU C-EB-001-S1 exists in production, or an approved mapping exists
-- 4) execute in a single session and inspect all preview SELECTs first
--
-- Safety:
-- - transaction used
-- - NOT EXISTS guard used on business keys
-- - COMMIT is commented out

START TRANSACTION;

CREATE TEMPORARY TABLE source_customers (
  source_customer_id BIGINT,
  name VARCHAR(120),
  phone VARCHAR(30),
  customer_type VARCHAR(30),
  created_at DATETIME,
  updated_at DATETIME
);

INSERT INTO source_customers (
  source_customer_id, name, phone, customer_type, created_at, updated_at
) VALUES
  (140,'蘇若喬','0955989812','LINE','2026-05-27 13:01:09','2026-05-27 13:01:09'),
  (141,'羅百廷','0970598736','LINE','2026-05-27 13:05:40','2026-05-27 13:05:40'),
  (142,'劉沛駿','0987335452','LINE','2026-05-27 13:08:53','2026-05-27 13:08:53'),
  (143,'陳守堂','0909043993','OFFLINE_WITH_PHONE','2026-05-31 18:25:03','2026-05-31 18:25:03'),
  (144,'侯欽章','0937035946','OFFLINE_WITH_PHONE','2026-05-31 18:26:25','2026-05-31 18:26:25'),
  (145,'蘇佩雯','0938688073','OFFLINE_WITH_PHONE','2026-05-31 18:31:33','2026-05-31 18:31:33'),
  (146,'康淑玲','0925915852','LINE','2026-05-31 18:34:37','2026-05-31 18:34:37'),
  (147,'陳秋燕','0916381153','LINE','2026-05-31 18:36:33','2026-05-31 18:36:33'),
  (148,'陳先生','0916598856','LINE','2026-05-31 18:38:37','2026-05-31 18:38:37'),
  (149,'林伯賢','0930603261','LINE','2026-05-31 18:40:29','2026-05-31 18:40:29'),
  (158,'羅祐凱','0913172179','OFFLINE_WITH_PHONE','2026-06-04 19:36:19','2026-06-04 19:36:19'),
  (159,'羅胤桀','0968625778','OFFLINE_WITH_PHONE','2026-06-04 19:43:16','2026-06-04 19:43:16'),
  (160,'黃意婷','0926428993','OFFLINE_WITH_PHONE','2026-06-04 19:49:42','2026-06-04 19:49:42');

CREATE TEMPORARY TABLE source_orders (
  source_order_id BIGINT,
  order_no VARCHAR(50),
  customer_name VARCHAR(120),
  customer_phone VARCHAR(30),
  total_amount DECIMAL(12,2),
  payment_method VARCHAR(30),
  status VARCHAR(30),
  notes TEXT,
  created_by_username VARCHAR(100),
  business_date DATE,
  created_at DATETIME,
  updated_at DATETIME,
  is_reservation_order TINYINT,
  deposit_amount DECIMAL(12,2),
  unpaid_balance DECIMAL(12,2),
  final_payment_status VARCHAR(30),
  final_paid_at DATETIME NULL,
  purchase_confirmation_sent_at DATETIME NULL,
  handover_confirmed_at DATETIME NULL,
  handover_confirmed_by_username VARCHAR(100) NULL,
  customer_type VARCHAR(30),
  order_type VARCHAR(30),
  source VARCHAR(50) NULL,
  stock_deducted_at DATETIME NULL,
  other_discount DECIMAL(12,2)
);

INSERT INTO source_orders (
  source_order_id, order_no, customer_name, customer_phone, total_amount,
  payment_method, status, notes, created_by_username, business_date,
  created_at, updated_at, is_reservation_order, deposit_amount, unpaid_balance,
  final_payment_status, final_paid_at, purchase_confirmation_sent_at,
  handover_confirmed_at, handover_confirmed_by_username, customer_type,
  order_type, source, stock_deducted_at, other_discount
) VALUES
  (186,'POS-20260526-151430-018','LINE 客戶','0903388711',1000.00,'CASH','COMPLETED',NULL,'admin','2026-05-26','2026-05-26 15:14:30','2026-05-26 15:14:30',1,0.00,1000.00,'UNPAID',NULL,NULL,NULL,NULL,'LINE','GENERAL',NULL,NULL,0.00),
  (187,'POS-20260527-130156-363','蘇若喬','0955989812',57000.00,'CASH','COMPLETED','57000','admin','2026-05-27','2026-05-27 13:01:56','2026-05-29 00:51:20',1,10000.00,47000.00,'PARTIAL',NULL,NULL,NULL,NULL,'LINE','GENERAL',NULL,NULL,8050.00),
  (188,'POS-20260527-130622-346','羅百廷','0970598736',75500.00,'CASH','COMPLETED','20260530已收尾款現金$65500~總金額$75500','admin','2026-05-27','2026-05-27 13:06:22','2026-06-04 19:18:23',1,10000.00,0.00,'PAID','2026-06-04 19:18:23',NULL,'2026-05-30 20:14:32','admin','LINE','GENERAL',NULL,NULL,24280.00),
  (191,'POS-20260531-183502-792','康淑玲','0925915852',80180.00,'CASH','COMPLETED','70000','admin','2026-05-31','2026-05-31 18:35:02','2026-05-31 18:35:02',1,70000.00,10180.00,'PAID','2026-05-31 10:35:03',NULL,NULL,NULL,'LINE','GENERAL',NULL,NULL,0.00),
  (192,'POS-20260531-183655-771','陳秋燕','0916381153',22000.00,'CASH','COMPLETED','','admin','2026-05-31','2026-05-31 18:36:55','2026-06-03 17:15:51',1,22000.00,0.00,'PAID','2026-06-03 17:15:24',NULL,'2026-06-03 17:15:51','admin','LINE','GENERAL',NULL,NULL,2900.00),
  (193,'POS-20260531-183849-611','陳煥鈞','0916598856',75000.00,'CASH','COMPLETED','','admin','2026-05-31','2026-05-31 18:38:49','2026-06-04 20:14:46',1,10000.00,65000.00,'PARTIAL',NULL,NULL,NULL,NULL,'LINE','GENERAL',NULL,NULL,0.00),
  (194,'POS-20260531-184150-171','林伯賢','0930603261',73000.00,'CARD','COMPLETED','20260528共刷兩張卡(一張富邦卡刷$70000,一張中國信託刷$3000)','admin','2026-05-31','2026-05-31 18:41:50','2026-06-04 19:22:55',1,73000.00,0.00,'PAID','2026-06-04 19:22:36',NULL,'2026-06-04 19:22:55','admin','LINE','GENERAL',NULL,NULL,9130.00),
  (201,'POS-20260604-192749-896','陳守堂','0909043993',21600.00,'CASH','COMPLETED','軍人優惠$21600','admin','2026-06-04','2026-06-04 19:27:49','2026-06-04 19:32:05',1,21600.00,0.00,'PAID','2026-06-04 19:31:49',NULL,'2026-06-04 19:32:05','admin','OFFLINE_WITH_PHONE','GENERAL',NULL,NULL,3300.00),
  (202,'POS-20260604-192800-405','陳守堂','0909043993',24900.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:28:00','2026-06-04 19:29:35',1,0.00,24900.00,'PAID','2026-06-04 11:28:00',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:29:35',0.00),
  (203,'POS-20260604-192816-375','陳守堂','0909043993',24900.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:28:16','2026-06-04 19:29:23',1,0.00,24900.00,'PAID','2026-06-04 11:28:16',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:29:23',0.00),
  (204,'POS-20260604-193648-194','羅祐凱','0913172179',73000.00,'CASH','COMPLETED','','admin','2026-06-04','2026-06-04 19:36:48','2026-06-04 19:41:42',1,0.00,0.00,'PAID','2026-06-04 19:39:26',NULL,'2026-06-04 19:41:42','admin','OFFLINE_WITH_PHONE','GENERAL',NULL,NULL,6280.00),
  (205,'POS-20260604-193656-864','羅祐凱','0913172179',78000.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:36:56','2026-06-04 19:37:18',1,0.00,78000.00,'PAID','2026-06-04 11:36:57',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:37:18',0.00),
  (206,'POS-20260604-194352-247','羅胤桀','0968625778',22000.00,'CARD','COMPLETED','','admin','2026-06-04','2026-06-04 19:43:52','2026-06-04 19:46:48',1,0.00,0.00,'PAID','2026-06-04 19:46:26',NULL,'2026-06-04 19:46:48','admin','OFFLINE_WITH_PHONE','GENERAL',NULL,NULL,2900.00),
  (207,'POS-20260604-194357-153','羅胤桀','0968625778',24900.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:43:57','2026-06-04 19:45:32',1,0.00,24900.00,'PAID','2026-06-04 11:43:57',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:45:32',0.00),
  (208,'POS-20260604-194415-380','羅胤桀','0968625778',24900.00,'CASH','COMPLETED','刷卡$22000','admin','2026-06-04','2026-06-04 19:44:15','2026-06-04 19:45:26',1,0.00,24900.00,'PAID','2026-06-04 11:44:15',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:45:26',0.00),
  (209,'POS-20260604-194420-599','羅胤桀','0968625778',24900.00,'CASH','COMPLETED','刷卡$22000','admin','2026-06-04','2026-06-04 19:44:20','2026-06-04 19:45:16',1,0.00,24900.00,'PAID','2026-06-04 11:44:21',NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:45:16',0.00),
  (210,'POS-20260604-195007-858','黃意婷','0926428993',50000.00,'CASH','COMPLETED','','admin','2026-06-04','2026-06-04 19:50:07','2026-06-04 19:55:11',1,0.00,0.00,'PAID','2026-06-04 19:54:37',NULL,'2026-06-04 19:55:11','admin','OFFLINE_WITH_PHONE','GENERAL',NULL,NULL,1200.00),
  (211,'POS-20260604-195011-413','黃意婷','0926428993',47000.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:50:11','2026-06-04 19:51:12',1,0.00,47000.00,'PARTIAL',NULL,NULL,NULL,NULL,'OFFLINE_WITH_PHONE','GENERAL',NULL,'2026-06-04 19:51:12',0.00),
  (212,'POS-20260604-195640-286','劉沛駿','0987335452',47080.00,'CASH','COMPLETED','','admin','2026-06-04','2026-06-04 19:56:40','2026-06-04 19:59:57',1,10000.00,0.00,'PAID','2026-06-04 19:59:36',NULL,'2026-06-04 19:59:57','admin','LINE','GENERAL',NULL,NULL,2100.00),
  (213,'POS-20260604-195644-098','劉沛駿','0987335452',47000.00,'CASH','COMPLETED',NULL,'admin','2026-06-04','2026-06-04 19:56:44','2026-06-04 19:57:13',1,0.00,47000.00,'PAID','2026-06-04 11:56:44',NULL,NULL,NULL,'LINE','GENERAL',NULL,'2026-06-04 19:57:13',0.00);

CREATE TEMPORARY TABLE source_order_items (
  order_no VARCHAR(50),
  sku_snapshot VARCHAR(100),
  product_name_snapshot VARCHAR(150),
  product_category_snapshot VARCHAR(80) NULL,
  quantity INT,
  unit_price DECIMAL(12,2),
  line_total DECIMAL(12,2),
  created_at DATETIME
);

INSERT INTO source_order_items (
  order_no, sku_snapshot, product_name_snapshot, product_category_snapshot,
  quantity, unit_price, line_total, created_at
) VALUES
  ('POS-20260526-151430-018','C-TR-015-S2','16吋內胎（16×4.0）','TR',1,800.00,800.00,'2026-05-26 15:14:30'),
  ('POS-20260526-151430-018','MIG-MIGRATED-8ED65E4E','內胎 (非本店售出工資)','OT',1,200.00,200.00,'2026-05-26 15:14:30'),
  ('POS-20260527-130156-363','B-EB-011-S1','飛燕-SK3','EBIKE',1,58000.00,58000.00,'2026-05-29 00:51:19'),
  ('POS-20260527-130156-363','B-TN-017-S1','大前置菜籃','ACCESSORY',1,2800.00,2800.00,'2026-05-29 00:51:19'),
  ('POS-20260527-130156-363','B-HG-008-S2','KINGWAY火箭筒','ACCESSORY',1,1000.00,1000.00,'2026-05-29 00:51:19'),
  ('POS-20260527-130156-363','B-ST-010-S1','直條座椅','ACCESSORY',1,2500.00,2500.00,'2026-05-29 00:51:19'),
  ('POS-20260527-130156-363','B-CL-008-S3','端子後視鏡錐形(單邊鎖+膨脹螺絲)','ACCESSORY',1,750.00,750.00,'2026-05-29 00:51:19'),
  ('POS-20260527-130622-346','B-EB-006-S1','K2','EBIKE',1,78000.00,78000.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-TN-017-S1','大前置菜籃','ACCESSORY',1,2800.00,2800.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','A-LC-032-S1','電池13A換25A','ACCESSORY',1,10000.00,10000.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','A-TN-001-S3','中置網籃-W型','ACCESSORY',1,980.00,980.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-LC-004-S5','鍊條鎖','ACCESSORY',1,350.00,350.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-ST-010-S1','直條座椅','ACCESSORY',1,2500.00,2500.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-CL-011-S3','八爪手機架 (黑)','ACCESSORY',1,850.00,850.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-CL-003-S3','鋁合金後視鏡 (圓)','ACCESSORY',1,1800.00,1800.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-CL-015-S4','寶寶套件握把(含海綿套)','ACCESSORY',1,1500.00,1500.00,'2026-06-04 19:18:07'),
  ('POS-20260527-130622-346','B-HG-008-S2','KINGWAY火箭筒','ACCESSORY',1,1000.00,1000.00,'2026-06-04 19:18:07'),
  ('POS-20260531-183502-792','B-EB-006-S1','K2','EB',1,78000.00,78000.00,'2026-05-31 18:35:02'),
  ('POS-20260531-183502-792','A-TN-005-S3','簡易前置籃','AC',1,1200.00,1200.00,'2026-05-31 18:35:03'),
  ('POS-20260531-183502-792','A-TN-003-S3','中置網籃-梯形','AC',1,980.00,980.00,'2026-05-31 18:35:03'),
  ('POS-20260531-183655-771','B-EB-008-S1','飛兔-小折 灰','EBIKE',1,24900.00,24900.00,'2026-06-03 17:15:22'),
  ('POS-20260531-183849-611','B-EB-012-S1','牛牛 ( 全配)','EBIKE',1,75000.00,75000.00,'2026-06-04 20:14:29'),
  ('POS-20260531-184150-171','B-EB-006-S1','K2','EBIKE',1,78000.00,78000.00,'2026-06-04 19:22:38'),
  ('POS-20260531-184150-171','A-TN-003-S3','中置網籃-梯形','ACCESSORY',1,980.00,980.00,'2026-06-04 19:22:38'),
  ('POS-20260531-184150-171','A-TN-005-S3','簡易前置籃','ACCESSORY',1,1200.00,1200.00,'2026-06-04 19:22:38'),
  ('POS-20260531-184150-171','B-CL-011-S3','八爪手機架 (黑)','ACCESSORY',1,850.00,850.00,'2026-06-04 19:22:38'),
  ('POS-20260531-184150-171','B-BG-018-S1','保溫水壺袋(綁帶魔鬼沾)','ACCESSORY',1,300.00,300.00,'2026-06-04 19:22:38'),
  ('POS-20260531-184150-171','B-CL-007-S4','螳螂後視鏡','ACCESSORY',1,800.00,800.00,'2026-06-04 19:22:38'),
  ('POS-20260604-192749-896','B-EB-008-S1','飛兔-小折 灰','EBIKE',1,24900.00,24900.00,'2026-06-04 19:31:54'),
  ('POS-20260604-192800-405','B-EB-008-S1','飛兔-小折 灰','EB',1,24900.00,24900.00,'2026-06-04 19:28:02'),
  ('POS-20260604-192816-375','B-EB-008-S1','飛兔-小折 灰','EB',1,24900.00,24900.00,'2026-06-04 19:28:21'),
  ('POS-20260604-193648-194','B-EB-006-S1','K2','EBIKE',1,78000.00,78000.00,'2026-06-04 19:39:00'),
  ('POS-20260604-193648-194','A-TN-002-S3','中置網籃（平）','ACCESSORY',1,980.00,980.00,'2026-06-04 19:39:00'),
  ('POS-20260604-193648-194','B-BG-018-S1','保溫水壺袋(綁帶魔鬼沾)','ACCESSORY',1,300.00,300.00,'2026-06-04 19:39:00'),
  ('POS-20260604-193656-864','B-EB-006-S1','K2','EB',1,78000.00,78000.00,'2026-06-04 19:36:58'),
  ('POS-20260604-194352-247','B-EB-009-S1','飛兔-小折 黑','EBIKE',1,24900.00,24900.00,'2026-06-04 19:46:01'),
  ('POS-20260604-194357-153','B-EB-009-S1','飛兔-小折 黑','EB',1,24900.00,24900.00,'2026-06-04 19:44:02'),
  ('POS-20260604-194415-380','B-EB-009-S1','飛兔-小折 黑','EB',1,24900.00,24900.00,'2026-06-04 19:44:15'),
  ('POS-20260604-194420-599','B-EB-009-S1','飛兔-小折 黑','EB',1,24900.00,24900.00,'2026-06-04 19:44:32'),
  ('POS-20260604-195007-858','C-EB-001-S1','T1','EBIKE',1,47000.00,47000.00,'2026-06-04 19:54:17'),
  ('POS-20260604-195007-858','B-ST-014-S1','一平座椅(咖啡)','ACCESSORY',1,2000.00,2000.00,'2026-06-04 19:54:17'),
  ('POS-20260604-195007-858','B-HG-008-S2','KINGWAY火箭筒','ACCESSORY',1,1000.00,1000.00,'2026-06-04 19:54:17'),
  ('POS-20260604-195007-858','A-TN-005-S3','簡易前置籃','ACCESSORY',1,1200.00,1200.00,'2026-06-04 19:54:17'),
  ('POS-20260604-195011-413','C-EB-001-S1','T1','EB',1,47000.00,47000.00,'2026-06-04 19:50:20'),
  ('POS-20260604-195640-286','C-EB-001-S1','T1','EBIKE',1,47000.00,47000.00,'2026-06-04 19:58:53'),
  ('POS-20260604-195640-286','A-TN-005-S3','簡易前置籃','ACCESSORY',1,1200.00,1200.00,'2026-06-04 19:58:53'),
  ('POS-20260604-195640-286','A-TN-002-S3','中置網籃（平）','ACCESSORY',1,980.00,980.00,'2026-06-04 19:58:53'),
  ('POS-20260604-195644-098','C-EB-001-S1','T1','EB',1,47000.00,47000.00,'2026-06-04 19:56:52');

CREATE TEMPORARY TABLE source_repairs (
  source_repair_id BIGINT,
  customer_phone VARCHAR(30),
  bike_model VARCHAR(150),
  issue_description TEXT,
  reservation_date DATE,
  reservation_day VARCHAR(20),
  status VARCHAR(50),
  estimate_amount DECIMAL(12,2),
  base_fee DECIMAL(12,2),
  storage_fee DECIMAL(12,2),
  approved_by_staff_id BIGINT NULL,
  completed_at DATETIME NULL,
  picked_up_at DATETIME NULL,
  created_at DATETIME,
  updated_at DATETIME,
  reservation_time VARCHAR(20) NULL,
  reservation_status VARCHAR(30),
  estimate_details TEXT NULL,
  estimate_sent_at DATETIME NULL,
  customer_estimate_response VARCHAR(30),
  customer_estimate_responded_at DATETIME NULL,
  customer_type VARCHAR(30),
  source VARCHAR(20),
  group_confirmed_at DATETIME NULL,
  group_confirmed_by VARCHAR(255) NULL,
  group_confirmed TINYINT,
  inspection_fee DECIMAL(12,2),
  parts_fee DECIMAL(12,2),
  labor_fee DECIMAL(12,2),
  quote_status VARCHAR(50),
  quote_notes TEXT NULL,
  quote_items_json LONGTEXT NULL,
  customer_confirmed_at DATETIME NULL,
  inspection_notes TEXT NULL
);

INSERT INTO source_repairs (
  source_repair_id, customer_phone, bike_model, issue_description, reservation_date,
  reservation_day, status, estimate_amount, base_fee, storage_fee, approved_by_staff_id,
  completed_at, picked_up_at, created_at, updated_at, reservation_time, reservation_status,
  estimate_details, estimate_sent_at, customer_estimate_response, customer_estimate_responded_at,
  customer_type, source, group_confirmed_at, group_confirmed_by, group_confirmed,
  inspection_fee, parts_fee, labor_fee, quote_status, quote_notes, quote_items_json,
  customer_confirmed_at, inspection_notes
) VALUES
  (75,'0909043993','小摺','前輪無法打氣','2026-05-31','Sunday','reserved',0.00,400.00,0.00,NULL,NULL,NULL,'2026-05-31 18:25:36','2026-05-31 18:25:36','14:00','approved',NULL,NULL,'pending',NULL,'OFFLINE_WITH_PHONE','WEB',NULL,NULL,0,0.00,0.00,0.00,'pending',NULL,NULL,NULL,NULL),
  (77,'0903989835','S1','手把','2026-05-31','Sunday','estimate_pending_approval',1900.00,400.00,0.00,NULL,NULL,NULL,'2026-05-31 18:30:12','2026-05-31 18:30:57','14:00','approved','維修估價明細\n品項：\n1. 油門鑰匙儀表+轉把 (A-FP-025-S1) × 1 = NT$1,500\n檢查費：NT$400\n工資：NT$0\n總額：NT$1,900','2026-05-31 18:30:57','pending',NULL,'LINE','WEB',NULL,NULL,0,400.00,1500.00,0.00,'sent',NULL,'[{\"productId\":232,\"sku\":\"A-FP-025-S1\",\"name\":\"油門鑰匙儀表+轉把\",\"quantity\":1,\"unitPrice\":1500,\"total\":1500}]',NULL,'油門');

CREATE TEMPORARY TABLE source_purchase_confirmations (
  source_purchase_confirmation_id BIGINT,
  order_no VARCHAR(50),
  customer_phone VARCHAR(30),
  token VARCHAR(120) NULL,
  status VARCHAR(30),
  signature_data LONGTEXT NULL,
  pdf_path VARCHAR(255) NULL,
  submitted_at DATETIME NULL,
  created_at DATETIME,
  confirmed_by_line_user_id VARCHAR(100) NULL,
  handover_confirmed_at DATETIME NULL,
  handover_confirmed_by_username VARCHAR(100) NULL,
  buyer_name VARCHAR(120) NULL,
  buyer_phone VARCHAR(40) NULL,
  buyer_id_number VARCHAR(40) NULL,
  delivery_checks_json LONGTEXT NULL,
  staff_explanations_json LONGTEXT NULL,
  terms_accepted TINYINT,
  final_confirmation_accepted TINYINT,
  html_snapshot LONGTEXT NULL
);

INSERT INTO source_purchase_confirmations (
  source_purchase_confirmation_id, order_no, customer_phone, token, status,
  signature_data, pdf_path, submitted_at, created_at, confirmed_by_line_user_id,
  handover_confirmed_at, handover_confirmed_by_username, buyer_name, buyer_phone,
  buyer_id_number, delivery_checks_json, staff_explanations_json, terms_accepted,
  final_confirmation_accepted, html_snapshot
) VALUES
  (41,'POS-20260531-184150-171','0930603261',NULL,'COMPLETED','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','/files/pdfs/purchase-confirmation-41.pdf','2026-06-02 20:18:14','2026-06-02 20:18:14',NULL,'2026-06-04 19:22:56','admin','林伯賢','0930603261','A123456789','[\"外觀無損\",\"功能正常\",\"配件齊全\",\"規格相符\"]','[\"使用方法\",\"保固範圍與期限（1 年）\",\"日常維護與保養方法\",\"臺灣電動自行車相關法規及速度限制\",\"騎乘安全注意事項\"]',1,1,'{\"title\":\"KINGWAY 購買確認書\",\"orderNo\":\"POS-20260531-184150-171\",\"customerName\":\"林伯賢\",\"customerPhone\":\"0930603261\",\"buyerName\":\"林伯賢\",\"buyerPhone\":\"0930603261\",\"buyerIdNumber\":\"A123456789\",\"deliveryChecks\":[\"外觀無損\",\"功能正常\",\"配件齊全\",\"規格相符\"],\"staffExplanations\":[\"使用方法\",\"保固範圍與期限（1 年）\",\"日常維護與保養方法\",\"臺灣電動自行車相關法規及速度限制\",\"騎乘安全注意事項\"],\"terms\":[\"本人已確認所購商品之外觀、功能、配件及規格皆與訂購內容相符，並經本人現場檢查確認無誤。\",\"門市店員已完成商品使用方式、保固範圍與期限、日常維護保養方式、臺灣電動自行車相關法規及速度限制、騎乘安全注意事項等說明。\",\"本人已了解並同意應遵守中華民國相關交通法規及電動自行車速度限制規範。\",\"如因違規、改裝、超速、個人過失或不當使用所致之損害、事故、罰則或其他法律責任，概由本人自行負責。\",\"商品保固期間自交車日起算一年，保固範圍限於非人為因素造成之製造瑕疵。\",\"耗材、外觀磨損、人為損壞、正常耗損、改裝或不當使用所致之故障或損害，不屬保固範圍。\",\"電池及充電注意事項：應使用原廠或店家認可之充電器，避免高溫、潮濕、無人看管或不當環境下充電；若發現電池膨脹、漏液、異常發熱等情形，應立即停止使用並聯絡門市；電池自然衰退屬正常耗損，不屬一般保固範圍。\"],\"finalStatement\":\"本人已確認上述自行車交付項目皆已完成，且自行檢查無誤，正式領回此自行車。\",\"submittedAt\":\"2026-06-02T12:18:14.196Z\"}');

-- Preview 1: source counts
SELECT 'source_customers' AS label, COUNT(*) AS row_count FROM source_customers
UNION ALL SELECT 'source_orders', COUNT(*) FROM source_orders
UNION ALL SELECT 'source_order_items', COUNT(*) FROM source_order_items
UNION ALL SELECT 'source_repairs', COUNT(*) FROM source_repairs
UNION ALL SELECT 'source_purchase_confirmations', COUNT(*) FROM source_purchase_confirmations;

-- Preview 2: hard stop if target schema is not ready for store_id
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('customers','orders','order_items','repair_orders','purchase_confirmations')
  AND column_name = 'store_id'
ORDER BY table_name;

-- Preview 3: existing duplicates by business key
SELECT 'existing_customer_phone' AS label, sc.phone AS business_key
FROM source_customers sc
INNER JOIN customers c ON c.phone = sc.phone
UNION ALL
SELECT 'existing_order_no', so.order_no
FROM source_orders so
INNER JOIN orders o ON o.order_no = so.order_no
UNION ALL
SELECT 'existing_purchase_confirmation_order_no', spc.order_no
FROM source_purchase_confirmations spc
INNER JOIN orders o ON o.order_no = spc.order_no
INNER JOIN purchase_confirmations pc ON pc.order_id = o.id
WHERE pc.status = spc.status
  AND COALESCE(pc.pdf_path, '') = COALESCE(spc.pdf_path, '');

-- Preview 4: missing customer mappings after considering
-- both existing production customers and source customers to be inserted first.
SELECT 'missing_order_customer_phone' AS label, so.order_no AS ref, so.customer_phone AS phone
FROM source_orders so
LEFT JOIN (
  SELECT phone FROM customers
  UNION
  SELECT phone FROM source_customers
) customer_pool ON customer_pool.phone = so.customer_phone
WHERE customer_pool.phone IS NULL
UNION ALL
SELECT 'missing_repair_customer_phone', CAST(sr.source_repair_id AS CHAR), sr.customer_phone
FROM source_repairs sr
LEFT JOIN (
  SELECT phone FROM customers
  UNION
  SELECT phone FROM source_customers
) customer_pool ON customer_pool.phone = sr.customer_phone
WHERE customer_pool.phone IS NULL
UNION ALL
SELECT 'missing_pc_customer_phone', spc.order_no, spc.customer_phone
FROM source_purchase_confirmations spc
LEFT JOIN (
  SELECT phone FROM customers
  UNION
  SELECT phone FROM source_customers
) customer_pool ON customer_pool.phone = spc.customer_phone
WHERE customer_pool.phone IS NULL;

-- Preview 5: missing product mappings for order items.
-- If this returns any row, STOP. The current known blocker is C-EB-001-S1.
SELECT soi.sku_snapshot, COUNT(*) AS affected_rows
FROM source_order_items soi
LEFT JOIN products p ON p.sku = soi.sku_snapshot
WHERE p.id IS NULL
GROUP BY soi.sku_snapshot
ORDER BY soi.sku_snapshot;

-- Insert customers first
INSERT INTO customers (
  name, phone, line_user_id, line_display_name, notes,
  crm_stage, budget, purchase_timing, usage_purpose, interested_model,
  assigned_staff_id, last_contact_at, follow_up_due_at, customer_type,
  created_at, updated_at, store_id
)
SELECT
  sc.name,
  sc.phone,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  sc.created_at,
  NULL,
  sc.customer_type,
  sc.created_at,
  sc.updated_at,
  1
FROM source_customers sc
WHERE NOT EXISTS (
  SELECT 1 FROM customers c WHERE c.phone = sc.phone
);

-- Insert orders only if customer/staff mapping exists
INSERT INTO orders (
  order_no, customer_id, customer_name, customer_phone, total_amount,
  payment_method, status, notes, created_by, business_date, created_at,
  updated_at, is_reservation_order, deposit_amount, unpaid_balance,
  final_payment_status, final_paid_at, purchase_confirmation_sent_at,
  handover_confirmed_at, handover_confirmed_by_staff_id, customer_type,
  repair_order_id, order_type, source, stock_deducted_at, deleted_at,
  deleted_by, other_discount, store_id
)
SELECT
  so.order_no,
  c.id,
  so.customer_name,
  so.customer_phone,
  so.total_amount,
  so.payment_method,
  so.status,
  so.notes,
  creator.id,
  so.business_date,
  so.created_at,
  so.updated_at,
  so.is_reservation_order,
  so.deposit_amount,
  so.unpaid_balance,
  so.final_payment_status,
  so.final_paid_at,
  so.purchase_confirmation_sent_at,
  so.handover_confirmed_at,
  handover.id,
  so.customer_type,
  NULL,
  so.order_type,
  so.source,
  so.stock_deducted_at,
  NULL,
  NULL,
  so.other_discount,
  1
FROM source_orders so
INNER JOIN customers c ON c.phone = so.customer_phone
INNER JOIN staff_users creator ON creator.username = so.created_by_username
LEFT JOIN staff_users handover ON handover.username = so.handover_confirmed_by_username
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.order_no = so.order_no
);

-- Insert order items only when every SKU is present in production.
-- If Preview 5 returned rows, STOP and do not run this block.
INSERT INTO order_items (
  order_id, product_id, sku_snapshot, product_name_snapshot,
  product_category_snapshot, quantity, unit_price, line_total,
  created_at, store_id
)
SELECT
  o.id,
  p.id,
  soi.sku_snapshot,
  soi.product_name_snapshot,
  soi.product_category_snapshot,
  soi.quantity,
  soi.unit_price,
  soi.line_total,
  soi.created_at,
  1
FROM source_order_items soi
INNER JOIN orders o ON o.order_no = soi.order_no
INNER JOIN products p ON p.sku = soi.sku_snapshot
WHERE NOT EXISTS (
  SELECT 1
  FROM source_order_items soi2
  LEFT JOIN products p2 ON p2.sku = soi2.sku_snapshot
  WHERE p2.id IS NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM order_items oi
  WHERE oi.order_id = o.id
    AND oi.sku_snapshot = soi.sku_snapshot
    AND oi.quantity = soi.quantity
    AND oi.unit_price = soi.unit_price
    AND oi.line_total = soi.line_total
);

-- Insert only the 2 repair rows approved in review.
INSERT INTO repair_orders (
  customer_id, bike_model, issue_description, reservation_date, reservation_day,
  status, estimate_amount, base_fee, storage_fee, approved_by_staff_id,
  completed_at, picked_up_at, created_at, updated_at, reservation_time,
  reservation_status, estimate_details, estimate_sent_at, customer_estimate_response,
  customer_estimate_responded_at, survey_id, customer_type, source,
  group_confirmed_at, group_confirmed_by, group_confirmed, order_id,
  inspection_fee, parts_fee, labor_fee, quote_status, quote_notes,
  quote_items_json, customer_confirmed_at, deleted_at, deleted_by,
  inspection_notes, store_id
)
SELECT
  c.id,
  sr.bike_model,
  sr.issue_description,
  sr.reservation_date,
  sr.reservation_day,
  sr.status,
  sr.estimate_amount,
  sr.base_fee,
  sr.storage_fee,
  NULL,
  sr.completed_at,
  sr.picked_up_at,
  sr.created_at,
  sr.updated_at,
  sr.reservation_time,
  sr.reservation_status,
  sr.estimate_details,
  sr.estimate_sent_at,
  sr.customer_estimate_response,
  sr.customer_estimate_responded_at,
  NULL,
  sr.customer_type,
  sr.source,
  sr.group_confirmed_at,
  sr.group_confirmed_by,
  sr.group_confirmed,
  NULL,
  sr.inspection_fee,
  sr.parts_fee,
  sr.labor_fee,
  sr.quote_status,
  sr.quote_notes,
  sr.quote_items_json,
  sr.customer_confirmed_at,
  NULL,
  NULL,
  sr.inspection_notes,
  1
FROM source_repairs sr
INNER JOIN customers c ON c.phone = sr.customer_phone
WHERE NOT EXISTS (
  SELECT 1
  FROM repair_orders ro
  INNER JOIN customers rc ON rc.id = ro.customer_id
  WHERE rc.phone = sr.customer_phone
    AND ro.created_at = sr.created_at
    AND ro.issue_description = sr.issue_description
);

-- Insert only the 1 purchase confirmation approved in review.
INSERT INTO purchase_confirmations (
  order_id, customer_id, token, status, signature_data, pdf_path,
  submitted_at, created_at, confirmed_by_line_user_id, handover_confirmed_at,
  handover_confirmed_by_staff_id, buyer_name, buyer_phone, buyer_id_number,
  delivery_checks_json, staff_explanations_json, terms_accepted,
  final_confirmation_accepted, html_snapshot, store_id
)
SELECT
  o.id,
  c.id,
  spc.token,
  spc.status,
  spc.signature_data,
  spc.pdf_path,
  spc.submitted_at,
  spc.created_at,
  spc.confirmed_by_line_user_id,
  spc.handover_confirmed_at,
  handover.id,
  spc.buyer_name,
  spc.buyer_phone,
  spc.buyer_id_number,
  spc.delivery_checks_json,
  spc.staff_explanations_json,
  spc.terms_accepted,
  spc.final_confirmation_accepted,
  spc.html_snapshot,
  1
FROM source_purchase_confirmations spc
INNER JOIN orders o ON o.order_no = spc.order_no
INNER JOIN customers c ON c.phone = spc.customer_phone
LEFT JOIN staff_users handover ON handover.username = spc.handover_confirmed_by_username
WHERE NOT EXISTS (
  SELECT 1
  FROM purchase_confirmations pc
  INNER JOIN orders po ON po.id = pc.order_id
  WHERE po.order_no = spc.order_no
    AND pc.status = spc.status
    AND COALESCE(pc.pdf_path, '') = COALESCE(spc.pdf_path, '')
);

-- Preview 6: post-insert row counts in the current transaction
SELECT 'customers_after_tx' AS label, COUNT(*) FROM customers
UNION ALL SELECT 'orders_after_tx', COUNT(*) FROM orders
UNION ALL SELECT 'order_items_after_tx', COUNT(*) FROM order_items
UNION ALL SELECT 'repair_orders_after_tx', COUNT(*) FROM repair_orders
UNION ALL SELECT 'purchase_confirmations_after_tx', COUNT(*) FROM purchase_confirmations;

-- Final action must be chosen manually after preview validation.
-- COMMIT;
-- ROLLBACK;
