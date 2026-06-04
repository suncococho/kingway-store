# Staging to Production Merge Review

작성일: 2026-06-05  
기준 문서:

- [STAGING_TO_PRODUCTION_DATA_DIFF_AUDIT.md](/volume1/docker/kingway-store/docs/STAGING_TO_PRODUCTION_DATA_DIFF_AUDIT.md)
- [STAGING_TO_PRODUCTION_MERGE_CANDIDATES.md](/volume1/docker/kingway-store/docs/STAGING_TO_PRODUCTION_MERGE_CANDIDATES.md)

기준 CSV:

- [customers.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/customers.csv)
- [orders.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/orders.csv)
- [repair_orders.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/repair_orders.csv)
- [purchase_confirmations.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/purchase_confirmations.csv)
- [excluded_test_like.csv](/volume1/docker/kingway-store/data/staging_to_production_merge_candidates/excluded_test_like.csv)

실행 원칙:

- read-only review only
- DB 변경 없음
- 민감정보 마스킹 유지
- token 전체 출력 금지

## 1. 검토 목적

이 문서는 staging-only 병합 후보 72건을 사람이 최종 승인할 수 있도록 실제 운영 가능성, 테스트 의심도, chain integrity 위험도를 기준으로 재분류한 상세 검토표다.

이번 문서의 분류 대상은 72건이다.

별도 참고:

- `excluded_test_like.csv`의 20건은 이미 사전 제외 후보로 분리되어 있으며, 이 문서의 72건 합계에는 포함하지 않는다.

## 2. 최종 분류 요약

72건 최종 분류:

| 분류 | 수량 |
|---|---:|
| 병합 권장 | 36 |
| 제외 권장 | 4 |
| 수동 확인 필요 | 32 |

테이블별 분류:

| 대상 | 병합 권장 | 제외 권장 | 수동 확인 필요 | 합계 |
|---|---:|---:|---:|---:|
| `customers` | 13 | 0 | 0 | 13 |
| `orders` | 20 | 0 | 4 | 24 |
| `purchase_confirmations` | 1 | 0 | 22 | 23 |
| `repair_orders` | 2 | 4 | 6 | 12 |
| 합계 | 36 | 4 | 32 | 72 |

## 3. 판단 기준

병합 권장:

- production에 동일 business key가 없고
- test/rehearsal 패턴이 없고
- 날짜/금액/전화/고객명이 실제 운영 데이터로 보이며
- 관련 chain의 핵심 연결이 비교적 자연스러운 경우

제외 권장:

- test 패턴은 아니더라도 내용이 비정상적이거나
- 자유 텍스트가 임시 입력처럼 보이거나
- 실제 운영건으로 보기 어려운 경우

수동 확인 필요:

- 실제 운영건일 가능성은 있으나
- order/customer/repair/purchase confirmation chain을 같이 봐야 하거나
- 비정형 고객명, 빈 전화, 상태 미완료, PDF 미생성 등의 이유로 자동 승인할 수 없는 경우

## 4. Customers 13건 상세 검토

판단:

- 13건 모두 phone 기준 production 미존재다.
- 이름/전화/생성시각 패턴상 실제 운영 고객일 가능성이 높다.
- 별도 test marker가 없고, 다수는 실제 주문 후보와 직접 연결된다.

