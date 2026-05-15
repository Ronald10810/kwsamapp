# PHASE4_MAPPING_DESIGN_AND_REVIEW

Date: 2026-05-15
Approval Scope: Approval 8 only (design and review)
Execution Mode: Inspection only, no transforms executed

## 1. Git branch and commit hash
- Worktree: C:/Users/ronal/OneDrive/Desktop/KWSA-Workspace/kwsa-cloud-console-clean-snapshot
- Branch: clean-source-snapshot-before-db-cutover
- Checkpoint commit: d715cd0d043e7cc23bc90199f77ae9fbe9076803

## 2. Working tree status before and after
- Before inspection/design: clean (git status --short returned no entries).
- After inspection/design docs updates: dirty by documentation files only (run-008 report and approval docs updates).

## 3. Database confirmation
Executed query:

```sql
SELECT current_database();
```

Result: kwsa_import_staging

Confirmed scope: inspection was limited to kwsa_import_staging metadata and read-only counts.

## 4. Summary of Phase 3 loaded data
Batch ID: azure-2026-05-14-staging-run-001

- staging.market_centers_raw: 48
- staging.teams_raw: 219
- staging.associates_raw: 9,243
- staging.listings_raw: 129,123
- staging.listing_descriptions_raw_source: 129,123
- staging.transactions_raw: 30,181
- staging.listing_associates: 146,571
- staging.listing_images_raw_source: 2,604,060
- staging.listing_images_raw: 2,561,505
- staging.listing_marketing_urls_raw: 14,075
- staging.transaction_associate_payment_details_raw: 46,824
- staging.transaction_agents_raw_source: 46,824
- staging.transaction_agents: 94,032

Total loaded rows (Phase 3 baseline): 5,238,234

## 5. Current target schemas available in kwsa_import_staging
Schemas present:
- staging
- migration
- public
- system schemas (pg_catalog, information_schema, etc.)

Base table counts:
- staging: 14
- migration: 41
- public: 1 (_prisma_migrations only)

Important finding:
- App-ready Prisma public tables (listings, associates, transactions, etc.) are not present in kwsa_import_staging.
- Therefore Phase 4 in this database must target migration schema tables (core and migration feature tables), not public app tables.

## 6. Existing transform scripts found and what they do
Primary scripts in clean worktree:

1) scripts/transform-staging-to-migration.sql
- Resolves batch and upserts:
  - staging.market_centers_raw -> migration.core_market_centers
  - staging.teams_raw -> migration.core_teams
  - staging.associates_raw -> migration.core_associates
  - staging.listings_raw -> migration.core_listings
  - staging.transactions_raw -> migration.core_transactions
- Builds id maps: migration.id_map_market_centers, id_map_teams, id_map_associates, id_map_listings.

2) scripts/enrich-migration-schema.sql
- Adds extended migration columns and creates migration feature tables.
- Populates migration.listing_agents, migration.listing_images, migration.listing_marketing_urls, migration.listing_property_areas.
- Populates migration.transaction_agents and migration.transaction_agent_calculations from staging tables.

3) backend/src/data/transformMarketCenters.ts
4) backend/src/data/transformTeams.ts
5) backend/src/data/transformAssociates.ts
6) backend/src/data/transformListings.ts
- Populate migration.*_prepared tables from staging.
- Useful as normalization layer but not currently wired to Group C/D phase3-specific raw tables.

7) backend/src/data/transformTransactions.ts
- Rebuilds migration.core_transactions and migration.transaction_agents from legacy staging.transaction_agents table.
- Calls recompute transaction calculations service.
- Requires careful adaptation to use transaction_agents_raw_source and payment_details_raw structures from Phase 3.

8) scripts/insert-migration-to-public.sql
- Intended promotion from migration.* to public Prisma tables.
- Not executable in current kwsa_import_staging as public app tables are absent.

## 7. Existing validation scripts found and what they do
1) backend/src/data/validateLoad.ts
- Validates row counts between staging, prepared, core.
- Checks duplicates and missing required values.
- Checks orphan team references.

2) backend/src/data/reconcileReport.ts
- Reconciliation report for raw vs prepared vs core and id map coverage.
- Summarizes load rejections from migration.load_rejections.

3) scripts/tmp-validate-counts.sql (ad hoc utility)
- quick count checks.

4) SQL checks from existing docs (run-005 and schema docs)
- listing/detail coverage and reconciliation style checks.

## 8. Mapping design: Market Centres
Source -> target:
- staging.market_centers_raw -> migration.core_market_centers

