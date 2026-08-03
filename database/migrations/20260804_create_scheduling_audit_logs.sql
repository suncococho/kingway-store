CREATE TABLE scheduling_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, store_id BIGINT UNSIGNED NOT NULL, actor_staff_user_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(80) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL, old_value_json JSON NULL,
  new_value_json JSON NULL, reason VARCHAR(500) NULL, correlation_id VARCHAR(100) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id), KEY idx_scheduling_audit_entity(store_id,entity_type,entity_id,created_at), KEY idx_scheduling_audit_actor(store_id,actor_staff_user_id,created_at),
  KEY idx_scheduling_audit_correlation(correlation_id), CONSTRAINT fk_scheduling_audit_store FOREIGN KEY(store_id) REFERENCES stores(id),
  CONSTRAINT fk_scheduling_audit_actor FOREIGN KEY(actor_staff_user_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
