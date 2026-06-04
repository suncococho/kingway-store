# SaaS v1 테스트 매장 E2E 리허설 계획 (1차)

작성일: 2026-06-04
브랜치: `beta/staging-architecture`
대상: CODE FREEZE 전 1매장 실사용 리허설

목적: 실제 운영 승인 전, `test store`를 기준으로 멀티테넌시·온보딩·주요 업무 흐름·롤백 동작을 E2E로 점검한다.
제약: production 설정/`.env`/DB destructive 변경 금지, 실제 LINE 메시지 발송 금지.

## 1) 테스트 목적

1. 신규 매장 1개를 실제 운영과 유사한 순서로 오픈 가능한지 검증한다.
2. `store owner` 계정과 `store_features`를 기준으로 권한/메뉴/직접 URL가 일치하는지 확인한다.
3. 공개 LIFF 진입과 구매확인/수리예약의 store context가 유지되는지 점검한다.
4. LINE 설정을 입력해도 legacy 흐름이 보존되며 tokenized webhook가 제한 조건으로만 동작하는지 검증한다.
5. 실패/오류 발생 시 운영 롤백 절차가 동작 가능한지 확인한다.

## 2) 테스트 매장 생성 절차

1. 플랫폼 관리자 계정으로 로그인한다.
2. `POST /api/saas-admin/stores`로 테스트 매장을 생성한다.
3. 요청 항목: store code, store name, status(`active`), plan(`trial` 또는 `single_store`), owner 정보.
4. 응답에서 다음 값을 저장한다.
   - 신규 store id
   - owner 임시 비밀번호
   - webhook_path(초기값 존재 시)
5. 매장 리스트에서 신규 id가 정상 생성됐는지 확인한다.
6. 신규 매장 `store_features`를 조회해 Free preset 기준 값이 반영되었는지 확인한다.

## 3) owner 로그인 절차

1. 신규 store owner ID로 `/api/platform-auth/login` 또는 staff 로그인 경로(실제 운영 절차에서 사용되는 경로) 확인.
2. owner가 첫 로그인 후 비밀번호 변경 또는 안내 문구 전달 규칙을 수동으로 수행한다.
3. owner 계정으로 다음 화면 접근을 점검한다.
   - `/dashboard`
   - 메뉴 권한 기반 페이지 노출(Free 범위)
   - `/saas-admin` 접근 차단 여부(권한에 따라 적절히 차단)
4. `req.storeId`가 해당 store로 매핑되는지 API 응답/세션 동작으로 간접 확인한다.

## 4) 매장 설정 입력

1. owner/admin 권한으로 [store settings] 진입:
   - `GET /api/store/settings`
   - 상시 필수 항목(名稱/주소/전화/영업時間/시간대/영수증 표시명) 확인
2. 필요한 값 입력/수정 후 `PATCH /api/store/settings` 실행.
3. 응답/반영 후 재조회로 저장값 일치 확인.
4. 금지 검증:
   - client-provided store_id가 요청에 있어도 반영되지 않아야 함.
   - raw token/secret 계열 값이 설정 API에 입력되어도 저장/반영되지 않아야 함.

## 5) LINE 설정 입력

1. owner/admin 권한으로 `GET /api/store/settings/line`으로 현재 상태 확인.
2. 채널 입력 항목:
   - `channelId`
   - `channelSecret` 또는 `channelSecretRef`
   - `channelAccessToken` 또는 `channelAccessTokenRef`
   - webhook path
3. 마스킹 응답(`masked` 형태)만 노출되는지 확인.
4. raw secret/token이 응답 또는 로그 출력에 노출되지 않는지 문서화.
5. webhook_path 기준으로 tokenized webhook URL이 산출되는지 확인한다.

## 6) 상품 등록

1. owner/admin으로 상품 관리 메뉴 접근.
2. 상품 기본 입력(이름/가격/카테고리/SKU) 실행.
3. 이미지 업로드(모바일/웹 모두 시도, 업로드/미리보기/저장).
4. 상품 목록 조회에서 신규 store id 기준으로만 노출되는지 확인.
5. 직접 URL로 타 매장 접근 조합을 시도해 교차 조회를 방지한다.

## 7) 주문 생성

1. 고객 주문 생성 플로우에서 최소 1건을 생성한다.
2. 주문 목록/상세 조회에서 생성 store의 데이터만 보이는지 확인.
3. 주문 상태 변경(예: 접수/확인/완료) 및 기본 유의사항 알림 문구 확인.
4. 동일 storeCode로 다른 매장의 주문 API를 호출했을 때 침투되지 않음을 확인한다.

