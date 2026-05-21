# Tenant / Store Restore Rehearsal Plan

## 1. restore rehearsal 목적

KINGWAY multi-tenant migration 전 실제 복구 가능성을 검증하기 위한 restore rehearsal 계획서다.

restore rehearsal의 목적은 다음과 같다.

- 운영 DB backup이 실제로 복구 가능한지 확인
- 복구 소요 시간과 절차를 기록
- migration 실패 시 rollback 가능한지 검증
- staging 환경에서 운영 snapshot을 재현
- multi-tenant migration rehearsal의 안전한 기반 확보
- 운영 반영 전 production safety 기준 확립

이 문서는 계획 문서이며, 이 문서만으로 DB restore, migration, docker-compose 수정, 서버 재시작을 승인하지 않는다.

## 2. restore rehearsal이 필요한 이유

multi-tenant migration은 다음 위험을 가진다.

- 주요 테이블에 `tenant_id` / `store_id` 추가
- 기존 운영 데이터 backfill
- unique key 재설계
- API store scope 적용
- LINE / POS / 수리 / 쿠폰 / 구매확인 flow 영향
- rollback 실패 시 운영 데이터 복구 필요

따라서 운영 반영 전에 backup이 실제로 restore 가능한지 검증해야 한다.

backup 파일이 존재하는 것만으로는 충분하지 않다.

필수 확인:

- backup 파일이 0 byte가 아닌지
- backup이 손상되지 않았는지
- staging DB에 restore 가능한지
- restore 후 row count가 원본과 일치하는지
- restore 후 핵심 업무 flow가 정상 동작하는지
- restore 소요 시간이 운영 rollback window 안에 들어오는지

## 3. 운영 반영 전 필수 조건

운영 migration 전 아래 조건을 모두 만족해야 한다.

| 조건 | 필요 상태 |
|---|---|
| 최신 NAS backup 존재 | YES |
| backup 파일 크기 확인 | YES |
| backup checksum 기록 | YES |
| staging restore 성공 | YES |
| restore timing 기록 | YES |
| row count 검증 성공 | YES |
| smoke test 성공 | YES |
| Git snapshot 확인 | YES |
| rollback rehearsal 성공 | YES |
| LINE webhook 복구 검증 | YES |
| production approval | YES |

하나라도 충족하지 못하면 production migration은 BLOCKER로 중단한다.

## 4. NAS backup 확인 절차

### 4-1. backup 파일 존재 확인

확인 항목:

- backup 경로
- 파일명
- 생성 시각
- 파일 크기
- 소유자/권한
- checksum

기록 형식:

| 항목 | 값 |
|---|---|
| backup path |  |
| backup filename |  |
| created_at |  |
| file size |  |
| owner |  |
| permission |  |
| checksum |  |

주의:

- 0 byte backup은 사용 금지.
- 오래된 backup은 운영 반영용 rollback 기준으로 사용하지 않는다.
- backup 경로가 NAS인지 로컬 임시 경로인지 구분한다.

### 4-2. checksum 기록

권장:

```sh
sha256sum /path/to/backup.sql
```

또는 환경에 따라:

```sh
shasum -a 256 /path/to/backup.sql
```

checksum은 restore 전후 파일 무결성 확인에 사용한다.

### 4-3. backup 보관 원칙

- migration 전 backup은 별도 디렉터리에 보관
- migration 후 안정화 전까지 삭제 금지
- backup 파일명을 날짜/시간 포함 형태로 저장
- 예: `kingway_store_before_multitenant_YYYYMMDD_HHmmss.sql`

## 5. Git snapshot 확인 절차

운영 migration 전 코드 rollback 기준을 남긴다.

확인 항목:

```sh
git branch --show-current
git rev-parse HEAD
git status --short
```

기록 형식:

| 항목 | 값 |
|---|---|
| branch | `beta/staging-architecture` |
| commit hash |  |
| working tree clean 여부 | YES / NO |
| snapshot tag 또는 branch |  |
| snapshot 생성자 |  |
| snapshot 생성일 |  |

주의:

- dirty working tree 상태로 production migration 금지.
- git add/commit/tag는 별도 승인 후 수행한다.
- 이 문서는 Git 변경을 승인하지 않는다.

## 6. staging restore 절차

### 6-1. 목적

운영 DB backup을 staging DB에 복원해 실제 복구 가능성과 데이터 일치 여부를 확인한다.

### 6-2. 절차

1. staging DB 대상 확인
2. staging DB가 운영과 분리되어 있는지 확인
3. staging DB 초기 상태 기록
4. 운영 backup 파일 준비
5. staging DB에 restore
6. restore 소요 시간 기록
7. restore 후 row count 확인
8. dry-run SQL 재실행
9. smoke test 실행
10. 결과 문서화

### 6-3. staging 안전 원칙

- 운영 DB에 restore하지 않는다.
- staging DB 이름을 명확히 구분한다.
- staging restore 중 운영 container를 재시작하지 않는다.
- staging test가 운영 LINE webhook을 호출하지 않도록 주의한다.
- 실제 고객에게 LINE/Telegram 메시지가 발송되지 않도록 test mode를 확인한다.

