# Staging Env Strategy

## 1. Staging `.env` 목적

이 문서는 staging restore rehearsal 전용 `.env` 분리 전략을 정의한다.

staging `.env`의 목적은 다음과 같다.

- production 환경변수와 staging 환경변수를 완전히 분리한다.
- restore rehearsal 대상이 항상 staging DB임을 보장한다.
- LINE, Telegram, email, push notification 등 외부 발송을 차단한다.
- production credential, webhook URL, upload path가 staging에서 사용되지 않도록 한다.
- production 안전을 최우선으로 유지하면서 restore rehearsal을 반복 가능하게 만든다.

## 2. Production `.env`와 완전 분리 원칙

staging restore rehearsal에서는 production `.env`를 그대로 복사하거나 재사용하지 않는다.

원칙:

- staging 전용 env 파일을 사용한다.
- production `.env`를 mount하지 않는다.
- production DB 접속 정보는 staging env에 넣지 않는다.
- production LINE credential은 staging env에 넣지 않는다.
- production Telegram token은 staging env에 넣지 않는다.
- production webhook URL은 staging env에 넣지 않는다.
- production upload path는 staging env에 넣지 않는다.
- 외부 발송 관련 값은 기본적으로 disabled 또는 dry-run으로 둔다.

## 3. Staging DB Env 예시

staging restore rehearsal 전용 DB env 예시는 다음과 같다.

```env
DB_HOST=kingway-staging-mysql
DB_PORT=3306
DB_NAME=kingway_store_staging_restore
DB_USER=kingway_staging
DB_PASSWORD=<staging-only-password>

MYSQL_DATABASE=kingway_store_staging_restore
MYSQL_USER=kingway_staging
MYSQL_PASSWORD=<staging-only-password>
MYSQL_ROOT_PASSWORD=<staging-only-root-password>
```

원칙:

- `DB_NAME`과 `MYSQL_DATABASE`는 `kingway_store_staging_restore`만 사용한다.
- host machine에서 직접 접속할 때만 external port `3310`을 사용한다.
- container 내부 통신은 MySQL internal port `3306`을 사용한다.
- production DB name, user, password를 사용하지 않는다.

## 4. Staging Backend Port 예시

staging backend port 예시는 다음과 같다.

```env
PORT=3000
BACKEND_INTERNAL_PORT=3000
BACKEND_PUBLIC_PORT=3010
```

원칙:

- container 내부 backend port는 `3000`을 사용할 수 있다.
- host 노출 port는 `3010`으로 분리한다.
- production backend port와 충돌하지 않는다.
- smoke test는 staging backend endpoint만 대상으로 한다.

## 5. Staging Frontend URL 예시

staging frontend URL 예시는 다음과 같다.

```env
FRONTEND_URL=http://localhost:5180
PUBLIC_FRONTEND_URL=http://<staging-host>:5180
API_BASE_URL=http://<staging-host>:3010
VITE_API_BASE_URL=http://<staging-host>:3010
```

원칙:

- frontend는 staging backend만 바라본다.
- production API URL을 사용하지 않는다.
- production domain을 staging frontend URL로 사용하지 않는다.
- reverse proxy를 사용할 경우에도 production upstream과 분리한다.

## 6. Staging JWT Secret 분리 원칙

staging JWT secret은 production과 반드시 달라야 한다.

원칙:

- production `JWT_SECRET`을 staging에 복사하지 않는다.
- staging 전용 random secret을 사용한다.
- restore rehearsal 중 production login token이 staging에서 유효하면 안 된다.
- staging token이 production에서 유효하면 안 된다.

예시:

```env
JWT_SECRET=<staging-only-random-secret>
JWT_EXPIRES_IN=1d
```

## 7. Production LINE Credential 사용 금지

staging restore rehearsal에서는 production LINE credential을 사용하지 않는다.

금지 대상:

- production LINE channel secret
- production LINE channel access token
- production LINE login channel id
- production LINE login channel secret
- production LINE Official Account 관련 credential

원칙:

- staging env에는 production LINE credential을 넣지 않는다.
- LINE 발송 기능은 disabled 또는 dry-run으로 둔다.
- 필요한 경우에도 별도 staging/test LINE credential만 사용한다.
- 고객에게 실제 LINE 메시지가 발송되면 안 된다.

## 8. Production Telegram Token 사용 금지

마스터 스펙 기준으로 KINGWAY 운영 workflow는 LINE-first이며 Telegram 기반 workflow를 재도입하지 않는다.

staging restore rehearsal에서는 production Telegram token을 사용하지 않는다.

금지 대상:

- production Telegram bot token
- production Telegram chat id
- production Telegram group id

원칙:

- staging env에는 Telegram credential을 넣지 않는다.
- Telegram notification은 disabled 또는 mock 상태로 둔다.
- smoke test 성공 기준에 Telegram 발송을 포함하지 않는다.

## 9. Production Webhook URL 사용 금지

staging restore rehearsal에서는 production webhook URL을 사용하지 않는다.

금지 대상:

- production LINE webhook URL
- production payment webhook URL
- production notification webhook URL
- production third-party integration webhook URL

