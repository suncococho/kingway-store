# Schema Guard Warn-Only Plan

## 1. Current Problem

The project currently has two MySQL environments with the same database name:

- `127.0.0.1:3306` default DB
- `127.0.0.1:3310` intended staging DB

Both use `kingway_store`, but their schemas differ:

- `3306` does not have `stores` or required `store_id` columns.
- `3310` has `stores` and required active-code `store_id` backfill.

Active backend code now expects `store_id` scope in several routes. If the backend connects to a DB without required `store_id` schema, runtime requests can fail with SQL errors such as unknown column errors.

The immediate goal is to prevent environment confusion and detect schema mismatch early without changing DB schema.

## 2. Why Not Enable Fail-Fast Immediately

Immediate fail-fast is risky because:

- production migration status is not confirmed in this phase
- `3306` default DB still lacks `store_id`
- enabling hard failure globally may stop an existing backend from starting
- current startup already includes `ensureV2Schema()`, which mutates legacy schema and may be used by existing environments
- some environments may be intentionally pre-migration during audit/rehearsal
- operators need visibility before enforcement

Therefore the first implementation should warn and report, not block startup by default.

## 3. Why Start With Warn-Only

Warn-only mode provides safety without operational disruption.

Benefits:

- surfaces the exact DB target at startup
- shows whether `stores` and required `store_id` columns exist
- helps prevent accidental `3306` usage for staging tests
- gives logs for review before enforcement
- allows staging to test the guard before production enforcement
- avoids changing runtime behavior for existing KINGWAY operations

Warn-only should be the default until staging evidence supports enabling enforcement.

## 4. Default Flag Behavior

Default:

```env
REQUIRE_STORE_ID_SCHEMA=false
```

Behavior:

- startup checks DB identity and required schema
- logs warnings if required schema is missing
- does not exit process
- does not run migrations
- does not modify DB

Only when explicitly enabled:

```env
REQUIRE_STORE_ID_SCHEMA=true
```

the backend may fail startup if required schema is missing.

## 5. When Staging Can Switch To `true`

Staging can switch `REQUIRE_STORE_ID_SCHEMA=true` only when all conditions are met:

- target is verified as backend `3010` + MySQL `3310`
- `stores` table exists
- seed store `id=1` exists
- required active-code tables have `store_id`
- required active-code tables have zero missing `store_id` rows
- staging smoke test passes
- actual staging login is verified or an approved staging-only token test is documented
- no production credentials are used
- rollback path is documented

Do not enable `true` on production until production migration is completed and verified.

## 6. DB Identity Items To Check

Startup guard should check and log sanitized DB identity:

- configured `MYSQL_HOST`
- configured `MYSQL_PORT`
- configured `MYSQL_DATABASE`
- `SELECT DATABASE()`
- `SELECT @@hostname`
- `SELECT @@port`
- `NODE_ENV`
- `APP_ENV` if present

Do not log:

- DB password
- JWT secret
- LINE access token
- LINE secret
- Telegram token

## 7. Required Tables / Columns To Check

Minimum required table:

- `stores`

Minimum required active-code `store_id` columns:

- `staff_users.store_id`
- `customers.store_id`
- `orders.store_id`
- `order_items.store_id`
- `products.store_id`
- `repair_orders.store_id`
- `coupons.store_id`
- `inventory_movements.store_id`
- `supplier_requests.store_id`
- `purchase_confirmations.store_id`

Optional future checks should stay out of the first implementation:

- LINE state tables
- feature gate tables
- membership tables
- tenant tables

This first guard is for current active-code schema readiness only.

## 8. Config Flags

Recommended config flags:

```env
APP_ENV=staging_restore
REQUIRE_STORE_ID_SCHEMA=false
EXPECTED_DB_HOST=
EXPECTED_DB_PORT=
EXPECTED_DB_NAME=
LOG_DB_IDENTITY=true
```

Recommended behavior:

- `REQUIRE_STORE_ID_SCHEMA=false`: warn-only
- `REQUIRE_STORE_ID_SCHEMA=true`: fail startup when required schema is missing
- `EXPECTED_DB_HOST`: optional expected configured host
- `EXPECTED_DB_PORT`: optional expected configured port
- `EXPECTED_DB_NAME`: optional expected configured database name
- `LOG_DB_IDENTITY=true`: log sanitized DB target and observed DB identity

For staging `3010/3310`, values can later be:

```env
APP_ENV=staging_restore
REQUIRE_STORE_ID_SCHEMA=true
EXPECTED_DB_HOST=kingway-staging-mysql
EXPECTED_DB_PORT=3306
EXPECTED_DB_NAME=kingway_store
LOG_DB_IDENTITY=true
```

Note: inside the staging backend container, MySQL port is `3306`; host port `3310` is only for host-side access.

## 9. `server.js` Startup Order

Recommended startup order:

1. load config
2. log sanitized app/runtime target
3. run read-only schema guard
4. if guard fails and `REQUIRE_STORE_ID_SCHEMA=true`, exit startup
5. run existing `ensureStorageDirectories()`
6. run existing `ensureV2Schema()`
7. run existing Telegram/config validation
8. ensure default admin/staff
9. start listening

Important:

- schema guard must not modify DB
- schema guard should be separate from `ensureV2Schema()`
- warn-only mode should not block startup

## 10. Health / Schema Endpoint

For this first implementation, `/health/schema` should be excluded or optional.

Reason:

- startup log is enough for first validation
- exposing DB/schema details through HTTP may leak environment information
- if added later, it should be gated by `EXPOSE_HEALTH_DETAILS=true` and disabled in production

Recommended first phase:

- no new health endpoint
- startup logs only

Possible future endpoint:

- `GET /health/schema`
- only in staging or protected/internal network
- no secrets
- returns schema readiness summary

## 11. Relationship With `ensureV2Schema()`

Current `ensureV2Schema()` performs automatic schema mutations for legacy/V2 compatibility.

The schema guard must not become another migration mechanism.

Separation:

- schema guard: read-only detection and warning/failure
- `ensureV2Schema()`: existing compatibility mutation behavior
- migration scripts: intentional schema changes with backup/rollback

Store ID migration should not be added to `ensureV2Schema()` automatically.

Reason:

- `store_id` migration requires environment targeting, backup, seed store, backfill, verification, and rollback
- automatic store migration on startup would be risky
- startup mutation could accidentally modify the wrong DB

## 12. Production Apply Prohibition Conditions

Do not enable production fail-fast if any condition is true:

- production DB does not have verified `stores`
- required active-code tables do not have `store_id`
- existing production staff do not have `store_id`
- production seed store `id=1` is not verified
- production backup/rollback is missing
- production smoke test has not passed
- target guard could point to wrong DB
- LINE-first workflows are not smoke-tested

Warn-only logging may be introduced earlier if it is confirmed not to leak secrets and not to block startup.

## 13. Next Implementation Step

Next implementation should be minimal:

1. add read-only schema guard helper
2. add config flags with safe defaults
3. log sanitized DB identity and schema readiness at startup
4. keep `REQUIRE_STORE_ID_SCHEMA=false` by default
5. test on staging backend `3010` connected to MySQL `3310`
6. confirm startup logs show schema ready
7. only after review, set `REQUIRE_STORE_ID_SCHEMA=true` in staging

No DB migration, production deployment, or health endpoint is part of the first implementation.
