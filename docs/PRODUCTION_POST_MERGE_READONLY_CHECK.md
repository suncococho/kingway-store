# Production Post-Merge Read-Only Check

작성일: 2026-06-05  
대상 환경: production `127.0.0.1:3306`, backend `3000`, frontend `5173`

## 1. 목적

이 문서는 staging `3310` -> production `3306` 선별 병합 완료 후 production 데이터 정합성을 read-only로 재확인한 결과를 기록한다.

이번 turn에서 하지 않은 것:

- DB write
- code 수정
- 배포
- `5173` 코드 승격

## 2. Row Count 결과

production 최종 row count:

- `customers = 158`
- `products = 385`
- `orders = 92`
- `order_items = 218`
- `repair_orders = 22`
- `purchase_confirmations = 21`
- `coupons = 30`

판정:

- 요청 기대값과 일치

## 3. store_id 검증

### 3-1. `store_id IS NULL`

아래 테이블은 모두 `0`:

- `customers`
- `products`
- `orders`
- `order_items`
- `repair_orders`
- `purchase_confirmations`
- `coupons`

### 3-2. `store_id = 1` count

현재 production 주요 table은 전부 `store_id = 1`로 집계된다.

- `customers = 158`
- `products = 385`
- `orders = 92`
- `order_items = 218`
- `repair_orders = 22`
- `purchase_confirmations = 21`
- `coupons = 30`

판정:

- `store_id` backfill / seed 상태는 현재 기준 정상

## 4. 연결 검증

### 4-1. 병합된 orders 20건

병합된 주문 20건은 모두 `order_items`와 연결됨:

- `merged_orders_with_items = 20`

### 4-2. 병합된 purchase confirmation 1건

병합된 구매확인 1건은 `order`와 연결됨:

- `merged_purchase_confirmation_link = 1`

### 4-3. T1 상품 확인

production `products`에서 아래 row 확인:

- `sku = C-EB-001-S1`
- `name = T1`
- `category = EB`
- `price = 47000.00`
- `stock = 0`
- `store_id = 1`
- `is_active = 1`

판정:

- merge blocker였던 `C-EB-001-S1 / T1`는 production에 존재

## 5. Duplicate 검증

### 5-1. order number duplicate

- `order_no_duplicates = 0`

### 5-2. purchase confirmation token duplicate

- `purchase_confirmation_token_duplicates = 0`

### 5-3. customer phone duplicate

- `customer_phone_duplicates = 2`

상세:

- `0909809300` -> customer ids `67,133`
- `0983092678` -> customer ids `80,97`

해석:

- 이번 merge로 생긴 신규 충돌이라기보다, production 내 기존 customer identity 정리 이슈로 보인다.
- 즉시 write 수정은 하지 않았고, 별도 conservative identity review가 필요하다.

### 5-4. purchase confirmation order duplicate

- `purchase_confirmation_order_duplicates = 2`

상세:

- `order_id = 48`, `order_no = CSV-2944`, duplicate count `6`
- purchase confirmation ids: `4,5,6,7,8,9`

해석:

- 이는 이번 merge 대상 주문이 아니라 기존 production legacy 데이터 이슈다.
- 이번 merge로 추가된 `POS-20260531-184150-171` purchase confirmation 1건에는 duplicate 징후가 없다.

## 6. Health Check

### 6-1. Backend `3000`

`GET http://127.0.0.1:3000/health`

결과:

- HTTP `200 OK`
- body: `{\"ok\":true}`

판정:

- backend health 정상

### 6-2. Frontend `5173`

`GET http://127.0.0.1:5173/`

결과:

- HTTP `200 OK`
- `nginx/1.27.5`
- HTML entry 응답 확인
- title: `Kingway Admin`
- asset references:
  - `/assets/index-AqzjoUEv.js`
  - `/assets/index-Bi9YBT4D.css`

판정:

- frontend `5173`는 응답 중
- 다만 이것은 정적 entry 응답 확인이며, 기능 검증이나 code promotion 승인과 동일하지는 않음

## 7. 결론

read-only 검증 기준으로 보면:

1. post-merge row count는 기대값과 일치
2. `store_id`는 주요 table에서 모두 정상
3. 병합된 orders / purchase confirmation 연결은 정상
4. `C-EB-001-S1 / T1`는 production에 정상 존재
5. backend `3000` health 정상
6. frontend `5173` 응답 정상

남은 주의사항:

1. production 전체 기준 `customer phone duplicate = 2`
2. production 전체 기준 `purchase confirmation order duplicate = 2`
3. 위 2개는 이번 merge 신규 오류보다는 기존 legacy data issue로 보이며, 별도 정리 계획이 필요

production 코드 승격 가능 여부:

- `조건부 보류`

이유:

- 이번 merge 자체의 핵심 정합성은 통과했지만,
- production 전체에 기존 duplicate anomaly가 남아 있고,
- `5173`는 단순 응답 확인만 했을 뿐 기능 smoke test / operator UAT / regression check가 아직 없다.
