# Multi-Tenant Migration Phases

## 1. 목적

KINGWAY 台南 獨立門市管理系統을 100개 자전거매장 SaaS로 확장하기 위한 multi-tenant migration 단계 계획서다.

이 문서는 실행 계획이며, 이 문서만으로 코드 수정, DB 수정, migration 실행, docker-compose 수정, 운영 서버 재시작을 승인하지 않는다.

핵심 원칙:

- 절대 한 번에 적용하지 않는다.
- 운영 서버 적용 전 반드시 DB 백업, Git snapshot, staging 테스트를 완료한다.
- 기존 KINGWAY 台南 운영 흐름을 먼저 seed tenant/store로 안전하게 귀속한다.
- LINE-first, zh-TW visible UX, 수리/구매/쿠폰/CRM/재고/공급사/직원관리 규칙을 유지한다.
- Telegram 기반 새 workflow를 추가하지 않는다.

## 2. 전제

관련 기준 문서:

- `docs/KINGWAY_STORE_MASTER_SPEC.md`
- `docs/MULTI_TENANT_ARCHITECTURE.md`
- `docs/TENANT_STORE_TABLE_MAPPING.md`

권장 seed 값:

- seed tenant: `kingway`
- seed store: `kingway-tainan`
- store display name: `KINGWAY 台南`
- locale: `zh-TW`
- timezone: `Asia/Taipei`
- currency: `TWD`

## PHASE 0: 백업 / Git snapshot / rollback 준비

### 목표

운영 데이터와 코드 상태를 되돌릴 수 있는 기준점을 만든다.

### 작업 내용

- 운영 DB 전체 백업 생성
- 백업 파일 무결성 확인
- 현재 Git branch 확인
- Git snapshot tag 또는 commit 기준점 확보
- 현재 docker-compose, env, 배포 설정 read-only 확인
- rollback 절차 문서화
- staging DB 복원 테스트 준비

### 위험 요소

- 백업 파일이 생성됐지만 복원 불가한 상태
- Git 기준점 없이 DB만 변경되는 상태
- 운영과 staging 환경 차이로 검증 결과가 달라지는 상태

### 검증 방법

- 백업 파일 크기, 생성 시간, checksum 확인
- staging 또는 임시 DB에 restore dry-run
- 현재 운영 commit hash 기록
- rollback checklist 리뷰

### rollback 방법

- 운영 코드를 Git snapshot 기준으로 되돌림
- DB를 PHASE 0 백업으로 restore
- 서비스 재시작 전 restore row count 확인

## PHASE 1: tenants / stores 테이블 설계

### 목표

multi-tenant SaaS의 최상위 소유 구조를 정의한다.

### 작업 내용

- `tenants` 테이블 설계
- `stores` 테이블 설계
- tenant와 store 관계 정의
- tenant 상태값 정의
- store 상태값 정의
- locale/timezone/currency 기본값 정의
- 향후 100개 매장 확장을 고려한 slug/unique 정책 정의

권장 개념:

- tenant: SaaS 계약/운영 주체
- store: 실제 자전거 매장/지점

### 위험 요소

- tenant와 store 책임이 섞여 권한/정산 분리가 어려워짐
- store slug 중복
- 기존 KINGWAY 台南을 예외 처리로 남기는 설계

### 검증 방법

- ERD 리뷰
- unique key 리뷰
- 기존 테이블과 FK 연결 방향 리뷰
- 1 tenant / 1 store, 1 tenant / N stores 시나리오 검증

### rollback 방법

- 이 단계는 설계 단계이므로 DB 적용 전이면 문서/DDL 초안 폐기
- 적용 후 문제 발생 시 신규 `tenants`, `stores` 테이블 제거 가능한지 migration rollback 준비

## PHASE 2: KINGWAY 台南 seed tenant/store 생성

### 목표

기존 운영 데이터를 귀속할 기본 tenant/store를 만든다.

### 작업 내용

- seed tenant 정의: `kingway`
- seed store 정의: `kingway-tainan`
- KINGWAY 台南 기본 설정 연결
- store 기본 언어 `zh-TW`
- timezone `Asia/Taipei`
- currency `TWD`
- LINE/POS/수리/재고/쿠폰 기본 흐름의 owner 기준을 seed store로 지정

