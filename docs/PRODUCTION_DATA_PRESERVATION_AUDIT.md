# Production Data Preservation Audit

작성일: 2026-06-04  
기준 문서: `docs/PRODUCTION_DATA_PRESERVATION_MIGRATION_PLAN.md`  
대상 DB: production `127.0.0.1:3306`, staging `127.0.0.1:3310`  
실행 원칙: read-only audit only, `SELECT` / `SHOW`만 사용, 코드 수정 없음, DB 수정 없음, 배포 없음

## 1. Audit 범위

이번 audit에서 확인한 항목:

1. production `3306` 주요 테이블 row count
2. production `3306` 주요 테이블 `store_id` 컬럼 존재 여부
3. staging `3310` 동일 테이블 `store_id` 컬럼 존재 여부
4. production에 아직 없는 SaaS 테이블 목록
5. migration 시 위험한 컬럼 / unique / foreign key 제약
6. 파일 / uploads 백업 필요 경로
7. production `3000` / `5173` 현재 health

## 2. 실행 금지 항목

이번 audit에서는 아래 작업을 하지 않았다.

- `INSERT`
- `UPDATE`
- `DELETE`
- `DROP`
- `TRUNCATE`
- schema 변경
- 데이터 backfill
- 배포 / 재기동
- staging DB를 production DB에 import

## 3. 접속 확인

### 3-1. production DB

- 접속 대상: `127.0.0.1:3306`
- DB명: `kingway_store`
- 확인 결과: `DATABASE() = kingway_store`
- DB hostname: `e7c611430306`
- DB 내부 port: `3306`

### 3-2. staging DB

- 접속 대상: `127.0.0.1:3310`
- DB명: `kingway_store`
- 확인 결과: `DATABASE() = kingway_store`
- DB hostname: `539dc44be02d`
- DB 내부 port: `3306`

판단:

- production과 staging은 서로 다른 DB 컨테이너로 응답했다.
- 따라서 이번 비교는 production `3306` 대 staging `3310` 기준으로 유효하다.

## 4. Production Row Count

production `3306`에서 read-only로 확인한 주요 테이블 row count:

| 테이블 | row count |
|---|---:|
| `customers` | 145 |
| `products` | 384 |
| `orders` | 72 |
| `order_items` | 170 |
| `repair_orders` | 20 |
| `purchase_confirmations` | 20 |
| `coupons` | 30 |

해석:

- production은 이미 실운영 데이터가 누적된 상태다.
- 따라서 migration 기준 데이터는 staging이 아니라 production `3306`이어야 한다.

## 5. Production `store_id` Schema Gap

### 5-1. production 주요 테이블 `store_id` 존재 여부

| 테이블 | `store_id` 존재 여부 |
|---|---|
| `customers` | NO |
| `products` | NO |
| `orders` | NO |
| `order_items` | NO |
| `repair_orders` | NO |
| `purchase_confirmations` | NO |
| `coupons` | NO |

결론:

- 이번 audit 대상 주요 운영 테이블 7개는 production `3306`에 아직 `store_id`가 없다.
- `PRODUCTION_DATA_PRESERVATION_MIGRATION_PLAN` 기준으로 이 테이블들은 모두 `store_id=1` backfill 대상이다.

### 5-2. backfill 필요 핵심 테이블

production에서 `store_id=1 / KINGWAY_TAINAN` backfill이 필요한 핵심 운영 테이블:

- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`
- `coupons`

추가로 active code 및 기존 계획 문서 기준 후속 검토 필요:

- `staff_users`
- `inventory_movements`
- `supplier_requests`

보조 범위에서 추가 검토 필요:

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

참고:

- production에서 위 보조 범위 중 이번 샘플 확인 목록에서는 `app_settings`만 `store_id`가 이미 존재했다.

## 6. Staging Schema Reference

staging `3310` 동일 테이블 `store_id` 존재 여부:

| 테이블 | staging `store_id` 존재 여부 |
|---|---|
| `customers` | YES |
| `products` | YES |
| `orders` | YES |
| `order_items` | YES |
| `repair_orders` | YES |
| `purchase_confirmations` | YES |
| `coupons` | YES |

해석:

- staging은 이미 `store_id` 스키마를 가진 reference 환경이다.
- 하지만 staging은 구조 reference / rehearsal 용도일 뿐, production 원본 데이터 대체 용도가 아니다.
- 따라서 production migration은 “staging 데이터 import”가 아니라 “production 원본 유지 + production schema 확장 + production row backfill” 방식이어야 한다.

## 7. Production에 없는 SaaS 신규 테이블

요청된 SaaS 테이블의 production 존재 여부:

| 테이블 | production 상태 | staging 상태 |
|---|---|---|
| `stores` | MISSING | PRESENT |
| `store_features` | MISSING | PRESENT |
| `store_line_settings` | MISSING | PRESENT |
| `platform_admin_users` | MISSING | PRESENT |
| `store_memberships` | MISSING | PRESENT |

정리:

- production에는 위 5개 SaaS 테이블이 아직 없다.
- staging에는 모두 존재한다.
- 따라서 production cutover 전, 위 5개 테이블은 신규 생성 대상이다.

## 8. Migration 시 위험한 컬럼 / 제약조건

이번 audit에서 production schema 기준으로 확인된 대표 위험 요소는 아래와 같다.

### 8-1. 전역 unique 제약

현재 production에는 store scope 없이 전역 unique가 걸린 컬럼이 존재한다.

| 테이블 | unique / key | 위험 |
|---|---|---|
| `customers` | `UNIQUE(line_user_id)` | 매장별 분리 전에는 타 매장 동일 LINE userId 수용 불가 |
| `staff_users` | `UNIQUE(username)` | 매장별 동일 username 전략과 충돌 가능 |
| `staff_users` | `UNIQUE(line_user_id)` | 다점포 staff LINE binding과 충돌 가능 |
| `products` | `UNIQUE(sku)` | store별 SKU 체계 도입 시 충돌 가능 |
| `orders` | `UNIQUE(order_no)` | store별 order number namespace 분리 전 충돌 가능 |
| `coupons` | `UNIQUE(code)` | 향후 store-aware coupon code 정책 설계 필요 |
| `purchase_confirmations` | `UNIQUE(token)` | token 자체는 전역 unique 유지 가능하나 store ownership 컬럼 추가 필요 |

판단:

- 1차 migration에서는 이 unique들을 즉시 갈아엎기보다, 먼저 `store_id` nullable 추가와 `store_id=1` backfill을 완료하는 것이 안전하다.
- unique 재설계는 후속 phase로 분리하는 것이 보수적이다.

### 8-2. foreign key가 `store_id` 없이 기존 ID 관계만 강제

production 핵심 FK:

| 자식 테이블 | 컬럼 | 부모 테이블 | 위험 |
|---|---|---|---|
| `orders` | `customer_id` | `customers` | 향후 동일 id 다른 store 개념이 아니라도 row ownership 정합 검증이 별도 필요 |
| `orders` | `created_by` | `staff_users` | staff와 order의 store ownership 일치 검증 필요 |
| `order_items` | `order_id` | `orders` | parent order와 child item의 `store_id` 동기화 필요 |
| `order_items` | `product_id` | `products` | order item과 product의 store mismatch 방지 필요 |
| `repair_orders` | `customer_id` | `customers` | repair와 customer의 store 일치 검증 필요 |
| `repair_orders` | `approved_by_staff_id` | `staff_users` | staff ownership 일치 검증 필요 |
| `purchase_confirmations` | `order_id` | `orders` | purchase confirmation과 order store 일치 검증 필요 |
| `purchase_confirmations` | `customer_id` | `customers` | confirmation과 customer store 일치 검증 필요 |
| `coupons` | `customer_id` | `customers` | coupon과 customer store 일치 검증 필요 |
| `coupons` | `order_id` | `orders` | coupon과 order store 일치 검증 필요 |
| `coupons` | `approved_by_staff_id` | `staff_users` | approver store 일치 검증 필요 |

판단:

- 현재 FK는 “row exists”만 보장한다.
- migration 후에는 `store_id` mismatch row를 따로 검증해야 한다.
- 따라서 backfill 후 검증 SQL이 필수다.

### 8-3. 파일 경로 관련 컬럼

`purchase_confirmations`의 `pdf_path`는 운영 파일 보존과 직접 연결된다.

read-only 확인 결과:

- total `purchase_confirmations`: `20`
- `pdf_path` missing: `9`
- sample `pdf_path`: `/files/pdfs/purchase-confirmation-11.pdf`

판단:

- 구매확인 PDF는 DB row뿐 아니라 실제 파일까지 함께 백업해야 한다.
- 일부 row는 `pdf_path`가 비어 있으므로, “DB row count = 실제 파일 count”라고 가정하면 안 된다.

## 9. 파일 / uploads 백업 대상

코드와 워크트리에서 확인된 실제 백업 필요 경로:

### 9-1. 필수

- `backend/uploads`
- `backend/storage/pdfs`

근거:

- `README.md`, `SYSTEM_ARCHITECTURE.md`에 purchase confirmation PDF가 `backend/storage/pdfs` 아래 기록된다고 명시됨
- 실제 파일 존재 확인:
  - `backend/storage/pdfs/purchase-confirmation-...pdf`
- staging env 예시는 `/app/uploads`, `/app/uploads/purchase-confirmations`를 사용하지만, 현재 repo의 실제 production 보존 관점에서는 `backend/storage/pdfs`도 별도 백업 대상이다.

### 9-2. 운영 참고

- `frontend/dist`는 정적 build artifact이며 데이터 원본은 아니다.
- migration readiness 관점의 “실데이터 백업” 대상은 파일 업로드 및 PDF 산출물 쪽이 우선이다.

권장 백업 범위:

1. DB dump
2. `backend/uploads`
3. `backend/storage/pdfs`
4. production `.env`
5. production 배포 commit hash

## 10. Production Runtime Health

### 10-1. backend `3000`

`curl http://127.0.0.1:3000/health`

