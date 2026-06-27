ALTER TABLE orders
  DROP COLUMN final_payment_completed_at,
  DROP COLUMN final_payment_completed_by_staff_user_id,
  DROP COLUMN final_payment_note,
  DROP COLUMN final_payment_received_amount,
  DROP COLUMN final_payment_method;

DROP TABLE IF EXISTS order_payment_records;
