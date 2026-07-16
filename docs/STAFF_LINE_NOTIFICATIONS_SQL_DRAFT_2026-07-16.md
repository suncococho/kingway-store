# STAFF LINE Notifications SQL Draft - 2026-07-16

Do not run this automatically. This is a draft for staging review before any migration.

This table records staff LINE group notification state and protects customer LINE sends with an idempotent, per-store lock. It must not store LINE tokens, full LINE userIds, customer phone numbers, signatures, ID-card data, or other sensitive payloads.

## Prerequisites

- Create a staging DB backup before applying this draft.
- Confirm the staging MySQL version supports `JSON`, `ENUM`, and `CREATE TABLE IF NOT EXISTS`.
- Confirm these referenced tables exist: `stores`, `staff_users`, `line_group_registrations`.
- Confirm FK column types match this draft:
  - `stores.id` is `BIGINT UNSIGNED`.
  - `staff_users.id` is `BIGINT UNSIGNED`.
  - `line_group_registrations.id` is `BIGINT UNSIGNED`.
- Do not apply to production without explicit approval and a fresh backup.

## Apply SQL

```sql
CREATE TABLE IF NOT EXISTS staff_line_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  related_type VARCHAR(40) NOT NULL,
  related_id BIGINT UNSIGNED NOT NULL,
  status ENUM(
    'PENDING',
    'ACKNOWLEDGED',
    'ASSIGNED',
    'SENDING',
    'ACTION_COMPLETED',
    'CUSTOMER_SENT',
    'FAILED',
    'CANCELED'
  ) NOT NULL DEFAULT 'PENDING',
  assigned_staff_id BIGINT UNSIGNED NULL,
  assigned_staff_name VARCHAR(120) NULL,
  acknowledged_by BIGINT UNSIGNED NULL,
  acknowledged_name VARCHAR(120) NULL,
  acknowledged_at DATETIME NULL,
  customer_message_sent_at DATETIME NULL,
  customer_message_sent_by BIGINT UNSIGNED NULL,
  line_group_registration_id BIGINT UNSIGNED NULL,
  line_message_id VARCHAR(120) NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  payload_json JSON NULL,
  last_error_code VARCHAR(80) NULL,
  sending_started_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_line_notification_store_key (store_id, idempotency_key),
  KEY idx_staff_line_related (store_id, related_type, related_id),
  KEY idx_staff_line_status (store_id, status, created_at),
  KEY idx_staff_line_assigned (store_id, assigned_staff_id),
  KEY idx_staff_line_event (store_id, event_type, created_at),
  CONSTRAINT fk_staff_line_notifications_store
    FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_staff_line_notifications_assigned_staff
    FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_staff_line_notifications_ack_staff
    FOREIGN KEY (acknowledged_by) REFERENCES staff_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_staff_line_notifications_customer_sent_staff
    FOREIGN KEY (customer_message_sent_by) REFERENCES staff_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_staff_line_notifications_line_group_registration
    FOREIGN KEY (line_group_registration_id) REFERENCES line_group_registrations(id)
    ON DELETE SET NULL
);
```

## Customer Send Lock SQL

Customer LINE send actions must acquire the row with a conditional update before delivery.

Normal staff customer-send buttons must not claim `FAILED` rows. Failed rows require a future admin or explicit retry action so the same staff button cannot retry indefinitely.

```sql
UPDATE staff_line_notifications
SET
  status = 'SENDING',
  sending_started_at = NOW(),
  last_error_code = NULL,
  updated_at = NOW()
WHERE id = ?
  AND store_id = ?
  AND status IN ('PENDING', 'ACKNOWLEDGED', 'ASSIGNED');
```

Only `affectedRows = 1` may send to the customer.

For a future administrator or explicit retry action, `FAILED` may be included only in that separate guarded path:

```sql
UPDATE staff_line_notifications
SET
  status = 'SENDING',
  sending_started_at = NOW(),
  last_error_code = NULL,
  updated_at = NOW()
WHERE id = ?
  AND store_id = ?
  AND status IN ('FAILED');
```

## Customer Send Finalization SQL

Success:

```sql
UPDATE staff_line_notifications
SET
  status = 'CUSTOMER_SENT',
  customer_message_sent_at = NOW(),
  customer_message_sent_by = ?,
  sending_started_at = NULL,
  last_error_code = NULL,
  updated_at = NOW()
WHERE id = ?
  AND store_id = ?
  AND status = 'SENDING';
```

Failure:

