-- KINGWAY SaaS production platform admin audit log rollback
-- Date: 2026-06-10
-- WARNING: This drops audit log rows written after migration.
-- Preferred rollback for production incidents is full backup restore.
-- Run only with explicit user approval.

DROP TABLE IF EXISTS platform_admin_audit_logs;
