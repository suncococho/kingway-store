# Tenant / Store Dry-Run Result Template

## 1. 실행 정보

| 항목 | 값 |
|---|---|
| 실행 날짜 |  |
| 실행자 |  |
| 서버 |  |
| 대상 DB |  |
| branch | `beta/staging-architecture` |
| git commit hash |  |
| backup 파일 위치 |  |
| dry-run SQL 문서 | `docs/TENANT_STORE_DRY_RUN_SQL.md` |
| dry-run plan 문서 | `docs/TENANT_STORE_DRY_RUN_PLAN.md` |

주의:

- backup 파일 위치는 실제 운영 반영 전 필수로 기록한다.
- 운영 DB에서 실행한 경우 반드시 read-only 여부와 실행 계정을 기록한다.
- 개인정보가 포함된 결과는 masking한다.

## 2. dry-run 실행 원칙

이번 dry-run은 아래 원칙을 따른다.

- SELECT-only
- 운영 DB 변경 금지
- `ALTER` 금지
- `UPDATE` 금지
- `DELETE` 금지
- `DROP` 금지
- `CREATE INDEX` 금지
- `INSERT` 금지
- migration 실행 금지
- docker-compose 수정 금지
- 서버 재시작 금지

실행 확인:

| 항목 | 결과 | 메모 |
|---|---|---|
| SELECT-only로 실행했는가 |  |  |
| 운영 DB 변경이 없었는가 |  |  |
| ALTER/UPDATE/DELETE를 실행하지 않았는가 |  |  |
| migration을 실행하지 않았는가 |  |  |
| read-only 계정 또는 read-only transaction을 사용했는가 |  |  |

## 3. 테이블별 row count 기록

### 3-1. 고객 / 주문 / 수리 / 상품

| 테이블 | row_count | 비고 |
|---|---:|---|
| `customers` |  |  |
| `orders` |  |  |
| `order_items` |  |  |
| `repair_orders` |  |  |
| `products` |  |  |
| `inventory_movements` |  |  |
| `coupons` |  |  |
| `purchase_confirmations` |  |  |

### 3-2. attendance / payroll / KPI

| 테이블 | row_count | 비고 |
|---|---:|---|
| `staff_users` |  |  |
| `staff_attendance` |  |  |
| `staff_kpi_logs` |  |  |
| payroll summary source: `staff_users + staff_attendance` |  | 별도 payroll table 없음 |
| `operational_checklists` |  |  |

### 3-3. suppliers

| 테이블 | row_count | 비고 |
|---|---:|---|
| `supplier_requests` |  |  |
| `supplier_request_items` |  |  |
| suppliers master table | N/A | 현재 별도 `suppliers` 테이블 없음 |

### 3-4. LINE / Telegram 관련

| 테이블 / 영역 | row_count | 비고 |
|---|---:|---|
| `line_group_registrations` |  | LINE group/room 등록 |
| `line_chat_sessions` |  | LINE flow session |
| `v2_workflow_events` |  | workflow/audit event |
| Telegram route/service legacy usage |  | 별도 테이블 없음. 관련 흐름만 메모 |

### 3-5. 기타 운영 히스토리

| 테이블 | row_count | 비고 |
|---|---:|---|
| `purchase_confirmation_tokens` |  |  |
| `repair_logs` |  |  |
| `surveys` |  |  |
| `app_settings` |  |  |
| `purchase_confirmation_requests` |  | legacy/보조 |
| `customer_crm_events` |  |  |
| `follow_up_tasks` |  |  |

## 4. duplicate 검증 기록

### 4-1. phone duplicates

| 항목 | 값 |
|---|---:|
| duplicate group count |  |
| affected customer rows |  |
| normalized phone duplicate group count |  |
| normalized affected customer rows |  |

메모:

- phone 전체값은 기록하지 않는다.
- 필요한 경우 `0912****78` 형태로 masking한다.
- 고객 병합은 이 단계에서 수행하지 않는다.

### 4-2. order_no duplicates

| 항목 | 값 |
|---|---:|
| duplicate group count |  |
| affected order rows |  |
| missing / empty order_no count |  |

주문번호 prefix 분포:

| prefix | count | 비고 |
|---|---:|---|
| POS |  |  |
| LINE |  |  |
| ORD |  |  |
| REP |  |  |
| OTHER |  |  |

### 4-3. LINE user duplicates

| 항목 | 값 |
|---|---:|
| duplicate customers.line_user_id group count |  |
| affected customer rows |  |
| duplicate staff_users.line_user_id group count |  |
| affected staff rows |  |
| customer/staff shared LINE userId count |  |
| duplicate line_chat_sessions user/flow count |  |
| duplicate line_group_registrations group count |  |

