# Production SaaS Migration Plan 2026-06-10

작성일: 2026-06-10

대상:

- production DB: `kingway_store` / `3306`
- 기준: staging schema parity
- SQL 초안:
  - [production_saas_preflight_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_preflight_2026_06_10.sql)
  - [production_saas_migration_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_migration_2026_06_10.sql)
  - [production_saas_rollback_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_rollback_2026_06_10.sql)

이번 문서는 초안 작성만 한다.

하지 않은 것:

- production DB 수정
- migration SQL 실행
- production deploy
- production container restart
- platform admin 계정 생성

## 1. 현재 production schema gap

직전 read-only diff 기준 production에 남은 staging parity gap은 아래와 같다.

### 1-1. missing tables

- `product_categories`
- `store_hostnames`
- `store_liff_apps`
- `store_line_channels`

### 1-2. missing columns

- `products.category_id`
- `inventory_movements.store_id`

### 1-3. index / constraint 차이

- `products`
  - production: legacy `UNIQUE KEY sku (sku)`
  - staging: `UNIQUE KEY uk_products_store_sku (store_id, sku)`
  - staging: `KEY idx_products_store_category_id (store_id, category_id)`
- `inventory_movements`
  - staging: `KEY idx_inventory_movements_store_id (store_id)`
- `app_settings`
  - production: `PRIMARY KEY (setting_scope)`가 남아 있음
  - staging: `UNIQUE KEY uk_app_settings_store_scope (store_id, setting_scope)` + non-unique `idx_app_settings_store_scope`

## 2. Preflight 원칙

실행 전 [production_saas_preflight_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_preflight_2026_06_10.sql)을 먼저 실행해 아래가 모두 통과해야 한다.

필수 확인:

- `products.sku` 전체 중복 없음
- `products(store_id, sku)` 중복 없음
- `products.store_id IS NULL` 없음
- `app_settings(store_id, setting_scope)` 중복 없음
- `app_settings.store_id IS NULL` 없음
- category backfill 불가 product 없음
- `inventory_movements.product_id` 기준 `store_id` backfill 불가 row 없음

중요:

- `products.sku` 전체 중복은 rollback에서 legacy `UNIQUE sku` 복구 가능 여부와 직접 연결된다.
- `products(store_id, sku)` 중복은 migration에서 `uk_products_store_sku` 추가 가능 여부와 직접 연결된다.
- `app_settings(store_id, setting_scope)` 중복은 `uk_app_settings_store_scope` 추가 가능 여부와 직접 연결된다.

## 3. Migration 핵심 내용

[production_saas_migration_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_migration_2026_06_10.sql)은 아래 순서로 구성했다.

1. 환경/row count preview
2. `product_categories` 생성
3. `products.category_id` nullable 추가
4. `inventory_movements.store_id` nullable 추가
5. `idx_inventory_movements_store_id` 추가
6. `idx_products_store_category_id` 추가
7. `products` SKU index 전환
    - `uk_products_store_sku(store_id, sku)` 추가
    - 기존 single-column unique `sku` 제거
8. `app_settings` index 전환
    - `uk_app_settings_store_scope(store_id, setting_scope)` 추가
    - 기존 `PRIMARY(setting_scope)` 제거
9. staging parity용 public identity table 생성
    - `store_hostnames`
    - `store_liff_apps`
    - `store_line_channels`
10. `START TRANSACTION`
11. 기본 category seed
12. `products.category_id` backfill
13. `inventory_movements.store_id` backfill
14. post-check
15. `COMMIT`은 주석 처리

DDL은 MySQL에서 auto-commit되므로 먼저 배치했다. seed/backfill DML은 마지막 transaction 블록에 모아, review 후 `COMMIT` 또는 `ROLLBACK`을 선택할 수 있게 했다.

## 4. Category seed 정책

category seed는 현재 backend/frontend 공통 category 정의를 따른다.

| code | name |
| --- | --- |
| `EB` | `電動自行車` |
| `RP` | `維修` |
| `PT` | `配件` |
| `AC` | `改裝套件` |
| `TR` | `輪胎` |
| `LT` | `燈具` |
| `LK` | `鎖具` |
| `SE` | `椅子` |
| `HB` | `車把握把腳踏` |
| `CR` | `載具` |
| `OT` | `其他` |

seed 대상:

- 현재 production `stores`에 존재하는 모든 store
- 기존 category가 있으면 overwrite하지 않음
- `code`/`name` unique 충돌이 있으면 SQL 실행 중 실패하도록 둔다

backfill 기준:

- 우선 `products.category` 값을 code로 사용
- legacy alias는 아래처럼 정규화
  - `EBIKE -> EB`
  - `REPAIR -> RP`
  - `ACCESSORY -> PT`
  - `OTHER -> OT`
  - `FK/BG/CL/FP -> PT`
  - `TN -> AC`
  - `ST -> SE`
  - `HG -> HB`
  - `LC -> LK`
  - `TY/EX -> OT`
- 그래도 매핑되지 않으면 SKU 두 번째 segment를 시도
- 그래도 실패하면 `OT`

## 5. store_hostnames / store_liff_apps / store_line_channels 필수 여부

이번 production authorization deploy 자체의 직접 필수 조건은 아니다.

그러나 staging parity와 public resolver/tokenized LINE webhook 계열 schema 준비 기준으로는 생성하는 편이 맞다.

이번 migration 초안에는 아래 원칙으로 포함했다.

- table만 생성
- seed row 없음
- raw LINE secret/token 저장 없음
- FK는 `stores(id)` 기준
- 기존 LINE legacy path는 `store_line_settings`를 그대로 사용

