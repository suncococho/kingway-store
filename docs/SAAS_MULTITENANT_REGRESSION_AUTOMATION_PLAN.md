# SaaS v1 멀티테넌시 교차침투 회귀 자동화 계획

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
목적: store 1과 rehearsal store 5의 데이터·기능·직접 URL 분리 상태를 자동으로 회귀 점검하여 v1 런칭 전 멀티테넌시 회귀 위험을 제로화한다.

## 1. 자동화 목적

1. Store 1과 Store 5의 tenant 경계를 상품, 주문, 고객, 수리, purchase-confirm, coupons, 설정, LINE 설정, 파일 접근 레벨에서 강제로 검증한다.
2. 회귀 실행 시, Free/Premium 정책 토글이 메뉴/API/직접 URL 접근 정책에 즉시 반영되는지 확인한다.
3. 자동화 실패 시 1차 롤백 포인트(기능 복귀 및 계정/스토어 정합성)로 빠르게 되돌릴 수 있는 증거를 남긴다.
4. 실행 로그에서 raw 토큰·secret, raw credential, DB destructive 이벤트를 배제한다.

## 2. 테스트 대상 store

1. control store: store 1 (`KINGWAY_TAINAN`), 기준 데이터/기능 분리의 기준점
2. rehearsal store: store 5 (`KW_REHEARSAL_202606`, owner `kw_rehearsal_owner`)
3. 제약 조건: 운영 DB 스키마 변경 금지, 포트/컨테이너 경계 고정, 실시간 배포 금지

## 3. 테스트 계정/토큰 정책

1. 사용할 계정/토큰은 자동화 실행 시점에 환경 변수 또는 CI secret에서 주입한다.
2. 플랫폼 admin 토큰: store 1, store 5 전환 점검과 saas-admin preset/API 접근 확인에만 사용한다.
3. owner 토큰: store 1 owner(운영 인증 채널 보유 계정)와 store 5 owner(`kw_rehearsal_owner`)의 정상 로그인 토큰만 사용한다.
4. line 테스트는 ping/pong 또는 mock lineUserId 시나리오로만 수행하고, 실제 사용자 메시지 발송은 금지한다.
5. 토큰/비밀번호 원문은 테스트 로그에 출력 금지, 실패 출력은 마스킹 필드만 허용한다.

## 4. 교차침투 테스트 범위

1. products: store 1에서 store 5 상품이 보이거나 store 5에서 store 1 상품이 보이면 FAIL
2. orders: 주문 목록/상세, invoice 생성, customer-status 연동까지 store_id 단위로 격리 확인
3. customers: 고객 조회 목록과 상세에서 타 store 주문/연락처/CRM 연동 노출 여부 확인
4. repairs: `repair_orders` 및 수리 상세/상태 변경 API의 store scope 확인, line-repair 흐름 연계 실패 시도 포함
5. purchase-confirmations: token+store 조합 접근, staff 조회 목록, manual/public 라우트의 tenant 노출 여부 점검
6. coupons: /api/coupons 및 관련 목록/생성 흐름에서 200/403 정책과 store 간 데이터 격리 확인
7. store settings: store settings, store-settings-write가 같은 store에만 반영되는지 확인
8. line settings: store 1과 store 5 line 설정 조회/수정 후 서로의 데이터 오염 여부 확인
9. files/pdf: `/files/*`, `/files/pdfs/*`, `/api/purchase-confirmations/manual/:id/pdf` 직접 URL 침투 차단 여부 확인

## 5. PASS 기준

1. 자기 store 접근은 200 success 또는 정책상 허용 응답이어야 한다.
2. 타 store 접근은 403 또는 404 중 정책 일치 응답이 되어야 하며, 200이면 fail.
3. 리스트 API는 타 store 데이터가 전혀 노출되지 않아야 한다.
4. Free/Premium 토글 시 메뉴·직접 URL·API 정책이 즉시 일치해야 한다.
5. store 1과 store 5 각각에서 동일한 회귀 시나리오를 같은 스크립트로 반복 실행해 동일한 결과가 나와야 한다.
6. 테스트 후에도 기존 데이터는 삭제하지 않고 보존되며, 회귀 실행 내역만 로그로 남아야 한다.

## 6. FAIL 기준

1. 타 store 데이터가 노출되거나 조회 가능한 경우
2. 자기 store가 401/403/404로 과도 차단되어 기본 흐름이 깨진 경우
3. `/files/*` 또는 `/files/pdfs/*`로 타 store 민감 문서에 접근 가능한 경우
4. coupons/order/customer/repairs/purchase-confirm 등 중 1개라도 정책 미반영
5. storeCode 조작 또는 비정상 store 파라미터(`FAKE/INVALID`)에 의해 정책 오동작이 발생한 경우
6. raw token/secret가 출력되거나 라인 메시지가 실제 발송된 경우

