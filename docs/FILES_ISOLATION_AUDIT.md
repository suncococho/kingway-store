# Files / Uploads Tenant Isolation Audit

Date: 2026-06-03
Branch: `beta/staging-architecture`

## Scope

Audited file and upload exposure for:

- `/files/*`
- `/files/products/*`
- purchase confirmation PDF
- signature image handling
- repair attachment / photo surfaces
- product image upload
- static file mount
- download routes

This step is audit-only. No application logic, LINE/Telegram flow, production config, `.env`, DB data, or stored files were modified.

## Method

Static review only:

- `backend/src/app.js`
- `backend/src/routes/products.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/repairs.js`
- `backend/src/services/pdfService.js`
- related frontend consumers under `frontend/src`

No file deletion, DB mutation, or runtime storage cleanup was performed.

## Route / Storage Inventory

### Static Route

- `backend/src/app.js:422`
- `app.use("/files", express.static(path.join(__dirname, "..", "storage")));`

Observed effect:

- every runtime file under `backend/../storage` is directly web-accessible if the relative path is known
- there is no authentication, store check, token check, or ownership validation on `/files/*`

### Runtime Storage Paths

Observed code-managed storage paths:

- `storage/products/*`
  - writer: `backend/src/routes/products.js:30,189-207`
  - public URL shape: `/files/products/<generated-file-name>`
- `storage/pdfs/*`
  - writer: `backend/src/services/pdfService.js:6,139-169`
  - public URL shape: `/files/pdfs/purchase-confirmation-<confirmationId>.pdf`

Note:

- `storage/` is not present in the current repo checkout, which means these directories are runtime-created.
- the absence of the directory in git does not reduce exposure; the route is still mounted globally.

### Download Routes

Purchase confirmation routes:

- `GET /api/purchase-confirmations/public/:token`
- `GET /api/purchase-confirmations/public/:token/pdf`
- `GET /api/purchase-confirmations/manual/:id/pdf`

No dedicated auth-gated download route was found for:

- product images
- repair attachments
- repair photos
- generic `/files/*`

### Repair Attachment / Photo Surface

No active dedicated route was found for:

- `repair_photos`
- repair attachment upload
- repair attachment download
- repair-specific signed URL flow

Current risk is therefore concentrated in the global `/files/*` mount and any future reuse of it.

## DB Column / File Linkage

### `products`

Relevant linkage:

- `products.image_url`
- normalized in `backend/src/routes/products.js:40-63`
- surfaced to frontend as `/files/products/...` or `/files/...`

Tenant observation:

- product DB rows are store-scoped
- actual image files are not store-scoped at the file-serving layer

### `purchase_confirmations`

Relevant linkage:

- `purchase_confirmations.pdf_path`
  - selected in `backend/src/routes/purchaseConfirmations.js:348,384,924`
  - selected in `backend/src/routes/customers.js:438`
- `purchase_confirmations.signature_data`
  - selected in `backend/src/routes/purchaseConfirmations.js:305,922`
  - stored as data URI, not as a separate file path

Tenant observation:

- DB rows are increasingly store-scoped after recent order isolation fixes
- file-serving for the resulting PDF still bypasses store enforcement when accessed through `/files/pdfs/*`

### Purchase Confirmation Tokens

Relevant linkage:

- `purchase_confirmation_tokens.token`
- resolved by `fetchPurchaseConfirmationToken(...)` in `backend/src/routes/purchaseConfirmations.js:1079-1099`

Tenant observation:

- token lookup joins back to `orders.store_id` and same-store customer rows
- this protects the token-backed page model
- it does not protect direct static `/files/pdfs/*` access

## Requested Checks

### 1. Direct URL access to another tenant file

Result: `HIGH`

Reason:

- `/files/*` is a public static mount with no tenant validation
- any guessed, leaked, or reused path is directly retrievable
- this bypasses all DB-level `store_id` checks

Primary references:

- `backend/src/app.js:422`
- `backend/src/services/pdfService.js:140-168`
- `backend/src/routes/products.js:202-207`

### 2. Static mount open without `store_id` validation

Result: `HIGH`

Reason:

- `express.static(...)` is mounted globally
- no auth middleware is applied
- no ownership callback or token resolver is involved

Primary reference:

- `backend/src/app.js:422`

### 3. Purchase confirmation PDF open without token / store scope

Result: `HIGH`

There are two separate risks:

- direct static file path:
  - PDF writer always emits `/files/pdfs/purchase-confirmation-<confirmationId>.pdf`
  - this is predictable and bypasses the token route entirely
