# ORDER_STATUS

이 문서는 `backend/src/utils/displayLabels.js`, frontend 표시 helper, route 파일, 현재 DB enum/status 집계를 기준으로 작성했습니다.

## Order status

`orders.status` enum:

- `PENDING`
- `PENDING_PAYMENT`
- `REPAIRING`
- `COMPLETED`
- `CANCELED`

확인된 표시 라벨:

| Status | Label |
| --- | --- |
| `PENDING` | `待處理` |
| `PENDING_PAYMENT` | `待付款` |
| `REPAIRING` | `維修中` |
| `COMPLETED` | `已完成` |
| `CANCELED` | `已取消` |
| `CANCELLED` | `已取消` |

현재 DB 집계:

| Status | Count |
| --- | ---: |
| `COMPLETED` | 86 |
| `PENDING` | 5 |
| `PENDING_PAYMENT` | 26 |
| `REPAIRING` | 6 |

## Final payment status

`orders.final_payment_status` enum:

- `UNPAID`
- `PARTIAL`
- `PAID`

확인된 의미:

| Status | Meaning |
| --- | --- |
| `UNPAID` | 미수금 전체 존재 |
| `PARTIAL` | 일부 수금, 잔금 존재 |
| `PAID` | 전액 결제 완료 |

현재 DB 집계:

| Status | Count |
| --- | ---: |
| `PAID` | 87 |
| `PARTIAL` | 7 |
| `UNPAID` | 29 |

## Order type

`orders.order_type` enum:

- `GENERAL`
- `REPAIR`

수리 주문 판정은 `backend/src/routes/orders.js`에서 다음 조건을 사용합니다.

- `orders.repair_order_id IS NOT NULL`
- `orders.source = 'repair_quote'`
- `repair_orders.order_id`로 연결된 수리 row 존재
- `order_items.product_category_snapshot = 'REPAIR'`

마스터 규칙상 수리 category 상품이 하나라도 포함된 주문은 수리 주문으로 취급되어야 합니다.

## Payment method

`orders.payment_method` enum:

- `CASH`
- `CARD`
- `LINE_PAY`
- `TRANSFER`
- `OTHER`

## Repair status

`repair_orders.status` enum:

- `reserved`
- `checking`
- `estimate_pending_approval`
- `estimate_approved`
- `estimate_rejected`
- `repairing`
- `completed_waiting_pickup`
- `picked_up`
- `canceled`

확인된 표시 라벨:

| Status | Label |
| --- | --- |
| `reserved` | `已確認` |
| `confirmed` | `已確認` |
| `waiting_quote` | `已預約待報價` |
| `checking` | `待群組確認` |
| `pending` | `待確認` |
| `new` | `待確認` |
| `estimate_pending_approval` | `待核准報價` |
| `quoted` | `已報價待客戶回覆` |
| `waiting_customer_confirm` | `已報價待客戶回覆` |
| `estimate_approved` | `報價已核准` |
| `customer_confirmed` | `客戶已同意報價` |
| `repair_order_created` | `已建立維修訂單` |
| `estimate_rejected` | `報價已拒絕` |
| `repairing` | `維修中` |
| `in_progress` | `維修中` |
| `completed_waiting_pickup` | `已完修待取車` |
| `ready_for_pickup` | `已完修待取車` |
| `picked_up` | `已取車` |
| `canceled` | `已取消` |

현재 DB 집계:

| Status | Count |
| --- | ---: |
| `reserved` | 25 |
| `estimate_pending_approval` | 3 |
| `estimate_approved` | 4 |
| `estimate_rejected` | 1 |
| `repairing` | 3 |
| `completed_waiting_pickup` | 15 |
| `picked_up` | 4 |
| `canceled` | 2 |

## Repair reservation status

`repair_orders.reservation_status` enum:

- `pending_approval`
- `approved`
- `rejected`

확인된 표시 라벨:

| Status | Label |
| --- | --- |
| `pending_approval` | `待群組確認` |
| `approved` | `已確認` |
| `rejected` | `已拒絕` |

현재 DB 집계:

| Status | Count |
| --- | ---: |
| `approved` | 55 |
| `rejected` | 2 |

## Repair quote status

`repair_orders.quote_status`에서 확인된 값:

- `pending`
- `sent`
- `approved`
- `rejected`

현재 DB 집계:

| Status | Count |
| --- | ---: |
| `pending` | 26 |
| `sent` | 4 |
| `approved` | 26 |
| `rejected` | 1 |

## Customer estimate response

`repair_orders.customer_estimate_response` enum:

- `pending`
- `approved`
- `rejected`

## Coupon status

`coupons.status` enum:

- `pending_approval`
- `approved`
- `rejected`
- `issued`
- `used`
- `expired`

확인된 coupon type label:

| Type | Label |
| --- | --- |
| `new_friend` | `新好友優惠券` |
| `google_review` | `Google 評論優惠券` |

현재 DB status 집계:

| Status | Count |
| --- | ---: |
| `issued` | 19 |
| `pending_approval` | 3 |

## Purchase confirmation status

`purchase_confirmations.status` enum:

- `PENDING`
- `COMPLETED`
- `EXPIRED`
- `CANCELED`

구매확인 제출 완료 시 PDF가 생성되고 `pdf_path`가 저장됩니다.

## Supplier request status

`supplier_requests.status` enum:

- `PENDING_SUPPLIER`
- `APPROVED`
- `REJECTED`
- `PARTIALLY_RECEIVED`
- `RECEIVED`
- `RETURN_CONFIRMED`
- `CANCELED`

현재 DB status 집계:

| Status | Count |
| --- | ---: |
| `PENDING_SUPPLIER` | 19 |
| `APPROVED` | 5 |
| `REJECTED` | 2 |
| `RECEIVED` | 24 |
| `RETURN_CONFIRMED` | 4 |

## Product category status/display

현재 `products.category` enum:

- `EB`
- `RP`
- `PT`
- `AC`
- `TR`
- `LT`
- `LK`
- `SE`
- `HB`
- `CR`
- `OT`

표시 라벨:

| Internal | Visible label |
| --- | --- |
| `EB` / `EBIKE` | `電動自行車` |
| `RP` / `REPAIR` | `維修` |
| `PT` / `ACCESSORY` | `配件` |
| `OT` / `OTHER` | `其他` |
| `AC` | `改裝套件` |
| `TR` | `輪胎` |
| `LT` | `燈具` |
| `LK` | `鎖具` |
| `SE` | `椅子` |
| `HB` | `車把握把腳踏` |
| `CR` | `載具` |
