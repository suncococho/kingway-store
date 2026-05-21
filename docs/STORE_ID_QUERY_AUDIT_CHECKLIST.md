# STORE_ID Query Audit Checklist

## 1. 목적

store_id 기반 SaaS 전환 전에 backend query를 점검하여 다음 위험을 방지한다.

- `store_id` 없는 query로 인한 cross-store data leakage 방지
- migration 전 코드 검색 및 검토 기준 수립
- multi-store 오픈 전 API scope 누락 여부 확인

## 2. 반드시 점검할 Backend Route 파일 후보

다음 파일은 우선 점검 대상이다.

- `backend/src/routes/customers.js`
- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`
- `backend/src/routes/products.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/lineOrder.js`
- `backend/src/routes/telegram.js`
- `backend/src/routes/suppliers.js`
- `backend/src/routes/inventory.js`
- `backend/src/routes/staff.js`

## 3. 점검 대상 Query 패턴

다음 패턴은 반드시 검색하고, `store_id` scope가 적용되는지 검토한다.

- `SELECT * FROM customers`
- `SELECT * FROM orders`
- `SELECT * FROM products`
- `UPDATE` without `store_id`
- `DELETE` without `store_id`
- `INSERT` without `store_id`
- `JOIN customers/orders/repair_orders` without `store_id`
- `COUNT/SUM` dashboard queries without `store_id`

## 4. 위험 API 유형

다음 API 유형은 cross-store data leakage 또는 권한 우회 위험이 높다.

- 고객 조회
- 주문 조회
- 수리 조회
- 상품 조회
- 재고 변경
- 쿠폰 발급
- LINE user binding
- Telegram approval callback
- dashboard statistics
- staff payroll/KPI

## 5. store_id Scope 원칙

store_id scope는 API 내부에서 명확히 확정되어야 한다.

- request context에서 `store_id` 확정
- staff 권한과 `store_id` 매칭
- super admin만 `store_id` 선택 가능
- 일반 staff는 자기 `store_id`만 접근
- LINE/Telegram callback도 `store_id` 확인 필요

## 6. 테스트 기준

store_id migration 전후로 다음 기준을 검증한다.

- A매장 로그인 시 B매장 데이터 조회 불가
- API 직접 호출로도 B매장 데이터 접근 불가
- dashboard count가 store별로 분리
- product SKU가 store별로 분리 가능
- customer phone/LINE 정책 결정 후 테스트

## 7. High-risk Unique Key

다음 unique key 또는 사실상 unique로 취급되는 값은 store별 분리 정책을 반드시 검토한다.

- `products.sku`
- `customers.line_user_id`
- `customers.phone`
- `coupons.code`
- `orders.order_no`

## 8. Audit Command 예시

```sh
grep -R "SELECT .*customers" -n backend/src
grep -R "UPDATE .*orders" -n backend/src
grep -R "DELETE .*products" -n backend/src
grep -R "COUNT\|SUM" -n backend/src/routes
```

## 9. 판정 기준

각 query 또는 API는 다음 기준으로 판정한다.

### PASS

- `store_id` scope가 명확히 적용되어 있음
- 권한 context와 `store_id`가 일치함
- 직접 API 호출 시에도 타 매장 데이터 접근이 불가능함

### PASS WITH WARNING

- 현재 단일 매장 환경에서는 동작하지만 SaaS 전환 전 보완 필요
- query 자체는 안전해 보이나 request context 또는 callback source 확인이 불명확함
- unique key 정책이 아직 확정되지 않아 후속 결정 필요

### BLOCKER

- `store_id` 없이 고객/주문/수리/상품/재고/쿠폰/직원 데이터를 조회 또는 변경함
- UI에서만 숨기고 API scope가 없음
- 일반 staff가 다른 매장 데이터를 선택 또는 접근할 수 있음
- LINE/Telegram callback에서 store 식별이 불가능하거나 검증되지 않음
- migration 전 반드시 수정해야 하는 cross-store leakage 가능성이 있음

## 10. 절대 금지

다음 작업은 금지한다.

- query audit 없이 `store_id` migration 진행
- `store_id` 없는 bulk update
- UI 숨김만으로 보안 처리
- API scope 없이 multi-store 오픈