Proposed mapping:
- source_market_center_id -> source_market_center_id (business key)
- name -> name
- status_name -> status_name
- frontdoor_id -> frontdoor_id
- raw_payload fields for address and portal settings -> extended core_market_centers columns where available (country/province/city/suburb, coordinates, opt-in flags)

Rules:
- Distinct on source_market_center_id by newest source_updated_at/loaded_at.
- Upsert on source_market_center_id.
- Preserve existing enriched columns when source value absent.

## 9. Mapping design: Teams
Source -> target:
- staging.teams_raw -> migration.core_teams

Proposed mapping:
- source_team_id -> source_team_id (business key)
- source_market_center_id -> source_market_center_id
- Resolve market_center_id using migration.core_market_centers.source_market_center_id
- name/status_name direct map

Rules:
- Upsert by source_team_id.
- Leave team row with null market_center_id only if source market center missing (currently 0 unmatched in baseline).

## 10. Mapping design: Associates
Source -> target:
- staging.associates_raw -> migration.core_associates

Direct mappings:
- source_associate_id, first_name, last_name, email, kwuid, status_name
- source_market_center_id and source_team_id from raw_payload

Required raw_payload field mappings (explicit):
- national_id -> core_associates.national_id
- ffc_number -> core_associates.ffc_number
- private_email -> core_associates.private_email
- mobile_number -> core_associates.mobile_number
- office_number -> core_associates.office_number
- source_market_center_id -> core_associates.source_market_center_id
- source_team_id -> core_associates.source_team_id
- proposed_growth_share_sponsor -> core_associates.proposed_growth_share_sponsor
- temporary_growth_share_sponsor -> core_associates.temporary_growth_share_sponsor (boolean cast)
- vested -> core_associates.vested (boolean cast)
- vesting_start_period -> core_associates.vesting_period_start_date (date cast)
- listing_approval_required -> core_associates.listing_approval_required (boolean cast)
- exclude_from_individual_reports -> core_associates.exclude_from_individual_reports (boolean cast)

Additional fields available in migration.core_associates to preserve/populate where available:
- cap, manual_cap, agent_split, projected_cos, projected_cap, start_date, end_date, anniversary_date, cap_date
- property24 and entegra/private-property opt-in fields

Rules:
- Use source_associate_id as business key.
- Boolean normalization from text ('true'/'false').
- Date and numeric regex-safe casting.
- Do not overwrite existing enriched values with null.

## 11. Mapping design: Listings
Source -> target:
- staging.listings_raw + staging.listing_descriptions_raw_source -> migration.core_listings

Critical requirement:
- listing_descriptions_raw_source must join by source_listing_id only.
- Never join descriptions by row order.

Proposed mapping strategy:
1) Base listing row from staging.listings_raw keyed by source_listing_id.
2) Left join staging.listing_descriptions_raw_source on source_listing_id.
3) Description precedence:
- property_title: descriptions.property_title then listings.property_title then payload fallback
- short_title: descriptions.short_title then listings.short_title then payload fallback
- property_description: descriptions.property_description then listings.property_description then payload fallback
4) Preserve listing_payload as full JSON audit source.
5) Map mandate/value fields from payload and typed columns into core_listings.

## 12. Mapping design: Listing Associates
Source -> target:
- staging.listing_associates -> migration.listing_agents

Proposed mapping:
- listing_associates.listing_id (source listing id text) -> migration.core_listings.id via source_listing_id
- listing_associates.associate_id (source associate id text) -> migration.core_associates.id via source_associate_id
- role -> migration.listing_agents.agent_role
- primary flag handling:
  - if role indicates primary/listing agent use is_primary true
  - otherwise false, with deterministic sort_order

Rules:
- Upsert uniqueness by (listing_id, associate_id, agent_role) or existing unique design.
- Keep unresolved rows in rejection table; do not silently drop.

## 13. Mapping design: Listing Images
Sources:
- staging.listing_images_raw_source (richer source)
- staging.listing_images_raw (legacy flattened source)

Target:
- migration.listing_images plus optional document registry table if introduced in Phase 4 scripts.

Required preservation/mapping:
- document_id: preserve in raw_payload and include in migration.listing_images.file_name or new source_document_id column
- image_url -> file_url
- preview_url -> optional preferred display URL when present
- order_number -> sort_order
- image_caption -> preserve in new caption column or raw_payload extension table
- raw_payload -> preserved in audit column/table for traceability

Proposed approach:
- Primary source: listing_images_raw_source for fidelity.
- Fallback source: listing_images_raw when source table row is missing.
- Join to listing by source_listing_id only.
- Keep rows with null source_listing_id in a rejection/audit table for manual review (do not force-map).