## 7. MySQL restore 절차

주의: 아래는 절차 예시이며, 실제 실행은 별도 승인 후 수행한다.

### 7-1. restore 전 확인

```sh
mysql -h127.0.0.1 -P3306 -uUSER -p -e "SHOW DATABASES;"
```

확인:

- target DB가 staging인지
- 운영 DB 이름과 혼동되지 않는지
- restore 권한이 있는지

### 7-2. restore 예시

```sh
mysql -h127.0.0.1 -P3306 -uUSER -p staging_kingway_store < /path/to/backup.sql
```

또는 gzip backup인 경우:

```sh
gunzip -c /path/to/backup.sql.gz | mysql -h127.0.0.1 -P3306 -uUSER -p staging_kingway_store
```

### 7-3. restore 후 확인

```sql
SELECT COUNT(*) FROM customers;
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM order_items;
SELECT COUNT(*) FROM repair_orders;
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM coupons;
SELECT COUNT(*) FROM purchase_confirmations;
```

주의:

- 운영 DB 이름에 restore하지 않는다.
- restore 전 target DB명을 재확인한다.
- restore 명령은 별도 승인 없이 실행하지 않는다.

## 8. docker container restore 절차

주의: 아래는 절차 예시이며, 실제 docker 명령 실행은 별도 승인 후 수행한다.

### 8-1. container 확인

```sh
docker ps
```

확인:

- MySQL container 이름
- staging MySQL container인지
- 운영 container와 분리되어 있는지

### 8-2. docker exec restore 예시

```sh
docker exec -i MYSQL_STAGING_CONTAINER mysql -uUSER -pPASSWORD staging_kingway_store < /path/to/backup.sql
```

gzip backup:

```sh
gunzip -c /path/to/backup.sql.gz | docker exec -i MYSQL_STAGING_CONTAINER mysql -uUSER -pPASSWORD staging_kingway_store
```

### 8-3. container restore 주의사항

- 운영 MySQL container에 실수로 restore하지 않는다.
- container name을 두 번 확인한다.
- docker-compose 수정 금지.
- 운영 container restart 금지.
- restore 전후 logs 확인은 read-only로 수행한다.
- 실제 restore는 staging container에서만 수행한다.

## 9. restore timing 기록

restore rehearsal 때 아래 항목을 기록한다.

| 항목 | 값 |
|---|---|
| rehearsal date |  |
| operator |  |
| source backup path |  |
| backup size |  |
| checksum |  |
| target server |  |
| target DB |  |
| restore started_at |  |
| restore completed_at |  |
| restore duration |  |
| restore command type | mysql / docker exec / other |
| restore result | SUCCESS / FAILED |
| error message |  |
| row count matched | YES / NO |
| smoke test result | PASS / FAIL |

restore duration은 production rollback window 산정에 사용한다.

## 10. restore 성공 기준

restore rehearsal 성공 기준:

| 기준 | 필요 상태 |
|---|---|
| backup 파일 정상 | YES |
| checksum 기록 | YES |
| staging DB restore 완료 | YES |
| restore 중 error 없음 | YES |
| 핵심 테이블 row count 일치 | YES |
| dry-run 결과 재현 | YES |
| login smoke test 통과 | YES |
| customer/order/repair/coupon 주요 화면 통과 | YES |
| purchase confirmation PDF 접근 확인 | YES |
| LINE webhook test mode 확인 | YES |
| rollback simulation 가능 | YES |

핵심 row count 대상:

- `customers`
- `orders`
- `order_items`
- `repair_orders`
- `products`
- `inventory_movements`
- `coupons`
- `purchase_confirmations`
- `purchase_confirmation_tokens`
- `staff_users`
- `staff_attendance`
- `staff_kpi_logs`
- `supplier_requests`
- `supplier_request_items`
- `line_group_registrations`
- `line_chat_sessions`
- `v2_workflow_events`

## 11. restore 실패(BLOCKER) 기준

아래 항목 중 하나라도 발생하면 BLOCKER다.

| 실패 조건 | 설명 |
|---|---|
| backup file missing | backup 파일이 없음 |
| backup file size 0 | 0 byte backup |
| checksum mismatch | 파일 무결성 불일치 |
| restore command failed | restore 중 SQL error 발생 |
| target DB confusion | 운영 DB와 staging DB 구분 불명확 |
| row count mismatch | restore 후 row count 불일치 |
| missing critical tables | 핵심 테이블 누락 |
| smoke test failed | 핵심 업무 flow 실패 |
| restore duration unknown | rollback window 산정 불가 |
| LINE webhook unsafe | staging에서 실제 고객 메시지 발송 위험 |
| rollback simulation failed | migration 실패 시 복구 불가 |

BLOCKER 원칙:

- restore 실패 시 migration 중단
- restore 원인 분석 전 backfill 금지
- restore 성공 전 production approval 금지

## 12. rollback rehearsal 절차

rollback rehearsal은 staging에서 수행한다.

### 12-1. rehearsal 순서

