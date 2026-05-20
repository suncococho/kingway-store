# Tenant / Store BLOCKER Remediation

## 1. 목적

multi-tenant migration dry-run에서 발견된 BLOCKER와 WARNING 항목의 해결 전략을 정의한다.

이 문서는 remediation 전략 문서이며, 이 문서만으로 DB 변경, 데이터 수정, migration 실행, 운영 반영을 승인하지 않는다.

관련 문서:

- `docs/TENANT_STORE_DRY_RUN_PLAN.md`
- `docs/TENANT_STORE_DRY_RUN_SQL.md`
- `docs/TENANT_STORE_DRY_RUN_RESULT_TEMPLATE.md`
- `docs/TENANT_STORE_DRY_RUN_EXECUTION_CHECKLIST.md`
- `docs/TENANT_STORE_SCHEMA_DRAFT.md`
- `docs/MULTI_TENANT_MIGRATION_PHASES.md`

## 2. 현재 BLOCKER 요약

최근 SELECT-only dry-run 기준 확인된 주요 위험은 다음과 같다.

| 항목 | 상태 | 위험 수준 | 요약 |
|---|---:|---|---|
| purchase confirmation token orphan | 6건 | BLOCKER | `purchase_confirmation_tokens.order_id`가 존재하지 않는 주문을 참조 |
| purchase confirmation orphan | 6건 | BLOCKER | `purchase_confirmations.order_id`가 존재하지 않는 주문을 참조 |
| survey orphan | 8건 | BLOCKER | `surveys.order_id`가 존재하지 않는 주문을 참조 |
| customer phone duplicate | 2그룹 / 4건 | WARNING 또는 BLOCKER 후보 | 고객 병합/unique 전환 전 수동 검토 필요 |
| coupon duplicate issue | 1그룹 / 2건 | WARNING 또는 BLOCKER 후보 | 1인 1회 쿠폰 정책과 충돌 가능성 |
| restore rehearsal 필요 | 미완료 | BLOCKER | backup restore 검증 없이 운영 migration 금지 |

추가 관찰:

- `customers.phone` NULL/empty: 87건
- `customers.line_user_id` NULL/empty: 80건
- `orders.customer_id` NULL: 3건
- `repair_orders.order_id` NULL: 8건
- `purchase_confirmations.pdf_path` NULL/empty: 9건
- `tenant_id` / `store_id` 컬럼은 아직 주요 테이블에 없음

## 3. migration 중단 기준

아래 조건 중 하나라도 충족하면 migration/backfill/운영 반영을 중단한다.

| 중단 조건 | 설명 |
|---|---|
| orphan unresolved | parent 없는 child row의 처리 방침이 확정되지 않음 |
| duplicate unresolved | phone, order_no, coupon, LINE userId 중복 정책이 확정되지 않음 |
| rollback 불가능 | rollback SQL 또는 full restore 전략이 없음 |
| restore 검증 실패 | NAS backup 또는 staging restore가 실패함 |
| LINE binding inconsistency | 고객/직원/세션 LINE userId 충돌 또는 tenant resolution 불명확 |
| purchase confirmation linkage 불명확 | PDF/token/order/customer 연결 보존 방침이 불명확 |
| coupon one-per-customer 정책 충돌 | 신규친구/Google 리뷰 쿠폰 중복 처리 기준 미확정 |
| production direct migration 요구 | staging rehearsal 없이 운영 적용하려는 경우 |

중단 원칙:

- ambiguous data가 있으면 migration을 멈춘다.
- 자동 병합으로 해결하지 않는다.
- 원인 분석 없이 backfill하지 않는다.

## 4. customer phone duplicate 해결 전략

### 4-1. merge 금지 원칙

고객 phone duplicate가 발견되어도 자동 merge하지 않는다.

금지:

