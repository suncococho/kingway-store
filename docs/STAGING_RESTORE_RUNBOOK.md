# Staging Restore Runbook

## 1. 목적

이 문서는 KINGWAY staging restore rehearsal 실제 실행 절차를 정의한다.

목적은 다음과 같다.

- production 백업을 staging 환경에 복구하는 절차를 반복 가능하게 만든다.
- production DB, container, volume, `.env`, reverse proxy에 영향을 주지 않고 restore를 검증한다.
- rollback rehearsal을 production 적용 전 staging에서 먼저 검증한다.
- LINE, Telegram, email, push notification 등 외부 발송이 차단된 상태에서 smoke test를 수행한다.
- restore 성공 기준과 BLOCKER 기준을 명확히 한다.

## 2. Restore Rehearsal 범위

포함 범위:

- NAS backup 파일 확인
- Git snapshot 확인
- staging folder 준비
- staging `.env` 준비
- staging compose 준비
- staging MySQL restore 절차
- staging backend / frontend 기동 절차
- smoke test
- LINE / Telegram disable 확인
- rollback rehearsal
- cleanup

제외 범위:

- production DB 수정
- production container restart
- production docker-compose 수정
- production `.env` 수정
- migration 실행
- production reverse proxy 변경
- 실제 LINE / Telegram / email / push 발송

## 3. 실행 전 필수 확인

실행 전 다음을 확인한다.

- 현재 작업 목적이 staging restore rehearsal임을 확인한다.
- production 환경이 아닌 staging 환경만 대상으로 한다.
- staging 프로젝트 폴더는 `/volume1/docker/kingway-store-staging`이다.
- staging DB 이름은 `kingway_store_staging_restore`이다.
- staging container 이름은 다음과 같다.
  - `kingway-staging-mysql`
  - `kingway-staging-backend`
  - `kingway-staging-frontend`
- staging port는 다음과 같다.
  - MySQL: `3310 -> 3306`
  - backend: `3010 -> 3000`
  - frontend: `5180 -> 80`
- production `.env`를 staging에 복사하지 않는다.
- production DB volume을 mount하지 않는다.
- production upload volume을 mount하지 않는다.
- LINE / Telegram / email / push notification은 disabled 또는 dry-run 상태여야 한다.

## 4. NAS Backup 확인 절차

NAS backup 확인 절차:

1. restore 대상 backup 파일 위치를 확인한다.
2. backup 파일명이 production backup인지 확인한다.
3. backup 생성 시각을 기록한다.
4. backup 파일 크기를 기록한다.
5. 가능한 경우 checksum을 기록한다.
6. backup 파일이 비어 있거나 비정상적으로 작은지 확인한다.
7. backup 파일을 staging restore 입력으로만 사용한다.
8. backup 파일 원본을 수정하지 않는다.

확인 항목 예시:

```text
backup path:
backup created at:
backup size:
checksum:
restore target DB: kingway_store_staging_restore
```

주의:

- production DB에 직접 접속해 dump를 새로 생성하지 않는다.
- backup 파일을 staging에서 read-only source로 취급한다.
- restore 대상 DB가 production인지 staging인지 실행 전 다시 확인한다.

## 5. Git Snapshot 확인 절차

Git snapshot 확인 절차:

1. 현재 branch가 `beta/staging-architecture`인지 확인한다.
2. restore rehearsal에 사용할 commit hash를 기록한다.
3. working tree 상태를 확인한다.
4. 문서 변경, staging 관련 변경, 미커밋 변경을 구분한다.
5. production hotfix 또는 unrelated change가 섞여 있으면 실행 전 중단하고 확인한다.
6. restore rehearsal 중 `git add` / commit / reset / checkout을 하지 않는다.

기록 예시:

```text
branch: beta/staging-architecture
commit:
working tree status:
notes:
```

## 6. Staging Folder 준비 절차

staging folder는 다음 경로를 사용한다.

```text
/volume1/docker/kingway-store-staging
```

준비 절차:

1. staging folder가 production folder와 분리되어 있는지 확인한다.
2. production folder `/volume1/docker/kingway-store`를 직접 수정하지 않는다.
3. staging folder 안에서만 rehearsal 관련 파일을 준비한다.
4. production upload path 또는 DB volume을 staging folder에 mount하지 않는다.
5. staging folder 내부에 restore log와 smoke test 결과를 남긴다.

주의:

- staging folder 준비는 production folder의 compose나 `.env` 변경을 의미하지 않는다.
- production folder를 staging runtime path로 사용하지 않는다.

## 7. Staging Env 준비 절차

staging env는 production `.env`와 완전히 분리한다.

필수 값 예시:

