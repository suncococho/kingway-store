# Production Cutover Plan

작성일: 2026-06-04  
대상 브랜치: `beta/staging-architecture`  
목표: staging 최신 SaaS/store-scope 코드를 production runtime(`3000/5173`, DB `3306`)로 안전하게 반영하고, `pos.kingway.tw`를 다시 production 경로로 전환하기 위한 사전 계획을 고정한다.

## 1. 현재 문제

- 현재 public 도메인 `pos.kingway.tw`는 production이 아니라 staging reverse proxy 대상으로 연결되어 있다.
- NAS nginx reverse proxy에서 `pos.kingway.tw`는 현재 `localhost:5180`으로 프록시된다.
- `localhost:5180`은 staging frontend이고, `/api/*`는 staging backend `3010`으로 연결된다.
- 따라서 `https://pos.kingway.tw/api/system/saas-status`는 `environment=staging_restore`를 반환한다.
- 이 상태에서는 운영 LINE webhook, group registration, customer public flow, staff backend 확인 결과가 staging와 섞인다.

## 2. 현재 포트 구조

### Production compose

- frontend: `5173 -> 80`
- backend: `3000 -> 3000`
- mysql: `3306 -> 3306`

근거: `docker-compose.yml`

### Staging restore compose

- frontend: `5180 -> 80`
- backend: `3010 -> 3000`
- mysql: `3310 -> 3306`

근거: `docker-compose.staging-restore.yml`

## 3. 현재 public 도메인 오연결 상태

- reverse proxy file: `/etc/nginx/sites-enabled/server.ReverseProxy.conf`
- `server_name pos.kingway.tw`
- 현재 `location /`는 `proxy_pass http://localhost:5180;`
- staging frontend nginx는 `/api/`를 `backend:3000`으로 프록시하므로, 외부에서는 결과적으로 staging frontend `5180` + staging backend `3010` 조합이 노출된다.

결론:

- `pos.kingway.tw` 현재 연결 대상: staging frontend `5180`
- `pos.kingway.tw/api/*` 현재 연결 대상: staging backend `3010`

## 4. Git 상태 차이

### Production code 기준

- production 기준 브랜치로 보이는 `main` HEAD: `730549e`

### Staging code 기준

- staging 작업 브랜치 `beta/staging-architecture` HEAD: `2b9236a`

### 차이 요약

- `main..beta/staging-architecture` diff는 backend 82개 파일, frontend 75개 파일, schema/compose 파일까지 포함하는 대규모 차이다.
- 단순 hotfix 수준이 아니라:
  - SaaS/store-scope 구조
  - platform admin/auth
  - store settings / line settings
  - customer/order/repair/product/coupon/purchase-confirm store scoping
  - public LINE flow/route 확장
  - feature gating
  - dashboard/task scoping
  - staging-specific deploy/runtime 문서
  를 모두 포함한다.

판단:

- production cutover는 “파일 몇 개만 복사”가 아니라 “staging branch 전체를 production runtime 기준으로 승격”하는 작업으로 다뤄야 한다.

## 5. Production vs Staging Schema 차이

### 규모

- production DB `3306`:
  - tables: `27`
  - columns: `306`
- staging DB `3310`:
  - tables: `35`
  - columns: `401`

### Staging에만 있고 production에 없는 핵심 테이블

- `platform_admin_users`
- `store_features`
- `store_hostnames`
- `store_liff_apps`
- `store_line_channels`
- `store_line_settings`
- `store_memberships`
- `stores`

### Production에 추가되어야 하는 핵심 `store_id` 컬럼 예시

- `customers.store_id`
- `products.store_id`
- `orders.store_id`
- `order_items.store_id`
- `repair_orders.store_id`
- `purchase_confirmations.store_id`
- `coupons.store_id`
- `inventory_movements.store_id`
- `supplier_requests.store_id`
- `staff_users.store_id`
- `app_settings.store_id`

