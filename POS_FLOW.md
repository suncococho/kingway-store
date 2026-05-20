# POS_FLOW

이 문서는 `frontend/src/pages/POSPage.jsx`, `backend/src/routes/orders.js`, `backend/src/routes/orderItemsEdit.js`, `backend/src/services/lineWorkflowService.js`를 기준으로 작성했습니다.

## Frontend

POS page:

- `frontend/src/pages/POSPage.jsx`

주요 API:

- `GET /api/products`
- `GET /api/customers`
- `POST /api/orders`

POS 화면에서 확인된 입력/기능:

- 상품 선택
- 고객 선택/입력
- 결제 방식
- 예약금/잔금 입력
- 주문 note
- 주문 생성

## Backend create order route

Route:

- `POST /api/orders`

File:

- `backend/src/routes/orders.js`

생성 흐름:

1. 요청 item 검증
2. customerId 또는 phone으로 고객 조회
3. 필요 시 고객 생성
4. orderNo 생성
5. `orders` row insert
6. `order_items` insert
7. 상품 stock 차감
8. `inventory_movements`에 `SALE` 기록
9. KPI/workflow event 기록
10. LINE 고객이면 주문/구매확인 알림 전송 시도

## Order number

`POST /api/orders`에서 생성되는 order number:

```text
POS-YYYYMMDD-HHmmss-SSS
```

LINE self-order는 별도 route에서 다음 prefix를 사용합니다.

```text
LINE-...
```

## Created order defaults

`POST /api/orders`에서 확인된 주요 값:

- `order_type = GENERAL`
- `status = COMPLETED`
- `payment_method`: request 값
- `is_reservation_order`: request/잔금 상태 기반
- `deposit_amount`: request 값
- `unpaid_balance`: request 값 또는 계산값
- `final_payment_status`: request 값 또는 계산값
- `final_paid_at`: `PAID`면 설정

## Order items

`order_items` 저장 값:

- `order_id`
- `product_id`
- `product_sku_snapshot`
- `product_name_snapshot`
- `product_category_snapshot`
- `unit_price`
- `quantity`
- `subtotal`

상품 category snapshot은 주문/수리 분류에 사용됩니다.

## Stock deduction

POS 주문 생성 시:

- `products.stock_quantity`를 주문 수량만큼 차감합니다.
- `inventory_movements.movement_type = SALE`
- movement quantity는 음수로 기록됩니다.

`orders.stock_deducted_at` column이 존재하지만, 주문 생성 코드에서는 item 단위 stock 차감과 inventory movement가 핵심입니다.

## Deposit and balance

Master spec:

- 예약 주문 여부
- 예약금
- 미수 잔금
- 최종 결제 상태
- 구매확인은 전액 결제 이후 시작

DB column:

- `orders.is_reservation_order`
- `orders.deposit_amount`
- `orders.unpaid_balance`
- `orders.final_payment_status`
- `orders.final_paid_at`

잔금 수금 route:

- `POST /api/orders/:id/collect-balance`

동작:

- 수금액만큼 `unpaid_balance` 차감
- 잔금 0이면 `final_payment_status = PAID`
- 일부만 수금되면 `final_payment_status = PARTIAL`
- 완납 시 `final_paid_at` 설정
- 완납 후 LINE 구매확인 link 전송 시도
- group에 handover 확인 action 전송

## Purchase confirmation after POS

관련 route:

- `POST /api/orders/:id/purchase-confirmation`
- `POST /api/purchase-confirmations/generate-link`
- `GET /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/public/:token`
- `POST /api/orders/:id/confirm-handover`

흐름:

1. EBIKE qualified order의 구매확인 link 생성
2. 고객 LINE으로 button/link 전송
3. 고객이 서명 포함 구매확인 제출
4. PDF 생성
5. staff가 교車 완료 확인

## Repair order classification

Master spec:

- 수리 category 상품이 하나라도 포함되면 수리 주문입니다.

`backend/src/routes/orders.js` list route에서 확인된 수리 판정:

- `orders.repair_order_id IS NOT NULL`
- `orders.source = 'repair_quote'`
- `repair_orders.order_id` 연결 존재
- `order_items.product_category_snapshot = 'REPAIR'`

`PUT /api/orders/:id/items`에서 category snapshot normalization:

- product category `EB` -> `EBIKE`
- product category `RP` -> `REPAIR`
- product category `AC` -> `ACCESSORY`
- 그 외 -> `OTHER`

## Order edit

Frontend:

- `frontend/src/pages/OrderEditPage.jsx`

Routes:

- `GET /api/orders/:id`
- `PATCH /api/orders/:id`
- `PUT /api/orders/:id/items`

`PUT /api/orders/:id/items`는 기존 item 삭제 후 새 item을 insert하고 total/unpaid/final payment status를 다시 계산합니다.

## Delete and restore

Routes:

- `DELETE /api/orders/:id`
- `POST /api/orders/:id/restore`
- `DELETE /api/orders/:id/permanent`
- `GET /api/orders/trash/list`

Trash UI:

- `frontend/src/pages/TrashPage.jsx`

## LINE self-order comparison

LINE self-order route:

- `POST /api/line-order/create`

LINE order 기본값:

- `status = PENDING_PAYMENT`
- `payment_method = OTHER`
- `is_reservation_order = 1`
- `deposit_amount = 0`
- `unpaid_balance = totalAmount`
- `final_payment_status = UNPAID`
- `source = line_order`
- item category snapshot `EBIKE`

POS 주문과 달리 LINE self-order는 고객 예약/대기 결제 성격으로 생성됩니다.
