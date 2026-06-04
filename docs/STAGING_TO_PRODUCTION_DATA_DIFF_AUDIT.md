# Staging to Production Data Diff Audit

작성일: 2026-06-05  
대상 저장소: `KINGWAY 台南 獨立門市管理系統`  
비교 대상:

- production = `127.0.0.1:3306 / kingway_store`
- staging = `127.0.0.1:3310 / kingway_store`

실행 원칙:

- read-only audit only
- `SELECT` / `SHOW`만 사용
- `INSERT` / `UPDATE` / `DELETE` / `DROP` / `TRUNCATE` 금지
- migration / 배포 / production 변경 금지

## 1. 감사 목적

이 문서의 목적은 staging `3310`과 production `3306`이 현재 얼마나 다른지, 그리고 SaaS migration 전에 “실제 병합이 필요한지 / 어떤 방식만 허용해야 하는지”를 판단하는 것이다.

중요:

- 이 문서는 차이 분석 문서다.
- 실제 데이터 이동은 수행하지 않았다.
- PK `id`는 환경별로 달라질 수 있으므로, 비교는 business key 기준으로 수행했다.

## 2. 비교 기준

테이블별 비교 key:

| 테이블 | 비교 기준 |
|---|---|
| `customers` | 정규화 phone |
| `products` | `sku` |
| `orders` | `order_no` |
| `order_items` | `order_no + sku_snapshot + quantity + unit_price + line_total` |
| `repair_orders` | 정규화 phone + `reservation_date` + `bike_model` |
| `purchase_confirmations` | `token` 우선, 없으면 `order_no` |
| `coupons` | `code` |

주의:

- `customers`와 `repair_orders`는 phone 누락 row가 많아 자동 병합 기준이 약하다.
- `purchase_confirmations`는 `token` 또는 `order_no`가 있어도 order/PDF 체인까지 함께 확인해야 한다.

## 3. 테이블별 Count 차이

### 3-1. 전체 row count

| 테이블 | production 3306 | staging 3310 | 차이(staging-production) |
|---|---:|---:|---:|
| `customers` | 145 | 154 | +9 |
| `products` | 384 | 388 | +4 |
| `orders` | 72 | 104 | +32 |
| `order_items` | 170 | 231 | +61 |
| `repair_orders` | 20 | 28 | +8 |
| `purchase_confirmations` | 20 | 46 | +26 |
| `coupons` | 30 | 29 | -1 |

### 3-2. 최근 60일 데이터

이번 비교 시점 기준 최근 60일(`2026-04-06` 이후) 생성 데이터 수:

| 테이블 | production 최근 60일 | staging 최근 60일 |
|---|---:|---:|
| `customers` | 145 | 154 |
| `products` | 384 | 388 |
| `orders` | 72 | 104 |
| `order_items` | 170 | 231 |
| `repair_orders` | 20 | 28 |
| `purchase_confirmations` | 20 | 46 |
| `coupons` | 30 | 29 |

판단:

- 양쪽 DB 모두 사실상 최근 60일 이내 데이터로 구성되어 있다.
- 즉, staging은 오래된 복제본이 아니라 최근 운영/테스트 데이터가 누적된 활성 DB 상태다.

## 4. Staging Only / Production Only 규모

아래 수치는 table PK 기준이 아니라 business key 기준 후보 수다.

### 4-1. customers

비교 기준: 정규화 phone

| 항목 | 수량 |
|---|---:|
| staging only distinct phone | 20 |
| production only distinct phone | 2 |
| staging only raw rows | 21 |
| production only raw rows | 2 |
| staging no-phone rows | 90 |
| production no-phone rows | 100 |

해석:

- staging에는 production에 없는 phone 기준 고객이 20개 key, 실제 row 21건 있다.
- production에는 staging에 없는 phone 기준 고객이 2건 있다.
- no-phone 고객이 양쪽 모두 매우 많아서, phone 미보유 고객은 자동 병합 기준으로 사용할 수 없다.

### 4-2. products

비교 기준: `sku`

| 항목 | 수량 |
|---|---:|
| staging only `sku` | 4 |
| production only `sku` | 0 |
| staging only raw rows | 4 |

해석:

- products는 staging이 production의 strict superset에 가깝다.
- 다만 4건 중 테스트성 SKU가 섞여 있다.

### 4-3. orders

비교 기준: `order_no`

