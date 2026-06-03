# Phase 4C 스테이징 tokenized webhook 검증 계획

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
목표: `/api/line/webhook/:webhookPathToken` 의 stage 3010 환경 기준 검증 준비를 문서화하고, DB/ENV 미변경 원칙하에 실행 가능한 테스트를 구분한다.

## 1) 현재 Store LINE credential 상태 (DB SELECT 결과)

아래 값은 3010 스테이징 DB(`127.0.0.1:3310`, `kingway_store`)에서 `store_id IN (1,4)`로 조회한 결과이다.

| store_id | webhook_path | channel_secret_ref | channel_access_token_ref |
|---|---|---|---|
| 1 | `/api/line/webhook/stg_PXnFtuJutS8QOb1HjpQEoA0z` | `NULL` | `NULL` |
| 4 | `/api/line/webhook/stg_jeeQQSEG84xWWF6K-TLUYAcS` | `env:STORE4_LINE_CHANNEL_SECRET` | `env:STORE4_LINE_CHANNEL_ACCESS_TOKEN` |

해석:
- Store 1: webhook token mapping만 존재, secret/ref 미등록.
- Store 4: webhook mapping + `env:` ref 등록, ref가 가리키는 환경변수는 존재 여부를 별도 점검 필요.

## 2) staging env ref presence 상태

실행 환경(`kingway-staging-backend`)에 `PRINT`된 환경변수 키 기준으로 확인한 결과:
- 기본 LINE 키는 존재: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_MESSAGING_ENABLED` 등.
- Store 4 전용 ref 키는 존재하지 않음:
  - `STORE4_LINE_CHANNEL_SECRET` (missing)
  - `STORE4_LINE_CHANNEL_ACCESS_TOKEN` (missing)
- Store 1 전용 ref 키도 존재하지 않음:
  - `STORE1_LINE_CHANNEL_SECRET` (missing)
  - `STORE1_LINE_CHANNEL_ACCESS_TOKEN` (missing)

해석: 현재 스테이징 env는 store-scoped ref로 등록된 스토어(특히 store 4) credential을 해석할 수 있는 상태가 아님.

## 3) valid signature 테스트 조건 정리

`POST /api/line/webhook/:webhookPathToken` 경로는 다음 순서로 검증한다.
1. token path 매핑 확인
2. `resolveSecretRef(row.channelSecretRef)` 완료(= env ref가 실제 값으로 resolve되어야 함)
3. `x-line-signature` 검증

`verifyLineSignature` 구현은 다음과 같다.
- 값: `crypto.createHmac("SHA256", channelSecret).update(rawBody).digest("base64")`
- 비교: LINE이 보낸 헤더(`x-line-signature`)와 `timingSafeEqual` 비교.

따라서 valid signature 테스트를 위해 최소 필요 항목:
- `webhookPathToken`이 DB의 `webhook_path`와 정확히 매칭
- `channel_secret_ref`가 `env:NAME` 형태
- backend 컨테이너 환경에 `NAME`이 존재하고 값이 비어있지 않아야 함
- 요청 raw body 그대로(공백/개행 포함)로 HMAC 계산
- `x-line-signature` 헤더에 base64 digest 전달

## 4) mock/test secret 방식의 적용 가능성

현재 구조상 endpoint는 요청에서 채널 시크릿을 직접 받지 않으며, DB의 ref와 backend env만 사용한다.

- 가능한 mock 방식:
  - 별도 환경에서 `rawBody`로 동일 HMAC 계산 로직 검증(문서화 목적)
  - 서명 mismatch/형식 오류 케이스만 사전 체크
- 불가능/제한된 mock 방식:
  - DB/ENV 미변경 상태에서 store 4의 `env:` ref를 실제 값으로 해결하지 못해 401/200 검증(성공 경로) 불가
  - store 1은 ref 미등록(`NULL`) 상태라 동일하게 성공 경로 미도달

## 5) DB/ENV 변경 없이 가능한 테스트 vs 불가능 테스트

가능 (DB/ENV 미변경):
- `store 1/4` webhook path 존재성 확인용 호출
- 잘못된 token path → 404
- 스토어 매핑 존재하나 secret ref 미해결 상태에서 503 경로 확인
- 로그/응답에서 raw token/secret 미노출 원칙 검증

불가능 (DB/ENV 미변경):
- store 4의 ref 환경변수 해석까지 포함한 `401 invalid signature` 분기 테스트
- store 4의 valid credential 경로(200, `credentialsResolved=true`) 테스트
- store 1의 credential 기반 성공/실패 세부 분기(비밀값 등록 전)

## 6) 테스트 실행 체크리스트

1. 사전 점검
- `[ ]` `store_line_settings` 조회
- `[ ]` backend env 키 존재성 확인(`STORE1_*`, `STORE4_*`)
- `[ ]` route 스케줄(3010 대상 서비스) 확인

2. no-secret 테스트
- `[ ]` invalid token path 테스트 (404)
- `[ ]` 매핑 존재 token에서 503(secret unresolved) 확인(현재 store 1/4에서 기대)
- `[ ]` mode/필드 값이 `tokenized_webhook` 계열인지 확인

3. mock 서명 테스트(성공 분기 미도달)
- `[ ]` webhook payload 샘플 생성
- `[ ]` local에서 HMAC 검증 로직으로 서명 형식 생성/검증
- `[ ]` API 호출 시 503 또는 404 예상치와 일치 확인

4. 실제 LINE 연동 테스트(ENV 준비 후)
- `[ ]` store 4 env ref 값 준비(`STORE4_LINE_CHANNEL_SECRET`, `STORE4_LINE_CHANNEL_ACCESS_TOKEN`)
- `[ ]` store 4 valid token path + valid signature + webhook 이벤트 전송 시 200 반환
- `[ ]` store 1은 별도 ref 구성 후 동일 검증 반복

## 7) 추가 준비 조건

- 실제 LINE 토큰 없이도 무해한 형식/문자열/코드 경로 검증은 가능.
- 실제 LINE 채널 secret/token 값 확인이 필요한 시점은 다음 두 가지:
  - 1) `store_id=4` `credentialsResolved=true`를 얻어 200 확인
  - 2) `x-line-signature` 서명 mismatch가 아닌 정합성 케이스 검증

## 8) 원칙
- raw token/secret 값 출력 금지
- mock/signing 테스트라도 실제 token을 로그/명령어 출력에 노출하지 않음
- DB/코드 변경 금지(현재 단계)

## 9) 다음 작업 추천

- 1순위: store 4 전용 env(`STORE4_LINE_CHANNEL_SECRET`, `STORE4_LINE_CHANNEL_ACCESS_TOKEN`) 주입 후 success-path를 별도 스테이징 계정/절차로 재검증
- 2순위: store 1에 `env:` ref 정책 적용 여부 결정 및 동일한 유효성 플로우 확장
- 3순위: 503 해석과 401/200 경로 분기 기준을 4C 테스트 스크립트(문서 기반)로 고정
