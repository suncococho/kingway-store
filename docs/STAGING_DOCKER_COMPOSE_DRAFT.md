# Staging Docker Compose Draft

## 1. 목적

이 문서는 운영 KINGWAY 환경과 완전히 분리된 staging restore rehearsal 전용 `docker-compose` 설계 초안을 정의한다.

목적은 다음과 같다.

- production 백업 restore 절차를 staging에서 사전 검증한다.
- rollback rehearsal을 production 영향 없이 반복 수행한다.
- staging container, port, DB, volume, network를 production과 명확히 분리한다.
- LINE webhook, Telegram notification, 외부 알림이 production으로 발송되지 않도록 차단한다.
- 실제 compose 파일 생성 전 안전 기준과 예시 구조를 문서화한다.

## 2. Production Docker Compose와 분리 원칙

staging restore rehearsal compose는 production compose와 독립되어야 한다.

분리 원칙:

- production `docker-compose.yml`을 수정하지 않는다.
- staging compose는 별도 파일로만 설계한다.
- staging compose는 별도 project name을 사용한다.
- container name, volume name, network name은 모두 `staging`을 포함한다.
- production DB container, production volume, production network를 참조하지 않는다.
- restore 대상은 staging DB만 허용한다.
- production 환경변수 파일을 그대로 사용하지 않는다.

## 3. Staging Container 이름

staging restore rehearsal container 이름은 다음으로 고정한다.

```text
kingway-staging-mysql
kingway-staging-backend
kingway-staging-frontend
```

운영 container와 혼동하지 않도록 모든 이름에 `staging`을 포함한다.

## 4. Staging 포트

staging restore rehearsal 환경은 production과 다른 host port를 사용한다.

```text
mysql:    3310 -> 3306
backend:  3010 -> 3000
frontend: 5180 -> 80
```

원칙:

- host port는 production과 겹치면 안 된다.
- container 내부 port는 기존 애플리케이션 구조를 유지할 수 있다.
- 외부 접속 및 smoke test는 staging port만 사용한다.

## 5. Staging DB

staging restore rehearsal 전용 DB 이름은 다음으로 고정한다.

```env
MYSQL_DATABASE=kingway_store_staging_restore
```

원칙:

- restore 명령은 반드시 `kingway_store_staging_restore`를 대상으로 한다.
- production DB name을 staging compose에 넣지 않는다.
- backend staging `.env`도 동일한 staging DB name을 사용해야 한다.
- migration 또는 destructive write는 별도 승인 없이는 실행하지 않는다.

## 6. Staging Volume / Network 이름

staging 전용 volume 예시:

```text
kingway-staging-mysql-data
kingway-staging-uploads
```

staging 전용 network 예시:

```text
kingway-staging-network
```

원칙:

- production volume을 mount하지 않는다.
- production upload volume을 공유하지 않는다.
- production network에 staging container를 연결하지 않는다.
- volume과 network 이름에는 반드시 `staging`을 포함한다.

## 7. Staging `.env` 분리 원칙

staging compose는 production `.env`를 그대로 사용하지 않는다.

staging `.env` 원칙:

- 별도 staging `.env` 파일을 사용한다.
- `NODE_ENV` 또는 환경 식별자는 staging restore 목적이 드러나야 한다.
- DB host는 `kingway-staging-mysql`을 사용한다.
- DB port는 container 내부 기준 `3306`, host 접속 기준 `3310`을 구분한다.
- DB name은 `kingway_store_staging_restore`만 사용한다.
- backend port는 `3000`, host 노출은 `3010`으로 둔다.
- frontend API endpoint는 staging backend만 바라본다.
- production LINE credential을 넣지 않는다.
- production Telegram credential을 넣지 않는다.
- 외부 발송 기능은 기본값 `disabled` 또는 `dry-run`으로 둔다.

## 8. LINE Webhook 비활성화 원칙

KINGWAY 시스템은 LINE-first architecture를 유지하지만, staging restore rehearsal 환경에서는 실제 LINE webhook을 비활성화한다.

원칙:

- staging backend를 LINE Official Account webhook URL로 등록하지 않는다.
- production LINE channel secret / access token을 staging에 넣지 않는다.
- LINE push, reply, multicast 등 외부 발송 기능은 disabled 또는 dry-run 처리한다.
- restore rehearsal 중 고객에게 LINE 메시지가 발송되면 안 된다.
- LINE 관련 smoke test는 "발송 차단 확인"까지만 수행한다.

## 9. Telegram Notification 비활성화 원칙

마스터 스펙 기준으로 KINGWAY 운영 workflow는 LINE-first이며 Telegram 기반 workflow를 재도입하지 않는다.

