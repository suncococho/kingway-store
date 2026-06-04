# Production Data Preservation Migration Plan

작성일: 2026-06-04  
대상 저장소: `KINGWAY 台南 獨立門市管理系統`  
대상 DB: production MySQL `3306`  
목표: production `3306`의 실제 운영 데이터를 보존하면서, 기존 단일점 데이터를 `store_id=1`, `store_code=KINGWAY_TAINAN` 기준으로 안전하게 귀속시키는 절차를 문서화한다.

## 1. 문서 목적

이 문서는 다음 원칙을 고정한다.

- production DB `3306`의 실제 운영 데이터는 기준 데이터이며, 어떤 경우에도 staging DB로 덮어쓰지 않는다.
- 기존 운영 데이터는 seed store인 `store_id=1 / KINGWAY_TAINAN`에 귀속한다.
- migration은 반드시 `read-only 확인 -> backup 확보 -> dry-run 검증 -> 승인된 SQL 실행 -> 사후 검증` 순서로 진행한다.
- 이 문서는 실행 절차 문서이며, 현재 turn에서는 코드 수정, DB 수정, 배포를 수행하지 않는다.

## 2. 절대 금지 원칙

### 2-1. staging -> production overwrite 금지

아래 작업은 모두 금지한다.

- staging DB `3310` dump를 production DB `3306`에 import
- staging 컨테이너를 production DB volume 위에 재기동
- staging `.env` 또는 staging compose 설정을 production 런타임에 그대로 사용
- production 스키마를 staging 기준으로 무검토 일괄 재생성
- production 데이터를 지우고 staging 데이터로 치환

금지 이유:

- production `3306`은 실제 고객/주문/수리/쿠폰/LINE 바인딩 이력이 있는 운영 원본이다.
- staging은 rehearsal 및 구조 검증용이며, 운영 원본의 대체물이 아니다.
- staging에는 mock flag, disabled webhook, 테스트용 store, 임시 데이터가 섞여 있을 수 있다.

### 2-2. destructive SQL 금지

production migration 준비 또는 실행 중 아래 SQL은 승인 없이 금지한다.

- `DROP DATABASE`
- `DROP TABLE`
- `TRUNCATE TABLE`
- `DELETE FROM ...` 일괄 삭제
- `REPLACE INTO ...` 전면 치환
- `INSERT ... SELECT ...`로 staging 원본을 production에 복제
- 운영 데이터에 대한 비가역 bulk rewrite

## 3. Source of Truth

이 계획은 아래 자료를 기준으로 정리한다.

1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. `AGENTS.md`
3. `docs/KINGWAY_TAINAN_MIGRATION_PLAN.md`
4. `docs/PRODUCTION_CUTOVER_PLAN.md`
5. `docs/TENANT_STORE_TABLE_MAPPING.md`
6. `docs/TENANT_STORE_DRY_RUN_SQL.md`
7. 현재 코드의 `store_id` 스코프 사용 현황

## 4. 현재 판단

현재 저장소 기준으로 확인된 점:

- backend 다수 route가 이미 `req.storeId`와 SQL `store_id` predicate를 사용한다.
- 문서상 production `3306`은 staging `3310`보다 schema가 뒤처져 있을 가능성이 높다.
- 기존 KINGWAY 운영 데이터는 사실상 single-store legacy 데이터이며, seed store 귀속 원칙이 필요하다.
- 기존 계획 문서들은 모두 `store_id=1`을 `KINGWAY_TAINAN` seed store로 사용하도록 정렬되어 있다.

따라서 production migration의 핵심은:

- production 실제 데이터를 유지한 채
- 필요한 schema만 추가하고
- 기존 모든 operational row를 `store_id=1`로 보수적으로 backfill하며
- staging 데이터는 참고와 rehearsal에만 사용하고 production에 주입하지 않는 것이다.

## 5. Seed Store 정의

production 기존 데이터를 귀속할 canonical seed store는 아래로 고정한다.