- 같은 phone이라는 이유만으로 customer row 병합
- 기존 non-null phone 덮어쓰기
- 기존 non-null LINE userId 덮어쓰기
- 이름이 비슷하다는 이유로 병합
- order/repair/coupon history를 자동 이동

이유:

- 같은 전화번호를 가족/직원/대리 구매자가 공유할 수 있음
- 과거 offline 고객과 LINE 고객이 분리되어 있을 수 있음
- 고객 이력, 쿠폰, 구매확인서, 수리 이력이 잘못 합쳐질 위험이 큼

### 4-2. manual review queue

phone duplicate는 manual review queue로 분류한다.

검토 항목:

- customer id
- masked phone
- name
- LINE binding 여부
- order count
- repair count
- coupon count
- purchase confirmation count
- last interaction date
- CRM notes
- 담당 staff
- 병합 가능 여부가 아니라 "동일 고객 가능성"만 표시

권장 판정:

| 판정 | 의미 | 처리 |
|---|---|---|
| same_person_likely | 동일 고객 가능성 높음 | migration 이후 별도 고객 정리 작업으로 처리 |
| shared_phone | 가족/대리/공용 번호 가능성 | merge 금지, duplicate 유지 |
| insufficient_evidence | 판단 근거 부족 | merge 금지, duplicate 유지 |
| data_error_suspected | 데이터 오류 가능성 | 원본 byte/이력 확인 후 별도 승인 |

### 4-3. store scope 적용 후 재검토

multi-tenant 전환 초기에는 phone unique를 강제하지 않는다.

권장 순서:

1. `store_id` nullable 추가
2. seed store backfill
3. duplicate report 유지
4. phone normalized duplicate view/report 제공
5. 운영자가 수동 검토
6. 충분한 근거가 있을 때만 별도 승인으로 정리

### 4-4. soft duplicate 정책

초기 정책은 hard unique가 아니라 soft duplicate로 둔다.

권장 정책:

- 같은 store 안에서 phone duplicate 허용
- 신규 고객 생성 시 duplicate warning 표시
- staff가 기존 고객 선택 또는 신규 생성 선택
- 자동 merge 금지
- 고객 상세에 duplicate 후보 표시
- LINE userId는 phone보다 강한 식별자로 취급하되, 그래도 자동 병합 금지

## 5. coupon duplicate issue 해결 전략

### 5-1. historical coupon 유지 원칙

기존 쿠폰 이력은 삭제하거나 덮어쓰지 않는다.

금지:

- 중복 쿠폰 자동 삭제
- used coupon 상태 변경
- issued coupon을 임의 expired 처리
- order_id 재연결 자동 수행
- coupon amount 변경

이유:

- 쿠폰은 고객 혜택/정산/주문 금액에 영향을 준다.
- used coupon은 회계/감사 이력으로 보존해야 한다.
- Google 리뷰 쿠폰은 staff 승인 이력이 중요하다.

### 5-2. customer/store scope 재설계

multi-tenant 이후 쿠폰 정책은 store 또는 tenant scope로 명확히 나눈다.

권장 기준:

| 쿠폰 | scope | 정책 |
|---|---|---|
| new_friend | tenant 또는 store | LINE friend add + phone binding 기준 1인 1회 |
| google_review | tenant 또는 store | staff manual approval 기준 1인 1회 |
| used coupon | immutable | 사용 이력 보존 |
| rejected coupon | historical | 재신청 허용 여부 별도 정책 |
| pending coupon | workflow state | 중복 pending 생성 방지 |

초기 권장:

- 기존 historical coupon은 그대로 유지
- 신규 발급 로직에만 duplicate guard 강화
- migration backfill은 coupon row를 seed store에 귀속만 함
- unique key는 바로 강제하지 않고 report 기반으로 검토

### 5-3. used coupon immutable 정책

used coupon은 immutable로 취급한다.

원칙:

