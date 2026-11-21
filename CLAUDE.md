# CLAUDE.md

## 브랜치 / 배포
- 이 브랜치(`production`)는 NAS 운영 환경과 연결되어 있음. push하면 5분 내 자동 빌드·배포됨.
- 다른 브랜치는 건드리지 말 것.

## 수정 금지
- `docker-compose.yml`
- `.env`
- MySQL 설정 (예: `mysql-low-memory.cnf` 등)

## push 전 필수 확인
backend / frontend 빌드가 통과해야 push 가능.

```bash
cd frontend && npm ci && npm run build
```

```bash
cd backend && npm ci && find src -name '*.js' -exec node --check {} \;
```

(backend는 별도 build 스크립트가 없으므로 의존성 설치 + 문법 검사로 확인)

## 응답 방식
- 한국어로 간결하게.
- 브라우저 확인은 사용자가 직접 함 → 작업 후 확인할 페이지 목록만 보고.