staging restore rehearsal 환경에서는 Telegram notification을 비활성화한다.

원칙:

- production Telegram bot token / chat id를 staging `.env`에 넣지 않는다.
- Telegram notification service는 disabled 또는 mock 상태로 둔다.
- smoke test 성공 기준에 Telegram 발송을 포함하지 않는다.
- legacy Telegram workflow를 staging compose 설계에 포함하지 않는다.

## 10. Production DB / Volume 절대 Mount 금지

staging compose에서는 production DB와 production volume을 절대 mount하지 않는다.

금지 사항:

- production MySQL volume mount 금지
- production upload volume mount 금지
- production backup directory를 writable mount로 연결 금지
- production `.env` mount 금지
- production container와 `volumes_from` 사용 금지
- production network 공유 금지
- production DB host를 backend staging env에 지정 금지

restore rehearsal은 backup dump 파일을 staging DB에 import하는 방식으로만 수행한다.

## 11. Restore Rehearsal에서만 사용하는 Compose 예시

아래 예시는 문서용 초안이며, 실제 파일이 아니다.

```yaml
name: kingway-staging-restore

services:
  mysql:
    image: mysql:8
    container_name: kingway-staging-mysql
    restart: unless-stopped
    ports:
      - "3310:3306"
    environment:
      MYSQL_DATABASE: kingway_store_staging_restore
      MYSQL_USER: kingway_staging
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    volumes:
      - kingway-staging-mysql-data:/var/lib/mysql
    networks:
      - kingway-staging-network

  backend:
    build:
      context: ./backend
    container_name: kingway-staging-backend
    restart: unless-stopped
    ports:
      - "3010:3000"
    env_file:
      - .env.staging-restore
    environment:
      DB_HOST: kingway-staging-mysql
      DB_PORT: 3306
      DB_NAME: kingway_store_staging_restore
      LINE_WEBHOOK_ENABLED: "false"
      LINE_MESSAGING_ENABLED: "false"
      TELEGRAM_NOTIFICATIONS_ENABLED: "false"
      NOTIFICATION_DRY_RUN: "true"
    depends_on:
      - mysql
    networks:
      - kingway-staging-network

  frontend:
    build:
      context: ./frontend
    container_name: kingway-staging-frontend
    restart: unless-stopped
    ports:
      - "5180:80"
    depends_on:
      - backend
    networks:
      - kingway-staging-network

volumes:
  kingway-staging-mysql-data:
  kingway-staging-uploads:

networks:
  kingway-staging-network:
    driver: bridge
```

주의:

- 이 예시는 restore rehearsal 전용 구조를 설명하기 위한 초안이다.
- 실제 repository의 compose, build context, env key와 다를 수 있다.
- 실제 파일 생성 전 현재 production compose 구조를 읽고 staging용으로 별도 설계해야 한다.
- production compose를 수정해서 staging을 추가하지 않는다.

## 12. 실행 전 체크리스트

실행 전 반드시 다음을 확인한다.

- 현재 작업 대상이 staging restore rehearsal인지 확인했다.
- production compose 파일을 수정하지 않았다.
- staging compose 파일이 production compose와 별도이다.
- container 이름이 모두 `kingway-staging-*` 형식이다.
- host port가 `3310`, `3010`, `5180`으로 분리되어 있다.
- DB name이 `kingway_store_staging_restore`이다.
- staging volume 이름에 `staging`이 포함되어 있다.
- staging network 이름에 `staging`이 포함되어 있다.
- production DB volume을 mount하지 않았다.
- production upload volume을 mount하지 않았다.
- production `.env`를 그대로 사용하지 않았다.
- LINE webhook이 비활성화되어 있다.
- LINE 발송 credential이 staging에 없다.
- Telegram notification이 비활성화되어 있다.
- Telegram credential이 staging에 없다.
- restore 대상 DB가 production이 아닌 staging DB임을 확인했다.
- migration 실행 계획이 없다.
- 서버 재시작 또는 production container restart 계획이 없다.

## 13. 절대 Production Compose를 수정하지 않는 원칙

staging restore rehearsal을 위해 production `docker-compose.yml`을 수정하지 않는다.

원칙:

- production compose에 staging service를 추가하지 않는다.
- production compose의 port, volume, network, env를 변경하지 않는다.
- production compose의 container name을 변경하지 않는다.
- production compose의 DB service를 staging restore 용도로 사용하지 않는다.
- production compose 변경이 필요해 보이면 즉시 중단하고 별도 승인 절차를 거친다.

staging restore rehearsal은 production 안전을 최우선으로 하며, production compose와 독립된 별도 compose 설계로만 진행한다.
