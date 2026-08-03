ALTER TABLE store_features ADD COLUMN staff_workday_selection_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER staff_management_enabled;
