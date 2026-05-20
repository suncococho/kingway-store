# PRODUCT_IMAGE_UPLOAD

이 문서는 `backend/src/routes/products.js`, `frontend/src/pages/ProductsPage.jsx`, `frontend/src/components/ProductImage.jsx`, `frontend/src/lib/api.js`를 기준으로 작성했습니다.

## Backend route

Route:

- `POST /api/products/images`

File:

- `backend/src/routes/products.js`

Middleware:

- `express.raw({ type: allowedImageTypes, limit: "8mb" })`

Allowed content types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`

## Request format

Frontend helper:

- `frontend/src/lib/api.js`
- function: `apiUploadImage(path, file)`

Request:

- Method: `POST`
- URL: `/api/products/images`
- Body: raw file
- Header `Content-Type`: file MIME type
- Header `X-File-Name`: original file name
- Header `Authorization`: Bearer token if available

이 route는 multipart form-data가 아니라 raw file body를 사용합니다.

## Validation

`backend/src/routes/products.js`에서 확인된 검증:

- `Content-Type`이 allowed image type이어야 합니다.
- request body가 비어 있으면 안 됩니다.
- 최대 크기 `8mb`

실패 시:

- 지원하지 않는 형식: HTTP 400
- 파일 없음: HTTP 400

## Storage path

Backend storage directory:

```text
backend/storage/products
```

Code path:

```js
path.join(__dirname, "..", "..", "storage", "products")
```

Express static route:

```text
/files -> backend/storage
```

응답 image URL:

```text
/files/products/{fileName}
```

## Filename generation

`backend/src/routes/products.js`에서 확인된 생성 규칙:

1. `X-File-Name` 또는 기본값 `product` 사용
2. `path.basename()` 적용
3. Unicode normalize `NFKD`
4. `[\w.-]` 외 문자를 `-`로 치환
5. 앞뒤 dash 제거
6. 최대 80자 사용
7. MIME type에 따라 확장자 결정
8. 최종 파일명:

```text
{Date.now()}-{randomHex}-{safeBaseName}{extension}
```

## Response

성공 응답:

```json
{
  "imageUrl": "/files/products/{fileName}"
}
```

Status:

- `201`

## Product create/update

Product routes:

- `POST /api/products`
- `PATCH /api/products/:id`

상품 row column:

- `products.image_url`

Frontend:

- `frontend/src/pages/ProductsPage.jsx`

동작:

- 신규 상품 form에서 이미지 업로드 후 `imageUrl`을 form state에 저장
- 상세/edit form에서 이미지 업로드 후 `detailForm.imageUrl`에 저장
- 상품 저장 시 `imageUrl`이 product payload에 포함됩니다.

## Image display

Component:

- `frontend/src/components/ProductImage.jsx`

처리하는 URL 형태:

- `http://...`
- `https://...`
- `data:image...`
- `/files/...`
- `files/...`
- `storage/products/...`
- `products/...`
- `wp-content/uploads/...`

Fallback UI:

- `無圖`

Modal/preview 기능도 `ProductImage.jsx`에서 처리됩니다.

## Product category relation

상품 이미지 업로드 자체는 category와 독립적입니다. 다만 상품관리 저장 시 category는 `products.category`에 저장되며 현재 enum은 다음 코드입니다.

- `EB`
- `RP`
- `PT`
- `AC`
- `TR`
- `LT`
- `LK`
- `SE`
- `HB`
- `CR`
- `OT`

대표 표시 라벨:

- `EB` / `EBIKE`: `電動自行車`
- `RP` / `REPAIR`: `維修`
- `PT` / `ACCESSORY`: `配件`
- `OT` / `OTHER`: `其他`

## Operational checks

이미지가 업로드되었는데 표시되지 않으면 다음을 확인합니다.

1. `POST /api/products/images` 응답의 `imageUrl`
2. `backend/storage/products`에 실제 파일 존재 여부
3. `/files/products/{fileName}` 접근 가능 여부
4. `products.image_url`에 저장된 값
5. `ProductImage.jsx`의 URL normalize 대상인지 여부

## Related files

- `backend/src/routes/products.js`
- `backend/src/app.js`
- `frontend/src/pages/ProductsPage.jsx`
- `frontend/src/components/ProductImage.jsx`
- `frontend/src/lib/api.js`
- `backend/storage/products`
