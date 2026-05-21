# Staging Smoke Test Plan

## 1. 목적

이 문서는 staging restore rehearsal 이후 KINGWAY 핵심 기능이 정상인지 확인하기 위한 smoke test 계획을 정의한다.

목적은 다음과 같다.

- production backup restore 후 staging 환경에서 핵심 화면과 주요 데이터 조회가 가능한지 확인한다.
- 고객, 주문, 維修管理, 상품, 재고, 쿠폰, 구매확인서 등 핵심 업무 흐름의 기본 동작을 검증한다.
- LINE webhook, Telegram notification, email, push notification 등 production notification이 차단되어 있는지 확인한다.
- restore rehearsal 성공 여부를 판단할 수 있는 최소 검증 기준을 제공한다.

## 2. Smoke Test 범위

포함 범위:

- 로그인
- dashboard
- 고객 관리
- 고객 검색
- POS
- 주문 관리
- 주문 상세
- 維修管理
- 수리 상세
- 쿠폰 흐름
- 상품 관리
- 재고 관리
- 구매확인서
- PDF generation
- LINE webhook disabled check
- Telegram disabled check

제외 범위:

- production 환경 테스트
- production DB write
- migration 실행
- production notification 발송
- 실제 고객 대상 LINE 발송
- 실제 Telegram 발송
- 대량 데이터 수정
- destructive cleanup

## 3. 테스트 전 확인

테스트 전 반드시 다음을 확인한다.

### Staging URL

확인 항목:

```text
frontend URL: http://<staging-host>:5180
backend URL:  http://<staging-host>:3010
```

기준:

- frontend는 staging host port `5180`으로 접속한다.
- backend는 staging host port `3010`으로 접속한다.
- production domain 또는 production API URL을 사용하지 않는다.

### Staging DB

확인 항목:

```text
DB host: kingway-staging-mysql
DB name: kingway_store_staging_restore
DB host port: 3310
DB container port: 3306
```

기준:

- smoke test 대상 DB는 `kingway_store_staging_restore`이다.
- production DB name, host, credential을 사용하지 않는다.

### Staging Container

확인 항목:

```text
kingway-staging-mysql
kingway-staging-backend
kingway-staging-frontend
```

기준:

- staging container만 사용한다.
- production container를 restart하거나 exec 대상으로 삼지 않는다.

### Notification Disabled

확인 항목:

```env
LINE_WEBHOOK_ENABLED=false
LINE_MESSAGING_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
EMAIL_ENABLED=false
PUSH_NOTIFICATIONS_ENABLED=false
NOTIFICATION_DRY_RUN=true
```

기준:

- LINE, Telegram, email, push notification은 disabled 또는 dry-run 상태이다.
- smoke test 중 production notification이 발송되면 즉시 BLOCKER로 처리한다.

## 4. 테스트 항목

## 5. 각 항목별 PASS / FAIL / BLOCKER 기준

### 5.1 Login

테스트:

- staging frontend에서 로그인 화면에 접속한다.
- staging 계정 또는 restore된 관리자 계정으로 로그인 가능 여부를 확인한다.
- 로그인 후 production URL로 redirect되지 않는지 확인한다.

PASS:

- 로그인 화면이 정상 표시된다.
- 로그인 성공 후 staging dashboard로 이동한다.
- API 호출 대상이 staging backend이다.

FAIL:

- 로그인 화면이 깨진다.
- staging backend 오류로 로그인할 수 없다.
- 세션이 유지되지 않는다.

BLOCKER:

- production backend로 로그인 요청이 전송된다.
- production token 또는 production credential이 필요하다.
- 로그인 과정에서 notification이 발송된다.

### 5.2 Dashboard

테스트:

- dashboard 화면이 로딩되는지 확인한다.
- 今日待確認, 今日待處理, 매출 / 주문 / 수리 요약이 표시되는지 확인한다.
- 중국어 번체 표시가 깨지지 않는지 확인한다.

PASS:

- dashboard가 staging 데이터 기준으로 표시된다.
- 핵심 카드와 summary가 로딩된다.
- visible UI가 zh-TW 기준으로 표시된다.

FAIL:

- dashboard API 오류가 발생한다.
- 주요 summary가 비어 있거나 로딩 실패한다.
- 일부 텍스트가 깨진다.

BLOCKER:

- production API에서 dashboard 데이터를 가져온다.
- dashboard 진입 중 production notification이 발송된다.

### 5.3 Customers

테스트:

- 고객 관리 목록에 접속한다.
- restore된 고객 목록이 조회되는지 확인한다.
- 이름, 전화번호, LINE binding, CRM stage 등 핵심 필드가 표시되는지 확인한다.

PASS:

- 고객 목록이 조회된다.
- 주요 고객 필드가 표시된다.
- 중국어 번체와 전화번호가 정상 표시된다.

