# Production T1 Product Seed Plan

작성일: 2026-06-05  
대상 SQL 초안: [production_add_t1_product.sql](/volume1/docker/kingway-store/sql/production_add_t1_product.sql)

## 1. 목적

이 문서는 production `3306`에 누락된 `C-EB-001-S1 / T1` 상품 1건을 추가하기 위한 실행 초안을 설명한다.

이번 문서와 SQL은 `draft only`다.

이번 turn에서 하지 않은 것:

- production DB 변경
- SQL 실행
- merge SQL 실행
- 재고 조정

## 2. 왜 필요한가

현재 staging -> production 병합 권장 범위에는 아래 `order_items` 4건이 포함되어 있다.

- `POS-20260604-195007-858`
- `POS-20260604-195011-413`
- `POS-20260604-195640-286`
- `POS-20260604-195644-098`

이 4건은 모두 `sku_snapshot='C-EB-001-S1'`를 참조한다.

하지만 production `3306`에는 현재:

- 동일 `sku='C-EB-001-S1'` 없음
- `name='T1'` exact match 없음
- `sku LIKE 'C-EB-%'` row 없음

따라서 이 product row가 먼저 없으면 merge SQL의 `order_items` block은 실행하면 안 된다.

## 3. 확인된 staging 근거

staging `3310` `products` read-only 확인 결과:

- `sku = C-EB-001-S1`
- `name = T1`
- `category = EB`
- `price = 47000.00`
- `stock = -3`
- `store_id = 1`
- `is_active = 1`
- `created_at = 2026-05-27 13:07:41`
- `updated_at = 2026-06-04 19:56:54`

추가 관찰:

- staging에는 명시적 rehearsal/test SKU도 별도로 존재한다.
  - `C-EB-901-RH5 / KW_REHEARSAL_CONFIRM_BIKE`
- 반면 `C-EB-001-S1 / T1`는 실제 고객 주문 흐름에 연결되어 있다.

판단:

- `C-EB-001-S1 / T1`는 테스트 상품이 아니라 실제 운영 상품으로 보는 것이 타당하다.

## 4. 연결 주문 4건

merge blocker가 된 연결 주문 4건:

- `POS-20260604-195007-858`
- `POS-20260604-195011-413`
- `POS-20260604-195640-286`
- `POS-20260604-195644-098`

공통점:

- 모두 `quantity = 1`
- 모두 `unit_price = 47000.00`
- 모두 `line_total = 47000.00`

## 5. stock 처리 정책

가장 중요한 설계 포인트는 `stock`이다.

staging 원본 값은 `-3`이지만, 이번 초안에서는 그대로 복사하지 않는 것을 권장한다.

권장안:

- production seed 시 `stock = 0`

이유:

1. `-3`은 staging 누적 판매/재고 흐름의 결과값이다.
2. 이번 단계는 product master row 1건을 추가하는 것이지, inventory history를 재현하는 단계가 아니다.
3. production에 product row만 먼저 만들면서 음수 재고를 직접 seed 하면, 근거 없는 초기 음수 상태가 먼저 생긴다.
4. 이후 merge SQL로 `order_items`를 반입하더라도 재고 차감 정책은 별도 검토가 필요하다.

따라서:

- 이번 seed는 `stock = 0`
- 재고 정합성은 merge 및 운영 재고 기준을 포함한 별도 reconciliation 단계에서 다룬다.

## 6. SQL 원칙

초안 SQL의 원칙:

1. `START TRANSACTION`
2. preview SELECT 포함
3. exact-match 존재 여부 먼저 확인
4. similar SKU / name preview 포함
5. `INSERT ... SELECT FROM DUAL WHERE NOT EXISTS (...)`
6. `store_id = 1`
7. `sku = 'C-EB-001-S1'`
8. `name = 'T1'`
9. `category = 'EB'`
10. `price = 47000.00`
11. `stock = 0`
12. `COMMIT` 주석 처리

## 7. 실행 전 검증

실행 전 반드시 확인:

1. production full backup 완료
2. `products`에 `sku='C-EB-001-S1'`가 아직 없음
3. `name='T1' AND category='EB' AND store_id=1` row가 아직 없음
4. preview에서 유사 SKU/name을 사람이 검토
5. merge blocker 주문 4건이 여전히 같은 SKU를 참조하는지 확인

## 8. 실행 후 검증

실행 직후 current transaction 안에서 확인해야 할 것:

1. `products`에 `C-EB-001-S1` row 1건이 보이는지
2. 값이 아래와 일치하는지
   - `name = T1`
   - `category = EB`
   - `price = 47000.00`
   - `stock = 0`
   - `store_id = 1`
   - `is_active = 1`
3. 중복 SKU가 생기지 않았는지

## 9. rollback 방법

이 SQL 초안은 DML only다.

따라서 가장 안전한 rollback은:

1. preview 확인
2. 이상 있으면 `ROLLBACK`
3. session 종료 전 `COMMIT` 금지

주의:

- 이번 문서는 실행 초안일 뿐이며, 실제 실행 전에는 다시 production 상태를 재검증해야 한다.

## 10. 결론

현재 기준 권장 방향은 아래와 같다.

1. production에 `C-EB-001-S1 / T1` product row를 먼저 seed
2. stock은 `0`으로 보수적으로 시작
3. 그 다음 merge SQL preview를 다시 확인
4. 이후에만 `order_items` 병합 실행 여부를 별도 승인