- `used` 상태의 coupon은 삭제하지 않는다.
- `used_at`, `order_id`, `amount`, `customer_id`는 임의 변경 금지.
- 잘못 연결된 의심이 있으면 quarantine/report로 분리하고 수동 승인 후 처리.
- migration은 used coupon의 tenant/store 귀속만 수행한다.

### 5-4. duplicate coupon 처리 후보

| 케이스 | 처리 전략 |
|---|---|
| 같은 customer + new_friend 2건 모두 issued | staff review 후 하나만 future-usable로 제한하는 정책 검토 |
| 같은 customer + new_friend 1 used, 1 issued | used 유지, issued 사용 가능 여부 수동 검토 |
| 같은 customer + google_review duplicate | 승인/사용 상태와 order 연결 확인 |
| duplicate coupon code | 전역 token/code 충돌이므로 migration 전 BLOCKER |
| pending duplicate | 신규 workflow guard로 추가 생성 방지 |

## 6. orphan 데이터 처리 전략

### 6-1. orphan token

대상:

- `purchase_confirmation_tokens.order_id -> orders.id` orphan

위험:

- public token이 존재하지 않는 주문을 가리킬 수 있음
- 구매확인서 링크가 잘못된 고객/주문으로 연결될 수 있음
- tenant/store backfill 시 parent store를 파생할 수 없음

처리 전략:

1. orphan token 목록을 read-only report로 추출
2. token 전체값은 masking
3. `customer_id` 연결이 살아있는지 확인
4. 관련 `purchase_confirmations.token`과 매칭되는지 확인
5. PDF/path 존재 여부 확인
6. parent order 복구 가능 여부 판단
7. 복구 불가하면 quarantine 후보로 표시

금지:

- token 삭제
- token 재발급
- order_id 임의 변경
- customer_id 기준으로 order 자동 추정

### 6-2. orphan purchase confirmation

대상:

- `purchase_confirmations.order_id -> orders.id` orphan

처리 전략:

1. confirmation id 기준으로 목록화
2. `customer_id`, `buyer_phone`, `buyer_name`, `pdf_path`, `submitted_at` 확인
3. PDF가 존재하면 고객관리 보존 대상 표시
4. order 복구 가능성이 있는 경우 근거 기록
5. 복구 불가하면 `orphan_purchase_confirmation` quarantine 정책 적용

보존 원칙:

- 구매확인서 PDF는 고객관리 이력으로 보존한다.
- 주문 연결이 없어도 고객/문서 이력으로 유지할 수 있다.
- 자동으로 다른 order에 붙이지 않는다.

### 6-3. orphan survey

대상:

- `surveys.order_id -> orders.id` orphan

처리 전략:

1. survey id, customer_id, rating, submitted_at 확인
2. customer 연결이 살아있는지 확인
3. repair survey인지 purchase survey인지 추정하지 않는다.
4. 관련 repair_order linkage가 있는지 별도 조사
5. order 복구 불가하면 customer-level survey history로 quarantine 후보 처리

주의:

- 설문은 고객 피드백 이력이므로 삭제하지 않는다.
- 수리 설문인지 주문 설문인지 불명확하면 migration 중단 후 정책 확정.

### 6-4. orphan order linkage

orphan 해결 전 확인할 관계:

- purchase confirmations
- purchase confirmation tokens
- surveys
- coupons
- repair orders
- inventory movements
- order items

처리 원칙:

- child row의 parent를 자동 생성하지 않는다.
- order_no나 phone만으로 order를 자동 연결하지 않는다.
- 연결 근거가 부족하면 quarantine으로 분류한다.

### 6-5. quarantine 정책

quarantine은 "삭제"가 아니라 "migration에서 별도 보존 대상"으로 분리하는 정책이다.

권장 방식:

- 원본 row 유지
- seed tenant/store backfill은 하되, parent linkage는 변경하지 않음
- 별도 report에 orphan 상태 기록
- UI/API에서 일반 workflow와 구분할지 후속 설계
- 향후 수동 정리 대상 queue로 관리

