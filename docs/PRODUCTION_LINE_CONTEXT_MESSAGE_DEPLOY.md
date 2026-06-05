# Production LINE context missing message deploy log

## 배포 일시
- 2026-06-05

## 변경 대상
- phone binding line context missing 안내문을 기존 문구에서 새 문구로 변경
  - 기존: `缺少 LINE 使用者資料，請重新從 LINE 開啟。`
  - 변경: 
    - `無法取得 LINE 使用者資料。`
    - `請回到 KINGWAY LINE 官方帳號，從選單重新開啟此頁面。`

## 배포 대상/조건
- 변경 반영 환경: production `5173` (`https://pos.kingway.tw`)
- 적용 방식: frontend docker image rebuild + `docker compose up -d --no-deps frontend`
- DB/Backend/API/Reverse proxy 변경 없음

## 배포/검증 결과
- `https://pos.kingway.tw/` 상태코드: `200`
- 기존 프로덕션 번들: `/assets/index-C78SEFUN.js`
- 배포 후 프로덕션 번들: `/assets/index-DV6L2rLB.js`
- 배포 후 번들 문자열 확인
  - `無法取得 LINE 使用者資料。` : 존재
  - `請回到 KINGWAY LINE 官方帳號，從選單重新開啟此頁面。` : 존재
  - `缺少 LINE 使用者資料，請重新從 LINE 開啟。` : 미존재

## API smoke
- `/api/system/saas-status` : `200`
- `/api/login` : `404 (GET)`
- `/api/dashboard/summary` : `401`
- 참고: 해당 API는 인증/요청 방식 미스매치로 404/401 응답 확인됨