## 7. 테스트 데이터 prefix

1. 모든 테스트 전용 이름/코드/노트/메시지에는 `KW_REHEARSAL` prefix를 반드시 사용한다.
2. 기존 운영 데이터와 혼재되지 않도록 fixture 생성/조회 키는 매번 `KW_REHEARSAL_<domain>_<timestamp>` 형식으로 고정한다.

## 8. 실제 LINE 발송 금지 조건

1. 자동화 실행 시 `line send`, push, reply, broadcast는 금지한다.
2. 검증은 webhook/route 응답과 store 해결 경로만 확인하고 채널 발송 결과만 관측한다.
3. `/files` 또는 공개 URL로 인해 tokenized reply/push가 유도되지 않도록 메시지 발송 플래그를 반드시 dry-run로 유지한다.

## 9. 스크립트 위치 제안

1. `scripts/regression/multitenant-smoke.sh`를 신규 스크립트로 제안한다.
2. 실행 방식은 `store_pairs=(1 5)` 형태로 루프하고, 각 스토어를 actor/target으로 교차 호출한다.
3. 테스트 시나리오는 단계별로 아래 endpoint 그룹을 순차 실행한다.
4. 추천 스크립트 구조는 백엔드 기본 인증 확인, store 1/5 token 발급, API 교차 호출, direct URL 검증, feature toggle 검증, 정리 리포트 출력이다.

예시:
```bash
#!/usr/bin/env bash
set -euo pipefail
TARGET_STORES=(1 5)
# 1) 토큰 준비
# 2) store scope baseline 조회
# 3) 교차 API 검사(products/orders/customers/repairs/purchase-confirmations/coupons/settings/line-settings/files)
# 4) free/premium preset 토글 후 재검증
# 5) 결과 JSON 리포트 출력
```

## 10. destructive 금지

1. `DROP`, `TRUNCATE`, `DELETE`를 실행하지 않는다.
2. 테스트용 데이터 생성은 허용하되 생성 후 즉시 삭제하지 않는다(재활용 및 추적 용도).
3. docker volume 삭제, `.env` 교체/수정, 배포/재기동은 실행하지 않는다.

## 11. 실행 순서

1. 사전 점검: staging target, 스토어 코드 매핑, 테스트 토큰 유효성 확인.
2. baseline 수집: store 1 및 store 5에서 products/orders/customers/repairs/purchase-confirmations/coupons/settings/line settings 목록/상세 샘플 추출.
3. 교차 침투1차: store 1 토큰으로 store 5 API를 호출해 타 store 차단(403/404) 확인.
4. 교차 침투2차: store 5 토큰으로 store 1 API를 호출해 타 store 차단 확인.
5. direct URL 검사: `/files/pdfs/*`, `/files/products/*`, `manual/pdf` 등 공개 경로 접근 결과를 403/404로 점검.
6. LIFF/store 파라미터 검사: purchase-confirm/public, line-order, line-repair에서 유효/무효 storeCode 조합 테스트.
7. Free/Premium 스위치: store 5를 FREE→PREMIUM로 토글하고 두 상태에서 owner 메뉴/API 정책 일치 여부 확인.
8. 롤백/복구: 가능한 경우 baseline 기능 상태로 복귀 후 재점검.
9. 결과 집계: store별 PASS/FAIL 및 타 store 침투 건수, 직접 URL 침투 건수, 라인 발송 금지 위반 건수 산출.

## 12. CI/수동 실행 계획

1. 수동 실행: 매일 배포 전 1회, 코드 변경 시 store 1/5 smoke 스크립트 수동 runbook 수행.
2. CI 실행: 릴리스 브랜치 병합 전 야간 또는 PR 동기 job으로 `scripts/regression/multitenant-smoke.sh` 실행.
3. 실패 시 결과: CI 실패를 red flag로 간주하고, 자동화 결과의 store 5 rehearsal 항목이 전부 안정화될 때까지 배포 승인 중단.
4. 리포트 저장: 실행 요약을 `docs/SAAS_V1_MULTITENANT_REGRESSION_CHECK.md`와 연결하고, 실패 증거(요청/응답 코드/URL만) 첨부.

## 13. 다음 구현 1순위

1. repair/line-repair 서비스의 `store_id` 단일 진입점 강제 적용을 완료해 모든 repair 상태 변경과 estimate postback가 store scope 기반으로만 동작하도록 마감한다.
