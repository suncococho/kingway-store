# REPAIR_FLOW

이 문서는 `docs/KINGWAY_STORE_MASTER_SPEC.md`, `backend/src/routes/repairs.js`, `backend/src/services/repairService.js`, `backend/src/services/repairReminderService.js`, `backend/src/services/repairStorageFeeService.js`, `frontend/src/pages/RepairsPage.jsx`, `frontend/src/pages/RepairDetailPage.jsx`를 기준으로 작성했습니다.

## Master repair workflow

마스터 문서 기준 수리 흐름:

1. LINE 친구 + phone binding 고객이 수리 예약 제출
2. Staff group에 승인/거절 prompt 전송
3. Staff 승인 또는 거절
4. 고객이 결과 수신
5. Staff가 수리 메뉴에서 견적 생성
6. 견적이 LINE으로 고객에게 전송
7. 고객이 동의 또는 거절
8. Staff group이 결과 수신
9. 수리 시작
10. Staff가 수리 완료 처리
11. 고객이 pickup/payment 알림 수신
12. 고객이 수리 설문 button 수신
13. 설문 결과가 수리관리에서 보여야 함

## Frontend

Repair pages:

- `frontend/src/pages/RepairsPage.jsx`
- `frontend/src/pages/RepairDetailPage.jsx`

Public LINE/customer related pages:

- `/repair-reservation`
- `/progress`
- `/surveys/:token`

## Backend routes

File:

- `backend/src/routes/repairs.js`

Routes:

- `GET /api/repairs`
- `GET /api/repairs/products`
- `GET /api/repairs/trash/list`
- `DELETE /api/repairs/:id`
- `POST /api/repairs/:id/restore`
- `DELETE /api/repairs/:id/permanent`
- `GET /api/repairs/:id`
- `POST /api/repairs`
- `POST /api/repairs/:id/reservation/respond`
- `POST /api/repairs/:id/estimate`
- `POST /api/repairs/:id/customer-response`
- `POST /api/repairs/:id/offline-complete`
- `POST /api/repairs/:id/approve`
- `POST /api/repairs/:id/reject`
- `POST /api/repairs/:id/complete`
- `POST /api/repairs/:id/phone-notified`
- `POST /api/repairs/:id/pickup`

## Repair rules from service

File:

- `backend/src/services/repairService.js`

확인된 규칙:

- 예약 가능 요일: Tuesday, Wednesday, Sunday
- 기본 검사/공임: `NT$400`
- 완료 알림 후 3일 초과 시 보관료: `NT$80` per day

## Create repair

Route:

- `POST /api/repairs`

Required fields:

- `customerId`
- `bikeModel`
- `issueDescription`
- `reservationDate`

생성 시 주요 저장값:

- `repair_no`
- `customer_id`
- `customer_name_snapshot`
- `customer_phone_snapshot`
- `line_user_id_snapshot`
- `bike_model`
- `issue_description`
- `reservation_date`
- `reservation_time`
- `source`
- `base_fee`
- `reservation_status`
- `status`

LINE 예약이면:

- `source = LINE`
- `reservation_status = pending_approval`
- `status = checking`

현장/web 생성이면:

- source와 reservation/status는 route 입력과 코드 경로에 따라 결정됩니다.

## Repair list

`GET /api/repairs`는 다음을 합쳐 보여줍니다.

- `repair_orders`
- 수리 category 상품이 포함된 `orders`

수리 주문 포함 조건:

- `order_items.product_category_snapshot = 'REPAIR'`

이 조건은 master spec의 수리 주문 분류 규칙과 연결됩니다.

## Reservation approval

Route:

- `POST /api/repairs/:id/reservation/respond`

Service:

- `applyRepairReservationDecision()`

승인:

- `reservation_status = approved`
- `status = reserved`
- 고객 LINE 알림
- group 알림

거절:

- `reservation_status = rejected`
- `status = canceled`
- 고객 LINE 알림
- group 알림

LINE postback action:

- `repair_reservation_approve`
- `repair_reservation_reject`

## Estimate

Route:

- `POST /api/repairs/:id/estimate`

Service:

- `sendRepairEstimateQuotation()`

견적 발송 시:

- `status = estimate_pending_approval`
- `quote_status = sent`
- `customer_estimate_response = pending`
- `quote_sent_at` 설정
- `quote_items_json` 저장
- 고객 LINE 알림
- repair/admin group 알림

## Customer estimate response

Route:

- `POST /api/repairs/:id/customer-response`

Service:

- `applyRepairEstimateCustomerResponse()`

동의:

- `quote_status = approved`
- `customer_estimate_response = approved`
- 연결 order 생성 또는 갱신

거절:

- `quote_status = rejected`
- `customer_estimate_response = rejected`
- `status = estimate_rejected`

LINE text:

- `同意`
- `同意報價`
- `拒絕`
- `拒絕報價`

LINE postback:

- `repair_estimate_approve`
- `repair_estimate_reject`

## Start repair

Route:

- `POST /api/repairs/:id/approve`

확인된 조건:

- `customer_estimate_response = approved`

동작:

- `repair_orders.status = repairing`
- 연결된 order가 있으면 `orders.status = REPAIRING`
- order source/type을 repair quote 흐름에 맞춤

## Reject repair

Route:

- `POST /api/repairs/:id/reject`

동작:

- 수리 거절/취소 상태로 전환
- 관련 log 기록

## Complete repair

Route:

- `POST /api/repairs/:id/complete`

확인된 조건:

- `status = repairing`

완료 시:

- `status = completed_waiting_pickup`
- `completed_at` 설정
- survey token row 생성
- `repair_orders.survey_id` 연결
- 고객에게 pickup/payment 알림
- 고객에게 repair survey link 전송
- group 알림

## Phone notified

Route:

- `POST /api/repairs/:id/phone-notified`

확인된 용도:

- LINE이 없는 offline 고객에게 전화 알림 완료를 기록합니다.

조건:

- `status = completed_waiting_pickup`

## Pickup

Route:

- `POST /api/repairs/:id/pickup`

Pickup 시:

- 보관료 계산
- `status = picked_up`
- `picked_up_at` 설정
- 연결 order가 있으면 `orders.status = COMPLETED`

## Reminder and storage fee jobs

Files:

- `backend/src/services/repairReminderService.js`
- `backend/src/services/repairStorageFeeService.js`

Cron in `backend/src/app.js`:

- 매일 13:30 `sendRepairPickupReminders()`
- 매일 01:00 `updateRepairStorageFees()`

Reminder 확인:

- `completed_waiting_pickup` 상태 수리를 대상으로 알림
- 1일차 LINE reminder
- 3일차 보관료 warning
- 7일 이상 내부 group 알림

Storage fee:

- 완료 후 3일 초과분에 대해 day당 `NT$80`

## Survey

Survey routes:

- `GET /api/surveys/public/:token`
- `POST /api/surveys/public/:token`
- `GET /api/surveys`
- `POST /api/surveys/generate-link`

수리 완료 시 `surveys` row가 생성되고, 고객 제출 후 rating/feedback/submitted_at이 저장됩니다.

## Repair delete and restore

Routes:

- `DELETE /api/repairs/:id`
- `POST /api/repairs/:id/restore`
- `DELETE /api/repairs/:id/permanent`
- `GET /api/repairs/trash/list`

Trash UI:

- `frontend/src/pages/TrashPage.jsx`