### 기타 schema 차이 예시

- `app_settings.setting_scope`는 staging에서 `STORE_PROFILE`까지 포함
- line/store scoped settings 관련 direct/ref/presence 컬럼이 staging에 존재

결론:

- production 반영 전 schema migration은 `필수`
- production runtime에 staging 코드를 그대로 올리면 schema mismatch로 route 500 위험이 높다.

## 6. Production .env vs Staging .env 차이 presence

### Production `.env` presence 특징

- global LINE credential env 존재
- production compose용 DB/MySQL 변수 존재
- staging 전용 `DB_HOST/DB_PORT/APP_ENV/STAGING_MODE` 없음
- disable/mock 계열 변수 없음

### Staging `.env.staging-restore` presence 특징

- `STAGING_MODE`, `APP_ENV`, `DB_*`, `BACKEND_PORT`, `FRONTEND_PORT` 존재
- `LINE_WEBHOOK_ENABLED=false`
- `LINE_MESSAGING_ENABLED=false`
- `LINE_MOCK_MODE=true`
- `WEBHOOKS_ENABLED=false`
- notification/email/push mock/disable 플래그 존재
- `REQUIRE_STORE_ID_SCHEMA=true`

결론:

- production cutover 시 staging env를 그대로 쓰면 안 된다.
- production은 runtime flag를 production-safe 값으로 별도 정리해야 한다.
- 특히 LINE/webhook/messaging 관련 값은 production 목적에 맞게 다시 확인해야 한다.

## 7. Production 코드 업데이트 전 필수 조건

1. production DB full backup 완료
2. production uploads/filesystem backup 또는 snapshot 완료
3. production git snapshot 확보
4. production schema migration 적용 순서 사전 검토 완료
5. production `.env`에 필요한 신규 key 목록 점검 완료
6. reverse proxy cutover 시점과 application cutover 시점을 분리 계획
7. rollback 절차 리허설 문서화 완료

## 8. 권장 production 업데이트 절차

### 8-1. Git

1. production working tree clean 확인
2. production runtime이 참조하는 repo/branch 확인
3. `beta/staging-architecture`를 production 반영용 기준 branch로 고정
4. production 반영 직전 commit hash 기록

### 8-2. DB backup

권장 절차:

1. `mysqldump --single-transaction --routines --triggers kingway_store > production_backup_YYYYMMDD_HHMM.sql`
2. dump 파일 checksum 기록
3. NAS/외부 backup 경로 2중 보관
4. 복원 테스트에 사용할 명령과 대상 DB 이름 별도 기록

### 8-3. Schema migration

필요 여부: `필수`

최소 필요 범주:

1. `stores`, `store_memberships`, `store_features`, `store_line_settings` 등 SaaS/store-scope 테이블 생성
2. 핵심 운영 테이블에 `store_id` 추가
3. 필요한 unique/index/foreign key 보강
4. `store_id=1` 기준 기존 타이난 데이터 backfill
5. app/settings/line 관련 nullable-first 또는 reversible migration 적용

후보 근거 파일:

- `backend/migrations/staging/2026-05-24_create_store_memberships.sql`
- `backend/migrations/staging/2026-05-25_create_store_public_identity_mapping.sql`
- `backend/src/bootstrap.js`
- `database/schema.sql`

주의:

- production에는 staging 전용 문서를 그대로 실행하면 안 된다.
- production 대상 migration SQL은 dry-run / review / rollback 기준이 있어야 한다.

### 8-4. Production app update

1. production reverse proxy는 아직 `5173/3000` 유지
2. production code를 staging HEAD와 동일 commit로 올림
3. backend dependency install
4. frontend build artifact refresh
5. backend restart
6. production backend health 확인
7. schema-dependent route smoke 확인

## 9. Reverse Proxy 전환 전 필수 조건

현재 reverse proxy:

- `pos.kingway.tw -> localhost:5180`

전환 목표:

