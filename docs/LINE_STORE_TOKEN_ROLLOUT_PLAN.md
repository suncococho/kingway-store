# Store LINE Token Rollout Plan (Phase 4C)

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`

## 1) 현재 global token 사용 경로

- `backend/src/utils/line.js`의 `resolveLineAccessToken`는 `options.channelAccessToken` → `options.accessToken` → `config.line.channelAccessToken` 우선순위로 동작한다.
- `backend/src/services/lineWorkflowService.js`의 `replyToLine`, `sendLineMessage`는 현재 `getScopedLineAccessTokenOptions`를 통해 context만 전달하며, 기본 토큰은 `config.line.channelAccessToken`이다.
- `backend/src/routes/line.js`의 legacy `POST /api/line/webhook`는 webhook 이벤트 처리에서 `replyToLine` 호출 시 context를 주입하지 않아 실질적으로 global token이 사용된다.
- 고객 발송/푸시 라우트 및 서비스(고객 알림, 주문, 수리, 쿠폰, 정기 리포트)는 실행상 모두 global token 경로에 묶여 있으며(현재 runtime 동작), resolver 준비만 있는 상태이다.

현재 구현 상태(2026-06-04):

- `POST /api/line/webhook/:webhookPathToken`는 signature 검증 성공 후 `resolveStoreLineCredentials()`를 실제 호출한다.
- resolver가 `accessToken`, `channelSecret`를 모두 해석하면 `req.lineContext = { storeId, storeCode, accessToken, channelSecret }`를 저장한다.
- 아직 tokenized webhook 경로에서 reply/push는 실행하지 않으며, 상태 응답만 반환한다.
- legacy `POST /api/line/webhook`는 global token 경로를 유지한다.

## 2) store resolver 준비된 위치

- 4B에서 준비된 resolver는 `backend/src/services/storeLineSettingsService.js`에 구현됨.
- 핵심 API:
  - `resolveStoreLineCredentials({ storeId, storeCode, purpose })`
  - `getMaskedLineCredentialStatus({ storeId, storeCode })`
- 조회 범위:
  - `stores` + `store_line_settings`에서 `storeId` 또는 `storeCode`로 조회.
- env 참조 해석:
  - `env:NAME` 형식만 해석하고 raw 값은 반환/로그/응답에서 노출하지 않음.
- 반환은 상태 메타(`present`, `source`, `maskedLabel`, `resolvable`) 중심이며 raw token은 내부에서만 사용하도록 구성됨.

## 3) 안전하게 먼저 적용할 경로 (Phase 4C 권장)

가장 안전한 첫 적용은 다음 순서로 제안한다.

1. `POST /api/line/webhook/:webhookPathToken` only
- 토큰화 라우트에서만 store credentials 사용.
- `verifyLineSignature`와 `channel_secret_ref` 검증이 이미 분기되어 있어, store-scoped 토큰 적용 실패 시 blast radius를 최소화하기 좋다.
- 이벤트 처리 파이프라인은 skeleton 상태이므로, 우선 token 사용 가능성/결측성 판단을 통해 no-op 또는 명시 실패 처리로 시작한다.

2. `line.js` tokenized 경로 내부에서 `runWithLineAccessTokenOptions(...)`를 통해 context 전달
- `storeId`, `storeCode`, `storeLineCredentials` source, `purpose`를 명시.
- `replyToLine`/`sendLineMessage`는 context-aware 토큰 선택이 가능하되, 실제 payload send는 Phase 4C에서 제한적으로 확장.

3. 신규 테스트 계층에서 dry-run 모드로 dry verification 먼저 수행 후, 실제 메시지 발송은 마지막에 분리.

## 4) 절대 먼저 건드리면 안 되는 경로

### 절대 먼저 변경 금지
- legacy `POST /api/line/webhook`
  - 기존 고객 OA 호환성을 유지해야 하며, token 주입 변경은 검증 이전에 이 경로에 적용하지 않는다.
- `backend/src/services/staffLineNotify.js`
  - staff 그룹 알림 경로는 운영성이 높아 rollback risk가 크므로 token fallback 정책 완성 전 유지.
- daily report 경로
  - 정기 보고/요약 발송 흐름은 서비스 신뢰도와 운영 가시성 측면에서 마지막 단계에서만 변경.

### 변경 시점 제한 대상
- `/api/line/push-test-welcome` 및 QA용 수동 발송 체크도 동결.
- 기존 legacy 라인 플로우(문자열 커맨드, 그룹 등록/반응, 메뉴 메시지)는 Phase 4C에서 tokenized webhook로 한정 적용.

## 5) Phase 4C 구현 범위

- scope는 `POST /api/line/webhook/:webhookPathToken` 에서만.
- tokenized 경로에서만 store-scoped token 경로를 사용해 `reply/push` 후보 경로를 준비한다.
- legacy `POST /api/line/webhook`는 global token과 기존 처리 방식 유지.
- tokenized 경로에서만 store context + channel secret/token 정합성 검사 후, 토큰 없음/해석 실패 시 명시 실패 처리.
- `resolveStoreLineCredentials` 기반으로 상태만 선검증하고, 다른 라우트로 확장하지 않는다.
- 현재 응답 기준:
  - 성공: `200`, `mode: "tokenized_webhook"`, `credentialsResolved: true`
  - credential 미해결: `503`
  - invalid signature: `401`
  - invalid token path / mapping miss: `404`

## 6) 실패 fallback 정책

- store token unresolved인 경우:
  - 동작: no-send + 503(가능한 경우) + 감사 로그(마스킹 값만).
  - 정책: legacy global token fallback는 기본 금지로 유지(Phase 4C에서 추가하지 않음).
- secret/토큰 resolve 실패는 `503` 또는 스켈레톤 종료 처리로 명시 실패만 허용.
- signature 검증 실패는 기존 흐름 유지(401).

## 7) 테스트 계획 (no real send)

- mock signature/secret 검증
  - `webhookPathToken` 유효/무효 케이스, 서명 mismatch 케이스 분리.
- no real send
- resolver dry-run
  - `getMaskedLineCredentialStatus` 및 resolver 결과(`present/source/resolvable`) 기반으로 token/secret 존재성만 점검.
- 경로 제한 검증
  - tokenized webhook 경로에서만 store token path가 시도되는지.
  - legacy `/api/line/webhook`, staffLineNotify, daily report는 여전히 global.
- 재현성 점검
  - store 1/4 설정 row(특히 `channel_*_ref`/present)으로 분기별 상태만 확인.

## 8) 실제 LINE 발송 전 필요한 env 준비

- store가 `env:NAME`를 사용한다면:
  - 5대 env 이름과 실제 값(`LINE_CHANNEL_ACCESS_TOKEN`/`LINE_CHANNEL_SECRET` 별개로) 매핑 정책 확정.
  - `.env`가 아니라 배포 환경의 runtime secret source로만 주입.
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`는 legacy fallback 용으로 유지하되, Phase 4C에서는 tokenized 경로에서 우선순위 전환 실험만 제한 적용.
- `NODE` 레벨에서 process.env 접근이 4B 상태에서 mask/오염 없이 동작하는지 재확인.

## 9) KINGWAY_TAINAN migration

- KINGWAY_TAINAN(기존 단일점) 전환은 마지막 단계.
- 현재는 tokenized webhook + store-scoped send 흐름을 먼저 다른 store 경로 또는 staging 검증 store로 제한.
- store별 503/no-send/실패 분기에서 교차 유출이 없는지 통과 후 마지막에 KINGWAY_TAINAN을 적용한다.
