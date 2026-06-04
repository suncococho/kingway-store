 # LINE Tokenized Reply Rollout Plan (Phase 4D-2)

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`  
범위: `webhook tokenized route` / `reply + push 전환 설계`  

## 1) 현재 dry-run 상태 (요약)

현재 4D dry-run 체계는 `backend/src/routes/line.js`의 tokenized webhook 경로에서 `POST /api/line/webhook/:webhookPathToken`만 대상으로 한다.

- `webhookPathToken` 매핑 조회 실패 시 `404` 처리.
- 매핑 성공 시 `resolveStoreLineCredentials()`로 스토어 자격 정보 확인.
- `channelSecret` 기반 signature 검증 수행.
- 실패 시 실무 처리 없이 상태 코드/메시지로 종료하는 no-op.
- 실제 메시지 발송은 아직 차단되어 있으며 응답 메타에 `dryRun` 또는 상태 마킹.
- `credentialsResolved`, `signatureVerified`, routeDecision(요청된 이벤트 타입별 분기)만 이벤트 추적.
- legacy `/api/line/webhook`는 변화 없이 기존 동작 유지.

## 2) 실제 reply 전환 대상 (Phase 4D-2)

아래 대상만 4D-2에서 tokenized route로 실제 전환 대상.

1. `POST /api/line/webhook/:webhookPathToken`
2. `replyToLine` 호출 경로를 토큰화 컨텍스트 기반으로 이동
3. 1차는 reply 케이스 중심 (`postback`, `message`, `follow` 등 tokenized webhook 이벤트 핸들러 경로)
4. push 전환은 별도 하위 단계로 둬서 reply 안정화 후 단계적 확장

적용 기준:

- `replyToken`이 있는 이벤트만 reply 전환 대상(요청 메시지 유효 이벤트에 한정).
- `credentialsResolved=true` 및 `resolvable` 조건 충족 시에만 실제 호출 허용.

## 3) legacy webhook 제외

- 대상 외 제외 범위: `POST /api/line/webhook` (global legacy).
- legacy 경로는 토큰화 토큰 해석/실제 전환 대상에서 **항시 제외**.
- tokenized dry-run 응답/로그는 legacy 응답 규격과 혼합 금지.
- 기존 채널 토큰 fallback이나 legacy 라우트 폴백 연결은 4D-2에서 적용하지 않음.

## 4) replyToLine context 전달 구조

`lineWorkflowService.js`의 `replyToLine`은 다음 경로로 컨텍스트를 받는다.

1. 핸들러/라우트에서 `runWithLineAccessTokenOptions({...})`로 비동기 컨텍스트 저장
2. `replyToLine` 내부에서 `getScopedLineAccessTokenOptions(options)`로 병합
3. `resolveLineAccessToken(config, resolvedOptions)`로 token 선택
4. `resolvedOptions.context`에는 아래가 포함될 수 있음
   - `storeId`, `storeCode`
   - `lineChannelId`, `channelAccessTokenRef`, `channelSecretRef`, `source`, `purpose`
   - `credentialsResolved`

요약 구조:

```js
{
  storeId,
  storeCode,
  lineChannelId,
  channelAccessTokenRef,
  channelSecretRef,
  source,
  purpose,
  credentialsResolved
}
```

`replyToLine` 로그에는 `context`가 그대로 찍히며, token/secret 원문은 전송/로그 노출하지 않음.

## 5) sendLineMessage context 전달 구조

`sendLineMessage`는 `lineWorkflowService.js`에서 `line.js`의 실제 sender로 위임하기 전에 scope context를 주입한다.

1. 호출: `sendLineMessage(configArg, to, messages, options)`
2. 내부 처리: `getScopedLineAccessTokenOptions(options)`
3. 실제 전송 유틸인 `backend/src/utils/line.js`의 `sendLineMessage(config, to, messages, options)` 호출
4. 내부에서 `normalizeLineSendOptions` → `context` 정규화 후 `resolveLineAccessToken` 적용

요약 구조:

```js
{
  context: {
    storeId, storeCode, lineChannelId,
    channelAccessTokenRef, channelSecretRef, source, purpose, credentialsResolved
  },
  credentialsResolved,
  기타 옵션 (channelAccessToken / accessToken / to / messages ...)
}
```

현 시점에서는 token/secret source는 기존 global 우선순위 로직이 살아 있으나, context는 전달이 가능한 상태로 유지된다.

## 6) store-scoped token resolver 사용 위치

현재 설계의 실제 사용 위치는 다음 1개 경로로 제한.

- `POST /api/line/webhook/:webhookPathToken`
  - webhook token → store context 조회
  - `store_line_settings` 연동 resolver 호출
  - `channel_access_token_ref`, `channel_secret_ref` 해석 상태 확보
  - 실패 시 no-send 처리(또는 `503`)

다른 라우트(legacy webhook, staff group notify, daily report, push 테스트 등)는 4D-2 범위에서 제외.

## 7) credentialsResolved=false 처리

현재 처리 기준:

- `credentialsResolved=false`가 감지되면 실제 전송을 진행하지 않음.
- 응답/로그는 실패 상태(가능 시 503 또는 정책 코드)로 종료.
- tokenized webhook에는 `sendSuppressed`/`mode`/상태 플래그가 남아 감사를 쉽게 해야 함.
- 추후 전환 시 예외:
  - reply/push 경로에서 실제 발송 전 단계에서 `credentialsResolved`를 1차 게이트로 사용
  - `false`면 즉시 중단 + retry/운영 알림 후보 처리

## 8) fallback 정책

Phase 4D-2 기본 fallback:

1. credentials 해석 실패
   - tokenized route: no-send + 실패 상태 반영
   - global token fallback 금지 (현재 목표: store-scoped 전환의 명시성 보장)
2. signature 실패
   - `401` 반환 후 처리 종료
3. route/mapping 실패
   - `404` 반환, 기존 legacy route 호출 금지
4. unexpected error
   - 500 또는 명시된 fail-fast 경로 유지
5. 운영적 폴백
   - 문제 발견 시 deploy rollback로 `dry-run-only` 또는 `handler 비활성화`

## 9) 테스트 계획

### 9.1 dry-run 연속성 확인
- tokenized route 상태별 시나리오: 유효 토큰, 무효 토큰, signature mismatch, malformed body
- `credentialsResolved`, `signatureVerified`, routeDecision, event 유형별 분기 분포 확인
- legacy route 무변경 여부 비교

### 9.2 실제 reply 전환 리허설(점진)
- `replyToken` 포함 이벤트만 한정
- 1순위: `lineWorkflowService` context 병합 경로 (`runWithLineAccessTokenOptions`+`replyToLine`)
- `credentialsResolved=false`에서 실제 전송이 발화되지 않음 검증
- 실제 전송은 스테이징에서 토글 기반으로만 허용

### 9.3 sendLineMessage 점검
- `sendLineMessage` 경로에서 context pass-through 유지 확인
- 전송 대상(고객/푸시/직원)과 token-scoped 라우팅은 다음 phase로 이관
- no-op/403/401/503 등 실패 코드 정합성 점검

### 9.4 회귀 제어
- legacy `/api/line/webhook` 트래픽/성능/오류율 무변화 확인
- `store-scoped`로 잘못 간주한 라우트가 없는지 스모크 추적
- `lineUserId`/store mapping 교차 오염 탐지

## 10) rollback 계획

Rollback 트리거:

- raw token/secret 노출 의심
- `signatureVerified/credentialsResolved` 실패 급증
- 이벤트 routeDecision 누락 또는 오염
- legacy webhook 영향 징후

Rollback 방법:

1. 배포 직후 `dry-run-only` 상태로 즉시 되돌림
2. tokenized route에서 `reply`/`push` 실행 플래그 비활성화
3. legacy 경로(`POST /api/line/webhook`) 단독 동작으로 복귀
4. 이벤트/로그 기준으로 resolver/파라미터만 정밀 리뷰

## 11) KINGWAY_TAINAN migration 마지막 적용

`KINGWAY_TAINAN`는 마지막 단계로 남겨둔다.

- 전제: tokenized webhook reply/push 핵심 전환이 안정
- store 간 token bleed 없이 `credentialsResolved` 게이트, routeDecision 가시성이 안정된 뒤
- push/legacy 공통 흐름/마지막 수동 승인 경로를 KINGWAY_TAINAN로 순차 전환

## 12) 적용 정리 (요청사항 대응 체크)

- 현재 dry-run 상태: 반영
- 실제 reply 전환 대상: tokenized webhook only 반영
- legacy webhook 제외: 명시 반영
- replyToLine context 전달: 반영
- sendLineMessage context 전달: 반영
- store-scoped token resolver 위치: 반영
- credentialsResolved=false 처리: 반영
- fallback 정책: 반영
- 테스트 계획: 반영
- rollback 계획: 반영
- KINGWAY_TAINAN 마지막 적용: 반영

비고:
- production config 및 production .env는 변경하지 않음.
- 실제 LINE 메시지 발송은 4D-2에서 별도 승인 전 실행하지 않음.