```env
DB_HOST=kingway-staging-mysql
DB_PORT=3306
DB_NAME=kingway_store_staging_restore
MYSQL_DATABASE=kingway_store_staging_restore

PORT=3000
BACKEND_PUBLIC_PORT=3010
FRONTEND_URL=http://<staging-host>:5180
API_BASE_URL=http://<staging-host>:3010

WEBHOOKS_ENABLED=false
LINE_WEBHOOK_ENABLED=false
LINE_MESSAGING_ENABLED=false
TELEGRAM_NOTIFICATIONS_ENABLED=false
EMAIL_ENABLED=false
PUSH_NOTIFICATIONS_ENABLED=false
NOTIFICATION_DRY_RUN=true
```

준비 절차:

1. staging 전용 env 파일을 준비한다.
2. production DB credential이 없는지 확인한다.
3. production LINE credential이 없는지 확인한다.
4. production Telegram token이 없는지 확인한다.
5. production webhook URL이 없는지 확인한다.
6. production upload path가 없는지 확인한다.
7. JWT secret이 production과 다른지 확인한다.
8. secret 값을 로그에 평문 출력하지 않는다.

## 8. Staging Compose 준비 절차

staging compose는 production compose와 분리한다.

확인 항목:

- compose project name에 `staging`이 포함되어 있다.
- container name이 `kingway-staging-*` 형식이다.
- volume name에 `staging`이 포함되어 있다.
- network name에 `staging`이 포함되어 있다.
- MySQL host port는 `3310`이다.
- backend host port는 `3010`이다.
- frontend host port는 `5180`이다.
- production DB volume을 mount하지 않는다.
- production upload volume을 mount하지 않는다.
- production network를 공유하지 않는다.

주의:

- production `docker-compose.yml`을 수정하지 않는다.
- staging service를 production compose에 추가하지 않는다.
- 실제 compose 실행은 별도 승인 후 진행한다.

## 9. MySQL Restore 절차 개요

MySQL restore는 staging DB에만 수행한다.

절차 개요:

1. staging MySQL container가 `kingway-staging-mysql`인지 확인한다.
2. restore 대상 DB가 `kingway_store_staging_restore`인지 확인한다.
3. MySQL host port가 `3310`인지 확인한다.
4. production DB 접속 정보가 사용되지 않는지 확인한다.
5. backup 파일 경로를 확인한다.
6. restore 전 staging DB 상태를 기록한다.
7. backup dump를 staging DB로 import한다.
8. restore 후 table count를 확인한다.
9. 주요 table row count를 확인한다.
10. 중국어 번체 encoding이 깨지지 않았는지 확인한다.
11. restore log를 보관한다.

금지 사항:

- production DB에 restore 실행 금지
- production MySQL container에 import 금지
- migration 실행 금지
- destructive write를 production에 실행 금지

## 10. Staging Backend / Frontend 기동 절차

기동 절차 개요:

1. staging MySQL이 정상 기동되었는지 확인한다.
2. staging backend가 `kingway_store_staging_restore`에 연결되는지 확인한다.
3. staging backend host port `3010`이 열려 있는지 확인한다.
4. staging frontend host port `5180`이 열려 있는지 확인한다.
5. frontend API target이 staging backend인지 확인한다.
6. production backend 또는 production API URL을 바라보지 않는지 확인한다.
7. 기동 로그에서 LINE / Telegram / notification disabled 상태를 확인한다.

주의:

- production container를 restart하지 않는다.
- production compose를 수정하지 않는다.
- staging 기동은 별도 staging compose에서만 수행한다.

## 11. Smoke Test 절차

smoke test 대상:

- frontend 접속: `http://<staging-host>:5180`
- backend health 또는 기본 API: `http://<staging-host>:3010`
- MySQL 접속: `3310`
- DB name: `kingway_store_staging_restore`
- 로그인 화면 또는 관리자 기본 화면
- 고객 관리 목록
- 주문 관리 목록
- 維修管理 목록
- 상품 목록
- 쿠폰 / CRM / 수리 관련 주요 데이터
- 중국어 번체 표시
- upload path가 staging 전용인지 확인
- LINE 발송 차단 확인
- Telegram 발송 차단 확인
- email / push notification 차단 확인

기록 항목:

```text
frontend result:
backend result:
mysql result:
customer list:
order list:
repair list:
product list:
notification disabled:
encoding check:
notes:
```

## 12. LINE / Telegram Disable 확인 절차

LINE disable 확인:

1. staging env에 production LINE credential이 없는지 확인한다.
2. `LINE_WEBHOOK_ENABLED=false`인지 확인한다.
3. `LINE_MESSAGING_ENABLED=false`인지 확인한다.
4. LINE webhook URL이 staging backend로 등록되어 있지 않은지 확인한다.
5. smoke test 중 고객에게 LINE 메시지가 발송되지 않았는지 확인한다.