1. staging restore 완료
2. baseline row count 기록
3. migration forward SQL rehearsal
4. row count 및 flow 검증
5. rollback SQL rehearsal 또는 full restore
6. rollback 후 row count 비교
7. smoke test 재실행
8. 결과 기록

### 12-2. rollback 검증 항목

| 항목 | 확인 |
|---|---|
| tenants/stores 생성 rollback | YES / NO |
| nullable column 추가 rollback | YES / NO |
| index 추가 rollback | YES / NO |
| backfill rollback | YES / NO |
| unique key rollback | YES / NO |
| app code rollback | YES / NO |
| data row count 복구 | YES / NO |
| LINE/POS/Repair/Coupon smoke test 복구 | YES / NO |

### 12-3. rollback 방식 선택

| 방식 | 사용 조건 |
|---|---|
| rollback SQL | 변경 범위가 작고 reversible할 때 |
| full DB restore | backfill/unique 변경 등 데이터 오염 가능성이 있을 때 |
| Git rollback | code/API scope 문제일 때 |
| hybrid rollback | DB + code 둘 다 되돌려야 할 때 |

## 13. smoke test 대상

restore 후 staging에서 다음 smoke test를 수행한다.

### 13-1. login

- admin login
- manager login
- cashier login
- role별 메뉴 접근
- 권한 없는 메뉴 차단

### 13-2. customers

- 고객 목록 조회
- 고객 상세 조회
- CRM history 조회
- order/repair/coupon/purchase confirmation history 표시
- phone/LINE binding 표시

### 13-3. POS

- POS 화면 조회
- 상품 검색
- 고객 선택
- 장바구니 계산
- 실제 주문 생성은 별도 승인 전 금지 또는 staging test data로만 수행

### 13-4. orders

- 주문 목록 조회
- 주문 상세 조회
- 예약금/잔금 표시
- 구매확인 상태 표시
- repair-classified order 표시 확인

### 13-5. repair flow

- 수리 목록 조회
- 수리 상세 조회
- 예약/견적/완료 상태 표시
- REPAIR 품목 포함 주문이 수리관리에서 보이는지 확인

### 13-6. coupon flow

- 쿠폰 목록 조회
- new_friend / google_review 상태 표시
- duplicate coupon warning 검토
- used coupon 이력 보존 확인

### 13-7. LINE webhook

- staging test mode 여부 확인
- 실제 고객에게 메시지 발송되지 않도록 설정 확인
- webhook route가 staging endpoint인지 확인
- LINE group registration 조회
- LINE binding customer 조회

### 13-8. Telegram flow

- legacy route/service가 staging에서 실제 운영 group으로 발송하지 않는지 확인
- Telegram 신규 workflow 추가 금지
- 잔존 Telegram callback이 운영 데이터에 영향을 주지 않는지 확인

### 13-9. purchase confirmation PDF

- 구매확인서 목록 조회
- PDF path 존재 확인
- PDF 다운로드/열람 가능 여부 확인
- orphan purchase confirmation은 별도 표시 또는 report 대상 확인

## 14. restore 후 데이터 검증

restore 후 dry-run SQL을 다시 실행해 baseline과 비교한다.

필수 비교:

| 항목 | 비교 기준 |
|---|---|
| customers count | 운영 dry-run과 일치 |
| orders count | 운영 dry-run과 일치 |
| order_items count | 운영 dry-run과 일치 |
| repair_orders count | 운영 dry-run과 일치 |
| products count | 운영 dry-run과 일치 |
| coupons count | 운영 dry-run과 일치 |
| purchase_confirmations count | 운영 dry-run과 일치 |
| inventory_movements count | 운영 dry-run과 일치 |
| duplicate phone count | 운영 dry-run과 일치 |
| duplicate coupon count | 운영 dry-run과 일치 |
| orphan count | 운영 dry-run과 일치 |
| LINE group/session count | 운영 dry-run과 일치 |

검증 원칙:

- row count가 다르면 restore 실패로 본다.
- orphan/duplicate 결과가 다르면 원인을 확인한다.
- restore 후 임의 수정 금지.

## 15. migration 전 restore rehearsal 필수 원칙

multi-tenant migration 전 restore rehearsal은 필수다.

필수 이유:

- 실제 rollback 가능성 검증
- backup 신뢰성 검증
- staging rehearsal 기반 확보
- migration 실패 시 운영 중단 시간 예측
- production approval 판단 근거 확보

금지:

- restore rehearsal 없이 production migration
- backup restore 실패 상태에서 backfill
- rollback duration 모르는 상태에서 운영 반영
- staging smoke test 없이 운영 반영

## 16. production safety 최우선 원칙

최종 원칙:

- production safety가 최우선이다.
- 복구 가능성이 증명되지 않으면 migration하지 않는다.
- 운영 데이터는 자동 병합하지 않는다.
- orphan row는 삭제하지 않는다.
- used coupon과 구매확인서 PDF는 보존한다.
- LINE/POS/Repair/Coupon flow가 깨지면 production migration을 중단한다.
- staging에서 성공한 절차만 production에 반영한다.
- production 반영은 별도 명시 승인 후 진행한다.
