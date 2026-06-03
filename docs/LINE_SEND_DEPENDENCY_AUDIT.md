# LINE Send Dependency Audit

Date: 2026-06-03
Branch: `beta/staging-architecture`

작성 목적: Store-scoped LINE webhook/LIFF 단계(현재 4 이전)에서 LINE 발송 의존성 정리 및 마이그레이션 위험점 추출.

상태:

- Phase 4A implemented on `2026-06-03`
- 구현 범위: `sendLineMessage` / `replyToLine` 의 `options.context` 정규화 및 내부 전달만 추가
- 비구현 범위: store token resolver, 실제 token switching, 실제 LINE 동작 변경

제약 요약:

- production config `.env` 미수정
- raw 토큰/시크릿 로그 출력 금지
- legacy `/api/line/webhook` 동작 보존
- 실제 LINE 메시지 발송 변경 없음

## 1. 현재 LINE 발송 함수 목록

`send` 유틸/호출기

- `backend/src/utils/line.js`
  - `resolveLineAccessToken(config, options = {})`
  - `sendLineMessage(config, to, messages, options = {})`
- `backend/src/services/lineWorkflowService.js`
  - `replyToLine(replyToken, messages, options = {})`
  - `sendLineMessage(configArg, to, messages, options = {})`

실 사용 호출부(현재 코드 기준)

- `backend/src/routes/lineOrder.js`
- `backend/src/routes/lineOrder.js`
- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/surveys.js`
- `backend/src/services/repairReminderService.js`
- `backend/src/services/repairReservationService.js`
- `backend/src/services/telegramService.js`
- `backend/src/services/lineWorkflowService.js`

주의: `backend/src`에는 다수 `.bak` / 백업 파일이 존재하며, 과거 시점 호출 내역이 포함되어 있음(동작 기준 제외).

## 2. token source

실제 실행 경로의 기본 소스

- `backend/src/config.js`
  - `config.line.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN`
  - `config.line.channelSecret = process.env.LINE_CHANNEL_SECRET`

현재 토큰 해석 경로

- `backend/src/utils/line.js: sendLineMessage`
  - 우선순위: `options.channelAccessToken` → `options.accessToken` → `config.line.channelAccessToken`
- `backend/src/services/lineWorkflowService.js: replyToLine`
  - 내부적으로 `resolveLineAccessToken(config, getScopedLineAccessTokenOptions(options))`
  - `lineWorkflowService`는 컨텍스트 주입을 위한 `runWithLineAccessTokenOptions` 유연성 보유
- 채널 시크릿: webhook 검증에서 `backend/src/routes/line.js`가 `config.line.channelSecret` 또는 `channel_secret_ref` 기반 파싱을 사용(Phase 2 결과)

Store metadata 기준 후보

- `store_line_settings.channel_access_token_ref`
- `store_line_settings.channel_secret_ref`

## 3. reply 흐름

- 진입: `backend/src/routes/line.js`
- 핵심 처리: `line.js` -> `lineWorkflowService.replyToLine`
- 전송: `lineWorkflowService` 내부의 `replyToLine`가 `https://api.line.me/v2/bot/message/reply` 호출
- 현재 토큰: 기본은 global `config.line.channelAccessToken`
- Phase 2 이후: `POST /api/line/webhook/:webhookPathToken`은 path token + signature 검증이 완료된 store context를 확인하지만, 실제 reply 메시지 동작은 아직 route skeleton/스택 유지 방식

## 4. push 흐름

- 직접 푸시: `backend/src/utils/line.js`에서 `https://api.line.me/v2/bot/message/push`
- 라우트/서비스 레이어
  - 주문/구매확정: `backend/src/routes/orders.js`, `backend/src/routes/purchaseConfirmations.js`
  - 수리: `backend/src/routes/repairs.js`
  - 쿠폰: `backend/src/routes/coupons.js`
  - 고객 메시지: `backend/src/routes/customers.js`, `backend/src/routes/surveys.js`, `backend/src/routes/lineOrder.js`
  - 서비스 내부: `backend/src/services/repairReminderService.js`, `backend/src/services/repairReservationService.js`, `backend/src/services/telegramService.js`, `backend/src/services/lineWorkflowService.js`

## 5. 고객 OA