### 위험 요소

- seed store가 누락되어 backfill 기준이 없음
- 같은 KINGWAY 데이터를 여러 seed로 중복 귀속
- 운영 코드가 seed tenant/store 없이 일부 데이터를 생성

### 검증 방법

- seed tenant/store row 존재 확인
- slug unique 확인
- seed store 상태 active 확인
- 기존 app settings와 seed store 관계 확인

### rollback 방법

- seed tenant/store 생성 전 백업으로 restore
- 아직 operational row backfill 전이면 seed row 삭제 migration 가능
- seed row 삭제 시 FK 연결 전인지 확인

## PHASE 3: 주요 테이블에 nullable store_id 추가

### 목표

기존 서비스 중단 없이 store scope를 넣을 수 있는 준비 컬럼을 추가한다.

### 작업 내용

- P0 테이블에 nullable `tenant_id`, `store_id` 추가
- 기존 query가 깨지지 않도록 nullable 상태 유지
- 인덱스는 조회 패턴 기준으로 단계 적용
- FK는 backfill 이후 적용하는 방향 검토
- `docs/TENANT_STORE_TABLE_MAPPING.md`의 P0 테이블 우선 적용

P0 우선 대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `repair_logs`
- `products`
- `inventory_movements`
- `coupons`
- `purchase_confirmations`
- `purchase_confirmation_tokens`
- `staff_users`
- `staff_attendance`
- `staff_kpi_logs`
- `customer_crm_events`
- `follow_up_tasks`
- `supplier_requests`
- `supplier_request_items`
- `line_group_registrations`
- `line_chat_sessions`
- `v2_workflow_events`
- `app_settings`

### 위험 요소

- 대형 테이블 ALTER로 lock 발생
- nullable 컬럼 추가 후 일부 신규 데이터가 null로 계속 생성
- FK를 너무 빨리 추가해 기존 운영 데이터와 충돌

### 검증 방법

- staging에서 migration 실행 시간 측정
- 각 테이블 컬럼 존재 확인
- 기존 API smoke test
- row count 변화 없음 확인
- null 비율 baseline 기록

### rollback 방법

- 컬럼 추가 직후 문제면 백업 restore가 가장 안전
- migration rollback으로 신규 컬럼 drop 가능 여부 확인
- 운영 적용 전 반드시 staging에서 rollback rehearsal

## PHASE 4: 기존 데이터 backfill 전략

### 목표

기존 KINGWAY 台南 데이터를 seed tenant/store로 안전하게 귀속한다.

### 작업 내용

- dry-run row count 생성
- 모든 기존 operational row를 `kingway` / `kingway-tainan`으로 backfill
- 관계형 테이블은 parent 기준으로 backfill
- polymorphic log는 ref 기준과 seed fallback을 병행
- backfill 후 null 잔여 row 보고서 생성

Backfill 원칙:

- 고객 병합 금지
- phone / LINE userId 덮어쓰기 금지
- Chinese text가 깨져 보이면 stored bytes 먼저 검증
- repair-classified orders 유지
- purchase confirmation PDF 연결 유지

### 위험 요소

- 일부 child row가 parent와 다른 store로 귀속
- backfill 중 새 데이터 생성으로 null row 발생
- repair order / order 연결이 깨짐
- coupon one-per-customer 기준이 흐려짐

### 검증 방법

- backfill 전후 row count 비교
- P0 테이블 null `store_id` count 확인
- customer/order/repair/coupon/PDF 연결 샘플링
- REPAIR 포함 주문이 `維修管理`에 계속 표시되는지 확인
- LINE binding 고객 조회 확인
- 신규친구 쿠폰/Google 리뷰 쿠폰 중복 여부 확인

### rollback 방법

- backfill 직전 DB 백업으로 restore
- backfill SQL이 reversible하면 seed store_id/tenant_id를 null로 되돌리는 rollback script 준비
- 운영에서는 부분 rollback보다 전체 restore 우선

## PHASE 5: API store scope middleware 적용

