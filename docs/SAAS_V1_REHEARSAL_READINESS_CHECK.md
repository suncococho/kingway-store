# SaaS v1 테스트 매장 리허설 Readiness 체크리스트

작성일: 2026-06-04
브랜치: `beta/staging-architecture`

본 문서는 실제 DB 쓰기/생성 없이, staging 기준으로 리허설 실행 전에 가능한 항목과 필요한 계정·토큰·fixture를 정리한다.

## Rehearsal Step 1

- Status: completed on 2026-06-04
- Store created: `id=5`, `code=KW_REHEARSAL_202606`, `name=KINGWAY Rehearsal Test Store`
- Owner created: `username=kw_rehearsal_owner`, `storeId=5`
- Owner login: success via `/api/login`
- `GET /api/store/settings`: 200
- `GET /api/store/settings/line`: 200

## Rehearsal Step 2

- Status: completed on 2026-06-04
- Owner login: success, `storeId=5`
- Store settings saved and reloaded successfully
- LINE settings saved and reloaded successfully
- Raw `channelSecret` / `channelAccessToken` values were not populated and not exposed
- Rehearsal LINE settings row created under `store_id=5`; existing store 1 LINE settings remained unchanged

## Rehearsal Step 3

- Status: completed on 2026-06-04
- Product created: `id=765`, `sku=KW_REHEARSAL_BIKE_001`, `store_id=5`
- Rehearsal owner product list returned the product under store scope `5`
- Store 1 product list did not return the rehearsal product
- Store 1 direct `PATCH /api/products/765` attempt returned `404`
- Existing store 1 products remained unchanged

## Rehearsal Step 4

- Status: completed on 2026-06-04
- Order created: `id=198`, `orderNo=POS-20260604-113516-561`, `store_id=5`
- Customer created/linked: `id=155`, `name=KW_REHEARSAL_CUSTOMER`, `store_id=5`
- Order item created: `id=386`, `product_id=765`, `quantity=1`, `line_total=36000`
- Inventory movement recorded for store `5`; rehearsal product stock changed from `3` to `2`
- Rehearsal owner could list and read the order
- Store 1 order detail access for order `198` returned `404`; existing store 1 orders remained unchanged

## Rehearsal Step 5

- Status: completed on 2026-06-04
- Staging suppression enabled for repair reservation staff LINE notify when `NODE_ENV=staging` or `APP_ENV=staging_restore` or `STAGING_MODE=true`
- Repair created: `id=83`, `store_id=5`, `source=WEB`, `status=reserved`
- Customer linked: `id=156`, `name=KW_REHEARSAL_REPAIR_CUSTOMER`, `store_id=5`
- Rehearsal owner could list and read the repair order
- Store 1 repair detail access for repair `83` returned `404`; existing store 1 repairs remained unchanged
- Backend log recorded `repair_notify_skipped_staging` and no `api.line.me` outbound log was observed during rehearsal run

## 1) 실행 가능 항목(Non-destructive readiness)

### API/라우트 가시성 확인
- 플랫폼 관리자 로그인 경로: `POST /api/platform-auth/login`
  - `staging` 호출(임의 계정) 시 401 응답 확인됨
  - 경로는 존재하지만 유효 계정/비밀번호가 필요
- 새 테스트 매장 생성 경로: `POST /api/saas-admin/stores`
  - 인증 없어도 라우트 응답은 401(Unauthorized)
  - 즉, 라우트 자체는 존재 추정(보안 미인증 차단)
- owner 로그인 경로 후보:
  - `POST /api/login` → 401(Invalid credentials)
  - `POST /api/platform-auth/login` 역시 운영상 플랫폼 로그인 경로로 병행 확인 필요
- store settings:
  - `GET /api/store/settings`
  - `PATCH /api/store/settings`
  - 모두 401(Unauthorized)
- line settings:
  - `GET /api/store/settings/line`
  - `PATCH /api/store/settings/line`
  - 401(Unauthorized)
- 상품 등록:
  - `GET /api/products`
  - `POST /api/products`
  - 401(Unauthorized)
- 주문 생성:
  - `GET /api/orders`
  - `POST /api/orders`
  - 401(Unauthorized)
- 수리예약 생성:
  - `GET /api/repairs`
  - `POST /api/repairs`
  - 401(Unauthorized)
  - 실제 테이블은 `repair_orders`
- 구매확인 테스트:
  - public 조회: `GET /api/purchase-confirmations/public/:token`는 토큰 유효 시 200 가능
  - store 파라미터 결합:
    - 실제 토큰 예시: `fab609c395444b8a1ee88da62924d734ae7376e3045cdd9d` (DB `purchase_confirmations` 최신 토큰)
    - `?store=KINGWAY_TAINAN` 조합은 404(找不到購買確認連結)
- Free/Premium preset/API:
  - `GET /api/saas-admin/stores/:id/features`, `PATCH .../:id/features`
  - 미인증 호출 401
  - 실제 기능 토글 방식은 feature 플래그 조합으로 판단 필요(현 스키마: `store_features`의 기능별 토글)

### 스테이징 정적 fixture 확인
- 스토어
  - id 1: `KINGWAY_TAINAN` (trial/active 상태)
  - id 2: `KINGWAY_KAOHSIUNG` (active)
  - id 3: `KINGWAY_PLATFORM_API_20260603E` (active)
  - id 4: `KINGWAY_PLATFORM_UI_20260603F` (active)
