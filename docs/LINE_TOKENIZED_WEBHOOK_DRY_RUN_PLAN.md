# LINE Tokenized Webhook Phase 4D Dry-run Plan

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`

목적:
- `/api/line/webhook/:webhookPathToken`에서 store-scoped LINE 이벤트 처리를 **실제 reply/push 없이** 검증 가능한 단계로 전환한다.
- `legacy /api/line/webhook`는 기존 동작을 유지한 상태로 운영한다.
- `/api/line/webhook/:webhookPathToken`만 dry-run 대상으로 삼아, 실패 분기/route 결정/로그 가시성을 먼저 고정한다.

참조:
1. `docs/KINGWAY_STORE_MASTER_SPEC.md`
2. `docs/STORE_LINE_SETTINGS_PLAN.md`
3. `docs/LINE_STORE_TOKEN_ROLLOUT_PLAN.md`
4. `docs/LINE_TOKENIZED_WEBHOOK_STAGING_TEST_PLAN.md`

제약:
- production config 변경/production `.env` 수정 없음
- DB 변경 없음
- raw token/secret 출력 및 응답 노출 없음
- 실제 LINE 메시지 발송 없음
- legacy `/api/line/webhook` 수정 없음
- 5자/영문 UI/로그 문구는 최소한의 운영 메시지에 국한

## 1) dry-run 목적
- 실제 발송 없이 경로·권한·서명·라우팅 판단만 안정적으로 동작하는지 증명한다.
- `credentialsResolved`, `signatureVerified`, `events parse`, `replyToken 존재`, `routeDecision`을 단일 응답/로그에서 추적 가능하게 한다.
- 실패 케이스별 응답 코드를 고정해 운영팀이 예측 가능한 운영 Runbook을 만들 수 있게 한다.
- store 4 기준으로 `credentialsResolved=true`와 토큰화 라우트 유효성 판단을 선 확인한다(직접 토큰/시크릿 값 비교는 금지).

## 2) 적용 대상: POST /api/line/webhook/:webhookPathToken only
- dry-run 설계와 검증은 오직 `POST /api/line/webhook/:webhookPathToken`에서만 수행한다.
- `webhookPathToken`은 `store_line_settings.webhook_path` 기반 매핑의 식별자로만 사용한다.
- `:webhookPathToken` 매핑이 실패하면 404/invalid 상태로 종료하고, 어떠한 경우에도 legacy route로 폴백하지 않는다.

## 3) legacy /api/line/webhook는 절대 제외
- legacy `/api/line/webhook`는 기존 global credential / 기존 워크플로우를 유지한다.
- legacy 경로는 dry-run 대상에 포함하지 않는다.
- dry-run 응답/로그는 legacy 라우트의 성공/실패 규칙과 혼동되지 않도록 `mode: "tokenized_webhook"`와 분리한다.

## 4) dry-run에서 할 일

1. signature 검증
- `findStoreLineSettingsByWebhookPathToken`로 store context 조회 후
- `resolveStoreLineCredentials`로 store credential을 해석한다.
- `channelSecret` 기반으로 `verifyLineSignature(rawBody, channelSecret, x-line-signature)`를 수행한다.
- 실패 시 메시지/응답에는 시크릿 원문을 넣지 않는다.

2. credentialsResolved 확인
- `resolvedCredentials.credentialsResolved`, `accessToken`, `channelSecret`의 존재 및 `resolvable` 상태를 응답 메타에 기록한다.
- 실패 시 `503` 계열로 종료하고 실제 이벤트 핸들링을 수행하지 않는다.

3. events 파싱
- `req.body.events`를 array로 정규화한다.
- 개별 event에서 최소 필드를 추출해 `eventCount`, `eventType`, `source.type`, `source.userId`, `replyToken` 존재 여부를 수집한다.
- malformed body는 `400` 또는 `503`로 종료하고 후속 처리 미실행.

4. replyToken 존재 여부 확인
- `hasReplyToken`을 boolean으로 기록한다.
- 필요 시 `routeDecision`에 "replyToken missing" 분기를 남긴다.
- replyToken이 있는 event는 `dry-run`에서만 routeDecision 로그로 남기고 실제 `reply` 호출하지 않는다.

5. route decision만 기록
- 기존 이벤트 핸들러 호출 대신, 이벤트 유형별로 routeDecision만 결정한다.
  - `follow` + `replyToken`: `route: "follow.welcome"`, `replyPlanned: true`
  - `postback`: `route: "postback.handlers"`, `handler: "handleLinePostback"`
  - `message` + group/room + `/register`: `route: "staff.launcher"`
  - `message` + text + 기타: `route: "message.handlers"`
  - 알 수 없는 이벤트: `route: "unhandled"`
- `dryRun: true`가 반드시 포함된 응답 메타로 실제 처리/발송이 아님을 명시한다.

## 5) dry-run response 예시

성공 (서명/credentials/events 정상):
```json
{
  "ok": true,
  "mode": "tokenized_webhook",
  "dryRun": true,
  "resolved": true,
  "signatureVerified": true,
  "credentialsResolved": true,
  "storeId": 4,
  "storeCode": "KINGWAY_TAINAN_STG4",
  "eventCount": 2,
  "events": [
    {
      "eventType": "follow",
      "sourceType": "user",
      "hasReplyToken": true,
      "routeDecision": "follow.welcome",
      "sendSuppressed": true
    },
    {
      "eventType": "message",
      "sourceType": "group",
      "hasReplyToken": false,
      "routeDecision": "message.handlers",
      "sendSuppressed": true
    }
  ],
  "sendSuppressed": true,
  "message": "dry-run completed"
}
```

실패 (서명 불일치):
```json
{
  "ok": false,
  "mode": "tokenized_webhook",
  "dryRun": true,
  "resolved": true,
  "signatureVerified": false,
  "credentialsResolved": true,
  "message": "Invalid LINE signature"
}
```

실패 (credential 미해결):
```json
{
  "ok": false,
  "mode": "tokenized_webhook",
  "dryRun": true,
  "resolved": true,
  "signatureVerified": false,
  "credentialsResolved": false,
  "message": "找不到可用的門市 LINE credentials"
}
```

## 6) 실패 케이스
- malformed token format: `404`
- mapping miss / inactive token: `404`
- secret 미해결: `503` (또는 환경 정책에 맞는 503)
- signature 미일치: `401`
- events not array/parse fail: `400` 또는 `503` (운영 정의에 맞춤)
- 비즈니스 이벤트 핸들러 오류: 이벤트별 `routeDecision: "handler_error"`로 200 응답 내역에 수집 (dry-run에서는 처리 금지)
- internal error: `500` + 민감정보 마스킹

## 7) 실제 발송 전 승인 조건
다음 조건이 모두 충족되면 4D-2로 진행:
- `legacy /api/line/webhook` 영향 없음 확인 (기능 및 코드 경로 불변)
- 4가지 모니터링 지표가 staging에서 안정:
  - `credentialsResolved=true` 비율
  - `signatureVerified=true` 비율
  - `parseOk` 비율
  - `routeDecision` 분기 커버리지 (follow/postback/message/unknown)
- 500/401/404/503 실패 케이스 분기가 운영 정책과 일치
- raw token/secret 출력이 없고, 로그에서 채널 토큰/시크릿 마스킹이 검증됨
- store 4 기준 dry-run 이벤트 스냅샷에서 라우팅 결정이 기대대로 고정됨
- 승인자가 dry-run 결과 로그를 검토 후 수동 승인 기록

## 8) Phase 4D-1 구현 범위
- `POST /api/line/webhook/:webhookPathToken`에 dry-run 처리 한정 구현
- `credentialsResolved` 및 `signatureVerified` 상태 분기 고정
- 이벤트별 routeDecision 수집 저장소(`line_webhook_events` + 기존 로그)만 활용
- `dryRun: true`, `sendSuppressed: true` 응답 고정
- 실제 reply/push 호출 코드 경로는 호출하지 않음
- legacy `/api/line/webhook` 경로는 비변경

## 9) Phase 4D-2 실제 reply 전환 범위
- `replyToken`이 있는 이벤트에 한해 `replyToLine` 컨텍스트 주입 경로를 제한적으로 활성화
- `postback` / message 처리 경로를 기존 handlers와 동일하게 routeDecision → handler 실행으로 점진 이동
- `resolvable credentials` 상태에서만 send를 허용, 실패 시 `credentialsResolved=false`로 즉시 종료
- staff/group 메시지, 주문/수리/쿠폰 푸시는 별도 phase에서 라우트별로 확장
- send/push 활성화 전 `feature flag` 또는 staging 승인 플래그로 차단/해제 가능

## 10) rollback 기준
- rollback trigger:
  - raw token/secret가 로그/응답에 노출됨
  - 401/503/404 분기 폭주 또는 routeDecision 미기록
  - legacy webhook 영향 징후(legacy 요청 처리 성능/오류율 상승, 의도치 않은 토큰화 경로 폴백)
  - store 간 event route 결정 혼선 (예: 다른 store event가 다른 store로 routeDecision)
- rollback 방법:
  - 배포 직후 `dry-run` 응답을 강제 유지 상태로 되돌리기
  - 토큰화 라우트에서 handler 실행 플래그 비활성화
  - 기존 legacy `POST /api/line/webhook`만 운영 경로로 복귀
  - 문제 로그를 기준으로 tokenized route 매핑과 요청 포맷만 재검토

운영 지침:
- dry-run 단계에서 절대 raw token/secret를 출력하지 않는다.
- 실제 메시지 발송은 Phase 4D-2 승인 이후에만 단계적으로 허용한다.
- 문서 승인 없이 코드/DB/.env를 변경하지 않는다.
