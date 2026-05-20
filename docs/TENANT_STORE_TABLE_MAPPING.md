# Tenant / Store Table Mapping

## 1. 목적

multi-tenant 전환 전, KINGWAY DB의 각 테이블에 `tenant_id` / `store_id` 적용 필요 여부를 정리한다.

기준 자료:

- `docs/KINGWAY_STORE_MASTER_SPEC.md`
- `database/schema.sql`
- `backend/src/routes`
- `backend/src/services`

## 2. 적용 기준

- `tenant_id`: 독립 운영 주체 경계. 고객, 주문, 상품, LINE, 직원, 공급사, 정산 데이터 분리의 핵심 키.
- `store_id`: 같은 tenant 안의 실제 매장/지점 경계. 현재 KINGWAY 台南은 seed store.
- P0: multi-tenant 전환 전 반드시 필요
- P1: 1차 전환 직후 또는 지점 확장 전 필요
- P2: 통계/설정/보조 로그 성격으로 후순위 가능

기본 원칙:

- 기존 KINGWAY 台南 데이터는 모두 seed tenant/store에 귀속한다.
- 권장 seed tenant: `kingway`
- 권장 seed store: `kingway-tainan`
- 단일 매장 단계에서는 `tenant_id = kingway`, `store_id = kingway-tainan`으로 일괄 backfill한다.
- 실제 backfill 전에는 반드시 dry-run row count를 생성한다.
- 고객 phone / LINE userId는 절대 무조건 병합하지 않는다.

## 3. 테이블별 매핑

| 테이블명 | 현재 역할 | store_id | tenant_id | 우선순위 | 주의사항 |
|---|---|---:|---:|---|---|
| `staff_users` | 직원 계정, 역할, LINE userId | 필요 | 필요 | P0 | 현재 `username`, `line_user_id`가 전역 unique. tenant/store 기준 unique 재검토 필요. 장기적으로 `user_tenants`/`user_stores` 분리 가능. |
| `customers` | CRM 고객, 전화번호, LINE binding | 필요 | 필요 | P0 | phone/LINE userId unique는 tenant 범위로 바꿔야 함. 기존 고객 병합 금지. seed store는 최초 유입 매장으로 귀속. |
| `products` | 상품, SKU, 카테고리, 재고 수량 | 필요 | 필요 | P0 | SKU unique는 store 또는 tenant 범위로 변경 필요. 카테고리 visible label은 zh-TW 유지. 상품 사진 경로도 store/tenant 분리 필요. |
| `orders` | POS/LINE 주문, 예약금/잔금, 구매확인 흐름 | 필요 | 필요 | P0 | 주문번호 unique 범위 재설계 필요. 고객/직원/수리/구매확인/쿠폰 join 모두 tenant scope 필수. |
| `order_items` | 주문 품목 snapshot, 수리분류 기준 | 파생 가능 | 필요 | P0 | `order_id`로 store 파생 가능하지만 query scope 안전성을 위해 tenant_id 권장. REPAIR 품목 포함 시 수리 주문 규칙 유지. |
| `inventory_movements` | 입출고/판매/조정/발주 입고 이력 | 필요 | 필요 | P0 | `product_id`, `created_by`, `reference_type/id` 모두 tenant/store 일치 검증 필요. |
| `line_group_registrations` | LINE group/room 등록, admin/staff/repair/inventory/daily | 필요 | 필요 | P0 | LINE group id unique는 tenant 범위로 검토. webhook tenant resolution 핵심 테이블. |
| `purchase_confirmations` | 구매확인서, 서명, PDF path | 필요 | 필요 | P0 | PDF 경로 tenant/store 분리 필수. order/customer와 같은 tenant인지 검증 필요. |
| `purchase_confirmation_tokens` | 구매확인 public token | 필요 | 필요 | P0 | token은 tenant-bound signed token 권장. public 조회도 tenant 누출 방지 필요. |
| `repair_orders` | 수리예약/견적/완료/수령 workflow | 필요 | 필요 | P0 | LINE 예약, staff 승인, 견적, 완료 알림 모두 tenant scope 필수. `order_id` 연결 시 같은 tenant 검증. |
| `repair_logs` | 수리 상태 변경 로그 | 파생 가능 | 필요 | P0 | `repair_order_id`로 store 파생 가능하지만 audit 성격상 tenant_id 권장. |
| `coupons` | 신규친구/Google 리뷰 쿠폰 | 필요 | 필요 | P0 | 1인 1회 규칙은 tenant 기준. Google 리뷰 쿠폰은 자동발급 금지, 승인 직원 tenant 일치 필요. |
| `surveys` | 고객 설문 결과 | 필요 | 필요 | P1 | 현재 `order_id` 중심. 수리 설문까지 확장 시 repair/store 연결 명확화 필요. |
| `staff_attendance` | 출근/퇴근 | 필요 | 필요 | P0 | 직원의 근무 store 기준 필요. LINE check-in도 tenant/store resolution 필요. |
| `staff_kpi_logs` | KPI 점수 로그 | 필요 | 필요 | P0 | `ref_type/ref_id`가 polymorphic이므로 tenant_id 없으면 cross-tenant 누출 위험. |
| `app_settings` | STORE/SYSTEM 설정 JSON | 필요 | 필요 | P0 | 현재 `setting_scope`가 PK라 multi-tenant 불가. `(tenant_id, store_id, setting_scope)` 구조 필요. |
| `purchase_confirmation_requests` | 구매확인 요청 상태 legacy/보조 테이블 | 필요 | 필요 | P1 | `order_id`가 VARCHAR라 실제 orders FK와 불일치. 유지 여부 먼저 확인 필요. |
| `customer_crm_events` | CRM event/history | 필요 | 필요 | P0 | customer 기준 파생 가능하지만 고객관리 핵심 히스토리라 tenant_id 직접 보유 권장. |
| `follow_up_tasks` | 3/7/14일 follow-up 및 수동 추적 | 필요 | 필요 | P0 | LINE 발송 대상 고객과 staff가 같은 tenant/store인지 검증 필요. |
| `supplier_requests` | 발주/반품 요청 header | 필요 | 필요 | P0 | 공급사 LINE/Telegram 알림과 정산 기준. supplier_name 문자열만 있으므로 추후 suppliers 테이블 분리 고려. |
| `supplier_request_items` | 발주/반품 품목 | 파생 가능 | 필요 | P0 | request/product tenant 일치 검증 필요. 입고 시 inventory movement도 같은 tenant/store로 기록. |
| `operational_checklists` | 직원 일일 체크리스트 | 필요 | 필요 | P1 | staff_user 기준 파생 가능하지만 매장별 daily ops라 store_id 권장. unique key에 store 범위 필요. |
| `v2_workflow_events` | LINE/업무 이벤트 로그 | 필요 | 필요 | P0 | polymorphic `ref_type/ref_id` 로그라 tenant_id 필수. 알림/audit 추적 기준. |
| `line_chat_sessions` | LINE 대화 flow 세션 | 필요 | 필요 | P0 | 현재 `line_user_id + flow_type` unique. tenant/channel별 분리 필요. phone binding/repair flow 누출 방지. |