## 8) 수리예약 생성

1. LINE LIFF 또는 내부 흐름으로 수리예약 화면/등록 경로 접근.
2. 기본 항목(고객명/연락처/문제 설명/예정일)을 입력해 예약 생성.
3. `repair code` 또는 접수 id가 정상 발급되는지 확인.
4. 수리 목록에서 store scope가 일치하는지 검증한다.
5. 공개 정합성 체크:
   - `storeCode` 정상 지정 시 조회/생성 허용
   - 잘못된 storeCode 시 404/차단 응답

9) 구매확인 확인

1. 구매확인 엔트리 토큰을 생성하고 공개 링크를 확인한다.
2. `purchase-confirm` 공개 URL에 `store` 파라미터를 붙여 접근:
   - 정상 storeCode: 화면 노출 및 확인 진행
   - `FAKE/INVALID` storeCode: 차단 응답
3. 서명/토큰 검증 경로 없이도 권한/store scope가 우회되지 않는지 확인한다.
4. 주문-구매확인 연동 상태를 정리해 스크린샷 또는 로그로 남긴다.

## 10) Free/Premium 전환

1. 플랫폼 admin 화면에서 대상 store의 `store_features` 조회.
2. Free 기준으로 시작해서 일부 메뉴 토글을 조정한다.
3. owner 계정으로 다음을 즉시 확인한다.
   - 메뉴 노출 변화
   - 제한된 직접 URL 접근(403/안내 메시지)
4. 변경 후 rollback(기존 preset 복원)까지 수행해 양방향 동작을 확인한다.
5. 변경 이력/스크린샷을 보존한다.

## 11) 실패 시 rollback

1. 발생 케이스 분류
   - 로그인/권한 오류
   - 매장 설정 입력 누락/유효성 실패
   - store scope 침투 또는 라우팅 오류
   - webhook/LINE 설정 검증 실패
2. 즉시 조치
   - 문제 기능만 되돌리고 나머지 리허설은 유지
   - owner가 아닌 경우 플랫폼 admin으로 상태 점검
   - lineized tokenized 기능은 필요 시 dry-run/보류 상태로 둔다.
3. 롤백 순서
   - `store_features` 원상복구
   - 매장 설정 변경 전 값 복원
   - LINE 설정은 마스킹 상태만 보관하며 실행 플래그/입력값은 원복
4. 재시도
   - 실패 항목만 개별 재실행
   - 재실행 결과를 PASS/FAIL 로그에 기록

## 12) PASS/FAIL 기준

### PASS

1. 플랫폼 admin이 신규 매장을 1회 생성하고 owner가 로그인/접근 가능한 상태.
2. store settings와 line settings 조회/입력 후 조회 일관성 유지.
3. 상품/주문/수리예약이 테스트 매장 scope로만 동작.
4. LIFF 공개 진입 링크에서 storeCode 조작에 대한 차단이 일관되게 동작.
5. Free→Premium 토글 후 메뉴/직접 URL 동작 변화가 일치.
6. 실패 시 지정한 롤백 순서로 기능 복구 가능.

### FAIL

1. raw token/secret가 표시되거나 로그/응답 노출.
2. store scope 침투(타 매장 데이터 표시/수정).
3. owner 권한으로 불가한 메뉴만 노출되는 등 정책 불일치.
4. LINE 설정 입력은 되었으나 legacy 흐름이 깨지거나 tokenized 제한을 위반.
5. purchase-confirm/LIFF storeCode 조작 차단 실패.
6. rollback 수행이 불가능하거나 데이터 정합성이 깨짐.

## 13) 실제 매장 사장에게 보여줄 데모 순서

1. 매장 생성 요약(한 화면에서 코드/매장정보/owner 계정 발급).
2. owner 로그인과 대시보드 확인.
3. 가게 정보/로고/연락처 등록.
4. LIFF 주문 연결 URL/수리예약 URL/구매확인 데모.
5. 상품 등록 및 주문 1건 처리 데모.
6. 수리예약 접수 생성 및 처리 대시보드 확인.
7. 구매확인 버튼/확인 화면 체험.
8. Free/Premium 기능 토글 UI로 기능 차이 체감.
9. “발송은 실제 운영 단계 이전이며 지금은 제한 모드” 안내 후 운영 전환 범위 명시.