| 항목 | 값 |
|---|---|
| `store_id` | `1` |
| `store_code` | `KINGWAY_TAINAN` |
| display name | `KINGWAY 台南` |
| locale | `zh-TW` |
| timezone | `Asia/Taipei` |
| currency | `TWD` |

원칙:

- 기존 production 단일점 운영 데이터는 모두 이 seed store에 귀속한다.
- 이 귀속은 “운영 원본을 유지한 store ownership 명시”이며, staging 데이터 치환이 아니다.
- 향후 다른 매장이 추가되더라도 기존 row를 임의 재분배하지 않는다.

## 6. Migration 범위

### 6-1. 우선 대상

아래 운영 핵심 테이블은 `store_id=1` 귀속 대상이다.

- `staff_users`
- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `coupons`
- `inventory_movements`
- `supplier_requests`
- `purchase_confirmations`

### 6-2. 후속 또는 함께 검토할 대상

- `app_settings`
- `customer_crm_events`
- `follow_up_tasks`
- `line_group_registrations`
- `line_chat_sessions`
- `purchase_confirmation_tokens`
- `purchase_confirmation_requests`
- `repair_logs`
- `staff_attendance`
- `staff_kpi_logs`
- `supplier_request_items`
- `surveys`
- `v2_workflow_events`

원칙:

- active code가 이미 `store_id`를 요구하는 테이블부터 우선 처리한다.
- 후속 테이블도 가능하면 같은 cutover window에서 dry-run과 row count를 확보한다.
- 고객 phone / LINE userId는 보수적으로 다루며, 고객 병합은 하지 않는다.

## 7. 실행 전략

### 7-1. 기본 전략

production migration은 아래 4개 축으로 진행한다.

1. production 원본 보존
2. schema 확장만 선행
3. 기존 row의 `store_id=1` backfill
4. store-scoped runtime 검증

### 7-2. staging의 역할

staging은 아래 역할만 가진다.

- migration SQL 초안 검토
- row count/NULL count/orphan check rehearsal
- rollback 절차 rehearsal
- route smoke test rehearsal

staging이 production에 대해 해서는 안 되는 일:

- data source 역할
- seed data 공급원 역할
- production truth 대체 역할

## 8. 단계별 절차

## Phase 0. 사전 통제

실행 전에 아래를 먼저 고정한다.

- 작업 대상 DB host/port가 실제 production `3306`인지 이중 확인
- staging `3310`과 production `3306` 접속 정보를 문서로 분리
- operator 2인 확인 또는 최소 체크리스트 sign-off 확보
- migration SQL 파일과 rollback SQL 파일을 분리
- 실행 세션에서 `SELECT DATABASE()`, `SELECT @@hostname`, `SELECT @@port` 결과를 기록

권장 확인 SQL:

```sql
SELECT DATABASE() AS current_database;
SELECT @@hostname AS hostname;
SELECT @@port AS port;
SELECT NOW() AS db_time;
```

## Phase 1. production read-only audit

목표: production `3306`의 현 상태를 절대 변경 없이 파악한다.

실행 원칙:

- 가능하면 read-only 계정 사용
- 아니면 `START TRANSACTION READ ONLY`
- `SELECT`, `SHOW`, `EXPLAIN`만 허용

최소 점검 항목:

- 핵심 테이블 row count
- `store_id` 컬럼 존재 여부
- unique/index 현황
- `customers.phone`, `customers.line_user_id` 중복 후보
- `orders.order_no` 중복 후보
- orphan row 존재 여부
- `repair`와 `order` 연계 정합성

권장 참조:

- `docs/TENANT_STORE_DRY_RUN_SQL.md`

산출물:

- production dry-run 결과 문서
- “schema 추가 가능 / blocker 존재 / 중복 정리 필요” 판정

## Phase 2. full backup

목표: production 원본을 복원 가능한 형태로 고정한다.

