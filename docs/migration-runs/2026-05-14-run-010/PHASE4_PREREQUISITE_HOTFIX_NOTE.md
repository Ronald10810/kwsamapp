# PHASE4_PREREQUISITE_HOTFIX_NOTE

Date: 2026-05-15
Approval: 10d (Prerequisite-order and guardrail hotfix only)
Scope status: Completed within approved limits (no SQL execution, no data changes, no commit/push)

## Why script 1 returned UPDATE 0
- `scripts/migration/phase4/01-core-listings-description-merge.sql` is update-only against `migration.core_listings`.
- It does not insert or upsert rows into `migration.core_listings`.
- During run-010, `migration.core_listings` was empty because `scripts/transform-staging-to-migration.sql` had not been run first.
- Therefore, `UPDATE 0` was expected behavior.

## Why script 2 created false-positive load_rejections
- `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql` resolves keys by joining to:
  - `migration.core_listings` (for listing_id mapping)
  - `migration.core_associates` (for associate_id mapping)
- With core tables empty, valid staging rows could not resolve these joins.
- Script 2 then inserted unresolved rows into `migration.load_rejections`, creating false-positive rejections caused by missing prerequisites rather than bad source data.

## Guardrails added in Approval 10d

### Script 1 guardrail
File: `scripts/migration/phase4/01-core-listings-description-merge.sql`
- Added a preflight `DO $$ ... $$` block that raises an exception when `migration.core_listings` is empty.
- Exception message instructs operator to run `scripts/transform-staging-to-migration.sql` before Phase 4 script 01.

### Script 2 guardrails
File: `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql`
- Added a preflight `DO $$ ... $$` block that raises an exception when `migration.core_listings` is empty.
- Added a second preflight check that raises an exception when `migration.core_associates` is empty.
- Exception messages instruct operator to run `scripts/transform-staging-to-migration.sql` before Phase 4 script 02.

## Confirmed prerequisite first transform step
- `scripts/transform-staging-to-migration.sql` is the required first transform step before Phase 4 scripts because it populates:
  - `migration.core_market_centers`
  - `migration.core_teams`
  - `migration.core_associates`
  - `migration.core_listings`
  - `migration.core_transactions`
- It is therefore a hard prerequisite for script 1 and script 2 linkage logic.

## Corrected execution sequence (prepare only; not executed in 10d)
1. `scripts/transform-staging-to-migration.sql`
2. `scripts/migration/phase4/01-core-listings-description-merge.sql`
3. `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql`
4. `scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql`
5. `scripts/migration/phase4/04-post-phase4-validation.sql`

## Targeted cleanup SQL for `migration.load_rejections` (DO NOT RUN YET)
Purpose: remove false-positive rows created specifically because script 2 was run before core prerequisites were loaded.

```sql
-- DO NOT RUN IN APPROVAL 10d.
-- Execute only under explicit follow-up approval.

-- Optional safety: confirm target database first.
-- SELECT current_database();

DELETE FROM migration.load_rejections r
WHERE r.entity_name = 'listing_associates'
  AND r.reason = 'Unresolved listing_id or associate_id in listing_associates'
  AND EXISTS (
    SELECT 1
    FROM staging.listing_associates la
    WHERE CONCAT_WS(':', COALESCE(la.listing_id, ''), COALESCE(la.associate_id, '')) = r.source_id
      AND (
        current_setting('migration.batch', true) IS NULL
        OR current_setting('migration.batch', true) = ''
        OR la.batch_id = current_setting('migration.batch', true)
      )
  );
```

Notes:
- This cleanup intentionally targets only the inflated script 2 unresolved-associate rejects.
- It does not delete structurally valid rejects such as rows with truly NULL listing identifiers from source.

## Exact next approval recommended
Approval 10e only:
- Execution-plan run with strict DB prechecks (`SELECT current_database();` before each SQL file), in corrected order.
- Include explicit approval to run the targeted `migration.load_rejections` cleanup SQL first.
- Then run transform + Phase 4 scripts 01/02/03/04.
- Stop immediately on first failure and produce run evidence artifacts.
