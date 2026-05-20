# CUSTOMER_RULES

이 문서는 `docs/KINGWAY_STORE_MASTER_SPEC.md`, `backend/src/routes/customers.js`, `backend/src/routes/line.js`, `backend/src/services/lineWorkflowService.js`, `backend/src/app.js`의 customer status route를 기준으로 작성했습니다.

## Master rules

고객관리 기준:

- 고객관리는 CRM-first입니다.
- 고객 상세는 이름, 전화, LINE binding, LINE userId, CRM stage, 예산, 구매 시기, 사용 목적, 주문 이력, 수리 이력, 쿠폰 이력, 설문 이력, 구매확인 PDF, follow-up 이력을 누적해야 합니다.
- phone 또는 LINE userId backfill은 보수적으로 처리해야 합니다.
- 기존 non-null 식별자를 안전한 근거 없이 덮어쓰면 안 됩니다.
- 고객을 조용히 병합하면 안 됩니다.
- 중국어가 `?`, `??`, `???`로 보이면 실제 저장 byte를 확인한 뒤 판단해야 합니다.

## Customer types

`customers.customer_type` enum:

- `LINE`
- `OFFLINE_WITH_PHONE`
- `OFFLINE_NO_PHONE`

`backend/src/routes/customers.js`에서 확인된 생성 규칙:

- `lineUserId`가 있으면 `LINE`
- phone이 있으면 `OFFLINE_WITH_PHONE`
- phone이 없으면 `OFFLINE_NO_PHONE`

## Customer routes

File:

- `backend/src/routes/customers.js`

Routes:

- `GET /api/customers`
- `POST /api/customers`
- `PATCH /api/customers/:id`
- `GET /api/customers/:id/detail`
- `POST /api/customers/:id/follow-up`
- `DELETE /api/customers/:id`

Customer status direct routes:

- `GET /api/customer-status`
- `POST /api/customer-status/orders/:id/payment`
- `POST /api/customer-status/orders/:id/deliver`
- `POST /api/customer-status/repairs/:id/payment`
- `POST /api/customer-status/repairs/:id/pickup`

## Customer list

`GET /api/customers`는 기본적으로 다음 조건을 사용합니다.

- `COALESCE(crm_stage, '') <> 'deleted'`

검색 parameter:

- `search`
- `type`
- `crmStage`

## Customer creation

`POST /api/customers` required:

- `name`

입력 가능 field:

- `phone`
- `lineUserId`
- `customerType`
- `email`
- `address`
- `birthDate`
- `note`
- `crmStage`
- `budget`
- `purchaseTiming`
- `usagePurpose`
- `interestedModel`
- `assignedStaffId`
- `followUpDueAt`

중복 phone 처리:

- phone이 있고 `customerType !== OFFLINE_NO_PHONE`이면 기존 phone 고객을 조회합니다.
- 기존 고객이 있으면 새 고객을 만들지 않고 기존 고객 정보를 반환합니다.

생성 후 기록:

- `customer_crm_events.event_type = customer_created`

## Customer update

`PATCH /api/customers/:id`는 고객 기본 정보와 CRM field를 갱신합니다.

확인된 보수 규칙:

- `customerType !== LINE`이고 `lineUserId`가 명시되지 않으면 `line_user_id`를 `NULL`로 설정합니다.
- `customerType === OFFLINE_NO_PHONE`이고 phone이 명시되지 않으면 `phone`을 `NULL`로 설정합니다.
- `last_contact_at`은 update 시 갱신됩니다.

## Customer detail

`GET /api/customers/:id/detail`에서 반환하는 이력:

- customer
- orders
- repairs
- coupons
- surveys
- purchase confirmations
- CRM events
- follow-up tasks
- timeline

관련 table:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `coupons`
- `surveys`
- `purchase_confirmations`
- `customer_crm_events`
- `follow_up_tasks`

## Follow-up

Route:

- `POST /api/customers/:id/follow-up`

확인된 action mapping:

| Input | Stored action_type |
| --- | --- |
| `3日追蹤` | `3_day` |
| `7日追蹤` | `7_day` |
| `14日追蹤` | `14_day` |
| `手動發送` | `manual` |
| `manual` | `manual` |

`follow_up_tasks.status` enum:

- `pending`
- `sent`
- `done`
- `canceled`

LINE userId와 LINE token이 있으면 follow-up message 전송 후 `status = sent`로 갱신합니다. 전송 결과는 `customer_crm_events`와 `v2_workflow_events`에도 기록됩니다.

## Customer delete

Route:

- `DELETE /api/customers/:id`

확인된 요구값:

- `adminPin = 1144`

동작:

- 실제 row 삭제가 아니라 soft hide 방식입니다.
- `name` 앞에 `[已刪除]` prefix를 붙입니다.
- `phone = NULL`
- `line_user_id = NULL`
- `crm_stage = deleted`
- 주문/수리/쿠폰/설문 등 관련 이력 table은 삭제하지 않습니다.

## LINE customer binding

LINE webhook:

- `POST /api/line/webhook`

`follow` event에서:

- LINE userId 기준 고객 생성 또는 조회
- welcome reply 전송

LINE phone binding은 customer identity의 핵심입니다. Master spec 기준으로 LINE friend add + phone binding 후 new friend coupon 발급 조건이 충족됩니다.

## Customer status lookup

Route:

- `GET /api/customer-status`

확인된 검색:

- query `q`
- phone-like query 감지
- 고객, 주문, 수리 상태 반환

Action routes:

- 주문 결제 처리: `POST /api/customer-status/orders/:id/payment`
- 주문 출고 처리: `POST /api/customer-status/orders/:id/deliver`
- 수리 결제 처리: `POST /api/customer-status/repairs/:id/payment`
- 수리 pickup 처리: `POST /api/customer-status/repairs/:id/pickup`

## Coupon history rules

쿠폰 table:

- `coupons`

확인된 coupon types:

- `new_friend`
- `google_review`

Master spec:

- new friend coupon: `NT$500`, EBIKE only, 고객당 1회
- Google review coupon: `NT$1500`, staff 수동 승인, EBIKE only, 고객당 1회

## Customer frontend

Frontend file:

- `frontend/src/pages/CustomersPage.jsx`

확인된 API 사용:

- `/customers`
- `/customers/:id/detail`
- `/customers/:id/follow-up`
- `/coupons`
- `/purchase-confirmations`
- `/surveys`

고객 상세 UI는 주문, 수리, 쿠폰, 설문, 구매확인, follow-up 이력 중심으로 동작합니다.
