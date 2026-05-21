# Staging Restore Environment Plan

## 1. 목적

이 문서는 운영 환경과 완전히 분리된 staging restore rehearsal 환경을 정의한다.

staging restore 환경의 목적은 다음과 같다.

- production 백업 복구 절차를 사전에 검증한다.
- rollback rehearsal을 production 영향 없이 반복 수행한다.
- DB restore, 애플리케이션 기동, 기본 smoke test 절차를 안전하게 확인한다.
- LINE, Telegram, 외부 알림, 운영 DB에 절대 영향을 주지 않는 격리 환경을 유지한다.

## 2. Production / Staging 완전 분리 원칙

staging restore 환경은 production과 다음 항목을 공유하지 않는다.

- 프로젝트 폴더
- Docker Compose project name
- container name
- DB name
- DB port
- frontend / backend port
- `.env`
- LINE credentials
- Telegram credentials
- reverse proxy upstream
- restore 대상 DB

production 데이터를 restore하더라도 대상은 반드시 staging DB여야 하며, production DB에는 어떠한 write 작업도 수행하지 않는다.

## 3. Staging 프로젝트 폴더

staging restore 전용 프로젝트 폴더는 다음으로 고정한다.

```text
/volume1/docker/kingway-store-staging
```

운영 프로젝트 폴더 `/volume1/docker/kingway-store`와 분리한다.

## 4. Staging Container Naming

staging restore 환경의 container name은 production과 충돌하지 않도록 다음으로 고정한다.

```text
kingway-staging-frontend
kingway-staging-backend
kingway-staging-mysql
```

container name에 `staging`을 명시하여 docker 명령 실행 시 production container와 혼동하지 않도록 한다.

## 5. Staging DB Naming

staging restore 전용 DB name은 다음으로 고정한다.

```text
kingway_store_staging_restore
```

restore 명령, DB 접속 문자열, smoke test는 반드시 이 DB name을 대상으로 해야 한다.

## 6. Staging Port 분리

staging restore 환경은 production과 다른 port를 사용한다.

```text
frontend: 5180
backend: 3010
mysql: 3310
```

production port와 절대 공유하지 않는다.

## 7. Reverse Proxy 분리 원칙

reverse proxy는 production upstream과 staging upstream을 명확히 분리한다.

원칙:

- staging 전용 server block 또는 staging 전용 location을 사용한다.
- staging upstream은 `kingway-staging-frontend:5180` 또는 지정된 staging frontend 대상만 바라본다.
- production upstream으로 fallback하지 않는다.
- production domain과 staging domain 또는 staging path를 혼용하지 않는다.
- reverse proxy 설정 변경 전에는 config validation을 먼저 수행한다.
- reverse proxy reload는 별도 승인 후 수행한다.

## 8. LINE Webhook 차단 원칙

staging restore 환경에서는 LINE webhook을 차단한다.

원칙:

- staging `.env`에는 production LINE channel secret / access token을 넣지 않는다.
- LINE webhook URL을 staging backend로 연결하지 않는다.
- staging backend에서 LINE webhook route가 호출되더라도 외부 LINE API 호출이 발생하지 않도록 한다.
- 필요 시 staging에서는 LINE 관련 기능을 mock, disabled, dry-run 상태로 둔다.
- customer-facing LINE message, coupon issuance, approval flow는 production LINE으로 전송되면 안 된다.

## 9. Telegram Notification 차단 원칙

마스터 스펙 기준으로 KINGWAY 시스템은 LINE-first 구조이며 Telegram 기반 workflow를 재도입하지 않는다.

staging restore 환경에서는 Telegram notification을 차단한다.

원칙:

- staging `.env`에는 production Telegram bot token / chat id를 넣지 않는다.
- Telegram notification service는 disabled 또는 mock 상태로 둔다.
- staging smoke test 중 Telegram 전송을 성공 기준으로 삼지 않는다.
- 기존 legacy Telegram workflow를 staging restore 설계에 포함하지 않는다.

## 10. Staging `.env` 분리 원칙

staging restore 환경은 production `.env`를 그대로 복사하지 않는다.

staging `.env` 원칙:

