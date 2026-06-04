# SaaS v1 공개 flow store 파라미터 정책

작성일: 2026-06-04  
브랜치: `beta/staging-architecture`
근거: `docs/KINGWAY_STORE_MASTER_SPEC.md`, 현재 공개 라우트 코드

## 1. 적용 대상

- `/line-order?store=` (frontend public entry, backend `backend/src/routes/lineOrder.js`)
- `/repair-reservation?store=` (frontend public entry, backend `backend/src/routes/lineRepair.js`)
- `/purchase-confirm/:token?store=` (frontend page + backend `backend/src/routes/purchaseConfirmations.js`)
- `/api/storefront/resolve-store` (backend `backend/src/routes/storefront.js`)

## 2. store 파라미터가 있는 경우 정책

- store 파라미터(`store`, `storeCode`, `store_code`)는 **store 식별 힌트**이다.
- 라우트는 먼저 resolver를 통해 실제 컨텍스트를 결정한다.
- `publicStoreResolver`의 우선순위는 고정이며 `store_code`도 이 우선순위의 한 단계다.
  - `SIGNED_TOKEN → LINE_CHANNEL → LIFF_ID → STORE_CODE → STORE_SLUG → HOSTNAME → LEGACY_KINGWAY_FALLBACK`
- `/line-order`, `/repair-reservation`은 `store`가 있을 때 다음을 강제한다.
  - resolver 결과가 `source=STORE_CODE`, resolved store가 존재, legacy fallback이 아님인 경우에만 허용
  - 해당 조건이 아니면 404
- `/purchase-confirm/:token`은 token 기반 접근이 우선이고, `store`는 선택적 검증 힌트다.

## 3. store 파라미터가 없는 경우 정책 (legacy)

- `/api/storefront/resolve-store`
  - 스토어 힌트 없이 요청하면 `404 { message: "找不到有效的門市代碼" }`
  - legacy fallback 없음
- `/line-order`, `/repair-reservation`
  - 현재는 `legacyFallbackMode=SOURCE.LEGACY_KINGWAY_FALLBACK`, `legacyFallbackStoreId=1`
  - 미지정 시 `req.publicStoreContext`가 없으면 `store_id=1`로 진행(legacy 호환)
- `/purchase-confirm/:token`
  - `store` 없음 가능
  - token의 store scope를 우선 사용(`tokenRow.storeId`)

## 4. invalid store 처리

- `/line-order` + `/repair-reservation`
  - 존재하지 않는/불일치 store 코드: `404 { message: "找不到有效的門市代碼" }`
- `/purchase-confirm/:token`
  - `store`가 요청되었으나 resolver가 못 찾거나 token store와 다르면 `404`
  - 메시지: `找不到有效的門市資訊` 또는 `找不到購買確認連結`
- `/api/storefront/resolve-store`
  - store 힌트 미해결: `404 { message: "找不到有效的門市代碼" }`
  - store_id 조회 결과가 없거나 비활성: `404 { message: "找不到有效的門市資料" }`

## 5. token possession flow와 store mismatch 정책

- 핵심은 store 매칭을 `store` query가 아니라 토큰/세션/엔티티 소유권으로 판단한다.
- purchase-confirm
  - `/public/:token`, `/public/:token/pdf`, `/public/:token` POST는 모두 tokenRow를 먼저 조회
  - token의 `storeId`를 소유권으로 사용
  - `store`가 있으면 별도 resolver 비교를 통해 token `storeId`와 일치해야 함
  - 불일치 시 `404` 처리
- `line-order`/`line-repair`의 경우는 고객 식별자(`lineUserId`)와 resolved store context를 연계해 reservation/customer 흐름을 생성하므로, `store` mismatch가 있으면 라우트 진입을 차단

## 6. purchase-confirm PDF 정책

- 공개 접근은 token 기반 엔드포인트로 한정한다.
- `/api/purchase-confirmations/public/:token/pdf`는 token 조회 후 `fetchPurchaseConfirmationPdfRecordByToken(token, tokenRow.storeId)`로 store 조건을 강제한다.
- `store` 파라미터가 존재할 경우 token store와 mismatch 시 접근 차단(=404).
- staff/수동 다운로드(`manual/download`)는 별도 JWT 토큰/`/download/:accessToken` 검증 경로를 사용하며 공개 `store` 파라미터 정책의 직접 적용 대상이 아니다.

## 7. LIFF store hint 신뢰 금지 및 resolver 검증

- `publicStoreResolver` Trust Boundary에 따라 `req.body/store_id`, `req.query.storeId` 등 직접 client-provided store id는 신뢰하지 않는다.
- LIFF 또는 URL에 보이는 `store`는 공개 hint일 뿐이며, resolver 결과 및 소스 신뢰도를 통과해야 한다.
- `/line-order`, `/repair-reservation`에서 resolver가 `STORE_CODE` 소스가 아니면 `store` 요청은 404로 종료.
- `/api/storefront/resolve-store`는 `store` hint를 resolver로 검증해 실제 store metadata만 반환.

## 8. KINGWAY_TAINAN legacy 유지 범위

- `store_id=1` 기본점: `backend/src/routes/lineOrder.js`, `backend/src/routes/lineRepair.js`의 현재 미지정 경로 동작은 `legacyFallbackMode`와 함께 존재.
- `legacy`는 오직 공개 정책의 임시 호환으로만 허용되며, `sourceResolved=false`, `legacyFallbackUsed=true`로 기록된다.
- `/api/storefront/resolve-store`는 legacy fallback을 사용하지 않음(실패 시 404).

## 9. 출시 전 PASS 기준

- [ ] `/api/storefront/resolve-store`는 유효한 store 코드·slug에서 200, 미유효 시 404
- [ ] `/line-order?store=`는 일치 시 정상 응답, 미일치 시 404
- [ ] `/repair-reservation?store=`는 일치 시 정상 응답, 미일치 시 404
- [ ] `/purchase-confirm/:token`은 `store` 생략 시 token 기반 동작, `store` 제공 시 token 소유 store와 mismatch면 404
- [ ] `/api/purchase-confirmations/public/:token/pdf`는 token 소유 store 경계 위반 시 차단
- [ ] `store_id` query/body를 클라이언트가 직접 바꿔도 인증/저장 동작에서 신뢰되지 않음

## 10. 추후 개선

- signed store token (public URL/QR에서 storeCode 대신 서명된 스토어 토큰 사용)
- LIFF ID → routeScope 기반 resolver를 강화하고, store hint와의 정합성 로그/알림 자동화
- custom domain/subdomain 매핑 정식 지원 (`store_hostnames`)을 공개 flow에 일괄 적용

## 11. 보류 항목

- `/line-order`, `/repair-reservation`의 legacy fallback 제거 시점은 `LINE_MULTI_STORE_MIGRATION` 단계에서 별도 플래그 기반으로 전환해야 함
- `/api/storefront/resolve-store`는 인증이 불필요한 공개 엔드포인트이나, 향후 `trusted client side hints` 정책과 결합해 캐싱/레이트 제한/로그 정책 강화 필요
