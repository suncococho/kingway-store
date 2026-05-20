# DB_SCHEMA

이 문서는 `database/schema.sql`, `backend/src/bootstrap.js`, 그리고 현재 MySQL `kingway_store` DB에서 확인한 table/column/status를 기준으로 작성했습니다.

## Schema source

- Initial schema: `database/schema.sql`
- Runtime schema additions: `backend/src/bootstrap.js`의 `ensureV2Schema()`
- DB connection: `backend/src/db.js`
- Default database: `kingway_store`

운영 DB 구조를 볼 때는 `database/schema.sql`과 `ensureV2Schema()`를 같이 확인해야 합니다.

## Actual tables

현재 DB에서 확인된 table:

- `app_settings`
- `coupons`
- `customer_crm_events`
- `customers`
- `follow_up_tasks`
- `inventory_movements`
- `line_chat_sessions`
- `line_group_registrations`
- `line_webhook_events`
- `operational_checklists`
- `order_items`
- `order_payment_events`
- `orders`
- `products`
- `purchase_confirmation_requests`
- `purchase_confirmation_tokens`
- `purchase_confirmations`
- `repair_logs`
- `repair_orders`
- `staff_attendance`
- `staff_kpi_logs`
- `staff_users`
- `supplier_request_items`
- `supplier_requests`
- `surveys`
- `telegram_chat_sessions`
- `v2_workflow_events`

## Row counts checked

현재 DB에서 확인한 대략 row 수:

| Table | Rows |
| --- | ---: |
| `customers` | 108 |
| `products` | 383 |
| `orders` | 93 |
| `order_items` | 167 |
| `repair_orders` | 57 |
| `repair_logs` | 149 |
| `coupons` | 22 |
| `surveys` | 8 |
| `supplier_requests` | 50 |
| `supplier_request_items` | 48 |
| `line_webhook_events` | 291 |
| `v2_workflow_events` | 1756 |

## Core tables

### `staff_users`

확인된 role enum:

- `ADMIN`
- `MANAGER`
- `CASHIER`
- `REPAIR`
- `INVENTORY`

주요 column:

- `id`
- `username`
- `password_hash`
- `display_name`
- `role`
- `permissions`
- `line_user_id`
- `telegram_user_id`
- `telegram_username`
- `is_active`
- `created_at`

### `customers`

확인된 customer type enum:

- `LINE`
- `OFFLINE_WITH_PHONE`
- `OFFLINE_NO_PHONE`

주요 column:

- `id`
- `name`
- `phone`
- `line_user_id`
- `customer_type`
- `email`
- `address`
- `birth_date`
- `note`
- `crm_stage`
- `budget`
- `purchase_timing`
- `usage_purpose`
- `interested_model`
- `assigned_staff_id`
- `last_contact_at`
- `follow_up_due_at`
- `created_at`
- `updated_at`

### `products`

현재 DB category enum:

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

표시 라벨은 `backend/src/utils/productCategories.js`, `frontend/src/utils/productCategories.js`에서 확인됩니다.

| Code | Label |
| --- | --- |
| `EB` | `電動自行車` |
| `RP` | `維修` |
| `PT` | `配件` |
| `AC` | `改裝套件` |
| `TR` | `輪胎` |
| `LT` | `燈具` |
| `LK` | `鎖具` |
| `SE` | `椅子` |
| `HB` | `車把握把腳踏` |
| `CR` | `載具` |
| `OT` | `其他` |

주요 column:

- `id`
- `sku`
- `name`
- `category`
- `price`
- `stock_quantity`
- `low_stock_threshold`
- `description`
- `image_url`
- `cost_price`
- `location`
- `inputter_name`
- `source`
- `deleted_at`
- `deleted_by`

### `orders`

확인된 status enum:

- `PENDING`
- `PENDING_PAYMENT`
- `REPAIRING`
- `COMPLETED`
- `CANCELED`

확인된 payment method enum:

- `CASH`
- `CARD`
- `LINE_PAY`
- `TRANSFER`
- `OTHER`

확인된 final payment status enum:

- `UNPAID`
- `PARTIAL`
- `PAID`

확인된 order type enum:

- `GENERAL`
- `REPAIR`

주요 column:

- `id`
- `order_no`
- `customer_id`
- `customer_name_snapshot`
- `customer_phone_snapshot`
- `customer_type`
- `status`
- `payment_method`
- `total_amount`
- `note`
- `is_reservation_order`
- `deposit_amount`
- `unpaid_balance`
- `final_payment_status`
- `final_paid_at`
- `purchase_confirmation_sent_at`
- `handover_confirmed_at`
- `handover_confirmed_by_staff_id`
- `repair_order_id`
- `order_type`
- `source`
- `stock_deducted_at`
- `deleted_at`
- `deleted_by`

현재 DB status 집계:

| Status | Count |
| --- | ---: |
| `COMPLETED` | 86 |
| `PENDING` | 5 |
| `PENDING_PAYMENT` | 26 |
| `REPAIRING` | 6 |

현재 DB final payment status 집계:

