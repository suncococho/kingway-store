# 토큰화 webhook mock 환경 검증 계획

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
목표: 실제 LINE 토큰/secret을 주입하지 않고, staging 3010 런타임을 건드리지 않은 상태에서 tokenized webhook 200 성공 경로를 안전하게 점검할 수 있는지 판단한다.

## 1) mock env 테스트 목적

- 현재 store 4는 `store_line_settings`에 `env:STORE4_LINE_CHANNEL_SECRET`, `env:STORE4_LINE_CHANNEL_ACCESS_TOKEN` ref가 존재하나, staging backend env에는 두 값이 없음.
- 따라서 기존 3010 런타임에서는 tokenized path가 `tokenized_webhook` 매핑은 되더라도 `resolveStoreLineCredentials`가 실제로는 실패한다.
- 목적은 다음을 증명하는 것:
  - `env` ref 기반 로직이 mock 값 주입 시 `credentialsResolved=true` 로직까지 동작 가능한지
  - 실제 3010 컨테이너 env 변경 없이 모의 실행으로 성공 분기를 증명하는 안전한 경로가 있는지
  - 실제 운영/스테이징 런타임에 영향 없는지

## 2) 실제 LINE 토큰과의 차이

- 실제 라인 스테이징 검증
  - store 4 row의 ref가 가리키는 실환경 secret/token을 사용
  - LINE 공식 서명 규격(`x-line-signature`)으로 유효성 검증
- mock 검증
  - 동일 코드 경로를 같은 방식으로 실행하되, secret/token 값은 임시/더미 값 사용
  - 더미값은 `mock_secret`, `mock_token`처럼 랜덤 문자열만 사용하고 실제 채널 값은 사용하지 않음
  - API 응답 분기(`200/401/503/404`)에 대한 논리 검증을 목적으로 함

> 주의: mock 값을 쓴다고 해도 실제 3010의 유효한 webhook 이벤트 처리 분기는 재현되지 않음(실제 런타임 secret 환경 부재가 원인)

## 3) 안전한 실행 방식

### 방식 A (권장): 일회성 Node 프로세스에서 resolver 단독 검증

- 방식
  1. `docker compose -f docker-compose.staging-restore.yml run --rm --name tokenized-webhook-mock backend sh -lc '...'`
  2. 실행 명령에서만 `STORE4_LINE_CHANNEL_SECRET`, `STORE4_LINE_CHANNEL_ACCESS_TOKEN` 환경변수 주입
  3. `resolveStoreLineCredentials({ storeId: 4, purpose: "tokenized_webhook" })` 호출
  4. `credentialsResolved`가 true인지, `channel*Status.resolvable`이 true인지 확인
  5. `resolveSecretRef`, `buildResolvedCredential` 로직이 정상 동작하는지 확인

- 특징
  - 컨테이너 기본 env, 3010 실행 프로세스에는 영향 없음
  - 네트워크/디스크/DB 변경 없음
  - DB/코드 수정 없이 가능한 범위

### 방식 B (목표 보강): tokenized route 핸들러를 인라인 테스트(고급)

- `line.js` 토큰화 라우트에서 사용되는 핵심 단계(매핑 조회 → secret resolve → signature verify)만 별도 스크립트로 호출
- mock secret으로 `verifyLineSignature` 기대값 생성 후 검증
- 실제 HTTP 전송/LINE 발송은 하지 않음

### 3010 컨테이너를 직접 변경 없이 실제 HTTP 200 달성 여부

- 불가. 현재로서는 3010 프로세스 자체의 `process.env`를 바꾸지 않으면 `env` ref가 계속 미해결되어 성공 경로에 도달하지 못함.
- `docker exec`로 `node`를 실행해 임시 env를 줘도, 3010 서비스 프로세스는 기존 env를 계속 사용하므로 해당 호출의 인증 분기에 영향 없음.

## 4) 금지사항

- raw token/secret 출력 금지 (`console`, curl 응답 body, 로그 포함)
- 실제 LINE 메시지 발송 금지
- production config/.env 수정 금지
- DB `INSERT/UPDATE/DELETE/DELETE/DROP/TRUNCATE` 금지
- 3010 런타임 컨테이너 영구 재기동/환경 교체 금지

## 5) 성공 기준

- mock 환경에서
  - `resolveStoreLineCredentials` 결과가 `found: true`, `credentialsResolved: true`
  - `channelAccessTokenStatus.resolvable === true`, `channelSecretStatus.resolvable === true`
  - `resolveSecretRef`는 실패 없이 성공 상태
- 실제 라우팅(실서비스)에서는
  - 현재 상태에서는 실패가 정상(503/secret unresolved)이며, mock 환경과 분리됨을 검증
- raw 값이 로그/결과에 노출되지 않음

## 6) 실패 기준

- container 내부에서 process env 주입 후에도 `credentialsResolved`가 false
- `x-line-signature`가 mock secret 검증에서 항상 mismatch
- 스크립트가 실제 라인 토큰/secret을 필요로 하거나 로깅/출력에 노출 요구가 발생
- 3010 프로세스 env를 실제로 바꾸는 실행/재시작이 필수로 요구되는 경우

## 7) 운영/스테이징 runtime 영향 판정

- 임시(node) mock 실행, `docker run/compose run` 방식은 실행 종료 시점에 사라짐
- 3010 기존 backend 프로세스/서비스 상태 변경 없음
- 운영 관점: 영향 **없음 (비침투적, read-only/isolated)**
- 스테이징 관점: 영향 **없음**, 단지 성공 경로 검증은 별도 env 주입 환경(임시)에서만 가능함

## 8) 다음 단계: 실제 store별 env 주입 SOP

1. store 4 우선 주입
- `store 4` 전용 env를 staging restore에서 설정 후 3010 webhook 200 경로 재검증
- valid token path + mock/real payload 2세트로 확인

2. store 1 동일 기준
- store 1이 env ref 모드로 전환될 경우 동일 mock/real 비교 실행

3. 분기 정리
- `credentialsResolved=true` 시나리오에서 `/api/line/webhook/:token`의 200 반환이 재현되면, 실토큰 없는 mock 테스트는 “구조적 성공 가능성” 검증으로 전환
- 이후 단계에서만 실제 token 배포로 신호 정합성(E2E) 수행
