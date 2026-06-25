CREATE TABLE IF NOT EXISTS staff_evaluation_notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT NULL,
  store_id BIGINT NULL,
  staff_user_id BIGINT NOT NULL,
  evaluator_staff_user_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rating VARCHAR(50) NULL,
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_staff_evaluation_notes_staff_period (staff_user_id, period_start, period_end),
  KEY idx_staff_evaluation_notes_store_period (store_id, period_start, period_end),
  KEY idx_staff_evaluation_notes_company_period (company_id, period_start, period_end),
  KEY idx_staff_evaluation_notes_evaluator (evaluator_staff_user_id, created_at)
);