## 4. 영역별 핵심 판단

### 고객 / CRM

P0 테이블:

- `customers`
- `customer_crm_events`
- `follow_up_tasks`
- `line_chat_sessions`

주의:

- 기존 KINGWAY 台南 고객은 seed store로 귀속.
- phone, LINE userId는 tenant 범위 unique로 전환.
- cross-tenant 고객 공유는 별도 승인 전까지 금지.

### 주문 / 구매확인

P0 테이블:

- `orders`
- `order_items`
- `purchase_confirmations`
- `purchase_confirmation_tokens`
- `coupons`

주의:

- EBIKE 구매확인서 PDF는 tenant/store별 파일 경로로 분리.
- 예약금/잔금/완납 상태는 tenant scope에서만 조회.
- 구매확인은 완납 후 시작한다.

### 수리

P0 테이블:

- `repair_orders`
- `repair_logs`
- `orders`
- `order_items`

주의:

- `order_items.product_category_snapshot = REPAIR`가 하나라도 있으면 수리 주문.
- 수리관리 조회도 tenant/store scope 필수.
- LINE 예약/견적/완료/설문 flow token은 tenant-bound여야 한다.

### 상품 / 재고 / 공급사

P0 테이블:

- `products`
- `inventory_movements`
- `supplier_requests`
- `supplier_request_items`

주의:

- SKU unique는 tenant/store 범위로 변경.
- 발주/반품/입고는 products stock과 같은 tenant/store만 수정.
- supplier 정산은 tenant/store별 기본 조회.

### 직원 / 출근 / KPI / payroll

P0 테이블:

- `staff_users`
- `staff_attendance`
- `staff_kpi_logs`

P1 테이블:

- `operational_checklists`

주의:

- payroll summary는 `staff_users + staff_attendance` 기반.
- staff role은 tenant/store context 안에서 해석해야 한다.
- 같은 직원이 여러 store에 속할 가능성은 별도 join table로 확장 가능.

### LINE / Telegram 관련

P0 테이블:

- `line_group_registrations`
- `line_chat_sessions`
- `v2_workflow_events`

주의:

- master spec 기준은 LINE-first.
- 현재 코드에는 Telegram route/service가 남아 있으므로 multi-tenant 전환 시 Telegram 관련 알림도 tenant/store scope 없이는 위험하다.
- Telegram 관련 새 workflow 추가는 금지. 기존 잔존 기능은 별도 승인 없이 확장하지 않는다.

## 5. Seed Store 귀속 원칙

기존 KINGWAY 台南 데이터는 다음 원칙으로 귀속한다.

- 모든 기존 operational row는 seed tenant/store에 귀속.
- seed tenant: `kingway`
- seed store: `kingway-tainan`
- store display name: `KINGWAY 台南`
- locale: `zh-TW`
- timezone: `Asia/Taipei`
- currency: `TWD`

Backfill 전 dry-run에서 최소 확인:

- 각 테이블 row count
- 고객 수, LINE binding 수
- 주문 수, 주문품목 수
- REPAIR 포함 주문 수
- 수리공單 수
- 쿠폰 수
- 구매확인서/PDF 수
- 상품/재고이력 수
- 직원/출근/KPI 수
- LINE group/session/workflow event 수
- 공급사 요청/품목 수

## 6. 1차 적용 권장 순서

1. seed tenant/store 정의 문서화
2. P0 테이블에 nullable `tenant_id`, `store_id` 설계
3. dry-run count 작성
4. 기존 row를 `kingway` / `kingway-tainan`으로 backfill
5. 주요 query에 tenant/store scope 적용
6. unique key를 tenant/store 범위로 재설계
7. LINE webhook/session/token을 tenant-bound로 변경
8. P1/P2 테이블 확장
9. `tenant_id`, `store_id` non-null 전환은 검증 후 진행