| 항목 | 수량 |
|---|---:|
| staging only `order_no` | 32 |
| production only `order_no` | 0 |
| staging only raw rows | 32 |

해석:

- staging에만 존재하는 주문이 32건이다.
- production only 주문은 없었다.
- 이는 staging이 production보다 최신 주문을 수용했거나, staging에서 별도 주문 생성이 진행된 상태를 의미한다.

### 4-4. order_items

비교 기준: `order_no + sku_snapshot + quantity + unit_price + line_total`

| 항목 | 수량 |
|---|---:|
| staging only composite rows | 61 |
| production only composite rows | 0 |

해석:

- staging only orders 32건과 일관되게, order item도 staging 쪽에 추가 데이터가 존재한다.

### 4-5. repair_orders

비교 기준: 정규화 phone + `reservation_date` + `bike_model`

| 항목 | 수량 |
|---|---:|
| staging only distinct repair key | 10 |
| production only distinct repair key | 3 |
| staging only raw rows | 11 |
| production only raw rows | 3 |
| staging no-phone repairs | 9 |
| production no-phone repairs | 9 |

해석:

- staging에만 있는 수리 후보가 10 key / 11 row 있다.
- production에만 있는 수리 후보도 3건 존재한다.
- no-phone repair가 양쪽 모두 있어 자동 병합 위험이 높다.

### 4-6. purchase_confirmations

비교 기준: `token` 우선, 없으면 `order_no`

| 항목 | 수량 |
|---|---:|
| staging only confirmation key | 29 |
| production only confirmation key | 3 |
| staging only raw rows | 29 |
| production only raw rows | 3 |

해석:

- staging에는 production에 없는 구매확인 건이 29건 있다.
- production에도 staging에 없는 구매확인 건이 3건 있다.
- 따라서 purchase confirmation은 양방향 diverged 상태다.

### 4-7. coupons

비교 기준: `code`

| 항목 | 수량 |
|---|---:|
| staging only coupon code | 1 |
| production only coupon code | 2 |
| staging only raw rows | 1 |
| production only raw rows | 2 |

해석:

- coupons는 row count 상으로는 production이 1건 더 많고, key 비교상으로도 production only가 2건이다.
- staging only 1건은 테스트성 데이터다.

## 5. Staging에만 있는 최근 데이터

최근 staging-only 샘플은 아래와 같다.

### 5-1. customers staging-only 최근 샘플

| id | name | phone | created_at |
|---|---|---|---|
| 160 | 黃意婷 | 0926428993 | 2026-06-04 19:49:42 |
| 159 | 羅胤桀 | 0968625778 | 2026-06-04 19:43:16 |
| 158 | 羅祐凱 | 0913172179 | 2026-06-04 19:36:19 |
| 151 | KH_TEST_COUPON_001 å®¢æˆ¶ | 0999000002 | 2026-06-02 22:50:26 |
| 150 | 高雄測試客戶 | 0900000002 | 2026-06-02 02:39:37 |

### 5-2. products staging-only 최근 샘플

| id | sku | name | created_at |
|---|---|---|---|
| 766 | `C-EB-901-RH5` | `KW_REHEARSAL_CONFIRM_BIKE` | 2026-06-04 12:00:02 |
| 765 | `KW_REHEARSAL_BIKE_001` | `KW_REHEARSAL_TEST_BIKE` | 2026-06-04 11:31:11 |
| 764 | `KH-TEST-001` | `高雄測試商品` | 2026-06-02 02:39:37 |
| 763 | `C-EB-001-S1` | `T1` | 2026-05-27 13:07:41 |

### 5-3. orders staging-only 최근 샘플

| order_no | customer | phone | total_amount | created_at |
|---|---|---|---:|---|
| `POS-20260604-195644-098` | 劉沛駿 | 0987335452 | 47000.00 | 2026-06-04 19:56:44 |
| `POS-20260604-195640-286` | 劉沛駿 | 0987335452 | 47080.00 | 2026-06-04 19:56:40 |
| `POS-20260604-195011-413` | 黃意婷 | 0926428993 | 47000.00 | 2026-06-04 19:50:11 |
| `POS-20260604-195007-858` | 黃意婷 | 0926428993 | 50000.00 | 2026-06-04 19:50:07 |
| `POS-20260604-194420-599` | 羅胤桀 | 0968625778 | 24900.00 | 2026-06-04 19:44:20 |

### 5-4. repair_orders staging-only 최근 샘플