| customer_id | name | phone | created_at | 판정 | 사유 |
|---|---|---|---|---|---|
| 160 | 黃*婷 | 09*****993 | 2026-06-04 19:49:42 | 병합 권장 | 같은 날짜 주문 후보와 직접 연결됨 |
| 159 | 羅*桀 | 09*****778 | 2026-06-04 19:43:16 | 병합 권장 | 같은 날짜 주문 후보와 직접 연결됨 |
| 158 | 羅*凱 | 09*****179 | 2026-06-04 19:36:19 | 병합 권장 | 같은 날짜 주문 후보와 직접 연결됨 |
| 149 | 林*賢 | 09*****261 | 2026-05-31 18:40:29 | 병합 권장 | 주문/구매확인 후보와 연결됨 |
| 148 | 陳*生 | 09*****856 | 2026-05-31 18:38:37 | 병합 권장 | 실명/전화 패턴, 테스트 흔적 없음 |
| 147 | 陳*燕 | 09*****153 | 2026-05-31 18:36:33 | 병합 권장 | 주문/구매확인 후보와 연결됨 |
| 146 | 康*玲 | 09*****852 | 2026-05-31 18:34:37 | 병합 권장 | 주문/구매확인 후보와 연결됨 |
| 145 | 蘇*雯 | 09*****073 | 2026-05-31 18:31:33 | 병합 권장 | repair 후보와 자연스럽게 연결됨 |
| 144 | 侯*章 | 09*****946 | 2026-05-31 18:26:25 | 병합 권장 | repair 후보와 자연스럽게 연결됨 |
| 143 | 陳*堂 | 09*****993 | 2026-05-31 18:25:03 | 병합 권장 | 주문/repair/구매확인 체인 존재 |
| 142 | 劉*駿 | 09*****452 | 2026-05-27 13:08:53 | 병합 권장 | 2026-06-04 주문/구매확인 체인과 연결됨 |
| 141 | 羅*廷 | 09*****736 | 2026-05-27 13:05:40 | 병합 권장 | 주문/구매확인 후보와 연결됨 |
| 140 | 蘇*喬 | 09*****812 | 2026-05-27 13:01:09 | 병합 권장 | 주문 후보와 연결됨 |

## 5. Orders 24건 상세 검토

판단 요약:

- 24건 중 20건은 실고객명/실전화/자연스러운 금액/같은 시점 customer 생성 흐름이 있어 병합 권장.
- 4건은 실제 운영건일 가능성은 있으나, 비정형 고객명 또는 LINE/repair 상태 때문에 수동 확인이 안전하다.

### 5-1. 병합 권장 20건

| order_no | customer | phone | total_amount | status | 판정 | 사유 |
|---|---|---|---:|---|---|---|
| POS-20260604-195644-098 | 劉*駿 | 09*****452 | 47000.00 | COMPLETED | 병합 권장 | 실고객+완료주문+연결 구매확인 존재 |
| POS-20260604-195640-286 | 劉*駿 | 09*****452 | 47080.00 | COMPLETED | 병합 권장 | 실고객+다품목 주문+연결 구매확인 존재 |
| POS-20260604-195011-413 | 黃*婷 | 09*****993 | 47000.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-195007-858 | 黃*婷 | 09*****993 | 50000.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-194420-599 | 羅*桀 | 09*****778 | 24900.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-194415-380 | 羅*桀 | 09*****778 | 24900.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-194357-153 | 羅*桀 | 09*****778 | 24900.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-194352-247 | 羅*桀 | 09*****778 | 22000.00 | COMPLETED | 병합 권장 | 실고객+당일 체인 존재 |
| POS-20260604-193656-864 | 羅*凱 | 09*****179 | 78000.00 | COMPLETED | 병합 권장 | 실고객+고가 구매+연결 구매확인 존재 |
| POS-20260604-193648-194 | 羅*凱 | 09*****179 | 73000.00 | COMPLETED | 병합 권장 | 실고객+고가 구매+연결 구매확인 존재 |
| POS-20260604-192816-375 | 陳*堂 | 09*****993 | 24900.00 | COMPLETED | 병합 권장 | 실고객+연결 구매확인 존재 |
| POS-20260604-192800-405 | 陳*堂 | 09*****993 | 24900.00 | COMPLETED | 병합 권장 | 실고객+연결 구매확인 존재 |
| POS-20260604-192749-896 | 陳*堂 | 09*****993 | 21600.00 | COMPLETED | 병합 권장 | 실고객+연결 구매확인 존재 |
| POS-20260531-184150-171 | 林*賢 | 09*****261 | 73000.00 | COMPLETED | 병합 권장 | 실고객+다품목+COMPLETED 구매확인 존재 |
| POS-20260531-183849-611 | 陳*鈞 | 09*****856 | 75000.00 | COMPLETED | 병합 권장 | 실고객 패턴, 테스트 흔적 없음 |
| POS-20260531-183655-771 | 陳*燕 | 09*****153 | 22000.00 | COMPLETED | 병합 권장 | 실고객+구매확인 후보 존재 |
| POS-20260531-183502-792 | 康*玲 | 09*****852 | 80180.00 | COMPLETED | 병합 권장 | 실고객+구매확인 후보 존재 |
| POS-20260527-130622-346 | 羅*廷 | 09*****736 | 75500.00 | COMPLETED | 병합 권장 | 실고객+구매확인 후보 존재 |
| POS-20260527-130156-363 | 蘇*喬 | 09*****812 | 57000.00 | COMPLETED | 병합 권장 | 실고객+다품목 주문 |
| POS-20260526-151430-018 | L*****戶 | 09*****711 | 1000.00 | COMPLETED | 병합 권장 | 소액이지만 repair 체인과 연결되어 운영건 가능성 높음 |