- manual PDF route:
  - `GET /api/purchase-confirmations/manual/:id/pdf` is public
  - it uses only numeric `id` plus `token IS NULL`
  - no auth, no store scope, no bearer token

Public token PDF route is lower risk:

- `GET /api/purchase-confirmations/public/:token/pdf` is bearer-token based
- it still does not carry an explicit `store_id` predicate in the route SQL, but the token itself is the access gate

Primary references:

- `backend/src/services/pdfService.js:140-168`
- `backend/src/routes/purchaseConfirmations.js:342-405`

### 4. Signature image path exposure

Result: `MEDIUM`

Observed state:

- signature image is not stored as a standalone file path
- it is stored in `purchase_confirmations.signature_data`
- it is embedded into the generated PDF at write time
- token-backed public purchase-confirmation detail also returns `signatureData`

Impact:

- there is no separate static signature URL to guess
- however the signature is still exposed through:
  - public token JSON response
  - public/manual PDF download routes
  - any direct static PDF access

Primary references:

- `backend/src/routes/purchaseConfirmations.js:295-335`
- `backend/src/services/pdfService.js:110-123`

### 5. Product image upload separated from `store_id`

Result: `MEDIUM`

Observed state:

- upload endpoint is authenticated and store-scoped at the API layer
- files are written into shared `storage/products`
- the filename contains timestamp + random suffix but no store namespace
- the returned URL is globally readable through `/files/products/...`

Impact:

- upload itself is not the main isolation bug
- storage layout and read path are tenant-agnostic
- once a URL is known, the file is publicly readable outside store scope

Primary references:

- `backend/src/routes/products.js:177-207`
- `backend/src/app.js:422`

### 6. Repair attachment / photo route presence

Result: `LOW`

Observed state:

- no active repair attachment/photo upload route found
- no active repair attachment/photo download route found
- no active `repair_photos` code path found

Impact:

- there is no current repair-specific file route to exploit directly
- risk becomes immediate if future repair uploads reuse `/files/*` without a gated download flow

Primary references:

- no active matches for `repair_photos`
- `backend/src/app.js:422`

### 7. Need for auth-gated download route

Result: `HIGH`

Conclusion:

- current architecture relies on public static serving for business documents and uploaded images
- this is incompatible with tenant isolation for sensitive PDFs
- at minimum, purchase confirmation PDFs need a gated download route that validates token/auth/store before file read

## Findings

### HIGH: Global `/files/*` static mount bypasses all tenant checks - Partially fixed 2026-06-03

Files:

- `backend/src/app.js:422`
- `backend/src/routes/purchaseConfirmations.js`

Previous state:

- any file under runtime `storage/` was directly retrievable by path.
- static serving ignored tenant, auth, token, and row ownership.

Fix completed in this step:

- direct public access to `/files/pdfs/*` is now blocked before the generic `/files/*` static mount.
- purchase confirmation PDFs now require gated routes instead of direct static access.

Residual risk:

- `/files/products/*` and other future static file categories are still public if their path is known.
- the global `/files/*` mount still remains a tenant-isolation risk outside purchase confirmation PDFs.

### HIGH: Purchase confirmation PDFs are stored under predictable public paths - Fixed 2026-06-03

Files:

- `backend/src/services/pdfService.js`
- `backend/src/app.js`
- `backend/src/routes/purchaseConfirmations.js`

Previous state:

- generated file name was deterministic: `purchase-confirmation-${confirmationId}.pdf`.
- direct `/files/pdfs/...` access could bypass public token controls and store checks.

Fix completed:

- existing PDF files remain on disk, but `/files/pdfs/*` direct public access is blocked.
- public customer download continues through `GET /api/purchase-confirmations/public/:token/pdf`.
- staff-facing download can now use gated purchase-confirmation download URLs instead of static file paths.

Residual note:

- deterministic file naming still exists on disk, so the route gate must remain in front of storage access.

### HIGH: Manual purchase confirmation PDF route is public and id-based - Fixed 2026-06-03

Files:

- `backend/src/routes/purchaseConfirmations.js`

Previous state:

- numeric id enumeration could expose another tenant's manual confirmation PDF.
- the route had no authentication, no store scope, and no signed token.

Fix completed:

- `GET /api/purchase-confirmations/manual/:id/pdf` now requires either:
  - an authenticated staff store context, or
  - a signed download token bound to the confirmation id and store id.
- staff direct download route now also exists with store-scoped confirmation lookup.
- another tenant's numeric id now resolves to `401` or `404` instead of opening the PDF.

