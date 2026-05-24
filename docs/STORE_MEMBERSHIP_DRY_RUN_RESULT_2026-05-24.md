# Store Membership Dry-Run Result - 2026-05-24

## 1. Target

Dry-run target was staging only.

| Component | Target |
| --- | --- |
| MySQL host-side endpoint | `127.0.0.1:3310` |
| Database | `kingway_store` |
| Observed MySQL hostname | `a9cbc99601a1` |
| Observed MySQL port inside container | `3306` |

Explicitly not used:

- production DB
- default MySQL `127.0.0.1:3306`
- any `CREATE`, `ALTER`, `INSERT`, `UPDATE`, or `DELETE`

All checks were read-only.

## 2. Current Staff State

### 2-1. `staff_users` row count

| Metric | Count |
| --- | ---: |
| `staff_users` total rows | `2` |

### 2-2. `store_id` distribution

| `store_id` | Count |
| --- | ---: |
| `1` | `2` |

`NULL store_id` count: `0`

### 2-3. Role distribution

| `staff_users.role` | Count |
| --- | ---: |
| `ADMIN` | `1` |
| `CASHIER` | `1` |

### 2-4. Seed store check

`stores.id=1` exists.

Observed row:

| id | code | name | status | plan |
| ---: | --- | --- | --- | --- |
| `1` | `KINGWAY_TAINAN` | `KINGWAY å°å—` | `active` | `single_store` |

Note: the store name still shows mojibake-like text. This must be verified at byte/client charset level before production consideration.

## 3. Expected Membership Rows

Expected `store_memberships` rows from current staging data:

| Metric | Count |
| --- | ---: |
| expected membership rows | `2` |
| expected active membership rows | `2` |

Current `store_memberships` table existence check:

| Table | Exists |
| --- | ---: |
| `store_memberships` | `0` |

The table does not exist yet. This dry-run does not create it.

## 4. Mapping Preview

Proposed mapping:

| staff_user_id | username | display_name | staff_role | is_active | store_id | proposed_membership_role | proposed_is_default |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: |
| `1` | `admin` | `System Admin` | `ADMIN` | `1` | `1` | `owner` | `1` |
| `2` | `staff` | `門市員工` | `CASHIER` | `1` | `1` | `staff` | `1` |

Proposed membership role summary:

| store_id | proposed_membership_role | Count |
| ---: | --- | ---: |
| `1` | `owner` | `1` |
| `1` | `staff` | `1` |

Owner mapping status:

| Status | proposed_owner_count | proposed_admin_count | proposed_staff_count |
| --- | ---: | ---: | ---: |
| `ok_one_seed_owner` | `1` | `0` | `1` |

## 5. Risks

Observed risks:

- `stores.name` has mojibake-like display value: `KINGWAY å°å—`.
- `stores` table currently does not include `slug`; this is not a membership backfill blocker, but it is a self-service onboarding schema gap.
- `store_memberships` table does not exist yet, so actual migration still requires explicit schema approval.
- Production owner mapping must not be guessed from username alone without review.

Not observed in this dry-run:

- no `NULL store_id` staff rows
- no staff rows pointing to missing stores
- no duplicate username rows reported by the dry-run query
- no duplicate LINE staff identity rows reported by the dry-run query
- no duplicate membership candidate risk from current data
- no multiple default membership risk from current single-store data

## 6. Migration Blockers

Current row-level blocker for staging backfill: none.

Blockers before actual migration:

- `store_memberships` schema has not been created or approved for execution.
- staging backend `3010` startup/health should be verified before and after migration.
- actual login with known staging credentials should be verified.
- current JWT should be confirmed to include `storeId=1` before auth changes.
- seed store encoding must be verified or documented.
- rollback plan must be written before any schema change.
- production must remain explicitly excluded.

## 7. Dry-Run `INSERT SELECT` Draft

Do not run until migration is explicitly approved.

```sql
INSERT INTO store_memberships (store_id, staff_user_id, role, is_default, status)
SELECT
  su.store_id,
  su.id AS staff_user_id,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS role,
  1 AS is_default,
  'active' AS status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  is_default = VALUES(is_default),
  status = VALUES(status);
```

Safer first execution option after approval:

```sql
SELECT
  su.store_id,
  su.id AS staff_user_id,
  su.username,
  su.role AS staff_role,
  CASE
    WHEN su.role = 'ADMIN' AND su.username = 'admin' THEN 'owner'
    WHEN su.role IN ('ADMIN', 'MANAGER') THEN 'admin'
    ELSE 'staff'
  END AS proposed_membership_role,
  1 AS proposed_is_default,
  'active' AS proposed_status
FROM staff_users su
JOIN stores s ON s.id = su.store_id
WHERE su.store_id IS NOT NULL
ORDER BY su.id;
```

## 8. Verification SQL Draft

Use only after approved migration execution.

```sql
SELECT COUNT(*) AS membership_count
FROM store_memberships;
```

```sql
SELECT store_id, role, status, COUNT(*) AS count
FROM store_memberships
GROUP BY store_id, role, status
ORDER BY store_id, role, status;
```

```sql
SELECT staff_user_id, COUNT(*) AS default_memberships
FROM store_memberships
WHERE is_default = 1 AND status = 'active'
GROUP BY staff_user_id
HAVING COUNT(*) > 1;
```

```sql
SELECT su.id, su.username, su.store_id, sm.store_id AS membership_store_id, sm.role
FROM staff_users su
LEFT JOIN store_memberships sm
  ON sm.staff_user_id = su.id
 AND sm.store_id = su.store_id
WHERE su.store_id IS NOT NULL
  AND sm.id IS NULL;
```

```sql
SELECT sm.store_id, sm.staff_user_id, sm.role, sm.status
FROM store_memberships sm
LEFT JOIN stores s ON s.id = sm.store_id
LEFT JOIN staff_users su ON su.id = sm.staff_user_id
WHERE s.id IS NULL OR su.id IS NULL;
```

## 9. Safest Backfill Strategy

Recommended staging-only strategy:

1. Keep production excluded.
2. Create `store_memberships` in staging only after explicit approval.
3. Backfill only rows where `staff_users.store_id IS NOT NULL` and the referenced `stores.id` exists.
4. Map only the existing seed `admin` account to `owner`.
5. Map `ADMIN` and `MANAGER` accounts to `admin`, except the seed owner account.
6. Map `CASHIER`, `REPAIR`, `INVENTORY`, and any other operational role to `staff`.
7. Set `is_default=1` for existing single-store memberships.
8. Keep `staff_users.store_id` unchanged.
9. Run verification SQL immediately after migration.
10. Run backend login and route smoke tests before any auth dual-read code change.

## 10. Required Before Actual Migration

Before any actual migration:

- confirm staging backend `3010` health
- confirm MySQL target is host-side `3310`, not `3306`
- confirm `DATABASE() = kingway_store`
- confirm `stores.id=1` exists
- confirm existing staging credentials work
- confirm current login returns `storeId=1`
- confirm schema guard startup is clean
- verify `stores.name` encoding at byte/client charset level
- prepare rollback SQL or restore plan
- review owner assignment with the operator
- prepare post-migration smoke tests
- keep signup, billing, and auth dual-read changes out of the migration step

## 11. Conclusion

The dry-run predicts `2` staging membership rows:

- `admin` as `owner` for `store_id=1`
- `staff` as `staff` for `store_id=1`

No row-level blocker was found for staging backfill. Actual migration should still wait for explicit schema approval, rollback planning, and staging runtime checks.
