# PHASE4_SCRIPT_PATCH_AND_EXECUTION_PLAN

Date: 2026-05-15
Approval Scope: Approval 9 preparation only (script patching and execution plan finalization)
Execution Mode: Inspection and script preparation only (no Phase 4 execution)

## 1. Git branch and commit hash
- Worktree: C:/Users/ronal/OneDrive/Desktop/KWSA-Workspace/kwsa-cloud-console-clean-snapshot
- Branch: clean-source-snapshot-before-db-cutover
- HEAD commit: 5b2dffc8e3795a6339bc8c8bf6a794ea7daafaba
- Required clean checkpoint: 5b2dffc8e3795a6339bc8c8bf6a794ea7daafaba (confirmed)

## 2. Working tree status before and after
- Before Approval 9 prep edits: clean (`git status --short` returned no output).
- After Approval 9 prep edits: dirty by new script/report files only.
- Current status summary: `?? scripts/migration/` plus this run-009 documentation folder.

## 3. Database confirmation
Read-only query executed through Cloud SQL Auth Proxy:

```sql
SELECT current_database();
```

Result: `kwsa_import_staging`

Additional read-only confirmation:
- `staging` tables: 14
- `migration` tables: 41
- `public` tables: 1 (`_prisma_migrations`)

## 4. Which existing scripts can be reused
Reusable as-is (with the patch overlay scripts below applied in order):
- `scripts/transform-staging-to-migration.sql`
- `scripts/enrich-migration-schema.sql`
- `backend/src/data/validateLoad.ts` (supplemental checks)
- `backend/src/data/reconcileReport.ts` (supplemental reconciliation)

Reusable with caution:
- `backend/src/data/transformMarketCenters.ts`
- `backend/src/data/transformTeams.ts`
- `backend/src/data/transformAssociates.ts`
- `backend/src/data/transformListings.ts`

Not for Approval 9 execution in `kwsa_import_staging`:
- `scripts/insert-migration-to-public.sql` (public app tables are not present in this DB)
- `backend/src/data/transformTransactions.ts` (contains destructive `DELETE` and legacy source assumptions)

## 5. Which scripts need patching
Patch requirements identified from schema inspection:
- Listing descriptions must merge by `source_listing_id` from `staging.listing_descriptions_raw_source`.
- `staging.listing_associates` uses `listing_id` and `associate_id` (not `source_listing_id` / `source_associate_id`).
- `staging.listing_images_raw_source` and `staging.listing_marketing_urls_raw` column shapes differ from assumptions in existing enrichment SQL.
- Group D should prioritize `staging.transaction_agents_raw_source` and `staging.transaction_associate_payment_details_raw`.
- Rejection handling is needed for unresolved and NULL-key rows while preserving raw/source evidence.

## 6. New or patched scripts proposed
Added under `scripts/migration/phase4/` (prepared only, not executed):
- `01-core-listings-description-merge.sql`
  - Merges descriptions into `migration.core_listings` by `source_listing_id` only.
- `02-group-c-listing-links-media-marketing.sql`
  - Correct mapping for listing associates, images, marketing URLs.
  - Adds rejection rows for NULL/unresolved listing linkages.
- `03-group-d-transaction-participants-and-financials.sql`
  - Transaction participants from `transaction_agents_raw_source` (with fallback).
  - Financial split/payment mapping from `transaction_associate_payment_details_raw`.
  - Adds rejection rows for unmatched participants/payment details.
- `04-post-phase4-validation.sql`
  - Read-only validation pack for counts, duplicates, integrity, rejection checks, and spot checks.
- `README.md`
  - Execution order and guardrails for this patch set.

## 7. Exact target schemas/tables Phase 4 will write to
Approval 9 writes are scoped to `kwsa_import_staging.migration` only:
- `migration.core_market_centers`
- `migration.core_teams`
- `migration.core_associates`
- `migration.core_listings`
- `migration.core_transactions`
- `migration.id_map_market_centers`
- `migration.id_map_teams`
- `migration.id_map_associates`
- `migration.id_map_listings`
- `migration.listing_agents`
- `migration.listing_images`
- `migration.listing_marketing_urls`
- `migration.listing_property_areas`
- `migration.transaction_agents`
- `migration.transaction_agent_calculations`
- `migration.load_rejections`

