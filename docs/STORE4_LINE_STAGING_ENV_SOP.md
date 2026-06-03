# Store 4 LINE staging env 주입 SOP

작성일: 2026-06-04
브랜치: `beta/staging-architecture`

## 1) 목적
- Store 4 tokenized webhook 검증이 통과되기 위해 필요한 staging 환경변수 주입 절차를 정의한다.
- 실제 LINE 채널 토큰/시크릿 값은 공개하지 않고, 운영/스테이징 runtime을 변경 없이 문서 기반으로 준비한다.

## 2) Store 4 현재 상태
- `store_id = 4`
- `store_line_settings.webhook_path`: 존재함 (`/api/line/webhook/stg_jeeQQSEG84xWWF6K-TLUYAcS`)
- `channel_secret_ref`: `env:STORE4_LINE_CHANNEL_SECRET`
- `channel_access_token_ref`: `env:STORE4_LINE_CHANNEL_ACCESS_TOKEN`

현재 스테이징 런타임은 4번 store의 env ref 값이 없어 `credentialsResolved`가 false로 떨어지는 구간을 먼저 보여준 상태이다.

## 3) 어디에 env를 넣어야 하는지
- staging restore backend runtime 기준으로만 주입한다.
- 대상: `docker-compose.staging-restore.yml`로 실행되는 backend 컨테이너의 런타임 환경.
- 대상 변수:
  - `STORE4_LINE_CHANNEL_SECRET`
  - `STORE4_LINE_CHANNEL_ACCESS_TOKEN`
- 절대 금지:
  - production용 `.env` 수정
  - production docker-compose 수정
  - 코드 변경

## 4) 절대 출력하면 안 되는 값
- raw secret/token 문자열
- `process.env` 전체 dump
- 요청/응답 바디에 노출되는 원문 secret/token
- 로그, 콘솔, shell 출력에 직접 표시

실무 원칙: 존재 여부 확인(`present`/`missing`)만 기록한다.

## 5) env 추가 후 backend 재시작 방법
- 안전 방식: staging restore 컨테이너 재기동
  1. staging restore 환경변수 소스에 `STORE4_LINE_CHANNEL_SECRET`, `STORE4_LINE_CHANNEL_ACCESS_TOKEN`을 주입
  2. 백엔드 컨테이너 재시작 또는 recreate
  3. 3010 응답 라우트가 새 env를 읽는지 확인
- 재시작 범위는 staging restore backend만 대상으로 하고, 다른 컨테이너는 유지한다.
- 코드/DB는 변경하지 않는다.

## 6) 재시작 후 확인
- 1단계 헬스 체크:
  - `GET /health`
  - 기대: `200`/OK
- 2단계 시스템 상태:
  - `GET /api/system/saas-status`
  - 스테이징에서 token resolver 관련 상태와 기존 사전조건이 정상인지 확인
- 3단계 tokenized webhook 경로 준비점검:
  - store 4 webhook path 사용
  - mapping 존재 여부 확인

## 7) tokenized webhook 검증
- valid signature 생성 원리:
  - `verifyLineSignature(rawBody, channelSecret, x-line-signature)`
  - `crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64")`
  - LINE signature(`x-line-signature`)와 timing-safe 비교
- 판단:
  - invalid signature: `401`
  - valid signature + resolved credentials: `200`
  - credentials unresolved: `503`
  - invalid token path/mapping miss: `404`
- 성공 판정 예시:
  - `200` 응답에서 `mode: "tokenized_webhook"`, `credentialsResolved: true`

## 8) 실패 시 rollback
- staging restore env 주입/재시작이 문제를 일으킨다면:
  1. rollback 대상 env 제거 또는 비워두지 않고 이전 상태로 복원
  2. backend 재시작
  3. `/health`, `/api/system/saas-status`로 회복 확인
  4. 로그에서 secret/token 미노출 조건 유지 확인
- 필요 시, 컨테이너 삭제/volume 제거/DB 변경 없이 환경 주입만 되돌린다.

## 9) KINGWAY_TAINAN legacy
- 기존 `KINGWAY_TAINAN` legacy 플로우는 이번 SOP 대상으로 제외한다.
- legacy route(`POST /api/line/webhook`) 동작 정책은 변경하지 않는다.

## 10) store 1 확장 순서
- Store 4 주입/검증이 성공한 뒤,
  - store 1 설정 상태(`channel_secret_ref`, `channel_access_token_ref`)를 동일 SOP로 확장한다.
  - 필요한 경우 store 1용 env key(`STORE1_...`)로 동일 패턴 적용.

## 11) 다음 단계
- 1순위: store 4 staging env 값 주입 후 `/api/line/webhook/:webhookPathToken` 200 통과 확인
- 2순위: store 4 valid/invalid signature 시나리오를 분리 기록
- 3순위: store 1로 확장
