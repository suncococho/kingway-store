# Staging Phase 1A Execution Checklist

## 1. 목적

이 문서는 store_id Phase 1A rehearsal 실행 전 안전 절차를 정의한다.

목적은 다음과 같다.

- store_id Phase 1A rehearsal 실행 전 안전 절차 정의
- staging-only execution 기준 정리
- production 사고 방지

## 2. 현재 상태 확인

- staging restore environment running
- backend / frontend / mysql container running
- migration SQL draft 존재
- production untouched
- git working tree clean 확인 필요

## 3. 절대 금지

- production DB 실행
- production container 실행
- production credential 사용
- rollback 계획 없이 실행
- verification 없이 다음 단계 진행

## 4. Execution 전 필수 Precheck

- 현재 branch 확인
- git status clean 확인
- docker ps 확인
- `kingway-staging-mysql` container 확인
- 현재 DB 이름 확인
- backup / checksum 존재 확인
- rehearsal 시작 시간 기록

## 5. Schema Precheck

각 대상 테이블에 대해 다음 명령으로 `store_id` 존재 여부를 확인한다.

```sql
SHOW COLUMNS FROM table_name LIKE 'store_id';
```

대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `products`
- `coupons`
- `inventory_movements`
- `supplier_requests`
- `purchase_confirmations`
- `staff_users`

`store_id` 이미 존재 시:

- `ALTER TABLE` 실행 중단
- 상태 기록
- 원인 확인

## 6. Index Precheck

각 대상 테이블에 대해 index 상태를 확인한다.

```sql
SHOW INDEX FROM table_name;
```

중복 index 발견 시:

- `CREATE INDEX` 실행 중단
- 상태 기록

## 7. Rehearsal Execution 순서

순서:

1. `stores` 테이블 생성
2. 기본 store insert
3. nullable `store_id` 추가
4. `store_id` index 추가
5. backfill 실행
6. verification query 실행

각 단계마다:

- 성공 여부 기록
- 에러 발생 시 즉시 중단

## 8. Verification Checklist

- `stores` row 확인
- missing `store_id` count 확인
- row count 이상 여부 확인
- backend startup 이상 여부 확인
- API basic response 확인
- dashboard 기본 동작 확인

## 9. Stop Conditions

다음 상황 시 즉시 중단한다.

- production DB 의심
- 예상 외 schema 차이
- `ALTER` 실패
- row count mismatch
- backend startup 실패
- dashboard / API 이상

## 10. Rollback 기준

- destructive rollback 금지
- 실패 시 staging restore volume 재생성
- 필요 시 backup restore 재수행
- production rollback과 분리

## 11. Rehearsal 후 기록

- 실행 시간
- 실행자
- 실행 branch
- 실행 DB / container
- 성공 / 실패 여부
- 에러 로그
- verification 결과
- 다음 조치

## 12. 최종 원칙

- rehearsal PASS 전 production 금지
- query scope 적용 전 production 사용 금지
- store isolation 검증 전 rollout 금지
- backend scope 적용 전 SaaS 공개 금지