메모:

- LINE userId 전체값은 masking한다.
- customer/staff 공유 사례는 권한 및 알림 혼선 위험으로 별도 확인한다.

### 4-4. coupon issue duplicates

| 항목 | 값 |
|---|---:|
| customer + coupon_type duplicate group count |  |
| affected coupon rows |  |
| duplicate coupon code group count |  |
| affected coupon code rows |  |
| new_friend duplicate customer count |  |
| google_review duplicate customer count |  |

coupon type/status 분포:

| coupon_type | status | is_used | count |
|---|---|---:|---:|
| new_friend |  |  |  |
| google_review |  |  |  |

메모:

- 신규친구 쿠폰은 NT$500, 1인 1회.
- Google 리뷰 쿠폰은 NT$1500, 직원 수동 승인, 1인 1회.
- 이 단계에서 쿠폰을 자동 수정하지 않는다.

## 5. orphan / NULL 검증 기록

### 5-1. orphan summary

| 관계 | orphan_count | risk level | 메모 |
|---|---:|---|---|
| `orders.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `orders.created_by -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `order_items.order_id -> orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `order_items.product_id -> products.id` |  | SAFE / WARNING / BLOCKER |  |
| `repair_orders.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `repair_orders.approved_by_staff_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `repair_logs.repair_order_id -> repair_orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `coupons.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `coupons.order_id -> orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `coupons.approved_by_staff_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `purchase_confirmations.order_id -> orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `purchase_confirmations.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `purchase_confirmation_tokens.order_id -> orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `purchase_confirmation_tokens.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `inventory_movements.product_id -> products.id` |  | SAFE / WARNING / BLOCKER |  |
| `inventory_movements.created_by -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `staff_attendance.staff_user_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `staff_kpi_logs.staff_user_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `supplier_requests.requested_by_staff_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |
| `supplier_request_items.supplier_request_id -> supplier_requests.id` |  | SAFE / WARNING / BLOCKER |  |
| `supplier_request_items.product_id -> products.id` |  | SAFE / WARNING / BLOCKER |  |
| `surveys.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `surveys.order_id -> orders.id` |  | SAFE / WARNING / BLOCKER |  |
| `customer_crm_events.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `follow_up_tasks.customer_id -> customers.id` |  | SAFE / WARNING / BLOCKER |  |
| `operational_checklists.staff_user_id -> staff_users.id` |  | SAFE / WARNING / BLOCKER |  |

### 5-2. NULL summary

| 테이블 | 컬럼 | null_count | 정상 NULL 가능 여부 | risk level | 메모 |
|---|---|---:|---|---|---|
| `customers` | `phone` |  | YES / NO |  | offline/no-phone 고객 가능 |
| `customers` | `line_user_id` |  | YES / NO |  | offline 고객 가능 |
| `orders` | `customer_id` |  | YES / NO |  | guest/offline 주문 여부 확인 |
| `orders` | `customer_phone` |  | YES / NO |  | OFFLINE_NO_PHONE 가능 |
| `orders` | `created_by` |  | YES / NO |  | 보통 필수 |
| `repair_orders` | `order_id` |  | YES / NO |  | 예약 단계에서는 NULL 가능 |
| `coupons` | `order_id` |  | YES / NO |  | 미사용 쿠폰 가능 |
| `coupons` | `approved_by_staff_id` |  | YES / NO |  | pending 가능 |
| `purchase_confirmations` | `order_id` |  | YES / NO |  | manual 여부 확인 |
| `purchase_confirmations` | `customer_id` |  | YES / NO |  | manual 여부 확인 |
| `purchase_confirmations` | `pdf_path` |  | YES / NO |  | pending 가능 |
| `staff_users` | `line_user_id` |  | YES / NO |  | LINE 미연동 직원 가능 |
| `line_chat_sessions` | `line_user_id` |  | YES / NO |  | 보통 필수 |

## 6. index 상태 기록

### 6-1. 현재 주요 unique/index 상태

| 테이블 | index_name | columns | unique 여부 | multi-tenant 재설계 필요 | 메모 |
|---|---|---|---|---|---|
| `staff_users` |  |  |  | YES / NO |  |
| `customers` |  |  |  | YES / NO |  |
| `products` |  |  |  | YES / NO |  |
| `orders` |  |  |  | YES / NO |  |
| `coupons` |  |  |  | YES / NO |  |
| `purchase_confirmations` |  |  |  | YES / NO |  |
| `purchase_confirmation_tokens` |  |  |  | YES / NO |  |
| `line_group_registrations` |  |  |  | YES / NO |  |
| `line_chat_sessions` |  |  |  | YES / NO |  |

### 6-2. unique key 재설계 메모

| 항목 | 현재 상태 | 권장 scope | 위험 | 메모 |
|---|---|---|---|---|
| `staff_users.username` |  | tenant |  |  |
| `staff_users.line_user_id` |  | tenant 또는 global |  |  |
| `customers.line_user_id` |  | tenant |  |  |
| `customers.phone` |  | store 또는 tenant |  | phone normalization 필요 |
| `products.sku` |  | store |  |  |
| `orders.order_no` |  | store |  |  |
| `coupons.code` |  | global 또는 store |  | 고객 입력 방식 확인 |
| `purchase_confirmation_tokens.token` |  | global |  | public token 보안 |
| `line_group_registrations.line_group_id` |  | tenant |  |  |
| `line_chat_sessions.line_user_id + flow_type` |  | store |  |  |

## 7. 위험 요소 및 메모

### 7-1. SAFE 항목

| 항목 | 근거 | 메모 |
|---|---|---|
|  |  |  |

### 7-2. WARNING 항목

| 항목 | 위험 | 필요한 후속 확인 |
|---|---|---|
|  |  |  |

### 7-3. BLOCKER 항목

| 항목 | 차단 사유 | 해결 전 금지 작업 |
|---|---|---|
|  |  |  |

### 7-4. 업무 흐름별 메모

| 영역 | 위험 수준 | 메모 |
|---|---|---|
| LINE onboarding / phone binding | SAFE / WARNING / BLOCKER |  |
| customer CRM | SAFE / WARNING / BLOCKER |  |
| POS orders | SAFE / WARNING / BLOCKER |  |
| repair workflow | SAFE / WARNING / BLOCKER |  |
| purchase confirmations / PDF | SAFE / WARNING / BLOCKER |  |
| coupons | SAFE / WARNING / BLOCKER |  |
| inventory movements | SAFE / WARNING / BLOCKER |  |
| supplier requests | SAFE / WARNING / BLOCKER |  |
| staff attendance / KPI / payroll | SAFE / WARNING / BLOCKER |  |
| Telegram legacy routes | SAFE / WARNING / BLOCKER |  |

## 8. rollback 준비 상태

| 항목 | 상태 | 메모 |
|---|---|---|
| DB backup 완료 여부 | YES / NO |  |
| DB backup 파일 위치 기록 | YES / NO |  |
| backup restore 테스트 완료 | YES / NO |  |
| Git snapshot 여부 | YES / NO |  |
| Git commit hash 기록 | YES / NO |  |
| rollback SQL 준비 여부 | YES / NO |  |
| rollback rehearsal 여부 | YES / NO |  |
| staging 테스트 완료 여부 | YES / NO |  |
| LINE webhook smoke test 준비 | YES / NO |  |
| POS 주문 smoke test 준비 | YES / NO |  |
| 수리 workflow smoke test 준비 | YES / NO |  |
| 쿠폰 발급/승인 smoke test 준비 | YES / NO |  |

## 9. 최종 판정

최종 판정은 아래 중 하나로 기록한다.

| 판정 | 의미 |
|---|---|
| SAFE | dry-run 기준으로 다음 migration 설계 단계 진행 가능 |
| WARNING | 진행은 가능하지만 특정 데이터/흐름의 추가 확인 필요 |
| BLOCKER | 해결 전 migration, backfill, 운영 반영 금지 |

최종 결과:

| 항목 | 값 |
|---|---|
| 최종 판정 | SAFE / WARNING / BLOCKER |
| 주요 근거 |  |
| migration 전 필수 조치 |  |
| backfill 전 필수 조치 |  |
| 운영 반영 전 필수 조치 |  |
| 승인자 |  |
| 승인일 |  |

## 10. 사용 제한 원칙

이 문서는 dry-run 결과 기록 템플릿이다.

절대 아래 용도로 사용하지 않는다.

- migration 승인서로 사용
- 운영 DB 반영 승인서로 사용
- backfill 승인서로 사용
- ALTER / UPDATE / DELETE 실행 근거로 사용
- 배포 승인 근거로 사용

운영 반영 전에는 별도 승인 문서와 다음 조건이 필요하다.

- DB full backup
- Git snapshot
- staging restore test
- migration rehearsal
- rollback rehearsal
- 주요 업무 flow smoke test
- 명시적 운영 반영 승인

최종 원칙:

- 이 문서는 관찰 결과 기록용이다.
- migration 승인 없이 운영 반영 기준으로 사용하지 않는다.
- SAFE 판정이어도 별도 migration 승인 없이는 DB를 변경하지 않는다.