## 14. Mapping design: Marketing URLs
Source -> target:
- staging.listing_marketing_urls_raw -> migration.listing_marketing_urls

Mapping:
- listing_id (source listing id text) -> core_listings.id via source_listing_id
- url -> url
- type -> url_type
- display_name default to url or mapped friendly name by type

Rules:
- Deduplicate by (listing_id, url, url_type).
- Maintain deterministic sort_order.

## 15. Mapping design: Transactions
Source -> target:
- staging.transactions_raw -> migration.core_transactions

Mapping:
- source_transaction_id business key
- source_listing_id to listing linkage key
- transaction_number, status, sale/list values, dates, gci, split, participants names
- primary_market_center_id from source_market_center_id -> core_market_centers

Rules:
- Upsert by source_transaction_id.
- Preserve both transaction_date and status_change_date for reporting logic.
- Keep unmatched listing references in rejection table (none in current baseline).

## 16. Mapping design: Transaction Agents
Sources:
- staging.transaction_agents_raw_source (authoritative raw source)
- staging.transaction_agents (already mapped staging bridge)

Targets:
- migration.transaction_agents
- migration.transaction_agent_calculations

Design:
- Prefer transaction_agents_raw_source for source fidelity including outside_agency and raw_payload.
- Resolve transaction_id by joining source transaction id to migration.core_transactions.source_transaction_id.
- Resolve associate_id by source_associate_id to core_associates.source_associate_id.
- Preserve split_percentage, agent_type/role, sort_order, outside_agency.
- Keep source_associate_id text and nullable associate_id for outside-agency participants.

Validation target:
- unmatched source transaction IDs should remain 0 (current baseline already 0).

## 17. Mapping design: Commission/Payment Details
Source -> target:
- staging.transaction_associate_payment_details_raw -> migration.transaction_agent_calculations
- optional future: public.transaction_associate_payment_details when public app tables exist in execution environment

Must preserve all fields:
- split_percentage
- gci_before_fees
- production_royalties
- growth_share
- gci_after_fees_excl_vat
- cap_remaining
- associate_dollar
- team_dollar
- mc_dollar

Design rules:
- Join keys: source_transaction_id + source_associate_id.
- Join target agent row through migration.transaction_agents (source_associate_id + mapped transaction).
- If agent join is missing, write to load_rejections with source keys and reason.
- Never aggregate away per-agent payment rows without retention.

## 18. MAPP 2.0-only tables to preserve and not overwrite
Must preserve and avoid destructive operations:
- app_users
- users
- roles
- user_roles
- audit_logs
- public_leads
- loom_user_tokens
- cma_documents
- marketing_plan_documents
- rentals and related rental tables
- additional MAPP/system tables and lookups from schema comparison, including but not limited to:
  - listing_p24_feed_items, listing_third_party_integrations
  - transaction_notes, transaction_documents, transaction_bonds
  - contacts and advanced lookup catalogs

Note for current database:
- public app tables are not present in kwsa_import_staging; these remain preserve-only policy references for downstream environments.

## 19. MAPP 2.0-only columns to preserve
Representative preserve list (non-exhaustive):
- associates.nationalId
- associates.ffcNumber
- associate_contact_details.privateEmail
- associate_business_details.proposedGrowthShareSponsor
- associate_business_details.growthShareSponsorId
- associate_business_details.temporaryGrowthShareSponsor
- associate_business_details.listingApprovalRequired
- associate_business_details.excludeFromIndividualReports
- associate_business_details.vested
- associate_business_details.vestingStartPeriod
- listings.listingDate, listings.reducedDate, listings.pendingDate, listings.withdrawnDate
- listing_mandate_infos.signedDate, onMarketSince, ratesTaxes, monthlyLevy
- listing_price_details.agentPropertyValuation
- transaction_descriptions.varianceSaleListPricePerc, avgCommsPerc, soldDate, expectedDate, paymentNotes, returnNotes
- transaction_associates.splitPercentage, outsideAgency
- transaction_associate_payment_details.transactionGCIBeforeFees, productionRoyalties, growthShare, gciAfterFeesExclVAT, capRemaining, associateDollar, teamDollar, mcDollar

## 20. Tables that Phase 4 may write to
Within kwsa_import_staging only, Phase 4 should write to:
- migration.market_centers_prepared
- migration.teams_prepared
- migration.associates_prepared
- migration.listings_prepared
- migration.transactions_prepared (if used)
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions
- migration.id_map_*
- migration.listing_agents
- migration.listing_images
- migration.listing_marketing_urls
- migration.listing_property_areas
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections

