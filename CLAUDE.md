# CLAUDE.md

프로젝트 규칙은 `AGENTS.md`와 `docs/KINGWAY_STORE_MASTER_SPEC.md`를 따른다. 아래는 추가 운영 규칙이다.

## 브랜치 / 배포
- `production` 브랜치 = NAS 운영 소스. push하면 자동 배포된다.
- 다른 브랜치는 건드리지 말 것 (생성·수정·push·삭제 금지).
- 강제 push 금지.

## 수정 금지
- `docker-compose*.yml`
- `.env` (및 모든 env 파일)
- DB 스키마 (migration, `ALTER TABLE`, `database/schema.sql` 등). 컬럼이 필요하면 만들지 말고 보고.

## push 전 필수 확인
frontend 빌드와 backend 문법검사가 모두 통과해야 push 가능.

```bash
cd frontend && npm ci && npm run build
```

```bash
cd backend && npm ci && find src -name '*.js' -exec node --check {} \;
```

## 응답 방식
- 한국어로 간결하게.
- 브라우저 확인은 사용자가 직접 함 → 작업 후 확인할 화면 목록만 보고.