- DB host / port / name은 staging 값만 사용한다.
- `MYSQL_DATABASE=kingway_store_staging_restore`
- backend port는 `3010`을 사용한다.
- frontend port는 `5180`을 사용한다.
- MySQL external port는 `3310`을 사용한다.
- LINE / Telegram / 외부 결제 / 외부 알림 credential은 production 값을 사용하지 않는다.
- 외부 발송 기능은 기본값 `disabled` 또는 `dry-run`으로 둔다.
- 환경명은 명확히 `staging_restore`로 표시한다.

## 11. Backup Restore 절차 개요

restore rehearsal 절차는 다음 순서를 따른다.

1. production backup 파일을 확인한다.
2. backup 파일의 생성 시각, 크기, checksum을 기록한다.
3. staging container와 staging DB 대상 값을 확인한다.
4. restore 대상 DB가 `kingway_store_staging_restore`인지 확인한다.
5. 필요 시 staging DB를 초기화하되 production DB에는 접근하지 않는다.
6. backup을 staging MySQL container로 restore한다.
7. restore 완료 후 table count, 주요 row count, encoding 상태를 확인한다.
8. backend가 staging DB에 연결되는지 확인한다.
9. frontend가 staging backend를 바라보는지 확인한다.
10. smoke test를 수행한다.
11. restore 결과와 문제점을 문서화한다.

위 절차 중 production DB write, migration 실행, production container restart는 금지한다.

## 12. Smoke Test 대상

staging restore 후 최소 smoke test 대상은 다음과 같다.

- frontend 접속: `http://<staging-host>:5180`
- backend health 또는 기본 API 접속: `http://<staging-host>:3010`
- MySQL 접속: port `3310`
- DB name 확인: `kingway_store_staging_restore`
- 로그인 화면 또는 관리자 기본 화면 로딩
- 고객 관리 목록 조회
- 주문 관리 목록 조회
- 維修管理 목록 조회
- 상품 목록 조회
- 쿠폰 / CRM / 수리 관련 주요 데이터 조회
- 중국어 번체 표시 깨짐 여부 확인
- LINE webhook 미연결 확인
- Telegram notification 미발송 확인
- production container / production DB에 영향 없음 확인

## 13. Staging Restore 성공 기준

restore rehearsal은 다음 조건을 만족하면 성공으로 본다.

- staging container만 사용되었다.
- restore 대상 DB가 `kingway_store_staging_restore`로 확인되었다.
- frontend `5180`, backend `3010`, mysql `3310`으로 분리 접속된다.
- production DB, production container, production reverse proxy upstream에 변경이 없다.
- LINE webhook이 staging으로 연결되지 않았다.
- Telegram notification이 발송되지 않았다.
- 주요 관리 화면에서 restore된 데이터를 조회할 수 있다.
- 고객, 주문, 維修管理, 상품 데이터의 기본 row count가 예상 범위다.
- visible Chinese text가 깨지지 않는다.
- smoke test 결과와 restore 로그가 남아 있다.

## 14. Rollback Rehearsal 연결 방식

staging restore 환경은 rollback rehearsal의 검증 대상으로 사용한다.

연결 방식:

- production backup을 staging DB로 restore한다.
- rollback SQL 또는 rollback 절차는 staging DB에서 먼저 rehearsal 한다.
- rehearsal 결과를 기준으로 예상 소요 시간, 실패 지점, 검증 쿼리를 정리한다.
- production rollback 실행 여부는 staging rehearsal 성공 후 별도 승인으로만 판단한다.
- staging에서 성공했더라도 production 적용은 자동으로 연결하지 않는다.

## 15. Production Safety 최우선 원칙

production safety가 모든 restore rehearsal 절차보다 우선한다.

금지 사항:

- production DB에 restore 실행 금지
- production DB migration 실행 금지
- production docker-compose 수정 금지
- production container restart 금지
- production `.env`를 staging에 그대로 복사 금지
- production LINE credential 사용 금지
- production Telegram credential 사용 금지
- production reverse proxy upstream과 staging upstream 혼용 금지
- 검증되지 않은 bulk write 금지

모든 staging restore 작업은 명령 실행 전 대상 경로, container name, DB name, port를 확인한 뒤 진행한다.
