# Release Baseline - 2026-07-10

This checkpoint is the source-of-truth baseline after regression hardening and environment alignment.

## Environment Lock

- UAT backend: `kwsa-backend-test-00179-dvs` (100%)
- UAT frontend: `kwsa-frontend-uat-00154-nvd` (100%)
- Prod backend: `kwsa-backend-prod-00242-n55` (100%)
- Prod frontend: `kwsa-frontend-prod-00177-cgr` (100%)

## Regression Guard Scope

- Office Admin market-center fallback now prefers `homeMcId` and falls back to `marketCenterId` for scoped checks.
- Associate edit/details flows are protected from false OWN-scope lockout when Office Admin context is active.
- Transactions scoped visibility and filters use effective market-center resolution for Office Admin contexts.
- Flyer social copy key resolution falls back to `OPENAI_API_KEY` when `OPENAI_SOCIAL_COPY_API_KEY` is not explicitly set.

## Operational Intent

- Treat this commit and tag as rollback target for Local/UAT/Prod.
- Any future rollback should return to this checkpoint or later validated checkpoints.