따라서 이 3개 table 생성은 non-destructive DDL이다. 실제 hostname/LIFF/LINE channel seed는 별도 승인 단계로 분리한다.

## 6. 위험 항목

### 6-1. MySQL DDL rollback

MySQL의 `CREATE TABLE`, `ALTER TABLE`, `DROP INDEX`는 auto-commit이다.

`START TRANSACTION`은 DML preview/backfill 보호에는 도움이 되지만 DDL rollback을 보장하지 않는다.

실제 rollback 원칙:

1. migration 전 full backup
2. 실패 시 backup restore 우선
3. rollback SQL은 emergency/manual 참고안으로만 사용

### 6-2. products SKU index 전환

전환 목표:

- 기존 `UNIQUE sku`
- 신규 `UNIQUE(store_id, sku)`

주의:

- migration 전 `products(store_id, sku)` 중복이 있으면 실패해야 한다.
- migration 후 신규 store에서 동일 SKU가 생긴 뒤 rollback으로 `UNIQUE sku`를 복구하면 실패할 수 있다.
- rollback 전에는 반드시 전체 `products.sku` 중복을 다시 확인해야 한다.

### 6-3. app_settings PRIMARY 전환

전환 목표:

- 기존 `PRIMARY(setting_scope)` 제거
- 신규 `UNIQUE(store_id, setting_scope)` 유지

주의:

- migration 전 `app_settings(store_id, setting_scope)` 중복이 있으면 실패해야 한다.
- migration 후 여러 store가 같은 `setting_scope`를 갖게 되면 rollback으로 `PRIMARY(setting_scope)` 복구가 실패한다.
- rollback 전에는 반드시 `setting_scope` 전체 중복을 다시 확인해야 한다.

### 6-4. category_id backfill

`products.category_id`는 nullable로 추가한다.

backfill 실패 가능 조건:

- `products.store_id IS NULL`
- category seed 실패
- store별 category row 누락

preflight와 post-check에서 `category_id IS NULL` 상품을 확인한다.

### 6-5. inventory_movements.store_id backfill

`inventory_movements.store_id`는 `inventory_movements.product_id -> products.id -> products.store_id`로 채운다.

backfill 실패 가능 조건:

- orphan `inventory_movements.product_id`
- 연결된 product의 `store_id IS NULL`

preflight와 post-check에서 확인한다.

## 7. Rollback SQL 초안

[production_saas_rollback_2026_06_10.sql](/volume1/docker/kingway-store/sql/production_saas_rollback_2026_06_10.sql)은 아래를 포함한다.

- rollback 전 중복 SKU / setting_scope 확인
- `products` legacy `UNIQUE sku` 복구 시도
- `app_settings PRIMARY(setting_scope)` 복구 시도
- 신규 index/column/table 제거 초안

주의:

- 이 rollback SQL은 DDL auto-commit 때문에 원자적이지 않다.
- production rollback의 1순위는 backup restore다.
- migration 후 신규 SaaS 데이터가 생성된 상태에서 rollback SQL을 실행하면 데이터 손실 가능성이 있다.

## 8. Platform admin production seed 제안

현재 production 상태:

- `platform_admin_users` table은 존재
- `admin@kingway.tw` row 없음
- production backend env에 `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_NAME` 없음

### 8-1. 추천 방식: env 기반 seed

추천한다.

이유:

- `backend/src/bootstrap.js`에 이미 `seedPlatformAdminFromEnv()`가 있음
- plain password를 repo/SQL에 저장하지 않아도 됨
- bcrypt hash 생성 책임을 app 코드에 맡길 수 있음
- 최초 1회 insert 후 같은 email이 있으면 추가 생성하지 않음

필요 env:

```bash
PLATFORM_ADMIN_EMAIL=admin@kingway.tw
PLATFORM_ADMIN_PASSWORD=<approved one-time password>
PLATFORM_ADMIN_NAME=KINGWAY Platform Admin
```

주의:

- plain password는 repo, SQL 파일, 문서에 저장하지 않는다.
- env 변경은 deploy/restart 승인 단계에서만 반영한다.
- 최초 로그인 후 운영자가 즉시 password 변경 또는 one-time reset 절차를 수행하는 것이 좋다.

### 8-2. 대안: one-time SQL insert/update

승인된 경우에만 사용한다.

hash 생성 방식:

```bash
cd /volume1/docker/kingway-store/backend
node -e "const { hashPassword } = require('./src/utils/passwords'); hashPassword(process.env.PLATFORM_ADMIN_ONETIME_PASSWORD).then(console.log)"
```

SQL 초안:

```sql
INSERT INTO platform_admin_users (email, password_hash, display_name, role, is_active)
VALUES ('admin@kingway.tw', '<bcrypt_hash_from_approved_runtime_secret>', 'KINGWAY Platform Admin', 'PLATFORM_OWNER', 1)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  display_name = VALUES(display_name),
  role = 'PLATFORM_OWNER',
  is_active = 1;
```

주의:

- `<bcrypt_hash_from_approved_runtime_secret>`만 SQL에 넣는다.
- plain password는 SQL/comment/history에 남기지 않는다.
- one-time password는 별도 비밀 채널로 전달한다.

## 9. 실행 전 체크리스트

1. production full backup 생성
2. backup gzip/tar/checksum 검증
3. preflight SQL 결과 확인
4. reviewed migration SQL 최종 승인
5. platform admin seed 방식 승인
6. LINE credential status 재확인
7. production deploy window 확정
8. rollback 기준점과 담당자 확정

## 10. 현재 deploy 판단

현재 상태에서는 production deploy는 아직 보류다.

가능 조건:

- 이 SQL 초안 review 완료
- preflight 결과 통과
- backup 확보
- platform admin seed 방식 승인
- 사용자 명시 승인