| id | customer | phone | reservation_date | bike_model | status | created_at |
|---|---|---|---|---|---|---|
| 84 | `KW_REHEARSAL_REPAIR_CUSTOMER` | `0900REHEARSALREPAIR` | 2026-06-04 | `STAGING_SCOPE_TEST_BIKE` | `estimate_approved` | 2026-06-04 14:19:24 |
| 83 | `KW_REHEARSAL_REPAIR_CUSTOMER` | `0900REHEARSALREPAIR` | 2026-06-07 | `KW_REHEARSAL_TEST_BIKE` | `estimate_rejected` | 2026-06-04 11:43:14 |
| 78 | 蘇佩雯 | 0938688073 | 2026-05-31 | 舊款T1 | `reserved` | 2026-05-31 18:32:04 |
| 77 | 王 柏翔 | 0903989835 | 2026-05-31 | S1 | `estimate_pending_approval` | 2026-05-31 18:30:12 |
| 76 | 侯欽章 | 0937035946 | 2026-05-31 | 舊車白色 | `estimate_pending_approval` | 2026-05-31 18:27:07 |

### 5-5. purchase_confirmations staging-only 최근 샘플

| id | token/order | status | created_at |
|---|---|---|---|
| 56 | token `a1b6e729...` / `POS-20260519-165953-464` | `PENDING` | 2026-06-04 20:05:39 |
| 55 | token `74f687e9...` / `POS-20260604-195644-098` | `PENDING` | 2026-06-04 19:57:12 |
| 54 | token `60cdae19...` / `POS-20260604-195640-286` | `PENDING` | 2026-06-04 19:56:55 |
| 53 | token `f33d0975...` / `POS-20260604-195007-858` | `PENDING` | 2026-06-04 19:54:24 |
| 52 | token `9318b3e5...` / `POS-20260604-194420-599` | `PENDING` | 2026-06-04 19:44:45 |

### 5-6. coupons staging-only 최근 샘플

| id | code | coupon_type | amount | status | issued_at |
|---|---|---|---:|---|---|
| 41 | `KH_TEST_COUPON_001-GR-001` | `google_review` | 1500.00 | `issued` | 2026-06-02 22:50:27 |

## 6. Production Only 주요 데이터

production only 샘플:

### 6-1. customers

| id | name | phone | created_at |
|---|---|---|---|
| 137 | 周彥佐 | 0908119657 | 2026-05-21 18:13:24 |
| 109 | 張家甄 | 0912179210 | 2026-05-13 18:47:48 |

### 6-2. repair_orders

| id | customer | phone | reservation_date | bike_model | created_at |
|---|---|---|---|---|---|
| 76 | Coco | 0975000244 | 2026-05-24 | Test | 2026-05-22 22:48:54 |
| 75 | 張家甄 | 0912179210 | 2026-05-27 | 電動自行車 | 2026-05-22 19:13:07 |
| 74 | 周彥佐 | 0908119657 | 2026-05-27 | 不清除 | 2026-05-21 18:15:03 |

### 6-3. purchase_confirmations

| id | token | order_no | status | created_at |
|---|---|---|---|---|
| 26 | `4c2912ec...` | `POS-20260513-161826-035` | `PENDING` | 2026-05-13 16:18:28 |
| 23 | `3d72fa70...` | `POS-20260512-182605-574` | `PENDING` | 2026-05-12 20:52:26 |
| 22 | `10cc8fa7...` | `POS-20260512-182246-363` | `PENDING` | 2026-05-12 18:22:47 |

### 6-4. coupons

| id | code | type | amount | status | issued_at |
|---|---|---|---:|---|---|
| 42 | `NF-D61ED5EB` | `new_friend` | 500.00 | `issued` | 2026-05-22 19:11:58 |
| 41 | `NF-7090BB4D` | `new_friend` | 500.00 | `issued` | 2026-05-21 18:14:01 |

판단:

- production도 staging에 없는 독자 데이터가 존재한다.
- 따라서 “staging이 최신이므로 production을 덮어쓴다” 방식은 명백히 금지다.

## 7. 병합 필요 후보

이번 audit에서 staging-only 데이터 중 실제 병합 검토 가치가 있는 후보:

### 7-1. 높음

- `orders`: staging only 32건 중 다수는 `2026-05-31`~`2026-06-04` 실제 고객명/전화 조합으로 보인다.
- `order_items`: staging only 61건. 주문과 함께 체인으로 병합해야 한다.
- `purchase_confirmations`: staging only 29건. 주문과 연결되어 있으므로 주문 병합 시 함께 검토 필요.