### 5-2. 수동 확인 필요 4건

| order_no | customer | phone | total_amount | status | 판정 | 사유 |
|---|---|---|---:|---|---|---|
| LINE-20260603-141722-658 | J******명 | 09*****300 | 47000.00 | PENDING_CONFIRM | 수동 확인 필요 | LINE flow 주문, 비정형 이름, repair와 연결 검증 필요 |
| POS-20260530-154855-542 | G***********0 |  | 1800.00 | COMPLETED | 수동 확인 필요 | 고객명 비정형, 전화 없음 |
| LINE-20260528-194556-887 | C**o | 09*****244 | 77500.00 | PENDING_CONFIRM | 수동 확인 필요 | LINE flow + 비정형 이름 |
| REP-20260526-144545-326 | L*****戶 | 09*****711 | 900.00 | REPAIRING | 수동 확인 필요 | repair 전용 주문, repair 체인과 같이 확인 필요 |

## 6. Purchase Confirmations 23건 상세 검토

판단 요약:

- 23건 모두 연결 order key는 존재한다.
- 다만 대부분 `PENDING`이고 `has_pdf=no`라서 단독 병합은 금지다.
- `COMPLETED + has_pdf=yes` 1건만 상대적으로 병합 우선순위가 높다.

### 6-1. 병합 권장 1건

| pc_id | token | order_no | status | has_pdf | 판정 | 사유 |
|---|---|---|---|---|---|---|
| 41 | masked | POS-20260531-184150-171 | COMPLETED | yes | 병합 권장 | 완료 상태이며 PDF 존재, 연결 주문도 실운영 후보 |

### 6-2. 수동 확인 필요 22건