- 결과: `HTTP/1.1 200 OK`
- body: `{"ok":true}`

판단:

- production backend는 현재 health endpoint 기준 정상 응답 중이다.

### 10-2. frontend `5173`

`curl http://127.0.0.1:5173/`

- 결과: `HTTP/1.1 200 OK`
- nginx 응답 확인
- `frontend/dist` 정적 페이지 응답 확인

판단:

- production frontend `5173`도 현재 정상 응답 중이다.

주의:

- 본 audit는 public reverse proxy 연결 상태까지 판정하지는 않는다.
- 여기서는 로컬 production runtime port `3000` / `5173`의 직접 응답만 확인했다.

## 11. Production Schema Gap 요약

production 기준 핵심 gap:

1. 주요 운영 테이블 7개에 `store_id` 없음
2. 요청된 SaaS 테이블 5개 모두 없음
3. 다수 전역 unique가 아직 store-aware 구조가 아님
4. foreign key는 존재하지만 `store_id` ownership 검증은 없음
5. purchase confirmation PDF는 DB + 파일 동시 보존 필요

## 12. Migration Readiness 판정

### 12-1. 가능한 것

- production `3306`을 기준 데이터로 사용하는 migration 준비
- `stores` 및 SaaS 테이블 신규 생성 준비
- 핵심 테이블 nullable `store_id` 추가 준비
- 기존 production row를 `store_id=1 / KINGWAY_TAINAN`으로 backfill하는 계획 수립
- post-backfill mismatch 검증 SQL 준비

### 12-2. 아직 바로 하면 위험한 것

- staging DB를 production에 덮어쓰기
- 전역 unique를 한 번에 재설계
- `store_id`를 곧바로 `NOT NULL`로 강제
- code cutover와 schema migration을 한 번에 처리
- 파일 백업 없이 purchase confirmation 관련 migration 진행

### 12-3. readiness 판정

판정: `조건부 진행 가능`

이유:

- production 실데이터는 충분히 존재하고 row count가 확인되었다.
- staging은 schema reference로 활용 가능하다.
- 그러나 production에는 핵심 `store_id` 컬럼과 SaaS 테이블이 아직 없고, 전역 unique / FK 정합 검토가 남아 있다.

따라서 다음 순서가 필요하다.

1. production full backup
2. 파일 백업(`backend/uploads`, `backend/storage/pdfs`)
3. production 전용 schema-only migration SQL 확정
4. nullable `store_id` 추가
5. `store_id=1 / KINGWAY_TAINAN` backfill
6. mismatch 검증
7. runtime smoke test

## 13. 최종 결론

이번 audit 결과, production `3306`은 실제 운영 원본으로 사용 가능한 기준 데이터이며 staging으로 절대 대체하면 안 된다.

핵심 사실:

- production row count:
  - `customers=145`
  - `products=384`
  - `orders=72`
  - `order_items=170`
  - `repair_orders=20`
  - `purchase_confirmations=20`
  - `coupons=30`
- production 주요 운영 테이블 7개에는 아직 `store_id`가 없다.
- staging 동일 테이블에는 `store_id`가 있다.
- production에는 `stores`, `store_features`, `store_line_settings`, `platform_admin_users`, `store_memberships`가 아직 없다.
- 파일 백업은 DB dump만으로 충분하지 않고 `backend/uploads`와 `backend/storage/pdfs`를 포함해야 한다.

정리하면, migration 방향은 다음으로 고정하는 것이 타당하다.

- production 원본 보존
- staging overwrite 금지
- `store_id=1 / KINGWAY_TAINAN` seed mapping
- schema-only 선행
- 보수적 backfill
- 사후 검증 후 runtime cutover 판단
