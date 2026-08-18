# KINGWAY LINE Options Production Release — 2026-08-19

- Runtime commit: `1421a3996bb929a52ddee14a1312e931b76b8a99`
- Frontend image: `sha256:852e635c1f1218acd06841df8fec92743007126715c421abe8331f8af4c1c6e3`
- Backend image: `sha256:c516863b8f4e358899f65f7fd8b4c20cb1c5f51d4a2045f2dbf1b6ccd0fdd254`
- Frontend asset: `index-CYOvgajY.js`
- Frontend asset SHA-256: `5a83eade41655c0fc957b53f9a56b3d71bf142c9805de7ebb8f93f58c26e1872`
- Deployment evidence: `/volume1/backup/kingway/production-deploy/line-order-options-retry-20260818T204751Z`

The release preserves three separate functions: public customer ordering at `/line-order`, employee order management at `/orders`, and ADMIN/MANAGER-only LINE option management at `/admin/line-order-options`. The public flow includes the restored existing 配件商品 step between vehicle selection and final confirmation.

Production verification found three active option groups and eight customer-visible products. Default ADMIN/STAFF reconciliation is an explicit bootstrap operation and remains disabled unless `RUN_DEFAULT_ACCOUNT_RECONCILIATION=true` is deliberately set. The Production rollout leaves that variable unset.

No database migration or settings change was performed for this release. The previous frontend and backend containers remain stopped under their rollback names. Verification did not submit a real customer order.