quarantine report 필드:

- table
- row id
- orphan relation
- missing parent id
- customer_id
- order_id
- created/submitted date
- suggested action
- risk level
- reviewer
- decision

## 7. restore rehearsal 전략

### 7-1. NAS backup restore

목표:

- 실제 rollback 가능한 backup인지 확인한다.

확인 항목:

- 최신 NAS backup 위치
- backup 생성 시각
- 파일 크기
- checksum
- restore 가능 여부
- restore 소요 시간
- restore 후 row count 일치 여부

주의:

- 0 byte backup은 사용 불가.
- backup 존재만으로는 충분하지 않다.
- restore 성공까지 확인해야 운영 migration 가능.

### 7-2. staging restore

전략:

1. 운영 snapshot을 staging DB에 restore
2. dry-run SQL 재실행
3. row count가 운영 dry-run 결과와 일치하는지 확인
4. orphan/duplicate 결과가 동일한지 확인
5. migration rehearsal은 staging에서만 실행

### 7-3. restore timing 기록

기록 항목:

| 항목 | 값 |
|---|---|
| backup file |
| backup size |
| restore started_at |
| restore completed_at |
| duration |
| target DB |
| row count match |
| errors |
| operator |

### 7-4. rollback simulation

simulation 항목:

- tenants/stores 생성 rollback
- nullable column 추가 rollback
- index 추가 rollback
- backfill rollback 또는 full restore
- unique key 변경 rollback
- application code rollback
- LINE webhook smoke test
- POS order smoke test
- repair workflow smoke test
- coupon approval smoke test

## 8. migration 안전 원칙

### 8-1. one-phase rollout 금지

금지:

- tenants/stores 생성
- store_id 추가
- backfill
- NOT NULL
- unique key 변경
- API scope 변경
- frontend 권한 변경

위 작업을 한 번에 운영 반영하지 않는다.

### 8-2. nullable -> backfill -> validate -> NOT NULL

순서:

1. nullable `tenant_id` / `store_id` 추가
2. seed tenant/store 생성
3. dry-run
4. backfill rehearsal
5. validation
6. application scope 적용
7. 추가 validation
8. `NOT NULL` 검토
9. unique key 재설계

### 8-3. production direct migration 금지

운영 DB 직접 migration 금지 조건:

- staging rehearsal 없음
- rollback rehearsal 없음
- backup restore 검증 없음
- BLOCKER 남아 있음
- LINE/POS/Repair/Coupon smoke test 없음
- 승인자 없음

## 9. 운영 승인 조건

운영 반영 전 모든 조건을 만족해야 한다.

| 조건 | 필요 상태 |
|---|---|
| BLOCKER | 0개 |
| orphan 처리 전략 | 승인 완료 |
| duplicate 처리 전략 | 승인 완료 |
| DB backup | 완료 |
| backup restore rehearsal | 성공 |
| rollback rehearsal | 성공 |
| staging migration rehearsal | 성공 |
| staging smoke test | 성공 |
| LINE flow 검증 | 완료 |
| POS flow 검증 | 완료 |
| Repair flow 검증 | 완료 |
| Coupon flow 검증 | 완료 |
| Purchase confirmation PDF 검증 | 완료 |
| 운영 window | 승인 |
| 명시적 production approval | 승인 |

## 10. 최종 원칙

- 운영 데이터는 자동 병합하지 않는다.
- ambiguity 발생 시 migration을 중단한다.
- production safety가 최우선이다.
- orphan row는 삭제하지 않고 먼저 격리/보고한다.
- used coupon과 구매확인서 PDF는 감사 이력으로 보존한다.
- LINE binding은 임의 변경하지 않는다.
- dry-run이 SAFE가 아니면 backfill하지 않는다.
- staging rehearsal 없이 production migration을 실행하지 않는다.
- rollback 불가능하면 production migration을 실행하지 않는다.