Telegram disable 확인:

1. staging env에 production Telegram token이 없는지 확인한다.
2. `TELEGRAM_NOTIFICATIONS_ENABLED=false`인지 확인한다.
3. Telegram service가 disabled 또는 mock 상태인지 확인한다.
4. smoke test 중 Telegram 메시지가 발송되지 않았는지 확인한다.
5. legacy Telegram workflow를 staging rehearsal 성공 기준에 포함하지 않는다.

## 13. Rollback Rehearsal 절차

rollback rehearsal은 staging DB에서만 수행한다.

절차:

1. rollback 대상 변경 범위를 정의한다.
2. rollback 전 staging DB 상태를 기록한다.
3. rollback SQL 또는 rollback 절차가 production을 가리키지 않는지 확인한다.
4. rollback을 staging DB에만 적용한다.
5. rollback 후 주요 table row count를 확인한다.
6. 고객 / 주문 / 維修管理 / 상품 화면 smoke test를 다시 수행한다.
7. rollback 소요 시간과 이슈를 기록한다.
8. production 적용 가능 여부는 별도 승인 대상으로 분리한다.

주의:

- staging rollback 성공이 production 자동 실행을 의미하지 않는다.
- production rollback은 별도 계획, 승인, backup 확인 후에만 진행한다.

## 14. Restore Rehearsal 성공 기준

성공 기준:

- staging folder만 사용했다.
- staging container만 사용했다.
- restore 대상 DB가 `kingway_store_staging_restore`였다.
- staging port `3310`, `3010`, `5180`만 사용했다.
- production DB, volume, container, compose에 변경이 없다.
- production `.env`를 사용하지 않았다.
- production LINE credential을 사용하지 않았다.
- production Telegram token을 사용하지 않았다.
- LINE / Telegram / email / push notification이 발송되지 않았다.
- frontend와 backend가 staging 환경에서 정상 응답한다.
- 주요 관리 화면에서 restore된 데이터를 조회할 수 있다.
- 중국어 번체 표시가 깨지지 않는다.
- rollback rehearsal 결과가 기록되었다.
- restore log와 smoke test 결과가 남아 있다.

## 15. BLOCKER 기준

다음 중 하나라도 발생하면 즉시 중단한다.

- restore 대상이 production DB로 확인됨
- production DB credential이 staging env에 포함됨
- production MySQL volume이 staging compose에 mount됨
- production upload volume이 staging compose에 mount됨
- production compose 수정이 필요해짐
- production container restart가 필요해짐
- production LINE credential이 staging env에 포함됨
- production Telegram token이 staging env에 포함됨
- LINE / Telegram / email / push notification 실제 발송 발생
- restore 후 주요 데이터가 비정상적으로 누락됨
- 중국어 번체 데이터가 깨짐
- rollback rehearsal이 데이터 손상 가능성을 보임
- backup 파일이 없거나 크기 / checksum이 비정상임
- staging과 production의 대상 구분이 불명확함

BLOCKER 발생 시 production 작업으로 전환하지 말고, 상태를 기록한 뒤 별도 검토한다.

## 16. Cleanup 절차

cleanup 절차:

1. restore rehearsal 결과를 기록한다.
2. smoke test 결과를 기록한다.
3. rollback rehearsal 결과를 기록한다.
4. 임시 로그에 secret이 포함되어 있지 않은지 확인한다.
5. 불필요한 임시 credential을 폐기한다.
6. staging container / volume cleanup 필요 여부를 판단한다.
7. cleanup이 destructive 작업이면 별도 승인 후 진행한다.
8. production container, DB, volume은 cleanup 대상에 포함하지 않는다.

주의:

- staging MySQL volume 삭제는 destructive 작업이므로 별도 승인 없이 수행하지 않는다.
- backup 원본 파일은 삭제하지 않는다.
- production 관련 리소스는 cleanup하지 않는다.

## 17. Production Safety 최우선 원칙

production safety가 restore rehearsal의 최우선 원칙이다.

금지 사항:

- production DB restore 금지
- production DB migration 금지
- production docker-compose 수정 금지
- production container restart 금지
- production `.env` 복사 금지
- production volume mount 금지
- production upload path mount 금지
- production LINE credential 사용 금지
- production Telegram token 사용 금지
- production webhook URL 사용 금지
- production notification 발송 금지
- production rollback 자동 실행 금지

모든 restore rehearsal 명령은 실행 전 대상 경로, container name, DB name, port, env 값을 확인한 뒤 진행한다.
