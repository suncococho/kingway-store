# SaaS v1 매장 Owner 온보딩 SOP

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`

본 SOP는 운영 전환 전, 새 매장 오너가 SaaS v1에서 처음 시스템을 사용할 수 있게 만드는 표준 절차이다.  
적용 범위: `docs/SAAS_V1_TEST_STORE_REHEARSAL_PLAN.md`, `docs/SAAS_V1_REHEARSAL_FINAL_REPORT.md`, `docs/SAAS_V1_FINAL_LAUNCH_CHECKLIST.md` 기준.  
제약: production `.env` 변경 금지, DB destructive 변경 금지, 배포 금지, 실제 LINE 발송 금지.

## 1) Platform Admin이 새 매장 생성하는 절차

1. 플랫폼 운영자 로그인 후 `platform-admin`에서 테스트 매장 생성 화면 또는 API를 열람한다.  
2. `POST /api/saas-admin/stores`로 매장 기초 정보를 생성한다.
   - 입력 항목: `code`, `name`, `status`, `plan`, owner 계정 정보(예: `username`, 역할)
3. 응답에서 다음 값을 수기로 기록한다.
   - `store_id`
   - `store_code`
   - `owner_username`
   - `owner_temp_password`(임시 비밀번호가 전달된 경우)
4. `GET /api/saas-admin/stores/:id/features`로 기본 기능 상태를 조회해 리허설/운영 정책과 맞는지 확인한다.
5. 생성 직후 매장 리스트/상세에서 중복 코드/이름 오기록이 없는지 확인한다.

## 2) owner 계정/임시 비밀번호 전달 방식

1. owner 임시 비밀번호는 플랫폼 운영자 채널에서 1회성으로만 전달한다(채팅/메신저 재전송 최소화).
2. 전달 메시지에는 다음만 포함한다.
   - `store_code`
   - `owner_username`
   - `login_url`(운영 기준 URL)
   - 임시 비밀번호
3. 임시 비밀번호는 전달 즉시 오너가 최초 로그인 후 1회 변경하도록 안내하고, 재전송은 금지한다.
4. 전달 저장 로그는 운영 내부 시스템에서 최소 보관하고 원문 비밀번호는 노출 저장소에 영구 보관하지 않는다.

## 3) owner 첫 로그인 절차

1. owner는 최초 전달된 계정으로 로그인한다.
2. 로그인 성공 후 대시보드 진입 가능 여부를 확인한다.
3. 기본 메뉴 노출이 의도된 범위인지 확인한다.
   - 정상: `store` 스코프 API 호출이 본인 매장 기준으로 동작
   - 비정상: 타 점포 API 접근/직접 URL 접근 차단 확인
4. 최초 로그인 직후 비밀번호 변경을 수행한다.
5. `GET /api/store/settings`와 `GET /api/store/settings/line`로 정상 조회를 확인한다.

## 4) Store Settings 입력 절차

1. `GET /api/store/settings`로 현재 값 조회.
2. 다음 최소 항목을 입력/보정한다.
   - 상호명/연락처/주소/영업시간/영수증 표시명
3. `PATCH /api/store/settings`로 저장 후 재조회해서 반영 여부 확인.
4. 저장 전후 필드 수 비교로 누락/초기화 없이 저장되었는지 확인한다.

## 5) LINE Settings 입력 절차

1. `GET /api/store/settings/line`에서 현재 설정 상태 확인.
2. `channelId`, `channelSecretRef`, `channelAccessTokenRef` 또는 `env` 방식 설정 항목 확인.
3. `PATCH /api/store/settings/line` 저장 후 재조회한다.
4. 응답에서 마스킹 확인(`****` 형식) 및 원문 노출이 없는지 확인한다.
5. `webhook_path` 노출 및 관리 정책(토큰화 경로 사용 유무)을 확인한다.

## 6) 상품 1개 등록 절차

1. owner 권한으로 상품 관리 접근.
2. 제품 1건을 등록한다.
   - 최소 항목: 이름, 가격, 카테고리, SKU
3. 등록 후 `GET /api/products`로 목록에서 조회되는지 확인.
4. SKU/카테고리 파생표기와 내부 표준과의 차이가 없도록 즉시 검수한다.

## 7) 주문/POS 첫 테스트 절차

1. 테스트 고객을 생성/선택하고 주문을 1건 생성한다.
2. 생성 주문 번호와 상태를 메모한다.
3. `GET /api/orders`, 주문 상세에서 본 매장 데이터만 조회되는지 확인한다.
4. 재고/금액/결제 흐름이 정상 동작하는지 최소 화면을 통해 확인한다.

## 8) 수리예약 첫 테스트 절차

1. 수리 예약 화면에서 고객 정보, 연락처, 차량/증상, 예약일시를 입력해 생성한다.
2. 생성된 수리예약 id를 기록한다.
3. 수리 목록/상세에서 본 매장으로만 조회되는지 확인한다.
4. (스테이징) 실제 LINE 발송이 아닌 억제/핑퐁 확인만 수행한다.

## 9) purchase-confirm 첫 테스트 절차

1. purchase-confirm 기능이 활성화된 상태에서 테스트 주문과 연동한다.
2. 확인 토큰 링크를 생성해 공개 URL을 확인한다.
3. 다음 조합을 테스트한다.
   - token + 유효 store: 정상
   - token + 잘못된 store: 차단(404 또는 정책 응답)
4. 공개 제출/상태 반영을 확인하고 PDF 조회가 정상 동작하는지 점검한다.

## 10) Free/Premium 수동 전환 절차

1. 플랫폼 관리자에서 대상 `store_features`를 조회한다.
2. Free/Premium preset 또는 개별 기능 토글을 적용한다.
3. owner가 메뉴 노출·직접 URL·API 정책 변경을 즉시 확인한다.
4. 승인 범위 내에서 1회 rollback을 수행해 복원 동작까지 확인한다.
5. 변경 이력과 일시를 기록한다.

## 11) 주의사항

- token/secret 원문 공유 금지
  - `channelSecret`, `channelAccessToken`, 토큰 원문은 문서/채팅/화면에 그대로 남기지 않는다.
- production `.env` 수정 금지
  - staging 기준 실습은 임시값/마스킹 정책 중심으로만 처리한다.
- 실제 LINE 메시지 발송 금지
  - 운영 전환 전에는 ping/pong 응답·차단 로그 수준의 검증만 수행한다.
- DB destructive 작업 금지
  - 이번 온보딩 절차에서 DROP/TRUNCATE/DELETE는 수행하지 않는다.

## 12) 실패 시 지원팀 확인 항목

1. 로그인 실패
2. owner 비밀번호 전달/변경 실패
3. store settings/line settings 저장 실패
4. 상품/주문/수리예약 접근이 타 매장으로 침투하거나 403/404가 과도하게 발생
5. `store_code` 조작 시 공개 링크 차단 실패
6. Free/Premium 전환 후 메뉴/API 정책 불일치
7. v1 공개 URL 또는 webhook 연동 응답 분기 실패(401/503/404 패턴)

지원팀은 위 항목별로 재시도 범위를 나누고, 문제 항목만 재실행한다.

## 13) 매장 사장에게 보여줄 10분 데모 순서

1. 매장 정보(코드/상호)와 owner 계정 로그인 방식 설명
2. 스토어 기본 설정(연락처/주소/영업시간) 입력 화면
3. LINE 설정 마스킹 확인 및 webhook 주소 확인
4. 상품 1건 등록 후 주문 1건 생성
5. 수리예약 생성 후 접수 조회
6. 구매확인 링크 생성 및 토큰 flow 확인
7. Free/Premium 토글 차이 체감 화면
8. 타 매장 데이터가 보이지 않는 다중 매장 분리 규칙 설명
9. 문제 발생 시 문의 채널과 재시작 방법 설명
10. 실제 운영 전 메시지 발송은 향후 승인 후 전환됨을 안내
