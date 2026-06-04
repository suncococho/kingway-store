# Production Backend Restart Result

작성일: 2026-06-05 05:10:12 CST  
대상: production backend `kingway-backend` / port `3000`

## 1. 범위

이번 작업에서 수행한 것:

- `sudo docker restart kingway-backend`
- production backend `3000` API smoke test
- 결과 문서화

이번 작업에서 하지 않은 것:

- code 수정
- 수동 DB write query 실행
- frontend `5173` 재배포
- reverse proxy 변경
- LINE webhook 테스트
- 고객 / staff LINE 발송 테스트

주의:

- backend startup code에는 `ensureV2Schema`, default account seed/update 경로가 포함되어 있다.
- 재시작 후 runtime log에서 `Default staff account updated.`가 관찰되었다.
- operator가 별도 `INSERT` / `UPDATE` / `DELETE` / `ALTER` query를 실행하지는 않았다.

## 2. 실행 전 확인

`git status --short`:

- clean

backup directory:

- `/volume1/docker/kingway-store/backups/production-pre-saas/20260605_004301`
- `mysql_kingway_store.sql.gz` 존재

restart 전 backend health:

- `GET /health`
- HTTP `200 OK`
- body: `{"ok":true}`

## 3. Restart 결과

실행 명령:

```sh
sudo docker restart kingway-backend
```

결과:

- restart 성공
- container: `373d88b231b8 kingway-backend`
- status: `Up`
- port: `0.0.0.0:3000->3000/tcp`

startup 관찰:

- `npm install && npm start` 방식이라 listen까지 시간이 걸렸다.
- 초기 health check는 startup 중 `timeout` / `connection reset` / `empty reply`가 발생했다.
- `Backend listening on port 3000` 로그 확인 후 health가 정상화됐다.
- SchemaGuard 경고는 `inventory_movements.store_id`만 남았다.

## 4. Smoke Test

restart 후 health:

- `GET /health`
- HTTP `200 OK`
- body: `{"ok":true}`

인증:

- `POST /api/login`
- HTTP `200`
- token 수신 확인
- user role: `CASHIER`
- storeId: `1`
- storeRole: `staff`
- raw password / raw token은 기록하지 않음

SaaS / dashboard routes:

| API | 결과 | 판정 |
| --- | --- | --- |
| `GET /api/dashboard/summary` | HTTP `200` | 정상 |
| `GET /api/system/saas-status` | HTTP `200` | 정상 |
| `GET /api/store/settings` | HTTP `200` | 인증 상태 정상 |
| `GET /api/store-features/me` | HTTP `200` | 인증 상태 정상 |
| `POST /api/platform-auth/login` without credentials | HTTP `401` | route 존재, 인증 실패 정상 |

기존 API:

| API | 결과 | 판정 |
| --- | --- | --- |
| `GET /api/products` | HTTP `200` | 정상 |
| `GET /api/orders` | HTTP `200` | 정상 |
| `GET /api/repairs` | HTTP `200` | 정상 |
| `GET /api/purchase-confirmations` | HTTP `200` | 정상 |

## 5. 판정

backend restart smoke 결과:

- 통과

해소된 blocker:

- `/api/login`의 `staff_users.store_id` schema 오류 해소
- `/api/dashboard/summary`의 `supplier_requests.store_id` schema 오류 해소
- SaaS route runtime 404 문제 해소

남은 blocker / TODO:

- `inventory_movements.store_id`는 SchemaGuard 경고로 남아 있음
- frontend `5173` 재배포는 아직 수행하지 않음
- reverse proxy 변경은 아직 수행하지 않음
- LINE webhook / 발송 smoke는 의도적으로 수행하지 않음

다음 단계 권장:

- frontend cutover 전 `5173` 배포 계획 별도 실행
- reverse proxy 변경 전 backend/frontend 통합 smoke test
- 후속 schema hardening에서 `inventory_movements.store_id` 검토