### 7-2. 중간

- `customers`: staging only raw row 21건 중 실고객으로 보이는 row가 다수 존재한다.
- `repair_orders`: staging only raw row 11건 중 실제 고객명/전화 기반 건이 존재한다.
- `products`: staging only 4건 중 최소 1건은 테스트가 아닐 가능성이 있어 수동 검토 필요.

## 8. 병합 금지 후보

자동 병합 또는 무검토 병합이 금지되는 후보:

1. 이름 / SKU / bike model / order context에 `REHEARSAL`, `TEST`, `測試`, `KH_TEST`가 포함된 row
2. phone이 비어 있는 `customers`
3. phone이 비어 있는 `repair_orders`
4. production only row
5. purchase confirmation token만 있고 order/PDF 체인이 정합 검증되지 않은 row
6. coupon code는 있으나 승인 근거/주문 연결이 불명확한 row

테스트성 staging-only 수치:

| 테이블 | staging-only raw | test-like 추정 |
|---|---:|---:|
| `customers` | 21 | 8 |
| `products` | 4 | 3 |
| `orders` | 32 | 8 |
| `repair_orders` | 11 | 3 |
| `purchase_confirmations` | 29 | 5 |
| `coupons` | 1 | 1 |

해석:

- staging에는 rehearsal / test 성격 데이터가 명확히 섞여 있다.
- full merge는 곧 test data 오염을 production에 반입하는 결과가 된다.

## 9. 위험도

| 테이블 | 위험도 | 이유 |
|---|---|---|
| `customers` | High | phone 없는 row가 많고 동일 고객 중복 가능성 존재 |
| `products` | Medium | `sku` 기준 정합은 가능하지만 test SKU 포함 |
| `orders` | High | staging only가 많고 payments / customers / items 체인이 연결됨 |
| `order_items` | High | 주문과 분리 병합 불가 |
| `repair_orders` | High | phone 누락 및 customer/date 기반 수동 판정 필요 |
| `purchase_confirmations` | High | order/token/PDF 삼중 정합 필요 |
| `coupons` | Medium | code는 있으나 test coupon 포함, 승인/주문 연결 검증 필요 |

## 10. 추천 병합 전략

### 10-1. 금지 전략

절대 금지:

- staging DB 전체를 production에 덮어쓰기
- table 단위 전체 copy
- `id` 기준 병합
- phone 없는 고객/수리를 자동 merge
- test/rehearsal row 무차별 반입

### 10-2. 권장 전략

권장 방식은 “production 원본 유지 + staging-only 실데이터 selective replay”다.

권장 순서:

1. production full backup
2. staging-only 후보를 business key 기준으로 별도 추출
3. test / rehearsal / no-phone / ambiguous row 제외
4. `customers -> products -> orders -> order_items -> repair_orders -> purchase_confirmations -> coupons` 순으로 수동 검토
5. production clone 또는 rehearsal DB에서 import rehearsal
6. row count / chain integrity / PDF path 검증
7. 승인 후에만 production 반영

### 10-3. 실제 우선순위

우선 검토 대상:

1. `orders` + `order_items`
2. `purchase_confirmations`
3. `customers`
4. `repair_orders`
5. `products`
6. `coupons`

이유:

- 현재 business impact가 가장 큰 차이는 주문 / 구매확인 / 수리 체인이다.
- coupons는 test data 비중이 높고, production only coupon도 있으므로 마지막에 검토하는 것이 안전하다.

## 11. 결론

이번 audit 기준으로 staging과 production은 단순한 상하 관계가 아니다.

핵심 사실:

- staging only 실데이터 후보가 분명히 존재한다.
- 동시에 staging에는 rehearsal / test 데이터가 섞여 있다.
- production only 데이터도 존재한다.

따라서 결론은 다음과 같다.

1. full merge는 금지
2. overwrite는 금지
3. selective/manual merge만 검토 가능
4. order / purchase confirmation / repair 체인을 중심으로 production clone에서 먼저 rehearsal 해야 함

현재 상태에서의 최종 판단:

- 실제 병합 필요성: `있음`
- 허용 가능한 방식: `business-key 기반 selective/manual merge only`
- 허용되지 않는 방식: `staging 전체 또는 테이블 전체를 production에 반영하는 방식`
