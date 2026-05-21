# Staging Restore Execution Result

## 1. 실행 정보

- date: 2026-05-21
- branch: beta/staging-architecture
- backup:
  - all_databases_2026-05-21_0600.sql.gz
  - kingway-store_2026-05-21_0600.tar.gz
  - storage_2026-05-21_0600.tar.gz

## 2. Checksum 기록

| 대상 | SHA256 |
|---|---|
| DB | 0647e3f43d57fc9f7021e02a3ef6822f4945fc072b32b4a07780152882029951 |
| Project | 271027e36e8197b2d857c4434e52e22159f7d2f9cf97b96742818f93af31221b |
| Uploads | 9a65409a331a9d5385d9ac9bef057487275d1c27317d69b6dec2247804ad3a0d |

## 3. Staging 환경

| Component | Container | Port |
|---|---|---|
| mysql | kingway-staging-mysql | 3310 |
| backend | kingway-staging-backend | 3010 |
| frontend | kingway-staging-frontend | 5180 |

- DB restored as: `kingway_store`

## 4. 발생한 문제와 해결

### schema.sql permission denied

`schema.sql` 접근 권한 문제로 인해 초기 schema 확인 또는 적용 단계에서 permission denied가 발생했다.

해결:
- staging restore rehearsal 범위에서는 schema 직접 수정 또는 migration 실행 없이 진행했다.
- 권한 문제는 restore 절차상 별도 확인 항목으로 기록했다.

### MYSQL_PORT 3310/3306 구분 문제

staging MySQL은 host port `3310`을 사용하지만, container 내부 MySQL port는 `3306`이다.

해결:
- host 접근과 container 내부 접근의 port 기준을 분리했다.
- staging backend가 접근하는 DB 연결 기준을 compose network 기준으로 재확인했다.

### all_databases restore로 DB명이 kingway_store로 복원됨

`all_databases` 백업을 복원하면서 원래 DB명인 `kingway_store`가 함께 복원되었다.

해결:
- staging DB명도 최종적으로 `kingway_store` 기준으로 정렬했다.
- staging 전용 DB명과 restore 원본 DB명 간 불일치가 발생하지 않도록 compose 설정을 맞췄다.

### docker-compose override가 DB_NAME을 덮어쓴 문제

docker-compose override 설정이 backend의 `DB_NAME` 값을 의도와 다르게 덮어썼다.

해결:
- compose 환경 변수 기준을 재정렬했다.
- backend와 MySQL의 DB 이름 설정을 동일하게 맞췄다.

### mysql user 권한 문제

restore 이후 MySQL user 권한이 staging DB 접근 조건과 맞지 않는 문제가 있었다.

해결:
- staging backend가 사용하는 MySQL user의 대상 DB 접근 권한을 확인했다.
- DB명 정렬 후 접근 가능한 상태로 조정했다.

### 최종 정렬

최종적으로 compose의 `DB_NAME` / `MYSQL_DATABASE`를 `kingway_store`로 정렬했다.

## 5. 검증 결과

| 항목 | 결과 |
|---|---|
| frontend curl | 200 OK |
| backend root route | 404 정상 |
| `/api/products` | JSON 응답 정상 |
| `/api/orders` | Unauthorized 정상 |
| `/api/repairs` | Unauthorized 정상 |
| 브라우저 dashboard 렌더링 | 정상 |
| 중국어 번체 표시 | 정상 |

비고:
- backend root route의 404 응답은 API 서버의 root route 미정의 상태로 판단되며, rehearsal 기준 정상으로 판정했다.
- 인증이 필요한 `/api/orders`, `/api/repairs`의 Unauthorized 응답은 정상 동작으로 판정했다.

## 6. Notification Isolation

- LINE disabled
- Telegram credential missing/skipped
- production notification 발송 없음

## 7. Production 영향 여부

- production DB 변경 없음
- production compose 변경 없음
- production container restart 없음
- production LINE/Telegram 발송 없음

## 8. 최종 판정

**PASS WITH WARNING**

Warning:
- `all_databases` restore는 mysql system DB와 원래 DB명까지 복원하므로 staging DB name 정렬이 필요하다.
- staging restore rehearsal에서는 restore 대상 DB명, compose `DB_NAME`, `MYSQL_DATABASE`, backend DB 연결 설정을 같은 기준으로 맞춰야 한다.

## 9. 다음 단계

- smoke test 확대
- tenant/store_id migration은 별도 단계에서 진행
- feature settings는 이후 단계에서 설계
