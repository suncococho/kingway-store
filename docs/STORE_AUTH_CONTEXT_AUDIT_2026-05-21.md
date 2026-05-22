# Store Auth Context Audit - 2026-05-21

## 1. 실행 정보

- date: 2026-05-21
- branch: beta/staging-architecture
- scope: auth/store context read-only audit

## 2. 확인한 명령

```sh
grep -R "jwt\|token\|login\|staff_users\|role" -n backend/src | head -120
```

```sql
SHOW COLUMNS FROM staff_users;
```

## 3. 현재 auth 구조

- `backend/src/routes/auth.js` 존재
- login route 존재
- `jsonwebtoken` 사용
- `jwt.sign()` 사용
- token payload에 `id`, `username`, `role` 포함
- `staff_users`에서 `username`, `password_hash`, `role`, `display_name`, `is_active` 조회

## 4. staff_users 현재 구조

- `id`
- `username`
- `password_hash`
- `display_name`
- `line_user_id`
- `role`
- `is_active`
- `created_at`
- `updated_at`
- `telegram_user_id`
- `telegram_username`

## 5. role enum

현재 role enum:

- `ADMIN`
- `MANAGER`
- `CASHIER`
- `REPAIR`
- `INVENTORY`

## 6. multi-store 관점 분석

- JWT auth는 이미 존재하므로 완전히 새로 만들 필요 없음.
- 기존 auth 구조 위에 `store_id` / `current_store_id` / accessible stores를 확장하는 방향이 적절함.
- `staff_users`에는 아직 `store_id`가 없음.
- store permission model 적용 전 staff-store 관계 설계가 필요함.

## 7. 주의 사항

- staff name 컬럼은 `name`이 아니라 `display_name`.
- `SELECT id, username, name, role` 은 실패함.
- 기존 role enum은 SaaS용 `super_admin` / `store_admin`과 직접 일치하지 않으므로 role mapping 또는 enum 확장 검토가 필요함.

## 8. 위험 사항

- token에 `role`만 있고 `store_id`가 없으면 multi-store scope 불가.
- frontend에서 `store_id`를 보내는 방식만 신뢰하면 위험함.
- backend middleware에서 `request.store_id`를 확정해야 함.

## 9. 다음 단계

- auth token strategy draft 작성
- `staff_store_access` migration draft 작성
- `requireStoreScope` middleware 설계
- staging에서만 실험

## 10. 최종 판정

- PASS for current single-store auth
- PASS WITH WARNING for SaaS extension
- `store_id` 없는 상태로 multi-store production rollout은 BLOCKER