## 8. Tables Phase 4 must not touch
Do not write to:
- Any table in databases `kwsa_uat`, `kwsa_prod`, or `kwsa`
- `kwsa_import_staging.public.*` app tables (not present for this stage)
- `kwsa_import_staging.staging.*` except read-only select
- Any secrets/env/deployment/runtime config object
- Asset/document migration targets

## 9. Phase 4 execution order
1. Confirm branch/commit/worktree and proxy/database scope (`kwsa_import_staging`).
2. Execute base core transform (`scripts/transform-staging-to-migration.sql`).
3. Execute listing description merge patch (`01-core-listings-description-merge.sql`).
4. Execute base enrichment (`scripts/enrich-migration-schema.sql`).
5. Execute Group C patch (`02-group-c-listing-links-media-marketing.sql`).
6. Execute Group D patch (`03-group-d-transaction-participants-and-financials.sql`).
7. Execute validation pack (`04-post-phase4-validation.sql`).
8. Run TypeScript validation/reconcile scripts.
9. Review validation report and rejection summaries before any promotion approval.

## 10. Exact commands proposed for Phase 4 (do not run now)
All commands below are proposed only.

```powershell
# From: C:/Users/ronal/OneDrive/Desktop/KWSA-Workspace/kwsa-cloud-console-clean-snapshot

# 0) Resolve psql and credentials (read-only secret read; no secret changes)
$raw = (gcloud secrets versions access latest --secret="kwsa-backend-test-db-url" --project="kwsa-mapp" --quiet | Out-String)
$m = [regex]::Match($raw, 'postgresql://([^:]+):([^@]+)@')
$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$psqlExe = (Get-ChildItem "C:/Program Files*/PostgreSQL/*/bin/psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$env:PGPASSWORD = $dbPass

# 1) Mandatory scope check via proxy
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SELECT current_database();"

# 2) Base transform + patches + validations (single explicit batch)
$batch = 'azure-2026-05-14-staging-run-001'

& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/transform-staging-to-migration.sql"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/migration/phase4/01-core-listings-description-merge.sql"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/enrich-migration-schema.sql"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql"
& $psqlExe -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SET migration.batch='$batch';" -f "scripts/migration/phase4/04-post-phase4-validation.sql"

# 3) Supplemental scripted checks
npm.cmd run data:validate
npm.cmd run data:reconcile -- --batch-prefix azure-2026-05-14-staging-run-001

# 4) Cleanup session secret variable
Remove-Item Env:PGPASSWORD
```

## 11. Mapping for market centres
Source: `staging.market_centers_raw`
Target: `migration.core_market_centers`

Mapping:
- `source_market_center_id` -> `source_market_center_id` (business key)
- `name` -> `name`
- `status_name` -> `status_name`
- `frontdoor_id` -> `frontdoor_id`
- Raw payload enrichment fields retained for later non-destructive enrichment.

## 12. Mapping for teams
Source: `staging.teams_raw`
Target: `migration.core_teams`

Mapping:
- `source_team_id` -> `source_team_id` (business key)
- `source_market_center_id` -> `source_market_center_id`
- FK resolve: `market_center_id` by `core_market_centers.source_market_center_id`
- `name`, `status_name` direct map

## 13. Mapping for associates
Source: `staging.associates_raw`
Target: `migration.core_associates`

Mapping highlights:
- Business key: `source_associate_id`
- Identity/contact fields: names, email, kwuid, status
- Payload-preserved fields: `national_id`, `ffc_number`, `private_email`, `mobile_number`, `office_number`
- Approval/vesting/sponsor fields preserved with safe boolean/date casting
- Team/MC linkage via `source_team_id` and `source_market_center_id`

## 14. Mapping for listings and descriptions
Sources:
- `staging.listings_raw` (base listing)
- `staging.listing_descriptions_raw_source` (description authority)

Target: `migration.core_listings`

Critical rule enforced:
- Merge by `source_listing_id` only.
- No row-order merges.

