# Staging to Production Merge Execution Plan

작성일: 2026-06-05  
대상 SQL 초안: [staging_to_production_merge_recommended_36.sql](/volume1/docker/kingway-store/sql/staging_to_production_merge_recommended_36.sql)

## 1. 목적

이 문서는 `STAGING_TO_PRODUCTION_MERGE_REVIEW.md`에서 병합 권장으로 분류된 36건만 production `3306`에 반영하기 위한 실행 계획 문서다.

이번 문서와 SQL은 `draft only`다.

실행하지 않은 것:

- DB 변경
- migration 실행
- 배포
- production write

## 2. 범위

이번 SQL 초안 범위:

- `customers`: 13
- `orders`: 20
- `order_items`: 48
  - 주의: 권장 주문 20건의 종속 row
- `repair_orders`: 2
- `purchase_confirmations`: 1

이번 SQL에서 제외:

- `manual review` 32건 전부 제외
- `exclude recommended` 4건 전부 제외
- `excluded_test_like.csv` 20건 전부 제외
- `PENDING + has_pdf=no` 구매확인 22건 전부 제외

## 3. 핵심 전제조건

SQL 실행 전 반드시 충족해야 할 조건:

1. production full backup 완료
2. production 파일 백업 완료
3. target table에 `store_id` 컬럼이 이미 존재
4. SQL preview 결과에서 missing mapping이 0
5. 승인되지 않은 test/manual row가 포함되지 않음

### 3-1. store_id prerequisite

현재 감사 문서 기준 production에는 아직 아래 `store_id` 컬럼이 없다.

- `customers.store_id`
- `orders.store_id`
- `order_items.store_id`
- `repair_orders.store_id`
- `purchase_confirmations.store_id`

따라서 이 SQL은 **store_id schema migration 이후에만** 실행 가능하다.

### 3-2. product prerequisite

현재 추천 주문 20건의 order item 중 아래 SKU가 production에 없을 가능성이 있다.

- `C-EB-001-S1`

영향 주문:

- `POS-20260604-195007-858`
- `POS-20260604-195011-413`
- `POS-20260604-195640-286`
- `POS-20260604-195644-098`

이 SKU가 production에 없으면:

- customer/order insert는 가능할 수 있어도
- `order_items` insert는 막아야 한다.

초안 SQL은 preview에서 이 문제를 표시하고, missing SKU가 있으면 `order_items` block을 실행하지 말아야 하도록 설계했다.

## 4. 실행 전 백업 필수

실행 전 필수:

- production DB dump
- `backend/uploads`
- `backend/storage/pdfs`
- `.env`
- `docker-compose.yml`
- 현재 git commit hash

참조:

- [PRODUCTION_MIGRATION_BACKUP_RUNBOOK.md](/volume1/docker/kingway-store/docs/PRODUCTION_MIGRATION_BACKUP_RUNBOOK.md)

## 5. 실행 전 row count

초안 실행 전 production 기준 row count를 기록해야 한다.

대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`

권장 SQL:

```sql
SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'repair_orders', COUNT(*) FROM repair_orders
UNION ALL SELECT 'purchase_confirmations', COUNT(*) FROM purchase_confirmations;
```

## 6. SQL 구성 원칙

초안 SQL의 원칙:

1. `START TRANSACTION`
2. source row는 temporary source table로 inline 고정
3. `NOT EXISTS` 기반 중복 방지
4. `store_id=1` 강제
5. `customers -> orders -> order_items -> repair_orders -> purchase_confirmations` 순서
6. preview SELECT 포함
7. `COMMIT` 주석 처리

## 7. 실행 순서

1. production clone 또는 rehearsal DB에서 먼저 실행
2. preview 결과 확인
3. missing SKU / missing customer mapping / duplicate preview가 0인지 확인
4. insert block 실행 결과 확인
5. post-insert row count 확인
6. 승인되면 production에서 같은 절차 반복
7. 마지막에만 `COMMIT`

## 8. 실행 후 row count 기대값

권장 기대 증가량:

- `customers`: +13
- `orders`: +20
- `order_items`: +48
  - 단, missing SKU가 있으면 48 미만이 될 수 있으므로 실행 금지
- `repair_orders`: +2
- `purchase_confirmations`: +1

## 9. rollback 방법

가장 안전한 rollback 순서:

1. transaction 안에서 검토
2. 이상이 있으면 `ROLLBACK`
3. session 종료 전 `COMMIT` 금지

권장:

- production 직접 실행 시에는 `COMMIT`을 uncomment 하지 말고
- preview와 inserted row를 사람이 확인한 뒤 마지막에만 수동으로 `COMMIT`

실행 중 이상 징후 예:

- missing SKU preview row 존재
- missing customer mapping 존재
- duplicate preview row 존재
- post-insert count가 기대값과 다름

## 10. manual review 32건 제외 확인

이번 SQL은 아래 32건을 제외한다.

- orders 수동 확인 4건
- purchase_confirmations 수동 확인 22건
- repair_orders 수동 확인 6건

따라서 SQL 초안은 검토 승인된 최소 범위만 다룬다.

## 11. exclude 4건 제외 확인

이번 SQL은 review 단계에서 제외 권장된 4건을 다루지 않는다.

제외 대상:

- `repair_orders` 4건

## 12. 가장 중요한 위험

가장 중요한 위험은 아래 2가지다.

1. `C-EB-001-S1` SKU 미존재 상태에서 order item merge를 진행하는 것
2. `purchase_confirmations` manual review 22건을 실수로 반입하는 것

따라서:

- preview에서 missing SKU가 한 건이라도 나오면 실행 중단
- purchase confirmation insert는 1건만 포함되었는지 다시 확인

## 13. 결론

현재 초안은 “실행 가능한 SQL”이 아니라 “승인 가능한 최소 병합 스크립트 초안”이다.

핵심 요약:

- 병합 대상: 권장 36건 + 종속 order_items 48건
- manual review 32건 제외
- exclude 4건 제외
- `PENDING + has_pdf=no` 구매확인 22건 제외
- 실제 실행은 하지 않았음