필수 백업:

- production DB full dump
- uploads/files/PDF/attachment snapshot
- 현재 production `.env` 사본
- 현재 production git commit hash

권장 dump 예시:

```bash
mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 kingway_store > production_backup_YYYYMMDD_HHMM.sql
```

필수 기록:

- dump 파일명
- 생성 시각
- checksum
- 저장 경로 2곳 이상
- 복원 명령 예시
- 복원 테스트 대상 DB명

승인 조건:

- backup 파일 생성만으로 끝내지 않고 checksum까지 기록
- restore rehearsal 절차가 이미 있거나 같은 날 검증 가능해야 함

## Phase 3. schema-only migration

목표: production data는 손대지 않고, seed store 귀속을 위한 구조를 먼저 만든다.

원칙:

- nullable-first
- reversible
- no data replacement
- no non-null enforcement at first pass

예상 작업 범주:

1. `stores` 테이블 생성
2. `id=1 / KINGWAY_TAINAN` seed row 생성
3. 핵심 운영 테이블에 nullable `store_id` 추가
4. 필요한 index 추가
5. 필요 시 `app_settings` 등 보조 테이블 store scope 구조 보강

중요:

- 이 단계에서는 production business row 자체를 staging row로 교체하지 않는다.
- unique key 재설계는 위험도가 높으면 분리 phase로 떼어낸다.
- foreign key는 orphan 점검 후 적용 여부를 결정한다.

## Phase 4. backfill to `store_id=1`

목표: production에 이미 존재하는 기존 운영 row를 seed store에 귀속한다.

원칙:

- 기존 row 유지
- `store_id`만 채움
- NULL인 row만 갱신
- 기존 non-null `store_id`가 있다면 무조건 덮어쓰지 않음

핵심 규칙:

- `UPDATE ... SET store_id = 1 WHERE store_id IS NULL`
- 이미 `store_id` 값이 있는 row는 별도 검토 목록으로 분리
- 고객 식별자, 주문번호, 쿠폰, LINE userId는 절대 merge하지 않음

테이블별 적용 원칙:

- `staff_users`: 기존 운영 직원 계정은 `store_id=1`
- `customers`: 기존 고객은 `store_id=1`, phone/LINE userId는 덮어쓰기 금지
- `products`: 기존 상품은 `store_id=1`
- `orders`: 기존 주문은 `store_id=1`
- `order_items`: parent order 기준 정합성 검증 후 `store_id=1`
- `repair_orders`: repair order는 `store_id=1`, repair/order/customer 정합성 재검증
- `coupons`: 고객/주문과 같은 store로 정렬
- `inventory_movements`: product와 같은 store로 정렬
- `supplier_requests`: 기존 KINGWAY 운영 건은 `store_id=1`
- `purchase_confirmations`: order/customer와 같은 store로 정렬

## Phase 5. post-backfill verification

목표: backfill 후에도 운영 데이터가 보존되었고 scope가 일관적인지 확인한다.

필수 검증:

- 핵심 테이블별 `store_id IS NULL` count = `0`
- row total count 전/후 동일
- store mismatch row = `0`
- orphan row count 악화 없음
- `repair`/`order`/`customer` 연계 정합
- purchase confirmation / coupon / inventory relation 정합

예시 검증 관점:

- `orders.store_id`와 `customers.store_id` 불일치 여부
- `order_items.store_id`와 `orders.store_id` 불일치 여부
- `repair_orders.store_id`와 `customers.store_id` 불일치 여부
- `purchase_confirmations.store_id`와 `orders/customers.store_id` 불일치 여부

## Phase 6. runtime smoke validation

목표: production 코드가 실제 production DB에서 `store_id=1` 기준으로 정상 동작하는지 확인한다.

최소 점검:

- 로그인
- dashboard
- customers list/detail
- products list/detail
- orders list/detail
- repairs list/detail
- coupons list
- purchase confirmations list/public token route
- store settings / line settings