| pc_id | token | order_no | status | has_pdf | 판정 | 사유 |
|---|---|---|---|---|---|---|
| 56 | a1b6e7...711b | POS-20260519-165953-464 | PENDING | no | 수동 확인 필요 | 주문 체인/실고객 여부 확인 필요 |
| 55 | 74f687...0d8d | POS-20260604-195644-098 | PENDING | no | 수동 확인 필요 | 연결 주문은 실운영 같지만 미완료 |
| 54 | 60cdae...4fc4 | POS-20260604-195640-286 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 53 | f33d09...9541 | POS-20260604-195007-858 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 52 | 9318b3...906d | POS-20260604-194420-599 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 51 | 01a254...7183 | POS-20260604-194415-380 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 50 | fc26a8...c140 | POS-20260604-194357-153 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 49 | 00eaa2...b84d | POS-20260604-194352-247 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 48 | acd9d3...fe9c | POS-20260604-193656-864 | PENDING | no | 수동 확인 필요 | 고가 주문과 연결, PDF 미생성 |
| 47 | 31e742...d8db | POS-20260604-193648-194 | PENDING | no | 수동 확인 필요 | 고가 주문과 연결, PDF 미생성 |
| 46 | 610d7a...7e3f | POS-20260604-192816-375 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 45 | 67260a...8f1f | POS-20260604-192800-405 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 44 | a249d7...e065 | POS-20260604-192749-896 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 43 | 20c344...fd64 | POS-20260519-165716-962 | PENDING | no | 수동 확인 필요 | 연결 주문 후보가 CSV에 없음, 원주문 확인 필요 |
| 38 | fab609...dd9d | POS-20260531-184150-171 | PENDING | no | 수동 확인 필요 | 같은 주문의 completed 건(41)과 중복 흐름 가능성 |
| 37 | 628e16...9ec2 | POS-20260531-183655-771 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 36 | 980f19...a6d5 | POS-20260531-183502-792 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 35 | dcd100...eb8d | POS-20260512-182446-072 | PENDING | no | 수동 확인 필요 | 연결 주문이 현재 merge 후보 문서에 없음 |
| 34 | 755d25...8bd5 | POS-20260527-130622-346 | PENDING | no | 수동 확인 필요 | 연결 주문 존재, PDF 미생성 |
| 26 | dc7ac8...7818 | POS-20260513-161826-035 | PENDING | no | 수동 확인 필요 | 오래된 pending, 연결 주문 chain 별도 확인 필요 |
| 23 | c6f3e0...9001 | POS-20260512-182605-574 | PENDING | no | 수동 확인 필요 | 연결 주문 후보 문서 외부, chain 재확인 필요 |
| 22 | 6d7410...05cf | POS-20260512-182246-363 | PENDING | no | 수동 확인 필요 | 연결 주문 후보 문서 외부, chain 재확인 필요 |

## 7. Repair Orders 12건 상세 검토

판단 요약:

- 12건 중 2건만 상대적으로 운영건 가능성이 높아 병합 권장.
- 4건은 내용이 임시/비정상적이라 제외 권장.
- 나머지 6건은 실제 수리건일 가능성은 있으나 customer/order chain 검증이 필요하다.

### 7-1. 병합 권장 2건

| repair_id | customer | phone | date | issue_preview | 판정 | 사유 |
|---|---|---|---|---|---|---|
| 77 | 王**翔 | 09*****835 | 2026-05-31 | 手把 | 병합 권장 | 자연스러운 실고객/실증상 패턴 |
| 75 | 陳*堂 | 09*****993 | 2026-05-31 | 前輪無法打氣 | 병합 권장 | 실고객/실제 수리 증상으로 보임 |

### 7-2. 제외 권장 4건