원칙:

- webhook URL은 staging 전용 URL이거나 disabled 상태여야 한다.
- production domain webhook을 staging env에 넣지 않는다.
- 외부 서비스의 production callback이 staging backend로 향하지 않도록 한다.
- staging restore rehearsal 중 외부 webhook을 실제 처리하지 않는다.

## 10. Staging Webhook Disable 전략

staging restore rehearsal에서는 webhook 처리를 기본적으로 비활성화한다.

예시:

```env
WEBHOOKS_ENABLED=false
LINE_WEBHOOK_ENABLED=false
PAYMENT_WEBHOOK_ENABLED=false
EXTERNAL_WEBHOOK_ENABLED=false
```

전략:

- webhook route가 호출되더라도 실제 상태 변경을 막는다.
- 외부 API 호출은 dry-run 또는 mock 처리한다.
- webhook signature 검증용 production secret을 사용하지 않는다.
- 필요한 smoke test는 "비활성화 상태 확인"까지만 수행한다.

## 11. Staging Email / Push Notification Disable 전략

staging restore rehearsal에서는 email, push notification, 외부 알림 발송을 비활성화한다.

예시:

```env
EMAIL_ENABLED=false
PUSH_NOTIFICATIONS_ENABLED=false
NOTIFICATIONS_ENABLED=false
NOTIFICATION_DRY_RUN=true
```

원칙:

- production SMTP credential을 사용하지 않는다.
- production push provider credential을 사용하지 않는다.
- customer-facing notification을 발송하지 않는다.
- 관리자 / 직원 / 공급사에게 실제 알림이 발송되지 않도록 한다.
- smoke test는 알림 발송이 차단되는지 확인한다.

## 12. Production Upload Path Mount 금지

staging restore rehearsal에서는 production upload path를 mount하지 않는다.

금지 대상:

- production product image upload path
- production customer file path
- production purchase confirmation PDF path
- production repair attachment path
- production shared upload volume

원칙:

- staging 전용 upload path 또는 staging 전용 volume을 사용한다.
- production file volume을 read-write로 mount하지 않는다.
- production file volume을 staging 앱의 runtime path로 사용하지 않는다.
- restore rehearsal에서 파일 검증이 필요하면 별도 staging copy를 사용한다.

예시:

```env
UPLOAD_DIR=/app/uploads-staging
PURCHASE_CONFIRMATION_PDF_DIR=/app/uploads-staging/purchase-confirmations
```

## 13. Staging Env 파일 보안 원칙

staging env 파일도 secret 파일로 취급한다.

원칙:

- repository에 commit하지 않는다.
- 접근 권한을 제한한다.
- production secret을 포함하지 않는다.
- staging secret도 채팅, 문서, 로그에 평문으로 남기지 않는다.
- restore rehearsal 종료 후 불필요한 임시 credential은 폐기한다.
- env 검증 시 secret 값 전체를 출력하지 않는다.

## 14. Git Ignore 원칙

staging env 파일은 git 추적 대상이 아니어야 한다.

권장 ignore 대상:

```gitignore
.env
.env.*
!.env.example
!.env.template
```

원칙:

- 실제 secret이 들어간 `.env.staging-restore`는 commit하지 않는다.
- 예시 파일이 필요하면 secret 없는 `.env.staging-restore.example`만 작성한다.
- git add 전에는 env 파일이 staging되지 않았는지 확인한다.
- 이번 문서 작업 범위에서는 실제 `.env` 또는 `.gitignore` 파일을 수정하지 않는다.

## 15. Restore Rehearsal 전 Env 검증 체크리스트

restore rehearsal 실행 전 다음을 확인한다.

- staging env 파일이 production `.env`와 별도이다.
- `DB_HOST=kingway-staging-mysql`이다.
- `DB_NAME=kingway_store_staging_restore`이다.
- `MYSQL_DATABASE=kingway_store_staging_restore`이다.
- host MySQL port는 `3310`이다.
- backend host port는 `3010`이다.
- frontend host port는 `5180`이다.
- `JWT_SECRET`이 production과 다르다.
- production LINE credential이 없다.
- production Telegram token이 없다.
- production webhook URL이 없다.
- webhook 관련 env가 disabled 상태이다.
- email / push notification 관련 env가 disabled 또는 dry-run 상태이다.
- production upload path를 사용하지 않는다.
- production DB host, user, password가 없다.
- production domain을 API base URL로 사용하지 않는다.
- env 출력 로그에 secret 전체가 노출되지 않는다.

## 16. Production Safety 최우선 원칙

production safety가 staging restore rehearsal의 최우선 기준이다.

금지 사항:

- production `.env` 복사 금지
- production DB credential 사용 금지
- production LINE credential 사용 금지
- production Telegram token 사용 금지
- production webhook URL 사용 금지
- production upload path mount 금지
- production SMTP / push credential 사용 금지
- production API URL을 staging frontend에 설정 금지
- production DB 또는 volume을 restore rehearsal 대상으로 사용 금지

staging env는 production과 연결되지 않은 독립 설정이어야 하며, restore rehearsal 실행 전 env 값을 먼저 검증해야 한다.