주의:

- unsigned webhook 호출은 실패가 정상이다.
- smoke test는 운영 데이터 파괴 없이 조회 중심으로 구성한다.

## 9. `store_id=1 / KINGWAY_TAINAN` 매핑 절차 요약

실행 절차를 한 줄로 요약하면 아래와 같다.

1. production `3306` read-only audit 수행
2. production full backup 확보
3. `stores`에 `id=1 / KINGWAY_TAINAN` seed 정의
4. 핵심 테이블에 nullable `store_id` 추가
5. 기존 production row 중 `store_id IS NULL`인 건만 `1`로 backfill
6. row count / mismatch / orphan / NULL count 검증
7. store-scoped runtime smoke test 수행
8. 이상 없을 때만 다음 phase 진행

## 10. 데이터 보존 규칙

### 10-1. 고객 데이터

- 기존 `customers` row를 삭제하지 않는다.
- phone, LINE userId가 비어 있지 않은 기존 값은 덮어쓰지 않는다.
- 중복 후보가 보여도 자동 merge하지 않는다.
- 깨진 문자 의심 시 stored bytes를 먼저 확인한다.

### 10-2. 주문 / 수리 / 쿠폰

- 주문 row 자체를 재생성하지 않는다.
- `REPAIR` 카테고리 포함 주문의 repair 분류 규칙은 유지한다.
- Google 리뷰 쿠폰은 자동 재발급하지 않는다.
- purchase confirmation PDF 경로와 메타데이터는 보존한다.

### 10-3. LINE 관련 데이터

- production LINE OA credential은 임의 변경하지 않는다.
- 기존 LINE binding과 group registration은 유지한다.
- webhook 경로/토큰 구조 변경은 데이터 migration과 분리해 승인 후 진행한다.

## 11. 승인 없이는 하지 말아야 할 것

- `store_id`를 `NOT NULL`로 즉시 강제
- global unique를 tenant/store unique로 한 번에 재설계
- production webhook cutover 동시 진행
- reverse proxy 전환 동시 진행
- staging env 값 반입
- production에서 rehearsal용 mock flag 활성화

## 12. 롤백 원칙

rollback은 “staging 데이터로 되돌리기”가 아니라 “production 백업 또는 직전 상태로 복구”여야 한다.

원칙:

- schema-only 실패: 직전 schema 변경만 역순 복구
- backfill 실패: production backup 또는 transaction/restore 계획에 따라 복구
- runtime 이슈: code rollback과 data rollback을 분리 판단

금지:

- “production이 이상하니 staging dump를 덮어씌운다” 방식의 복구

## 13. 최종 승인 체크리스트

- [ ] 대상이 production `3306`인지 확인했다.
- [ ] staging `3310`을 production에 import하지 않는다는 원칙을 확인했다.
- [ ] production full backup과 checksum을 확보했다.
- [ ] 핵심 테이블 row count dry-run 결과를 보관했다.
- [ ] `stores.id=1 / KINGWAY_TAINAN` seed 정의를 검토했다.
- [ ] 핵심 테이블 `store_id` 추가 범위를 확정했다.
- [ ] `store_id IS NULL -> 1` backfill만 수행한다는 원칙을 확인했다.
- [ ] 기존 non-null 식별자와 운영 row를 덮어쓰지 않는다는 원칙을 확인했다.
- [ ] post-backfill validation SQL을 준비했다.
- [ ] runtime smoke test 항목을 준비했다.

## 14. 결론

production migration의 정답은 staging을 production에 복제하는 것이 아니다.

정답은:

- production `3306`의 실제 데이터를 원본으로 유지하고
- 그 원본에 seed store `store_id=1 / KINGWAY_TAINAN` ownership을 부여하며
- 필요한 schema와 scope만 보수적으로 추가하고
- 모든 변경은 backup, dry-run, verification, rollback 기준 아래 단계적으로 수행하는 것이다.