| Status | Count |
| --- | ---: |
| `PAID` | 87 |
| `PARTIAL` | 7 |
| `UNPAID` | 29 |

### `order_items`

주요 column:

- `id`
- `order_id`
- `product_id`
- `product_sku_snapshot`
- `product_name_snapshot`
- `product_category_snapshot`
- `unit_price`
- `quantity`
- `subtotal`

수리 주문 분류는 여러 곳에서 `order_items.product_category_snapshot = 'REPAIR'`를 사용합니다.

### `repair_orders`

확인된 status enum:

- `reserved`
- `checking`
- `estimate_pending_approval`
- `estimate_approved`
- `estimate_rejected`
- `repairing`
- `completed_waiting_pickup`
- `picked_up`
- `canceled`

확인된 reservation status enum:

- `pending_approval`
- `approved`
- `rejected`

확인된 customer estimate response enum:

- `pending`
- `approved`
- `rejected`

확인된 source enum:

- `LINE`
- `WEB`
- `POS`

주요 column:

- `id`
- `repair_no`
- `customer_id`
- `customer_name_snapshot`
- `customer_phone_snapshot`
- `customer_type`
- `line_user_id_snapshot`
- `bike_model`
- `issue_description`
- `reservation_date`
- `reservation_time`
- `status`
- `reservation_status`
- `customer_estimate_response`
- `source`
- `base_fee`
- `estimate_amount`
- `estimated_total`
- `quote_status`
- `quote_sent_at`
- `quote_responded_at`
- `quote_items_json`
- `storage_fee`
- `completed_at`
- `picked_up_at`
- `survey_id`
- `order_id`
- `deleted_at`
- `deleted_by`

현재 DB status 집계:

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

현재 DB reservation status 집계:

| Status | Count |
| --- | ---: |
| `approved` | 55 |
| `rejected` | 2 |

현재 DB quote status 집계:

| Status | Count |
| --- | ---: |
| `pending` | 26 |
| `sent` | 4 |
| `approved` | 26 |
| `rejected` | 1 |

### `coupons`

확인된 coupon type enum:

- `new_friend`
- `google_review`

확인된 status enum:

- `pending_approval`
- `approved`
- `rejected`
- `issued`
- `used`
- `expired`

주요 column:

- `id`
- `customer_id`
- `order_id`
- `coupon_type`
- `code`
- `amount`
- `status`
- `eligible_category`
- `issued_at`
- `approved_at`
- `used_at`
- `expires_at`

현재 DB status 집계:

| Status | Count |
| --- | ---: |
| `issued` | 19 |
| `pending_approval` | 3 |

### `purchase_confirmations`

확인된 status enum:

- `PENDING`
- `COMPLETED`
- `EXPIRED`
- `CANCELED`

주요 column:

- `id`
- `order_id`
- `customer_id`
- `token`
- `status`
- `buyer_name`
- `buyer_phone`
- `buyer_id_number`
- `checks_json`
- `signature_data`
- `html_snapshot`
- `pdf_path`
- `handover_confirmed_at`
- `created_at`
- `completed_at`

관련 table:

- `purchase_confirmation_tokens`
- `purchase_confirmation_requests`

### `surveys`

주요 column:

- `id`
- `customer_id`
- `order_id`
- `repair_order_id`
- `token`
- `rating`
- `feedback`
- `submitted_at`
- `created_at`

### `inventory_movements`

확인된 movement type enum:

- `IN`
- `OUT`
- `ADJUST`
- `SALE`
- `RESTOCK`
- `ADJUSTMENT`

주요 column:

- `id`
- `product_id`
- `movement_type`
- `quantity`
- `note`
- `created_by_staff_id`
- `created_at`

### `supplier_requests`

확인된 request type enum:

- `PURCHASE_ORDER`
- `RETURN`

확인된 status enum:

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

### `supplier_request_items`

주요 column:

- `id`
- `request_id`
- `product_id`
- `sku_snapshot`
- `product_name_snapshot`
- `quantity`
- `received_quantity`
- `note`

## Workflow/audit tables

### `v2_workflow_events`

주요 column:

- `id`
- `event_type`
- `entity_type`
- `entity_id`
- `customer_id`
- `line_user_id`
- `payload`
- `created_at`

### `repair_logs`

주요 column:

- `id`
- `repair_order_id`
- `action`
- `message`
- `created_by_staff_id`
- `created_at`

### `customer_crm_events`

주요 column:

- `id`
- `customer_id`
- `event_type`
- `note`
- `created_by_staff_id`
- `created_at`

### `follow_up_tasks`

확인된 action type enum:

- `3_day`
- `7_day`
- `14_day`
- `manual`

확인된 status enum:

- `pending`
- `sent`
- `done`
- `canceled`

## LINE and Telegram tables

LINE:

- `line_chat_sessions`
- `line_group_registrations`
- `line_webhook_events`

Telegram:

- `telegram_chat_sessions`

`line_webhook_events`는 LINE webhook event dedupe 용도로 사용됩니다.