### 목표

모든 API 요청이 tenant/store context 안에서만 데이터를 읽고 쓰도록 만든다.

### 작업 내용

- 인증된 staff user에서 tenant/store context 결정
- customer LINE flow에서 LINE channel/LIFF/token 기반 tenant/store 결정
- supplier approval flow에서 token/group 기반 tenant/store 결정
- request context에 `tenantId`, `storeId` 주입
- P0 API query에 store scope 적용
- create/update/delete에 tenant/store guard 적용

우선 대상 API:

- customers
- orders
- repairs
- products
- inventory
- coupons
- purchase confirmations
- attendance
- KPI/payroll
- suppliers
- LINE webhook/session

### 위험 요소

- scope 누락으로 cross-store 데이터 노출
- 기존 admin 기능이 전체 데이터를 못 보는 문제
- LINE public endpoint에서 tenant resolution 실패
- Telegram 잔존 route가 unscoped 상태로 남음

### 검증 방법

- seed store 로그인으로 기존 기능 smoke test
- 임시 두 번째 store 데이터로 cross-store 접근 차단 테스트
- create/update/delete가 올바른 store_id를 쓰는지 확인
- public token endpoint tenant leakage 테스트
- dashboard count가 store scope로 맞는지 확인

### rollback 방법

- middleware feature flag로 비활성화 가능하게 준비
- query scope 변경 전후 diff 가능한 staging 테스트 유지
- 문제 발생 시 PHASE 4 백업 또는 Git snapshot 기준 rollback

## PHASE 6: LINE / Telegram / POS / 수리 / 주문 / 재고 / 쿠폰 흐름별 검증

### 목표

주요 업무 흐름이 store scope 적용 후에도 기존 KINGWAY 台南 기준으로 동일하게 작동하는지 검증한다.

### 작업 내용

LINE 검증:

- 친구추가
- 전화번호 binding
- 신규친구 NT$500 쿠폰
- Google 리뷰 신청
- 직원 승인 후 쿠폰 발급
- 수리예약
- 수리견적 고객 승인/거절
- 수리완료 알림
- 구매확인서 발송/서명/PDF

Telegram 잔존 흐름 검증:

- 기존 Telegram route/service가 unscoped write를 하지 않는지 확인
- 신규 Telegram workflow는 추가하지 않음
- 필요 시 read-only 또는 legacy-isolated 처리

POS/주문 검증:

- 일반 주문
- 예약금 주문
- 잔금 수납
- EBIKE 구매확인
- REPAIR 품목 포함 주문의 수리관리 표시

재고/공급사 검증:

- 상품 생성/수정
- 입고/출고/조정
- 발주/반품
- 입고 시 stock 반영
- 공급사 월정산

쿠폰 검증:

- 신규친구 쿠폰 1인 1회
- Google 리뷰 쿠폰 수동 승인
- EBIKE category only
- 사용 처리와 주문 연결

### 위험 요소

- LINE group registration이 store별로 분리되지 않음
- 쿠폰 중복 발급
- 수리 주문이 일반 주문으로만 표시
- 재고가 다른 store 상품에 반영
- Telegram legacy callback이 store scope 없이 주문/재고 수정

### 검증 방법

- flow별 staging checklist 작성
- seed store 데이터로 end-to-end 테스트
- 두 번째 테스트 store 데이터로 격리 테스트
- LINE webhook replay 테스트
- POS 주문 후 inventory movement 확인
- repair/order/customer history 일치 확인

### rollback 방법

- flow별 feature flag로 scoped behavior disable
- 문제가 데이터 오염이면 DB 백업 restore
- 문제가 코드 scope라면 Git snapshot으로 rollback

## PHASE 7: frontend 권한/메뉴 분리

### 목표

사용자 역할과 store 권한에 따라 메뉴와 데이터가 분리되도록 한다.

### 작업 내용

- 로그인 후 store context 표시
- staff role별 메뉴 제한
- store 선택 UI는 권한 있는 사용자에게만 제공
- 일반 staff는 assigned store 고정
- platform admin과 store admin UI 분리
- dashboard, customers, orders, repairs, inventory, coupons, staff 메뉴 store scope 적용
- visible text는 zh-TW 유지