- `pos.kingway.tw -> localhost:5173`

전환 전 필수 조건:

1. production frontend `5173` 정상 응답
2. production backend `3000` health 정상
3. production frontend의 `/api` 프록시가 `3000` backend를 올바르게 참조하는지 확인
4. production runtime에 staging branch 코드가 이미 반영되어 있어야 함
5. production DB schema migration 완료
6. LINE webhook route `POST /api/line/webhook`가 production runtime에서 정상 동작해야 함
7. `line_webhook_events`, `line_group_registrations`, `store_line_settings` 등 운영 확인 테이블이 production code와 호환되어야 함

## 10. Smoke Regression 절차

production 실행 직후 최소 확인:

1. `http://127.0.0.1:3000/health`
2. `http://127.0.0.1:5173/`
3. `http://127.0.0.1:3000/api/login`
4. store 1 admin 로그인
5. dashboard summary
6. products/orders/repairs/customers list
7. purchase confirmation list/public route
8. coupons list
9. `GET /api/store/settings`
10. `GET /api/store/settings/line`
11. `POST /api/line/webhook` unsigned request -> signature failure 확인

추가 확인:

- `line_webhook_events` 최신 시간 갱신 여부
- `repair`/`staff`/`admin`/`daily` group registration 상태

## 11. Reverse Proxy Cutover 절차

1. production app update 완료
2. production smoke PASS
3. Synology/NAS reverse proxy에서 `pos.kingway.tw` 대상 변경
   - 기존: `localhost:5180`
   - 목표: `localhost:5173`
4. public 확인
   - `https://pos.kingway.tw/`
   - `https://pos.kingway.tw/api/line/webhook` unsigned POST -> signature failure
   - `https://pos.kingway.tw/api/settings/public`
5. browser cache / CDN 영향 여부 확인

권장:

- staging/demo용 별도 hostname을 분리한다.
- 예: `staging-pos.kingway.tw` 또는 demo 전용 도메인

## 12. LINE Webhook / Group Registration 테스트 절차

1. LINE Developers webhook URL 확인
   - `https://pos.kingway.tw/api/line/webhook`
2. Webhook 사용 ON 확인
3. OA가 직원 테스트 그룹에 실제로 들어가 있는지 확인
4. 그룹에서 `/register repair` 전송
5. production DB에서 확인
   - `line_webhook_events` 최신 시간 갱신
   - `line_group_registrations`에 `repair` active 존재
6. 고객 LINE 수리예약 1건 테스트
7. 직원 그룹 알림 수신 확인
8. 고객에게 불필요한 별도 push가 없는지 확인

## 13. Rollback 절차

### App rollback

1. reverse proxy를 즉시 기존 known-good 대상로 되돌림
2. production repo를 이전 commit hash로 되돌림
3. backend/frontend 재시작
4. health / login / key routes 재확인

### DB rollback

원칙:

- destructive rollback SQL보다 full restore 기준이 더 안전

절차:

1. traffic 차단 또는 maintenance
2. production DB backup restore
3. app restart
4. smoke retest

### Reverse proxy rollback

1. `pos.kingway.tw`를 기존 `localhost:5180` 또는 직전 known-good target으로 복귀
2. public route 확인

## 14. 최종 판단

- 현재 `pos.kingway.tw`는 production 도메인 역할을 해야 하지만 실제로는 staging restore를 가리키고 있다.
- production runtime `3000/5173`는 살아 있으나, 코드/DB/schema가 staging SaaS 최신 상태보다 뒤처져 있다.
- 따라서 cutover는 반드시 아래 순서를 따라야 한다:

1. production schema 준비
2. production code 승격
3. production smoke
4. reverse proxy 전환
5. LINE webhook/group registration 검증
6. customer repair reservation live verification

- reverse proxy만 먼저 바꾸거나, code만 먼저 바꾸고 schema를 빼면 높은 확률로 운영 장애가 난다.
