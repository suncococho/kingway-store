# 임시 조치: LIFF Context 디버그(Production)

## 목적
`pos.kingway.tw`(production)에서 LINE OA 진입 시 `無法取得 LINE 使用者資料`가 계속 발생해 원인 추적이 불가한 상태를 바로 확인하기 위해, `LinePhoneBindGate`에 임시 디버그 카드를 표시한다.

## 적용 범위
- frontend만 변경
- backend/DB/LINE 발송/리버스 프록시 변경 없음
- 임시 조치 상태: **활성**

## 표시 항목
- `liffId`
- `isInClient`
- `isLoggedIn`
- `context.userId`
- `profile.userId`
- `lineUserId`
- `failureReason`

## 보안/민감정보 정책
- token/secret/session secret은 출력하지 않는다.
- 표시 대상은 LIFF context 진단값만 노출한다.

## 제거 계획
- 원인 확인이 끝나면 즉시 해당 코드를 되돌리고
  - `LinePhoneBindGate`의 production 노출 플래그 조건에서 production 허용을 제거할 것.
- 관련 커밋과 함께 운영 반영 여부를 별도 기록한다.

## 주의
- 본 조치는 진단 목적의 일시적 상태이며, 장기 운영 반영이 아니다.
