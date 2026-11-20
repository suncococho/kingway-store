ALTER TABLE store_features ADD COLUMN product_import_apply_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER staff_workday_selection_enabled;