- 고객 대상 대상자 ID: `lineUserId`
- 현재는 customer OA 푸시/응답 모두 global token 경로를 따라가며 store별 token 분기 없음
- `storeLineSettingsService`/`store_line_settings`는 메타데이터 표시/마스킹만 수행하며 실제 발송 런타임으로 연결 안 됨

## 6. 직원 그룹

- 대상자 조회: `line_group_registrations.line_group_id`
- 핵심 알림 함수: `backend/src/services/staffLineNotify.js`
  - `pushTextToLineGroup`
  - `notifyRepairReservationCreated`
- 현재 token source는 여전히 global legacy token
- 즉, 대상군 분리는 되어 있으나 credential 분리는 미적용

## 7. store-scoped 변경 필요 지점

HIGH

- `backend/src/services/lineWorkflowService.js`
  - `replyToLine`
  - `sendLineMessage`
  - `resolveLineAccessToken` 연계

MEDIUM

- `backend/src/routes/orders.js` (`pushPurchaseConfirmationLineMessage`)
- `backend/src/routes/repairs.js` (`LINE` 고객 푸시)
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/lineOrder.js`
- `backend/src/services/telegramService.js`
- `backend/src/services/repairReminderService.js`
- `backend/src/services/repairReservationService.js`

LOW

- `backend/src/services/staffLineNotify.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/surveys.js`
- `backend/src/app.js`의 `/api/line/push-test-welcome`(누락 모듈 의심)

필수 보조 확인

- `backend/src/utils/publicStoreResolver.js`로 resolve된 store context를 사용 가능한 위치 확대
- `backend/src/routes/line.js`의 신규 webhook tokenized route에만 scoped token 주입 적용

## 8. 절대 건드리면 안 되는 legacy 함수/흐름

- `POST /api/line/webhook` 자체
- `backend/src/routes/line.js`의 기존 webhook 이벤트 응답 흐름(고객 대화/메뉴/워크플로우)
- 신규 `:webhookPathToken` 라우트를 `/api/line/webhook`에 fallback로 연결
- `sendLineMessage`/`replyToLine`의 핵심 동작 변경 없이 context wiring 선행
- 배포/스키마/기밀 정보 변경 없이 store scoped token이 점진적으로 적용

## 9. Phase 4A~4D migration plan

### Phase 4A: no-behavior-change context object

- `send`/`reply` 런타임에 store context 메타만 추가
  - `storeId`, `storeCode`, `lineChannelId`, `channelAccessTokenRef`, `channelSecretRef`
- 기존 동작(legacy 경로·메시지 패턴) 불변 유지
- 구현 상태:
  - `backend/src/utils/line.js`
    - `normalizeLineSendContext(context = {})`
    - `normalizeLineSendOptions(options = {})`
    - `sendLineMessage(config, to, messages, options = {})`는 `options.context` 허용
  - `backend/src/services/lineWorkflowService.js`
    - `replyToLine(replyToken, messages, options = {})`는 `options.context` 허용
    - `runWithLineAccessTokenOptions(options, callback)`는 normalized context 저장
  - token 선택 우선순위는 기존과 동일하며 global `LINE_CHANNEL_ACCESS_TOKEN` 동작 유지

### Phase 4B: store token resolver 추가

- `store_line_settings.channel_access_token_ref` 해석기 추가
- `env:NAME` 방식 해석 + 실패 안전 응답
- raw token/secret는 로그/응답 미노출

### Phase 4C: tokenized webhook에서만 store token 사용

- `POST /api/line/webhook/:webhookPathToken`에서만 store token 경로를 사용
- legacy `/api/line/webhook`는 기존 글로벌 토큰/동작 유지

### Phase 4D: legacy `KINGWAY_TAINAN` 마지막 전환

- 핵심 고객 플로우의 direct push/reply 경로를 점진 마이그레이션
- `KINGWAY_TAINAN`은 마지막으로 전환
- 전환 전 통합 검증: reply/push parity, 교차 store token bleed 차단

## Risk

HIGH

- `backend/src/services/lineWorkflowService.js`
- `backend/src/utils/line.js`

MEDIUM

- `backend/src/routes/orders.js`
- `backend/src/routes/repairs.js`
- `backend/src/routes/coupons.js`
- `backend/src/routes/purchaseConfirmations.js`

LOW

- `backend/src/services/staffLineNotify.js`
- `backend/src/routes/customers.js`
- `backend/src/services/telegramService.js`
