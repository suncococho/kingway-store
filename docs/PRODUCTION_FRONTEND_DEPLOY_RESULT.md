# Production Frontend Deploy Result

작성일: 2026-06-05 05:38:03 CST  
대상: production frontend `kingway-frontend` / port `5173`

## 1. 범위

이번 작업에서 수행한 것:

- `npm --prefix frontend run build`
- `sudo docker compose build frontend`
- `sudo docker compose up -d frontend`
- production frontend `5173` smoke test

이번 작업에서 의도적으로 하지 않은 것:

- source code 수정
- reverse proxy 변경
- LINE webhook 테스트
- 고객 / staff LINE 발송 테스트

중요 관찰:

- 요청된 `sudo docker compose up -d frontend` 실행 중 `depends_on` 영향으로 `kingway-backend`도 `Recreate` 대상이 되었다.
- 이로 인해 backend container가 `373d88b...`에서 `aef7f3f...`로 재생성되고 다시 start 되었다.
- backend startup 과정에서 app bootstrap이 실행되며 `Default staff account updated.` 로그가 남았다.
- operator가 별도 수동 SQL write query를 실행하지는 않았다.

## 2. 실행 전 확인

`git status --short`:

- clean

build 확인:

- `npm --prefix frontend run build`
- 결과: 성공
- 산출물:
  - `dist/index.html`
  - `dist/assets/index-C78SEFUN.js`
  - `dist/assets/index-Bi9YBT4D.css`

build warning:

- `frontend/src/styles.css:4244` 기존 CSS syntax warning
- build 실패 요인은 아님

기존 production `5173` asset:

- JS: `index-AqzjoUEv.js`
- CSS: `index-Bi9YBT4D.css`
- HTTP `200`

## 3. Deploy 실행

실행 명령:

```sh
sudo docker compose build frontend
sudo docker compose up -d frontend
```

결과:

- frontend image build 성공
- frontend container 재생성 성공
- frontend container: `166ea1b2287b`
- frontend status: `running`
- frontend port: `0.0.0.0:5173->80/tcp`

예상 외 영향:

- backend container도 재생성됨
- backend container: `aef7f3fcd86f`
- backend status: `running`
- backend port: `0.0.0.0:3000->3000/tcp`
- backend 재기동 중 일시적으로 `3000` health 실패와 `5173` API proxy `502`가 발생했다.
- `Backend listening on port 3000` 확인 후 정상화됐다.

## 4. 검증 결과

frontend root:

- `GET http://127.0.0.1:5173/`
- HTTP `200`
- 최신 JS asset `index-C78SEFUN.js` 확인
- old JS asset `index-AqzjoUEv.js` 미사용 확인

backend health:

- `GET http://127.0.0.1:3000/health`
- HTTP `200`
- body: `{"ok":true}`

SaaS / auth / dashboard:

| API | 결과 | 판정 |
| --- | --- | --- |
| `GET /api/system/saas-status` | HTTP `200` | 정상 |
| `POST /api/login` | HTTP `200` | 정상 |
| `GET /api/dashboard/summary` | HTTP `200` | 정상 |
| `GET /api/store/settings` | HTTP `200` | 정상 |
| `GET /api/store-features/me` | HTTP `200` | 정상 |

기존 API:

| API | 결과 | 판정 |
| --- | --- | --- |
| `GET /api/products` | HTTP `200` | 정상 |
| `GET /api/orders` | HTTP `200` | 정상 |
| `GET /api/repairs` | HTTP `200` | 정상 |
| `GET /api/purchase-confirmations` | HTTP `200` | 정상 |

인증 테스트 주의:

- smoke test token은 process memory에서만 사용
- raw password / raw token은 문서에 기록하지 않음

## 5. 판정

deploy 결과:

- frontend deploy 성공
- 최신 SaaS frontend build가 production `5173`에 반영됨
- API smoke test 통과

남은 blocker / TODO:

- `docker compose up -d frontend`가 backend까지 recreate한 점은 운영 절차상 blocker로 기록
- 다음부터 frontend 단독 반영 시 `docker compose up -d --no-deps frontend` 사용 필요
- `inventory_movements.store_id`는 backend SchemaGuard warning으로 남아 있음
- `frontend/src/styles.css:4244` CSS syntax warning은 후속 정리 필요
- reverse proxy 변경은 아직 수행하지 않음
- LINE webhook / 발송 smoke는 수행하지 않음