### MEDIUM: Product uploads are store-scoped on write but public on read

Files:

- `backend/src/routes/products.js:177-207`
- `backend/src/routes/products.js:40-63`

Risk:

- uploaded product images are written into a shared directory
- returned URLs are globally fetchable through `/files/products/*`
- less sensitive than PDFs, but still not tenant-isolated

### MEDIUM: Public token purchase confirmation routes intentionally expose signed content

Files:

- `backend/src/routes/purchaseConfirmations.js:278-374`

Risk:

- bearer token possession grants access to customer info, checklist data, signature data, and PDF
- this may be acceptable business behavior for customer-facing flow
- however the same document is also reachable through static or manual-id paths, which weakens the token model

### LOW: Repair file subsystem is not actively implemented, but future reuse of `/files/*` would be unsafe

Files:

- `backend/src/app.js:422`
- `backend/src/routes/repairs.js:66-84`

Risk:

- current repair UI normalizes product image URLs, not repair attachment URLs
- no active repair file route exists today
- future repair uploads will inherit the same public-static risk if built on current storage pattern

## Frontend Exposure Surface

Observed frontend consumers:

- `frontend/src/pages/PurchaseConfirmPublicPage.jsx:327-347`
- `frontend/src/pages/PurchaseConfirmationsPage.jsx:151-174`
- `frontend/src/pages/CustomersPage.jsx:1186-1192`

Observed behavior:

- frontend opens returned PDF URLs directly in new tabs
- this is compatible with either public token routes or public static URLs
- no frontend-side store binding exists or can exist once a public URL is issued

## Risk URL Examples

Examples below are structural examples from code review, not executed cross-tenant probes:

- `/files/pdfs/purchase-confirmation-123.pdf`
- `/files/products/1717370000000-abcd1234-bike.jpg`
- `/api/purchase-confirmations/manual/77/pdf`
- `/api/purchase-confirmations/public/<token>/pdf`

Interpretation:

- the first three are the most important audit targets
- the fourth is the intended public bearer-token flow and should remain separate from direct static file exposure

## Files That Need Changes

Primary backend files:

- `backend/src/app.js`
- `backend/src/routes/purchaseConfirmations.js`
- `backend/src/services/pdfService.js`
- `backend/src/routes/products.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/repairs.js`

Likely frontend follow-up files:

- `frontend/src/pages/PurchaseConfirmPublicPage.jsx`
- `frontend/src/pages/PurchaseConfirmationsPage.jsx`
- `frontend/src/pages/CustomersPage.jsx`
- `frontend/src/components/ProductImage.jsx`

## Recommended Fix Order

1. Stop direct document bypass for purchase confirmation PDFs.
2. Replace public manual `/:id/pdf` route with token-gated or authenticated staff-gated download.
3. Introduce a centralized download controller that validates token/auth/store before reading any business file.
4. Move PDF delivery off direct `/files/pdfs/*` URLs and return application routes instead.
5. Add file metadata ownership (`store_id`, owner type, owner id, visibility mode) before adding any repair attachment feature.
6. Decide whether product images remain public-by-URL or move to signed/gated delivery for multi-tenant mode.
7. After migration, narrow or remove the global `/files/*` static mount.

## No-Behavior-Change Migration Plan

Phase 1:

- keep existing file generation logic
- add a new auth/token-gated download route for purchase confirmation PDFs
- change all backend `pdfUrl` emitters to point to the gated route instead of `/files/...`

Phase 2:

- add a file metadata table or equivalent ownership columns:
  - `store_id`
  - `owner_type`
  - `owner_id`
  - `storage_path`
  - `visibility`
  - `public_token` or signed-access mode where needed

Phase 3:

- dual-read existing `pdf_path` values:
  - allow old static path lookup internally
  - serve only through the new gated route externally

Phase 4:

- introduce store namespacing or opaque UUID file keys for newly written uploads
- avoid deterministic public filenames for sensitive documents

Phase 5:

- once all callers use gated routes, block direct access to:
  - `/files/pdfs/*`
  - future repair attachments
- optionally keep only non-sensitive public assets under a limited static mount

## Summary

Current isolation status:

- product and purchase-confirmation DB rows are becoming store-scoped
- file serving is not

Highest risks:

- global `/files/*` static mount
- predictable purchase confirmation PDF path under `/files/pdfs/*`
- public manual purchase confirmation PDF route by numeric id

Most urgent next step:

- introduce a gated PDF download route and stop returning directly fetchable sensitive document paths