Precedence used in patch:
- `property_title`: description source, else existing core value
- `short_title`: description source, else existing core value
- `property_description`: description source, else existing core value
- `agent_property_valuation`: description parse when numeric, else existing

## 15. Mapping for listing associates
Source: `staging.listing_associates`
Target: `migration.listing_agents`

Adjusted to real source shape:
- `listing_associates.listing_id` (text source ID) -> `core_listings.source_listing_id`
- `listing_associates.associate_id` (text source ID) -> `core_associates.source_associate_id`
- `role` -> `agent_role`
- `is_primary` derived from role markers (`primary`, `primary agent`, `listing agent`, `lead`)
- unresolved links recorded in `migration.load_rejections`

## 16. Mapping for listing images and media
Primary source:
- `staging.listing_images_raw_source`

Fallback source:
- `staging.listing_images_raw`

Target:
- `migration.listing_images`

Mapping:
- `source_listing_id`/`listing_id` -> `core_listings.source_listing_id`
- `preview_url` else `image_url` -> `file_url`
- `image_caption`/`document_id`/URL -> `file_name`
- `order_number` -> `sort_order`
- `document_id` and full source row preserved via raw source and rejection payload when unmappable

## 17. Mapping for marketing URLs
Source: `staging.listing_marketing_urls_raw`
Target: `migration.listing_marketing_urls`

Adjusted mapping:
- `listing_id` (text source ID) -> `core_listings.source_listing_id`
- `url` -> `url`
- `type` -> `url_type`
- `display_name` defaults to `url`
- NULL listing IDs preserved in `migration.load_rejections`

## 18. Mapping for transactions
Source: `staging.transactions_raw`
Target: `migration.core_transactions`

Mapping remains in base transform script:
- Business key: `source_transaction_id`
- Core transaction/value/date/status/listing fields mapped
- market center/associate links preserved by source IDs

## 19. Mapping for transaction agents/participants
Primary source:
- `staging.transaction_agents_raw_source`

Fallback:
- `staging.transaction_agents` + `staging.transactions_raw`

Target:
- `migration.transaction_agents`

Mapping:
- `transaction_id` (source) -> `core_transactions.source_transaction_id`
- `source_associate_id` preserved as text
- optional resolved `associate_id` via `core_associates.source_associate_id`
- `agent_type` -> `agent_role`
- `split_percentage`, `outside_agency`, `sort_order` preserved
- unmatched transaction references captured in `migration.load_rejections`

## 20. Mapping for financial/split/payment details
Source:
- `staging.transaction_associate_payment_details_raw`

Target:
- `migration.transaction_agent_calculations`

Mapping preserved:
- `split_percentage`
- `gci_before_fees`
- `production_royalties`
- `growth_share`
- `gci_after_fees_excl_vat`
- `cap_remaining`
- `associate_dollar`
- `team_dollar`
- `mc_dollar`

Join strategy:
- `source_transaction_id` -> `core_transactions.source_transaction_id`
- `source_associate_id` -> `transaction_agents.source_associate_id`
- unmatched payment rows logged to `migration.load_rejections`

## 21. MAPP 2.0-only tables and columns to preserve
Preserve-only policy (no destructive touch in Approval 9):
- Tables: `app_users`, `users`, `roles`, `user_roles`, `audit_logs`, `public_leads`, `loom_user_tokens`, `cma_documents`, `marketing_plan_documents`, rentals-related tables, and other MAPP 2.0 extension tables.
- Representative columns to preserve:
  - Associate enrichment: `nationalId`, `ffcNumber`, private/sponsor/approval/vesting fields
  - Listing lifecycle and mandate details
  - Transaction participant/payment financial columns
  - 3rd-party integration fields (Property24/KWW/Entegral)

## 22. How raw_payload/source tables will be preserved
- `staging.*` raw/source tables remain read-only in Phase 4.
- No delete/truncate/update on `staging.*`.
- For unmapped rows, full payload evidence is persisted in `migration.load_rejections.payload`.
- Description/media/participant raw payloads remain intact for audit replay.

