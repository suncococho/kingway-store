# LINE_FLOW

이 문서는 `backend/src/routes/line.js`, `backend/src/services/lineWorkflowService.js`, `backend/src/services/lineClient.js`, `backend/src/routes/lineOrder.js`, `backend/src/services/repairService.js`에서 확인한 LINE 흐름입니다.

## LINE-first rule

`docs/KINGWAY_STORE_MASTER_SPEC.md` 기준 핵심 업무는 LINE-first입니다. 고객 onboarding, CRM 수집, 쿠폰, Google 리뷰 확인, 수리예약, 견적 확인, 완료 알림, 설문, 구매확인, staff/supplier 승인 흐름은 LINE 중심으로 유지해야 합니다.

## Webhook

Route:

- `POST /api/line/webhook`

File:

- `backend/src/routes/line.js`

동작:

- LINE signature 검증
- eventId 기반 dedupe
- `line_webhook_events`에 webhook event 기록
- `follow` event에서 LINE customer 생성/연결
- `message` event에서 command/session 처리
- `postback` event에서 수리/쿠폰/구매확인 액션 처리

## LINE group commands

`backend/src/routes/line.js`에서 확인된 group/room 명령:

- `/register admin`
- `/register staff`
- `/register repair`
- `/register inventory`
- `/register daily`

등록 정보는 `line_group_registrations`에 저장됩니다.

직원 출퇴근 명령:

- `/checkin`
- `/checkout`

직원 매칭은 `staff_users.line_user_id`를 사용합니다.

## Customer text keywords

`backend/src/services/lineWorkflowService.js`의 menu command:

- `功能`
- `功能選單`
- `選單`
- `開始`
- `menu`
- `MENU`
- `幫助`

확인된 keyword 그룹:

| Flow | Keywords |
| --- | --- |
| Repair reservation | `維修預約`, `預約維修`, `我要維修`, `我要預約維修` |
| Coupon | `領取優惠券`, `優惠券`, `新朋友優惠`, `我的優惠券` |
| Order status | `我的訂單`, `訂單查詢`, `查詢訂單`, `尾款查詢`, `查詢尾款`, `訂單`, `尾款` |
| Google review | `Google評論`, `Google 評論`, `我要評論` |
| Purchase confirmation | `購買確認`, `購買確認書`, `交車確認` |
| Survey | `滿意度調查`, `問卷`, `維修問卷` |
| Progress | `查詢進度`, `維修進度`, `我的維修` |
| Store info | `門市資訊`, `地址`, `營業時間` |
| Support | `客服協助`, `真人客服`, `聯絡門市` |

## Repair reservation session

Session type:

- `repair_reservation`

Steps:

1. `date`
2. `time`
3. `bike_model`
4. `issue_description`
5. `confirm`

취소 keyword:

- `取消維修預約`
- `取消預約`
- `取消`

확인 keyword:

- `確認送出維修預約`
- `確認送出`

확인된 예약 가능 time slot:

- `14:00`
- `15:00`
- `16:00`
- `18:00`
- `19:00`

확인된 자주 쓰는 bike model quick reply:

- `黑武士`
- `城市車`
- `折疊車`
- `其他車款`

## Repair reservation business rule

`backend/src/services/repairService.js`에서 확인:

- 예약 가능 요일: Tuesday, Wednesday, Sunday
- 기본 검사/공임: `NT$400`
- 완료 알림 후 3일 초과 시 보관료: `NT$80` per day

LINE 예약 생성 시 `repair_orders` 값:

- `customer_type = LINE`
- `source = LINE`
- `base_fee = 400`
- `reservation_status = pending_approval`
- `status = checking`

생성 후 `repair_logs`에 `reserved` log가 추가되고, repair/admin group에 승인/거절 prompt가 전송됩니다.

## Repair reservation approval

Postback action:

- `repair_reservation_approve`
- `repair_reservation_reject`

Service:

- `applyRepairReservationDecision()`

승인 시:

- `reservation_status = approved`
- `status = reserved`
- `group_confirmed = 1`
- 고객에게 승인 메시지 전송

거절 시:

- `reservation_status = rejected`
- `status = canceled`
- `group_confirmed = 0`
- 고객에게 거절 메시지 전송