| repair_id | customer | phone | date | issue_preview | 판정 | 사유 |
|---|---|---|---|---|---|---|
| 82 | J******명 | 09*****300 | 2026-06-03 | ㅕ어노융 | 제외 권장 | 입력 내용이 비정상적, 운영증상 판단 곤란 |
| 81 | J******명 | 09*****300 | 2026-06-03 | ㅎㅎㅎㅎ | 제외 권장 | 임시 입력/테스트성 텍스트 의심 |
| 80 | J******명 | 09*****300 | 2026-06-03 | ㅎㅎㅎㅎ | 제외 권장 | 임시 입력/테스트성 텍스트 의심 |
| 12 | [***********戶 |  | 2026-04-28 | hjhjhj | 제외 권장 | 증상 텍스트가 임시 입력처럼 보임 |

### 7-3. 수동 확인 필요 6건

| repair_id | customer | phone | date | issue_preview | status | 판정 | 사유 |
|---|---|---|---|---|---|---|---|
| 79 | J******명 | 09*****300 | 2026-06-02 | Fat bike flat tire | canceled | 수동 확인 필요 | 내용은 실제 같지만 같은 고객의 제외 권장 건들과 함께 존재 |
| 56 | L*****戶 | 09*****302 | 2026-05-13 | 前輪擋泥板螺絲鬆脫... | picked_up | 수동 확인 필요 | 실제 증상 같지만 고객 식별/관련 주문 확인 필요 |
| 54 | [***********戶 |  | 2026-05-12 | 電機不修 收檢修費 | completed_waiting_pickup | 수동 확인 필요 | 전화 없음, 고객 식별 약함 |
| 53 | [***********戶 |  | 2026-05-12 | 保養400 | completed_waiting_pickup | 수동 확인 필요 | 전화 없음, 고객 식별 약함 |
| 51 | [***********戶 |  | 2026-05-12 | 油門+儀表+煞車... | completed_waiting_pickup | 수동 확인 필요 | 전화 없음, chain 검증 필요 |
| 45 | [***********戶 |  | 2026-05-12 | 油門 | completed_waiting_pickup | 수동 확인 필요 | 전화 없음, chain 검증 필요 |

## 8. 가장 위험한 항목

가장 위험한 항목은 `purchase_confirmations` 미완료 건과 `repair_orders`의 자유 텍스트/무전화 고객 건이다.

특히 위험:

1. `purchase_confirmations` 22건
   - 대부분 `PENDING`
   - 대부분 `has_pdf=no`
   - order는 있지만 완료 여부가 불명확
2. `repair_orders` 중 no-phone 고객
   - 고객 식별 약함
   - issue text만으로 중복 판정 위험
3. `LINE-*` 또는 비정형 고객명 주문
   - 실제 운영건일 수 있으나 cross-flow 검증 필요

## 9. 병합 순서

권장 병합 순서:

1. `customers` 중 병합 권장 13건
2. `orders` 중 병합 권장 20건
3. `order_items`는 승인된 orders에 종속적으로 병합
4. `purchase_confirmations` 중 병합 권장 1건
5. `orders` / `purchase_confirmations` 수동 확인 건 처리
6. `repair_orders` 병합 권장 2건
7. `repair_orders` 수동 확인 6건 재검토

원칙:

- `purchase_confirmations`는 단독 반입 금지
- `repair_orders`는 customer/order chain 검증 없이 반입 금지

## 10. 위험 항목

| 항목 | 위험 |
|---|---|
| `LINE-*` 주문 | LINE workflow / confirm 상태가 남아 있을 수 있음 |
| `REP-*` 주문 | repair chain과 분리 반입 시 불일치 가능 |
| `PENDING` purchase confirmation | 미완료 문서 반입으로 운영 혼선 가능 |
| `has_pdf=no` purchase confirmation | PDF 파일 부재 시 고객관리 이력 불완전 |
| no-phone repair | 고객 중복/오인 merge 위험 |
| 비정형 고객명 | 테스트/임시/외국어 입력 혼입 가능성 |

## 11. 최종 승인 전 체크리스트

- [ ] `customers` 13건을 phone 기준으로 production 미존재 재확인
- [ ] `orders` 20건 병합 권장 목록을 order_no 기준으로 production 재확인
- [ ] `orders` 수동 확인 4건에 대해 원천 화면 또는 영수증/로그 확인
- [ ] `purchase_confirmations` 22건 수동 확인 대상의 완료 여부/PDF 존재 여부를 확인
- [ ] `repair_orders` 6건 수동 확인 대상의 고객 식별/주문 연계 여부를 확인
- [ ] `repair_orders` 제외 권장 4건은 merge 대상에서 제외하기로 승인
- [ ] `excluded_test_like.csv` 20건은 merge 대상에서 제외하기로 승인
- [ ] 병합 SQL 작성 전에 production clone rehearse 계획 확정
- [ ] rollback / backup restore 절차가 이미 준비되어 있는지 확인

## 12. 결론

현재 72건 중 바로 병합 권장 가능한 범위는 제한적이다.

실무적으로는 다음처럼 보는 것이 안전하다.

- `customers` 13건: 대부분 병합 권장
- `orders` 24건: 20건 병합 권장, 4건 수동 확인
- `purchase_confirmations` 23건: 1건만 병합 권장, 22건 수동 확인
- `repair_orders` 12건: 2건 병합 권장, 4건 제외, 6건 수동 확인

따라서 최종 추천은 다음과 같다.

1. 1차 승인 대상은 `customers + orders` 중심
2. `purchase_confirmations`와 `repair_orders`는 상세 chain 검증 후 2차 승인
3. test-like 20건과 본 문서의 제외 권장 4건은 production 반입 금지