```sql
UPDATE staff_line_notifications
SET
  status = 'FAILED',
  sending_started_at = NULL,
  last_error_code = ?,
  payload_json = JSON_SET(
    COALESCE(payload_json, JSON_OBJECT()),
    '$.customerSendErrorCode',
    ?
  ),
  updated_at = NOW()
WHERE id = ?
  AND store_id = ?
  AND status = 'SENDING';
```

Safe customer-send error codes include:

- `CUSTOMER_LINE_NOT_BOUND`
- `LINE_PUSH_FAILED`
- `NOTIFICATION_TABLE_UNAVAILABLE`
- `REPAIR_STATUS_CHANGED`
- `CUSTOMER_SEND_LOCK_FAILED`
- `CUSTOMER_SEND_TIMEOUT`

`payload_json` may contain non-sensitive supporting metadata only. Do not store tokens, full LINE userIds, customer phone numbers, signatures, or ID-card data.

## SENDING Stuck Recovery

Automatic infinite retry is forbidden.

- If `status = 'SENDING'` and `sending_started_at >= NOW() - INTERVAL 10 MINUTE`, show staff that another person is processing.
- If `status = 'SENDING'` and `sending_started_at < NOW() - INTERVAL 10 MINUTE`, the normal customer-send button still must not release or resend the lock.
- Only a manager/admin or a future explicit retry action may convert a stale `SENDING` row to `FAILED` after review.
- This draft does not add the admin retry UI.

Example guarded stale-lock transition for a future admin action:

```sql
UPDATE staff_line_notifications
SET
  status = 'FAILED',
  sending_started_at = NULL,
  last_error_code = 'CUSTOMER_SEND_TIMEOUT',
  updated_at = NOW()
WHERE id = ?
  AND store_id = ?
  AND status = 'SENDING'
  AND sending_started_at < NOW() - INTERVAL 10 MINUTE;
```

## Verification SQL

```sql
SHOW CREATE TABLE staff_line_notifications;

SHOW INDEX FROM staff_line_notifications;

SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'staff_line_notifications';
```

Optional column verification:

```sql
SELECT column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'staff_line_notifications'
ORDER BY ordinal_position;
```

## Smoke Verification

Do not run test inserts automatically. After staging approval and backup, a manual smoke insert can use real staging FK IDs only:

```sql
-- Example only. Replace FK values with valid staging IDs before manual execution.
INSERT INTO staff_line_notifications (
  store_id,
  event_type,
  related_type,
  related_id,
  status,
  line_group_registration_id,
  idempotency_key,
  payload_json
) VALUES (
  1,
  'REPAIR_COMPLETED',
  'REPAIR',
  12345,
  'PENDING',
  1,
  'REPAIR_COMPLETED:1:12345:GROUP_NOTIFY',
  JSON_OBJECT('source', 'manual_staging_smoke')
);
```

Recommended smoke behavior after manual setup:

- One repair reservation staff notification creates or reuses a per-store notification row.
- One repair completion customer-send button changes `PENDING` or `ACKNOWLEDGED` or `ASSIGNED` to `SENDING` before sending.
- Successful send changes `SENDING` to `CUSTOMER_SENT` and clears `sending_started_at` and `last_error_code`.
- Failed send changes `SENDING` to `FAILED`, clears `sending_started_at`, and writes `last_error_code`.
- Current staff Flex group notification code does not implement a legacy text fallback if Flex push fails. Add that in a separate implementation step if required.

## Rollback SQL

Production rollback is forbidden without explicit approval and backup.
Do not run rollback SQL during staging pre-apply validation.

```sql
DROP TABLE staff_line_notifications;
```

## Reapply Safety

This draft uses `CREATE TABLE IF NOT EXISTS`, so re-running it will not fail if the table already exists. It also will not modify an existing table whose columns, indexes, or constraints differ from this draft.

If staging already has `staff_line_notifications`, first compare `SHOW CREATE TABLE staff_line_notifications;` against this draft. For an existing mismatched staging table, prepare a separate reviewed `ALTER TABLE` draft instead of relying on re-running `CREATE TABLE IF NOT EXISTS`.

## Impact

- Adds one audit/idempotency table only.
- No existing workflow table is modified by this SQL draft.
- Idempotency is scoped by `(store_id, idempotency_key)`; there is no global `idempotency_key` unique constraint.
- Staff group notification creation can still be skipped when this table is absent, but customer LINE send buttons must fail closed until this table exists.
- Customer send failures are recorded in `last_error_code` and may also store non-sensitive supporting metadata in `payload_json`.