## Repair estimate flow

Staff route:

- `POST /api/repairs/:id/estimate`

Service:

- `sendRepairEstimateQuotation()`

견적 발송 시 주요 update:

- `status = estimate_pending_approval`
- `quote_status = sent`
- `customer_estimate_response = pending`
- `quote_sent_at` 설정
- 견적 item/notes 저장
- 고객 LINE과 repair/admin group에 알림

고객 응답:

- Text: `同意`, `同意報價`, `拒絕`, `拒絕報價`
- Postback: `repair_estimate_approve`, `repair_estimate_reject`
- Route: `POST /api/repairs/:id/customer-response`
- Service: `applyRepairEstimateCustomerResponse()`

동의 시:

- `quote_status = approved`
- `customer_estimate_response = approved`
- linked repair order/order 생성 또는 연결

거절 시:

- `quote_status = rejected`
- `customer_estimate_response = rejected`
- `status = estimate_rejected`

## Repair completion and survey

완료 route:

- `POST /api/repairs/:id/complete`

완료 조건:

- `status = repairing`

완료 시:

- `status = completed_waiting_pickup`
- `completed_at` 설정
- `surveys` token 생성
- `repair_orders.survey_id` 연결
- 고객에게 pickup/payment 알림과 survey link 전송
- group 알림 전송

Pickup route:

- `POST /api/repairs/:id/pickup`

Pickup 시:

- `status = picked_up`
- `picked_up_at` 설정
- 연결된 order가 있으면 `orders.status = COMPLETED`

## New friend coupon

Master spec rule:

- 금액: `NT$500`
- Trigger: LINE friend add + phone binding
- 사용 가능 category: EBIKE only
- 고객당 1회
- 중복 발급 금지

확인된 code:

- `backend/src/routes/lineOrder.js`의 LINE self-order 생성 과정에서 기존 `new_friend` coupon이 없으면 발급합니다.
- `backend/src/routes/coupons.js`의 `POST /api/coupons/issue`는 `new_friend` 발급 route입니다.

## Google review coupon

Master spec rule:

- 금액: `NT$1500`
- 자동 발급 금지
- 고객이 LINE에서 완료를 알림
- staff가 수동 검증/승인
- 사용 가능 category: EBIKE only
- 고객당 1회

확인된 code:

- 고객 text `我已完成評論` 처리
- `coupons.coupon_type = google_review`
- `amount = 1500`
- `status = pending_approval`
- admin/staff group에 승인/거절 postback 전송

승인/거절 route:

- `POST /api/coupons/approve-google-review/:id`
- `POST /api/coupons/reject-google-review/:id`

## Purchase confirmation

관련 route:

- `POST /api/orders/:id/purchase-confirmation`
- `POST /api/orders/:id/collect-balance`
- `POST /api/orders/:id/confirm-handover`
- `GET /api/purchase-confirmations/public/:token`
- `POST /api/purchase-confirmations/public/:token`

흐름:

1. EBIKE 구매 또는 잔금 완납 후 구매확인 link 생성
2. 고객 LINE으로 구매확인 button/link 전송
3. 고객이 public page에서 구매자 정보, check, 약관, signature 제출
4. `purchase_confirmations.status = COMPLETED`
5. PDF 생성 후 `pdf_path` 저장
6. admin/staff group에 교車 확인 action 전송
7. staff가 `POST /api/orders/:id/confirm-handover`로 handover 확정

## LINE self-order

Frontend page:

- `frontend/src/pages/LineOrderPage.jsx`

Backend route:

- `GET /api/line-order/customer`
- `GET /api/line-order/ebikes`
- `POST /api/line-order/create`

생성되는 order 주요 값:

- `order_no` prefix: `LINE-`
- `status = PENDING_PAYMENT`
- `payment_method = OTHER`
- `is_reservation_order = 1`
- `deposit_amount = 0`
- `unpaid_balance = totalAmount`
- `final_payment_status = UNPAID`
- `source = line_order`
- item `product_category_snapshot = EBIKE`

## LINE cron notifications

`backend/src/app.js`에서 확인:

- 매일 21:00 `sendDailyReport()`
- 매일 13:30 `sendRepairPickupReminders()`
- 매일 01:00 `updateRepairStorageFees()`