- 플랫폼 admin 계정
  - `platform_admin_users` 샘플: `admin@kingway.tw` / `PLATFORM_OWNER` (비밀번호는 운영 secret에서 확인 필요)
- store owner 계정 후보
  - store 1: `admin` (ADMIN)
  - store 2: `kaohsiung_owner` (ADMIN)
  - store 3: `platform_owner_20260603e` (ADMIN)
  - store 4: `platform_ui_owner_20260603f` (ADMIN)
  - 비밀번호 해시만 존재(평문 미확인)
- store-line 설정 존재
  - store 1 `webhook_path`: `/api/line/webhook/stg_PXnFtuJutS8QOb1HjpQEoA0z`
  - store 4 `webhook_path`: `/api/line/webhook/stg_jeeQQSEG84xWWF6K-TLUYAcS`
- 구매확인 fixture
  - 최근 pending 토큰 다수 존재
  - 대표 토큰: `fab609...cdd9d` (order 194, store 1), public 조회는 토큰만으로 200(토큰 경로), store 파라미터 동작은 현재 404

## 2) 실제 생성이 필요한 항목

다음 항목은 staging readiness를 통해 경로만 확인할 수 있고, 실리허설 단계에서만 실제 실행 가능:

1. 플랫폼 admin 로그인(유효 계정으로 토큰 획득)
2. `POST /api/saas-admin/stores`로 새 테스트 매장 생성
3. 신규 owner 계정의 로그인 검증(`/api/login`)
4. 테스트 매장 store settings 조회/설정(필수 필드 저장/조회 일치)
5. 테스트 매장 LINE settings 입력 및 webhook_path 점검
6. 최소 상품 등록
7. 주문 생성 (`order_no`, 결제/주문 상태 기반)
8. 수리예약 생성(`POST /api/repairs`)
9. Purchase-confirm token 발급 및 public flow 검증
   - `POST /api/purchase-confirmations/generate-link` 인증 필요
   - 또는 테스트 주문에서 수동/이미 존재 토큰 사용
10. Free/Premium 토글
   - `GET /api/saas-admin/stores/:id/features`
   - `PATCH .../:id/features`

## 3) 위험 항목

- 인증 비밀번호 부재로 대부분 엔드포인트가 401로만 확인되어, 리허설 본 실행은 실제 계정 보유가 필수
- `storeCode` 기반 분기와 공용 링크 연동이 route 간 일관성 이슈 존재 가능:
  - token 조회 시 200, `?store=KINGWAY_TAINAN` 붙이면 404
- 구매확인은 public 링크와 store 파라미터 동작을 별도 검증해야 함
- 일부 legacy 기능/문서와 DB 스키마 차이:
  - `store_features`가 feature boolean set, 프리셋 문자열 키는 없음
- 실데이터 생성 시 교차 침투/권한 범위 오탐 위험(리허설 중 즉시 확인 필요)

## 4) 필요한 테스트 데이터

- 유효한 플랫폼 admin 계정 (JWT 발급용)
- 신규 테스트 매장용 스토어 코드, 이름, status/plan
- 신규 owner 사용자명 + 초기 비밀번호(1회 전달/교체 정책)
- 테스트 상품 1개 이상 (name/category/price/SKU)
- 주문 생성 최소 데이터(고객/상품/결제 상태)
- 수리예약 최소 데이터(전화/차량모델/문제/예약일시)
- purchase-confirm 토큰/연동 주문
  - 현재 DB 샘플 토큰은 토큰만으로 public 조회됨(`token+200`)
  - store 파라미터 연동은 추가 준비 필요

## 5) 필요한 계정

- 플랫폼 admin: `admin@kingway.tw` 계정 비밀번호 필요(리허설 실행 시 사용)
- 운영자/owner: 테스트 매장 owner 계정 중 1개 이상
  - `admin`, `kaohsiung_owner`, `platform_owner_20260603e`, `platform_ui_owner_20260603f`

## 6) 다음 실제 실행 1순위

1. 플랫폼 admin 인증 확보 후 `POST /api/saas-admin/stores`로 신규 테스트 매장 생성(샘플 데이터와 분리)
2. 신규 owner 로그인을 통해 store-scoped 로그인 체계(권한/대시보드 접근) 확인
3. `POST /api/purchase-confirmations/generate-link` 또는 동일 주문 기반 token 발급 후 public flow + store 파라미터를 기준으로 `/api/purchase-confirmations/public/:token` 정합성 점검

## 7) PASS/FAIL 기준(리허설 실행 전 판단)

| 항목 | 현재 상태 | 비고 |
|---|---|---|
| 라우트 가시성 확인 | PASS | 401/404를 통한 존재성 확인 완료 |
| 유효 인증 준비 | FAIL | 유효 계정/비밀번호 미확보로 실 API 실행 불가 |
| 매장 생성 준비 | BLOCKED | 계정 확보 전 |
| owner 로그인/권한 검증 | BLOCKED | 실 계정 로그인 필요 |
| 상품/주문/수리예약 | BLOCKED | 401 상태로 path만 확인, 실제 생성 미확인 |
| purchase-confirm token 테스트 | PARTIAL | public token 조회는 동작, store param 동작 추가 확인 필요 |
| Free/Premium 토글 | BLOCKED | 인증 필요 |