## 23. How NULL source_listing_id media rows will be handled
- Rows with NULL listing source keys are not force-mapped.
- They are preserved in staging and recorded in `migration.load_rejections` with reason:
  - `NULL source_listing_id preserved and not mapped` (raw source images)
  - `NULL listing_id preserved and not mapped` (legacy images/marketing URLs)
- This keeps auditability while preventing bad foreign-key linkage.

## 24. How duplicates already skipped in Phase 3 will be documented
Phase 3 duplicate history is carried forward explicitly:
- Listing/media duplicates skipped in load phase are documented in run-007.
- Group D duplicate `(transaction_id, source_associate_id)` pairs are documented in run-007.
- Approval 9 report references run-007 as source-of-truth and adds post-Phase4 duplicate key validation queries.

## 25. Required validation checks after Phase 4
Run `scripts/migration/phase4/04-post-phase4-validation.sql` and scripted checks.
Required checks include:
- core and feature row counts
- duplicate business keys in `migration.core_*`
- listing description join coverage by `source_listing_id`
- orphan listing agents/images/marketing URLs
- orphan transaction agents/calculations
- payment rows without mapped calculations
- rejection totals by entity/reason
- 10-row spot checks for associates/listings/transactions/images

## 26. Rollback plan if Phase 4 fails
Scope: Approval 9 execution in `kwsa_import_staging` only.

Rollback path:
1. Stop Phase 4 sequence immediately on first failed step.
2. Keep `staging.*` unchanged (source-of-truth from Phase 3).
3. Reset only `migration.*` targets (or recreate `kwsa_import_staging` if needed per rollback runbook).
4. Re-run from base transform after patch correction.
5. Do not promote to `kwsa_uat` or `kwsa_prod` until validation passes.

Reference: `docs/DATABASE_ROLLBACK_PLAN.md` Stage 1 rollback guidance.

## 27. Exact recommended next approval step
Recommended next step:
- Review and approve this Approval 9 patch set and command plan.
- On explicit approval, execute Phase 4 in `kwsa_import_staging` only (no promotion).
- Produce a post-execution validation report before any Approval 10 discussion.

---

## End Summary (Approval 9 prep only)

1. What was inspected:
- Required committed reports and plans (run-007, run-008, cutover/checklist/approval/rollback/schema docs).
- Current SQL/TS transform and validation scripts.
- Prisma schema.
- Read-only DB checks via proxy on `kwsa_import_staging` including counts and table shapes.

2. What scripts were created or patched:
- Created new patch set under `scripts/migration/phase4/` (5 files).
- Existing scripts were not executed.

3. Remaining mapping gaps:
- No additional blocking structural gaps found for Approval 9 execution in `kwsa_import_staging`.
- Business sign-off still required on final disposition/reporting expectations for NULL-key media rows.

4. Risks before Phase 4 execution:
- Running legacy scripts without these patch overlays can mis-map Group C/D data.
- Running `insert-migration-to-public.sql` in `kwsa_import_staging` is invalid for this stage.
- Any execution without strict DB scope check risks cross-environment mistakes.

5. Files created or changed:
- docs/migration-runs/2026-05-14-run-009/PHASE4_SCRIPT_PATCH_AND_EXECUTION_PLAN.md
- scripts/migration/phase4/README.md
- scripts/migration/phase4/01-core-listings-description-merge.sql
- scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql
- scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql
- scripts/migration/phase4/04-post-phase4-validation.sql

6. Confirmation that no data was transformed or changed:
- Confirmed. No Phase 4 transform/enrichment SQL was executed in this session.

7. Confirmation that no env var, secret, deployment, kwsa_uat, kwsa_prod, or kwsa was touched:
- Confirmed. Only read-only secret access for connection parsing and read-only DB inspection against `kwsa_import_staging` via proxy.
- No env var update, no secret mutation, no deployment, no non-staging DB touch.

8. Working tree cleanliness:
- Working tree is dirty by new uncommitted Approval 9 prep files.

9. Exact next approval recommended:
- Approve execution of the prepared Approval 9 Phase 4 command sequence in `kwsa_import_staging` only.
