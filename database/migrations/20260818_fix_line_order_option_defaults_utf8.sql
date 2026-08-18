-- Forward-only metadata correction for LINE order option defaults.
-- MySQL 8.0.45. This migration intentionally changes no row data.
-- page_title intended UTF-8: 選擇您需要的配件
-- page_title UTF-8 HEX: E981B8E69387E682A8E99C80E8A681E79A84E9858DE4BBB6
-- page_description intended UTF-8: 可依照需求選擇配件，也可以略過此步驟
-- page_description UTF-8 HEX: E58FAFE4BE9DE785A7E99C80E6B182E981B8E69387E9858DE4BBB6EFBC8CE4B99FE58FAFE4BBA5E795A5E9818EE6ADA4E6ADA5E9A99F
--
-- Character-set introducers plus hex literals make the DDL independent of the
-- client's text encoding. INFORMATION_SCHEMA guards make re-execution a no-op
-- when both metadata defaults are already correct.

SET @line_option_schema := DATABASE();
SET @line_option_title_hex := 'E981B8E69387E682A8E99C80E8A681E79A84E9858DE4BBB6';
SET @line_option_description_hex := 'E58FAFE4BE9DE785A7E99C80E6B182E981B8E69387E9858DE4BBB6EFBC8CE4B99FE58FAFE4BBA5E795A5E9818EE6ADA4E6ADA5E9A99F';

SET @line_option_column_count := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @line_option_schema
    AND TABLE_NAME = 'line_order_option_settings'
    AND COLUMN_NAME IN ('page_title', 'page_description')
);

SET @line_option_assert_columns_sql := IF(
  @line_option_schema IS NOT NULL AND @line_option_column_count = 2,
  'DO 0',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''line_order_option_settings default columns are missing'''
);
PREPARE line_option_assert_columns_stmt FROM @line_option_assert_columns_sql;
EXECUTE line_option_assert_columns_stmt;
DEALLOCATE PREPARE line_option_assert_columns_stmt;

SET @line_option_current_title_hex := (
  SELECT HEX(COLUMN_DEFAULT)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @line_option_schema
    AND TABLE_NAME = 'line_order_option_settings'
    AND COLUMN_NAME = 'page_title'
  LIMIT 1
);
SET @line_option_title_sql := IF(
  BINARY @line_option_current_title_hex = BINARY @line_option_title_hex,
  'DO 0',
  'ALTER TABLE line_order_option_settings ALTER COLUMN page_title SET DEFAULT _utf8mb4 0xE981B8E69387E682A8E99C80E8A681E79A84E9858DE4BBB6'
);
PREPARE line_option_title_stmt FROM @line_option_title_sql;
EXECUTE line_option_title_stmt;
DEALLOCATE PREPARE line_option_title_stmt;

SET @line_option_current_description_hex := (
  SELECT HEX(COLUMN_DEFAULT)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @line_option_schema
    AND TABLE_NAME = 'line_order_option_settings'
    AND COLUMN_NAME = 'page_description'
  LIMIT 1
);
SET @line_option_description_sql := IF(
  BINARY @line_option_current_description_hex = BINARY @line_option_description_hex,
  'DO 0',
  'ALTER TABLE line_order_option_settings ALTER COLUMN page_description SET DEFAULT _utf8mb4 0xE58FAFE4BE9DE785A7E99C80E6B182E981B8E69387E9858DE4BBB6EFBC8CE4B99FE58FAFE4BBA5E795A5E9818EE6ADA4E6ADA5E9A99F'
);
PREPARE line_option_description_stmt FROM @line_option_description_sql;
EXECUTE line_option_description_stmt;
DEALLOCATE PREPARE line_option_description_stmt;

SET @line_option_verify_count := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @line_option_schema
    AND TABLE_NAME = 'line_order_option_settings'
    AND (
      (COLUMN_NAME = 'page_title' AND BINARY HEX(COLUMN_DEFAULT) = BINARY @line_option_title_hex)
      OR
      (COLUMN_NAME = 'page_description' AND BINARY HEX(COLUMN_DEFAULT) = BINARY @line_option_description_hex)
    )
);
SET @line_option_verify_sql := IF(
  @line_option_verify_count = 2,
  'DO 0',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''LINE option default metadata verification failed'''
);
PREPARE line_option_verify_stmt FROM @line_option_verify_sql;
EXECUTE line_option_verify_stmt;
DEALLOCATE PREPARE line_option_verify_stmt;
