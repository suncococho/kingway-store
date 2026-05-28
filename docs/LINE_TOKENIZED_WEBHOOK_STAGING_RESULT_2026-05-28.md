# LINE Tokenized Webhook Staging Wiring Result

Date: 2026-05-28
Branch: beta/staging-architecture
Commit: 6cf7ca1

## Summary

Implemented staging-only wiring for tokenized LINE webhook context.

The tokenized webhook path can now resolve channelAccessTokenRef and inject the resolved token into LINE reply/push flow through scoped options, without changing the production default config.line.channelAccessToken fallback.

## Files Changed

- backend/src/routes/line.js
- backend/src/services/lineWorkflowService.js

## Safety Guard

Tokenized access-token injection is enabled only when:

- process.env.NODE_ENV === "staging"
- or process.env.LINE_TOKENIZED_WEBHOOK_ENABLED === "true"

## Production Safety

- Existing /api/line/webhook flow remains available.
- Existing config.line.channelAccessToken fallback remains unchanged.
- No DB schema change.
- No webhook URL change.
- No raw LINE token logging.
- No direct overwrite of config.line.channelAccessToken.

## Verification Result

- Latest commit: 6cf7ca1 feat: wire tokenized LINE webhook context in staging
- Pushed to origin/beta/staging-architecture
- Raw token log check returned no matches.
- git status was clean after commit and push.

## Next Step

Deploy only to staging first.

Recommended staging test order:

1. Start with LINE_TOKENIZED_WEBHOOK_ENABLED unset or false.
2. Confirm legacy /api/line/webhook still works.
3. Enable LINE_TOKENIZED_WEBHOOK_ENABLED=true only in staging.
4. Test tokenized webhook path.
5. Confirm LINE reply/push uses scoped token only for tokenized webhook context.
6. Confirm production environment remains unaffected.