FAIL:

- 고객 목록 API가 실패한다.
- 주요 필드가 누락된다.
- 일부 표시값이 깨진다.

BLOCKER:

- 고객 데이터가 대량 누락된 것으로 보인다.
- production DB에서 고객 목록을 조회한다.
- 테스트 중 고객 정보가 production에 write된다.

### 5.4 Customer Search

테스트:

- 이름 또는 전화번호로 고객 검색을 수행한다.
- 검색 결과가 staging DB 기준으로 표시되는지 확인한다.
- 검색 중 production API 호출이 없는지 확인한다.

PASS:

- 이름 / 전화번호 검색이 동작한다.
- 결과 상세 진입이 가능하다.
- 검색 결과가 staging DB 기준이다.

FAIL:

- 검색 API 오류가 발생한다.
- 검색 결과가 예상과 다르다.
- 상세 페이지 진입이 실패한다.

BLOCKER:

- production 고객 데이터에 접근한다.
- 검색 중 production notification 또는 webhook이 발생한다.

### 5.5 POS

테스트:

- POS 화면에 접속한다.
- 상품 검색 또는 선택이 가능한지 확인한다.
- 장바구니 추가 등 읽기 중심의 기본 UI 동작만 확인한다.
- 실제 결제 완료, 주문 확정, 고객 notification 발송은 수행하지 않는다.

PASS:

- POS 화면이 로딩된다.
- 상품 조회와 장바구니 UI가 동작한다.
- staging backend만 호출한다.

FAIL:

- POS 화면이 로딩되지 않는다.
- 상품 조회가 실패한다.
- 장바구니 UI가 동작하지 않는다.

BLOCKER:

- production 주문 생성 API가 호출된다.
- 실제 결제 또는 notification 발송이 발생한다.
- production 재고가 변경된다.

### 5.6 Orders

테스트:

- 주문 관리 목록에 접속한다.
- restore된 주문 목록이 조회되는지 확인한다.
- 주문 상태, 결제 상태, 예약금 / 잔금 정보가 표시되는지 확인한다.

PASS:

- 주문 목록이 조회된다.
- 주요 상태와 금액 필드가 표시된다.
- staging DB 기준 데이터이다.

FAIL:

- 주문 목록 API가 실패한다.
- 주요 필드가 누락된다.
- 금액 또는 상태 표시가 깨진다.

BLOCKER:

- production 주문 데이터에 write가 발생한다.
- production DB에서 주문 목록을 조회한다.

### 5.7 Order Detail

테스트:

- 주문 상세 화면에 진입한다.
- 주문 상품, 고객, 결제 상태, 예약금 / 잔금, 수리 분류 여부를 확인한다.
- 수리 상품이 포함된 주문이 維修管理 흐름과 일관되는지 확인한다.

PASS:

- 주문 상세가 정상 표시된다.
- 결제 / 예약금 / 잔금 정보가 확인된다.
- 수리 분류 주문의 표시가 일관된다.

FAIL:

- 주문 상세 API가 실패한다.
- 주문 상품 또는 결제 정보가 누락된다.
- 수리 분류 표시가 불일치한다.

BLOCKER:

- 상세 조회 중 production write가 발생한다.
- 주문 상태 변경 또는 notification이 의도치 않게 발생한다.

### 5.8 Repairs

테스트:

- 維修管理 목록에 접속한다.
- restore된 수리 목록이 조회되는지 확인한다.
- 수리 상태, 고객, 견적, 완료 여부, 설문 관련 필드가 표시되는지 확인한다.

PASS:

- 維修管理 목록이 조회된다.
- 주요 수리 상태가 표시된다.
- 수리 상품 주문이 목록에 포함된다.

FAIL:

- 수리 목록 API가 실패한다.
- 수리 상태가 표시되지 않는다.
- 수리 상품 주문이 누락된다.

BLOCKER:

- production 수리 상태가 변경된다.
- 수리 알림이 실제 고객 또는 LINE 그룹에 발송된다.

### 5.9 Repair Detail

테스트:

- 수리 상세 화면에 진입한다.
- 고객, 접수 내용, 견적, 상태, 완료 / pickup 정보, 설문 결과 표시를 확인한다.
- 상태 변경 버튼은 클릭하지 않는다.

PASS:

- 수리 상세가 정상 표시된다.
- 견적 / 상태 / 설문 관련 정보가 확인된다.
- staging DB 기준 데이터이다.

FAIL:

- 수리 상세 API가 실패한다.
- 주요 필드가 누락된다.
- 설문 결과 표시가 깨진다.

BLOCKER:

- 수리 상태 변경이 production에 발생한다.
- LINE 수리 알림이 발송된다.

### 5.10 Coupon Flow

테스트:

