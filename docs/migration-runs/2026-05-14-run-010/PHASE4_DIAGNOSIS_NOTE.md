# PHASE4_DIAGNOSIS_NOTE

Date: 2026-05-15
Scope: Diagnosis only (no execution, no data changes)

## Findings

1. `migration.core_*` tables are empty:
- `migration.core_market_centers = 0`
- `migration.core_teams = 0`
- `migration.core_associates = 0`
- `migration.core_listings = 0`
- `migration.core_transactions = 0`

2. Staging data and source keys are present for the approved batch (`azure-2026-05-14-staging-run-001`):
- Market centers: 48 total, 48 with non-null source ID
- Teams: 219 total, 219 with non-null source ID
- Associates: 9,243 total, 9,243 with non-null source ID
- Listings: 129,123 total, 129,123 with non-null source ID
- Transactions: 30,181 total, 30,181 with non-null source ID

3. Script 1 behavior is expected given empty core tables:
- `scripts/migration/phase4/01-core-listings-description-merge.sql` contains **UPDATE-only** logic against `migration.core_listings`.
- It has no INSERT/UPSERT into core tables.
- With `migration.core_listings` empty, result is naturally `UPDATE 0`.

4. Script 2 rejection inflation is consistent with empty core tables:
- `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql` resolves listing/associate IDs by joining to `migration.core_listings` and `migration.core_associates`.
- With both core tables empty, rows are classified as unresolved and inserted into `migration.load_rejections`.
- Current rejection breakdown:
  - `listing_associates / Unresolved listing_id or associate_id in listing_associates = 146,571`
  - `listing_images_raw_source / NULL source_listing_id preserved and not mapped = 72,546`
  - Total currently observed: 219,117

## Root cause
The reruns were started from phase4 patch scripts without first populating `migration.core_*` from staging. The base core-load step (`scripts/transform-staging-to-migration.sql`) is required before script 1/2 can produce meaningful linkage outcomes.

## Should `migration.load_rejections` be cleared before rerun?
Yes, for a clean/accurate rerun outcome.

Reason:
- A large portion of current rejection entries came from running script 2 while core tables were empty.
- Keeping them will contaminate post-rerun audit interpretation.
- Script 2 uses `NOT EXISTS`, so stale rejections will persist unless explicitly cleared.

## Correction plan (no execution yet)

1. Execution-order fix (primary)
- Reintroduce/explicitly require core load step before phase4 patches:
  - `scripts/transform-staging-to-migration.sql` (batch scoped)
  - then script 1, script 2, script 3, script 4

2. Script 1 hardening
- Keep script 1 as description-merge logic (do not convert it into full core loader).
- Add a preflight guard that raises an exception when `migration.core_listings` is empty, with a message to run `scripts/transform-staging-to-migration.sql` first.

3. Script 2 hardening
- Add preflight guard(s) that raise an exception if `migration.core_listings` or `migration.core_associates` are empty.
- This prevents large false-positive rejection inserts when prerequisites are missing.

4. Rejections hygiene before rerun
- Archive or snapshot current `migration.load_rejections` state for evidence.
- Then perform approved, targeted cleanup of invalid run-generated rejection rows before rerun.

## Files needing patching (planned)
- `scripts/migration/phase4/01-core-listings-description-merge.sql` (add prerequisite guard)
- `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql` (add prerequisite guard)
- Optional runbook/report docs to enforce execution order (transform core load first)

No patches were applied in this diagnosis note scope.