### 위험 요소

- frontend만 숨기고 API scope가 없는 상태
- store 선택 UI로 권한 없는 store 접근
- 메뉴 번역 누락
- 모바일 핵심 workflow가 깨짐

### 검증 방법

- ADMIN/MANAGER/CASHIER/REPAIR/INVENTORY role별 메뉴 확인
- 모바일 viewport 확인
- 권한 없는 API 직접 호출 차단 확인
- store 전환 시 데이터 count 변경 확인
- visible UI zh-TW 확인

### rollback 방법

- frontend 변경 Git rollback
- store selector feature flag 비활성화
- API scope가 이미 적용된 경우 frontend rollback만으로 해결 가능한지 확인

## PHASE 8: store_id NOT NULL / unique key 재설계

### 목표

nullable 전환 단계를 끝내고 DB 레벨에서 tenant/store 격리를 강제한다.

### 작업 내용

- P0 테이블 null row가 0인지 확인
- `store_id` / `tenant_id` NOT NULL 전환
- unique key 재설계
- FK 제약 추가 검토
- 주요 index 재정리

재설계 대상 예시:

- `customers.line_user_id`
- `customers.phone`
- `products.sku`
- `orders.order_no`
- `coupons.code`
- `purchase_confirmation_tokens.token`
- `line_group_registrations.line_group_id`
- `line_chat_sessions.line_user_id + flow_type`

### 위험 요소

- 기존 전역 unique와 store-scoped unique 충돌
- null row 잔존으로 NOT NULL 실패
- 대형 테이블 index rebuild lock
- token/code가 전역 unique여야 하는 경우와 store unique여야 하는 경우 혼동

### 검증 방법

- duplicate key dry-run
- null check
- FK violation dry-run
- staging migration 시간 측정
- API create/update smoke test
- token public endpoint 충돌 테스트

### rollback 방법

- index/constraint 변경 전 DB 백업 필수
- 실패 시 migration rollback 또는 restore
- 운영에서는 constraint 변경을 작은 단위로 나누어 적용

## PHASE 9: staging 검증 후 운영 반영

### 목표

staging에서 검증된 변경만 운영에 단계적으로 반영한다.

### 작업 내용

- staging DB를 운영 snapshot에서 복원
- PHASE 1-8 migration rehearsal
- end-to-end flow 검증
- rollback rehearsal
- 운영 반영 window 결정
- 운영 DB 백업 재생성
- Git snapshot 재확인
- 운영 적용
- 적용 후 smoke test
- 적용 후 monitoring

### 위험 요소

- staging과 운영 env 차이
- 운영 중 신규 데이터 생성으로 dry-run 결과와 차이 발생
- LINE webhook traffic이 적용 중 들어옴
- 긴 migration으로 운영 지연

### 검증 방법

- staging rehearsal 결과 승인
- 운영 적용 직전 row count snapshot
- 적용 직후 P0 flow smoke test
- LINE webhook 수신 확인
- POS 주문 생성 확인
- 수리관리 조회 확인
- 재고 movement 확인
- 쿠폰 발급/승인 확인
- 구매확인서 PDF 확인

### rollback 방법

- 즉시 Git snapshot rollback
- DB는 PHASE 9 직전 운영 백업으로 restore
- LINE webhook endpoint 상태 확인
- restore 후 row count와 핵심 업무 flow 재확인
- rollback 결과를 문서화

## 최종 안전 규칙

- 절대 PHASE 1-8을 한 번에 운영 반영하지 않는다.
- 각 phase는 staging에서 검증 후 다음 phase로 이동한다.
- 운영 적용 전 반드시 DB 백업을 생성한다.
- 운영 적용 전 반드시 Git snapshot을 남긴다.
- 운영 적용 전 반드시 rollback rehearsal을 완료한다.
- 고객/주문/수리/쿠폰/LINE binding 데이터는 임의 병합하거나 덮어쓰지 않는다.
- KINGWAY 台南 기존 운영 흐름이 깨지면 즉시 중단하고 rollback한다.