- 쿠폰 목록 또는 고객 상세의 쿠폰 history를 확인한다.
- 신규 친구 쿠폰 NT$500, Google review 쿠폰 NT$1500 관련 데이터가 표시되는지 확인한다.
- 실제 쿠폰 발급 / 승인 / 사용 처리는 수행하지 않는다.

PASS:

- 쿠폰 history가 조회된다.
- 금액, 상태, 사용 제한이 표시된다.
- EBIKE 사용 제한 표시가 확인된다.

FAIL:

- 쿠폰 데이터 조회가 실패한다.
- 금액 또는 상태 표시가 누락된다.
- 카테고리 표시가 영어로 노출된다.

BLOCKER:

- 실제 쿠폰이 production에 발급된다.
- LINE coupon notification이 발송된다.
- Google review coupon이 자동 발급된다.

### 5.11 Products

테스트:

- 상품 관리 목록에 접속한다.
- 상품명, SKU, 카테고리, 가격, 사진 표시를 확인한다.
- 카테고리 visible label이 zh-TW로 표시되는지 확인한다.

PASS:

- 상품 목록이 조회된다.
- SKU, 가격, 사진, 카테고리가 표시된다.
- EBIKE / REPAIR / ACCESSORY / OTHER가 각각 電動自行車 / 維修 / 配件 / 其他로 표시된다.

FAIL:

- 상품 목록 API가 실패한다.
- 사진 또는 카테고리 표시가 누락된다.
- 카테고리가 visible UI에서 영어로 보인다.

BLOCKER:

- production 상품 또는 재고가 변경된다.
- production upload path에 접근하거나 파일을 write한다.

### 5.12 Inventory

테스트:

- 재고 화면에 접속한다.
- 재고 수량, low stock, 입출고 관련 표시를 확인한다.
- 실제 재고 조정은 수행하지 않는다.

PASS:

- 재고 목록이 조회된다.
- stock quantity와 low stock 표시가 정상이다.
- staging DB 기준 데이터이다.

FAIL:

- 재고 API가 실패한다.
- 수량 표시가 누락된다.
- low stock 표시가 비정상이다.

BLOCKER:

- production 재고 수량이 변경된다.
- supplier / manager notification이 실제 발송된다.

### 5.13 Purchase Confirmation

테스트:

- 구매확인서 관리 화면에 접속한다.
- 구매확인서 목록과 상태가 표시되는지 확인한다.
- 주문 완납 후 확인서 대상 여부가 표시되는지 확인한다.
- 실제 고객 서명 요청 또는 LINE 발송은 수행하지 않는다.

PASS:

- 구매확인서 목록이 조회된다.
- 상태와 고객 / 주문 연결 정보가 표시된다.
- PDF link 또는 저장 상태가 확인된다.

FAIL:

- 구매확인서 API가 실패한다.
- 상태 또는 주문 연결 정보가 누락된다.
- PDF link 표시가 깨진다.

BLOCKER:

- production 고객에게 구매확인서 LINE 요청이 발송된다.
- production 주문 상태가 변경된다.

### 5.14 PDF Generation

테스트:

- restore된 기존 PDF link 또는 PDF metadata를 확인한다.
- 새 PDF 생성이 필요한 경우 staging 전용 저장 경로인지 먼저 확인한다.
- production upload path에는 접근하지 않는다.

PASS:

- 기존 PDF metadata 또는 link가 확인된다.
- staging 전용 path를 사용하도록 설정되어 있다.
- production path를 mount하지 않는다.

FAIL:

- PDF metadata 조회가 실패한다.
- link가 깨져 있다.
- staging path 설정이 불명확하다.

BLOCKER:

- production PDF path에 write가 발생한다.
- production upload volume이 staging에 mount되어 있다.
- 새 PDF 생성이 production 고객 flow를 트리거한다.

### 5.15 LINE Webhook Disabled Check

테스트:

- staging env에서 LINE webhook / messaging 관련 env가 disabled인지 확인한다.
- LINE Official Account webhook URL이 staging backend로 연결되어 있지 않은지 확인한다.
- smoke test 중 LINE message가 발송되지 않는지 확인한다.

PASS:

- `LINE_WEBHOOK_ENABLED=false`이다.
- `LINE_MESSAGING_ENABLED=false`이다.
- production LINE credential이 staging에 없다.
- LINE 메시지가 발송되지 않는다.

FAIL:

- LINE disable 상태를 확인할 수 없다.
- LINE 관련 route가 enabled인지 불명확하다.

BLOCKER:

- production LINE credential이 staging에 있다.
- 실제 LINE 메시지가 고객 또는 직원 그룹에 발송된다.
- production LINE webhook이 staging으로 연결되어 있다.

### 5.16 Telegram Disabled Check

테스트:

