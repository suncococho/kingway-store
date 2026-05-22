# Store ID Query Audit Result - 2026-05-21

## 1. 실행 정보

- date: 2026-05-21
- branch: beta/staging-architecture
- scope: backend/src read-only grep audit

## 2. 확인 결과 요약

- 현재 핵심 business query는 single-tenant 기준으로 작성되어 있음.
- customers / orders / products / repairs 관련 query에 `store_id` scope가 없음.
- multi-store 전환 전 API query scope 보강이 필요함.

## 3. High-risk Files

- `backend/src/routes/dashboard.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/orders.js`
- `backend/src/routes/products.js`
- `backend/src/routes/inventory.js`
- `backend/src/routes/suppliers.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/line.js`
- `backend/src/routes/customerStatus.js`
- `backend/src/routes/orderItemsEdit.js`

## 4. High-risk Query Categories

- customer search without `store_id`
- order list / detail / update / delete without `store_id`
- product stock update without `store_id`
- dashboard `COUNT` / `SUM` without `store_id`
- repair / customer / order joins without `store_id`
- LINE customer binding without `store_id`
- Telegram / supplier stock callbacks without `store_id`

## 5. Examples from Grep Result

- `dashboard.js`
  - `COUNT(*) FROM customers`
  - `COUNT(*) FROM orders`
  - `COUNT(*) FROM products`
  - `SUM(total_amount) FROM orders`

- `customers.js`
  - subqueries using `COUNT` against `orders`
  - subqueries using `COUNT` against `repair_orders`

- `orders.js`
  - `UPDATE orders`
  - `DELETE FROM orders`

- `inventory.js`
  - `UPDATE products SET stock`

- `suppliers.js`
  - `UPDATE products SET stock`

- `purchaseConfirmations.js`
  - `FROM customers`
  - `FROM orders`

- `customerStatus.js`
  - customer search by phone / name

## 6. Risk Assessment

- Current production single-store usage is acceptable.
- Multi-store exposure without query scope would be a BLOCKER.
- `store_id` migration must not proceed to production until query scope is implemented and tested.

## 7. Next Steps

- Create API scope strategy document.
- Define request store context.
- Define staff store permission model.
- Plan staged route-by-route refactor.
- Keep staging environment for rehearsal.

## 8. Final Status

- PASS for discovery.
- BLOCKER for multi-store production rollout until scope is implemented.
