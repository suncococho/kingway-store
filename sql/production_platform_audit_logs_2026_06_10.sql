-- KINGWAY SaaS production platform admin audit log migration
-- Date: 2026-06-10
-- Scope: create platform_admin_audit_logs only.
-- Safe to run after backup and explicit user approval.

CREATE TABLE IF NOT EXISTS platform_admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NULL,
  admin_email VARCHAR(190) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id BIGINT UNSIGNED NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_platform_audit_admin_time (admin_user_id, created_at),
  INDEX idx_platform_audit_target_time (target_type, target_id, created_at),
  INDEX idx_platform_audit_action_time (action, created_at)
);