- staging env에서 Telegram notification 관련 env가 disabled인지 확인한다.
- Telegram token / chat id가 staging에 없는지 확인한다.
- smoke test 중 Telegram message가 발송되지 않는지 확인한다.

PASS:

- `TELEGRAM_NOTIFICATIONS_ENABLED=false`이다.
- production Telegram token / chat id가 staging에 없다.
- Telegram 메시지가 발송되지 않는다.

FAIL:

- Telegram disabled 상태를 확인할 수 없다.
- Telegram service mock / disabled 여부가 불명확하다.

BLOCKER:

- production Telegram token이 staging에 있다.
- 실제 Telegram 메시지가 발송된다.
- legacy Telegram workflow가 smoke test 성공 조건으로 사용된다.

## 6. 데이터 손상 방지 원칙

smoke test는 기본적으로 read-only 검증으로 수행한다.

원칙:

- production DB에 write하지 않는다.
- staging DB에서도 destructive write를 피한다.
- 주문 확정, 결제 완료, 쿠폰 발급, 수리 상태 변경, 구매확인서 발송 등 상태 변경 action은 수행하지 않는다.
- 상태 변경이 꼭 필요하면 staging DB 대상인지 재확인하고 별도 승인 후 진행한다.
- production upload path에 파일을 생성하지 않는다.
- production volume을 mount하지 않는다.

## 7. Production Notification 발송 금지

smoke test 중 production notification 발송은 금지한다.

금지 대상:

- LINE message
- LINE group approval notification
- Telegram notification
- email
- push notification
- supplier notification
- customer-facing coupon notification
- purchase confirmation request
- repair estimate / completion notification

production notification이 실제 발송되면 즉시 BLOCKER로 처리하고 테스트를 중단한다.

## 8. 테스트 결과 기록 양식

테스트 결과는 다음 형식으로 기록한다.

```text
Date:
Tester:
Branch:
Commit:
Staging frontend URL:
Staging backend URL:
Staging DB:
Backup source:
Restore timestamp:

Item                      Result   Notes
Login                     PASS/FAIL/BLOCKER
Dashboard                 PASS/FAIL/BLOCKER
Customers                 PASS/FAIL/BLOCKER
Customer Search           PASS/FAIL/BLOCKER
POS                       PASS/FAIL/BLOCKER
Orders                    PASS/FAIL/BLOCKER
Order Detail              PASS/FAIL/BLOCKER
Repairs                   PASS/FAIL/BLOCKER
Repair Detail             PASS/FAIL/BLOCKER
Coupon Flow               PASS/FAIL/BLOCKER
Products                  PASS/FAIL/BLOCKER
Inventory                 PASS/FAIL/BLOCKER
Purchase Confirmation     PASS/FAIL/BLOCKER
PDF Generation            PASS/FAIL/BLOCKER
LINE Disabled Check       PASS/FAIL/BLOCKER
Telegram Disabled Check   PASS/FAIL/BLOCKER

Summary:
Blockers:
Follow-up:
```

## 9. BLOCKER 발생 시 중단 기준

다음 중 하나라도 발생하면 즉시 smoke test를 중단한다.

- production DB에 접근하거나 write가 발생한다.
- production API URL로 요청이 전송된다.
- production LINE credential이 staging에 존재한다.
- 실제 LINE 메시지가 발송된다.
- production Telegram token이 staging에 존재한다.
- 실제 Telegram 메시지가 발송된다.
- email 또는 push notification이 실제 발송된다.
- production upload path에 write가 발생한다.
- production container restart가 필요해진다.
- production compose 수정이 필요해진다.
- restore 데이터가 대량 누락되었거나 integrity 문제가 의심된다.
- 중국어 번체 데이터가 깨져 업무 검증이 불가능하다.
- staging / production 대상 구분이 불명확하다.

BLOCKER 발생 시 기록 후 중단하며, production에 대한 임의 조치로 전환하지 않는다.

## 10. Restore Rehearsal 성공 판정 기준

restore rehearsal은 smoke test 기준으로 다음을 만족하면 성공으로 판단한다.

- 모든 필수 smoke test 항목이 PASS이거나, 허용 가능한 non-blocking FAIL로 기록되어 있다.
- BLOCKER가 없다.
- frontend `5180`, backend `3010`, MySQL `3310` staging port만 사용했다.
- DB 대상이 `kingway_store_staging_restore`로 확인되었다.
- production DB, container, volume, compose에 변경이 없다.
- LINE webhook과 LINE messaging이 disabled 상태이다.
- Telegram notification이 disabled 상태이다.
- email / push notification이 disabled 또는 dry-run 상태이다.
- 고객, 주문, 維修管理, 상품, 재고 등 핵심 데이터가 조회된다.
- visible UI의 주요 중국어 번체 표시가 깨지지 않는다.
- 테스트 결과 기록 양식이 작성되어 있다.
