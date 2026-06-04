# Staging to Production Merge Candidates

작성일: 2026-06-05  
기준:

- staging = `127.0.0.1:3310`
- production = `127.0.0.1:3306`
- read-only audit only
- DB 변경 없음
- 자동 병합 없음

## 1. 목적

이 문서는 staging에만 있고 production에는 없는 데이터 중, 사람이 수동 검토할 수 있는 병합 후보와 제외 후보를 분리한 것이다.

이번 산출물은 “실제 병합 SQL 작성 전 검토 목록”이다.

실행하지 않은 것:

- `INSERT`
- `UPDATE`
- `DELETE`
- `DROP`
- `TRUNCATE`
- schema 변경
- migration 실행

## 2. 생성 파일

생성 경로: `data/staging_to_production_merge_candidates/`

- [customers.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/customers.csv)
- [orders.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/orders.csv)
- [repair_orders.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/repair_orders.csv)
- [purchase_confirmations.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/purchase_confirmations.csv)
- [excluded_test_like.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/excluded_test_like.csv)

마스킹 원칙:

- phone은 마지막 3자리만 노출
- 고객명은 부분 마스킹
- token은 앞 6자리 + 뒤 4자리만 노출

## 3. 추출 기준

| 대상 | 기준 |
|---|---|
| `orders` | staging `order_no`가 production에 없음 |
| `customers` | staging 정규화 phone이 production에 없음 |
| `repair_orders` | staging `customer phone + created_at + issue` key가 production에 없음 |
| `purchase_confirmations` | staging `token` 우선, 없으면 `order_no` key가 production에 없음 |
| excluded | `TEST`, `REHEARSAL`, `測試`, `KH_TEST`, `KW_REHEARSAL` 패턴 포함 |

보조 판단:

- `products` staging only 4건 중 3건은 test-like, 1건은 수동 상품 검토 후보
- `coupons` staging only 1건은 test-like로 제외 추천

## 4. 실제 병합 후보 수

CSV에 들어간 실제 운영 후보:

| 파일 | 후보 수 | 추천 |
|---|---:|---|
| `customers.csv` | 13 | `merge_candidate` |
| `orders.csv` | 24 | `merge_candidate` |
| `repair_orders.csv` | 12 | `manual_review` |
| `purchase_confirmations.csv` | 23 | `manual_review` |

합계:

- 실제 검토 대상 row: `72`

## 5. 제외 후보 수

`excluded_test_like.csv`에 분리한 제외 추천 항목:

| 유형 | 수량 |
|---|---:|
| `order` | 8 |
| `repair_order` | 3 |
| `purchase_confirmation` | 5 |
| `product` | 3 |
| `coupon` | 1 |

합계:

- 제외 추천 row: `20`

## 6. 수동 확인 필요 항목

### 6-1. repair_orders

수동 확인 필요 이유:

- customer phone 누락 또는 비정형 값 존재
- issue description과 bike model이 자유 텍스트
- 같은 고객의 기존 production repair와 충돌 여부를 사람이 판단해야 함

### 6-2. purchase_confirmations

수동 확인 필요 이유:

- order / token / PDF 상태를 함께 검증해야 함
- `COMPLETED`와 `PENDING`이 혼재
- `has_pdf=no`가 많아서 단순 row insert로는 업무 의미가 완성되지 않음

### 6-3. orders 중 비정형 고객명

예:

- `G***********0`
- `J******명`
- `L*****戶`

이런 row는 실제 운영건일 수 있으나, 고객 정체성과 관련 row 체인을 사람이 먼저 확인해야 한다.

## 7. 병합 추천

### 7-1. 우선 추천

우선 검토:

1. `orders.csv`
2. `customers.csv`
3. `purchase_confirmations.csv`

이유:

- 최근 `2026-05-27`~`2026-06-04` 실고객처럼 보이는 데이터가 집중되어 있음
- phone / order_no 기준으로 production 미존재가 비교적 명확함

### 7-2. 조건부 추천

조건부 검토:

- `repair_orders.csv`

조건:

- customer identity
- existing repair chain
- linked order 존재 여부
- free-text issue 충돌 여부

## 8. 제외 추천

즉시 제외 추천:

- `excluded_test_like.csv` 전부

이유:

- rehearsal/test/mocked workflow 가능성이 높음
- production 반입 시 운영 데이터 오염 위험

추가 제외 또는 보류 추천:

- staging only `products` 중 test-like 3건
- staging only `coupons` 1건

## 9. 위험 사유

| 대상 | 위험 |
|---|---|
| `customers` | phone 없는 row는 자동 병합 불가 |
| `orders` | order_items, purchase_confirmations, coupons와 연계됨 |
| `repair_orders` | free-text key라 중복 오판 가능 |
| `purchase_confirmations` | token / order / pdf_path를 함께 봐야 함 |
| `products` | test SKU 혼입 |
| `coupons` | 승인/발급 이력 검증 필요 |

## 10. 추천 방식

허용 가능한 방식:

- business-key 기반 selective merge
- order chain 단위 merge
- 사람 검토 후 승인된 SQL만 작성

금지 방식:

- staging overwrite
- full table copy
- `id` 기준 merge
- no-phone customer 자동 merge
- purchase confirmation 단독 merge

## 11. 다음 단계 SQL 작성 전 승인 체크리스트

- [ ] production full backup 완료
- [ ] `orders.csv` 각 row에 대해 production 중복 없음 재확인
- [ ] `customers.csv` phone 기준 production 미존재 재확인
- [ ] `repair_orders.csv` 고객/이슈/일시를 사람이 검토
- [ ] `purchase_confirmations.csv` order / token / PDF 상태를 사람이 검토
- [ ] `excluded_test_like.csv` 항목은 merge 대상에서 제외하기로 합의
- [ ] product/coupon staging-only 건은 별도 승인 없이는 제외
- [ ] SQL은 `INSERT` 초안 작성 전 review 문서를 먼저 작성
- [ ] production 직접 실행 전 clone DB rehearsal 수행
- [ ] production 직접 실행 전 rollback SQL / backup restore 절차 확보

## 12. DB 변경 없음 확인

이번 turn에서는 read-only 비교만 수행했다.

수행하지 않은 것:

- production 변경
- staging 변경
- data merge
- 배포

따라서 현재 산출물은 문서와 CSV 파일뿐이다.