## 21. Tables that Phase 4 must not touch
- Any non-kwsa_import_staging database objects (kwsa_uat, kwsa_prod, kwsa)
- Cloud Run and secret configs (non-table but hard block)
- staging raw source tables except read-only select
- public schema in kwsa_import_staging (except optional metadata checks); no DML to app tables here
- MAPP 2.0 app tables in other DBs

## 22. Proposed Phase 4 execution order
1) Pre-checkpoint and read-only validation snapshot.
2) Ensure migration schema structures are present (DDL only in kwsa_import_staging if missing).
3) Prepare layer transforms (market centers, teams, associates, listings, transactions).
4) Core upserts (core_market_centers, core_teams, core_associates, core_listings, core_transactions).
5) Feature/enrichment loads (listing_agents, listing_images, listing_marketing_urls, listing_property_areas).
6) Transaction participant loads (transaction_agents).
7) Payment/commission load (transaction_agent_calculations from payment details raw).
8) Populate load_rejections for unmatched/unusable rows.
9) Post-load validation pack and reconciliation report.

## 23. Proposed SQL/scripts to run later (do not run now)
Planned execution set (future Approval 9 execution gate):

```bash
# Pre-Phase 4 structure check
node scripts/run-sql.cjs scripts/bootstrap-uat-migration-structures.sql

# Core transform
node scripts/run-sql.cjs scripts/transform-staging-to-migration.sql

# Enrichment and Group C/D completion mappings
node scripts/run-sql.cjs scripts/enrich-migration-schema.sql

# Validation
npm run data:validate
npm run data:reconcile -- --batch-prefix azure-2026-05-14-staging-run-001
```

Required script updates before execution:
- align script joins with current Phase 3 table shapes:
  - listing_associates uses listing_id/associate_id (not source_listing_id/source_associate_id)
  - use listing_descriptions_raw_source in listing description precedence
  - use transaction_agents_raw_source and transaction_associate_payment_details_raw as authoritative Group D sources
  - keep legacy staging.transaction_agents usage only as compatibility fallback

## 24. Required pre-execution backup/checkpoint before Phase 4
Before any Phase 4 DML:
1) Confirm branch and commit checkpoint tag for execution session.
2) Export migration schema DDL and row counts from kwsa_import_staging.
3) Save per-table counts for all staging and migration tables.
4) Optional snapshot backup of kwsa_import_staging (recommended).
5) Save generated SQL/script versions to run folder for reproducibility.

## 25. Required validation checks after Phase 4
Must include:
- row counts by source and target entity
- duplicate business keys
- orphaned listings
- orphaned agents
- orphaned market centres
- orphaned teams
- listing images without listings
- listings without primary agent
- transactions without listings
- transactions without agents
- commission/split totals and per-transaction balancing checks
- sample record spot checks (at least 10 each for associates, listings, transactions, images)

Suggested SQL check set (examples):
- duplicates on source ids in migration.core_*
- counts parity checks between staging and migration.core
- transaction agents unmatched and payment detail unmatched checks
- listing description join integrity by source_listing_id

## 26. Risk list and mitigation plan
Risk 1: Script/table shape drift between legacy scripts and current Phase 3 structures.
- Mitigation: patch scripts to use *_raw_source tables and current column names before execution.

Risk 2: Listing descriptions could be mis-joined if row-order assumptions are used.
- Mitigation: enforce source_listing_id-only joins and add validation query for unmatched descriptions.

Risk 3: Null source_listing_id media cannot map to listings.
- Mitigation: route to rejection/audit table; do not force foreign keys.

Risk 4: Group D financial fields could be dropped by partial transform.
- Mitigation: explicit field list and non-null-preserving insert to transaction_agent_calculations.

Risk 5: Attempted use of insert-migration-to-public.sql in kwsa_import_staging.
- Mitigation: block that step in Phase 4 execution plan because public app tables are absent in this DB.

Risk 6: Overwrite of MAPP 2.0-only features in downstream databases.
- Mitigation: scope guard to kwsa_import_staging only for Phase 4; no writes to kwsa_uat/prod/kwsa.

## 27. Exact recommended Approval 9 step
Recommended Approval 9:
- Authorize Phase 4 execution in kwsa_import_staging only, using patched transform scripts and full post-validation pack.
- Explicitly disallow any promotion/copy to kwsa_uat, kwsa_prod, or kwsa during Approval 9.
- Require sign-off on validation report before any later promotion approval.

## Approval 8 conclusion
This document completes Approval 8 design and review scope only.
No Phase 4 execution was performed.
No data was transformed.
No non-staging database was touched.
