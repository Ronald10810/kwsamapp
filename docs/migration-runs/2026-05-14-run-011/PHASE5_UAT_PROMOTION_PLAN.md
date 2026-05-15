# PHASE5_UAT_PROMOTION_PLAN

Date: 2026-05-15
Approval Scope: Approval 11 (planning and safety review only)
Execution Mode: Read-only inspection only (no data copy, no DML, no env/deploy changes)

## 1) Git branch and commit hash
- Branch: clean-source-snapshot-before-db-cutover
- Commit: 4f3b5bc75c77e830a279ce412c65cb8093cdcc8b

## 2) Current working tree status
- Working tree status at planning time: clean
- Temporary helper file 10v-pre-validation-counts.sql: removed from worktree as temporary artifact

## 3) Source database
- Source (validated): kwsa_import_staging

## 4) Target database
- Target for next phase: kwsa_uat

## 5) Current Cloud Run DB targets (masked confirmation)
Read-only inspection completed for Cloud Run service env mappings and referenced secrets.

Service to secret mapping:
- kwsa-backend-prod -> DATABASE_URL (secret version 3)
- kwsa-backend-test -> kwsa-backend-test-db-url (latest)
- kwsa-public-api-uat -> kwsa-public-api-db-url (latest)

Masked target extraction from secrets:
- DATABASE_URL@3 -> db token includes kwsa_uat (host masked; non-local)
- kwsa-backend-test-db-url@latest -> db=kwsa_uat, host=loc***ost
- kwsa-public-api-db-url@latest -> db=kwsa_uat, host=34.***173

## 6) Confirmation whether production still points to kwsa_uat
- Yes. Current evidence indicates production backend still resolves to kwsa_uat via DATABASE_URL secret reference and secret-value token extraction.
- Public API UAT and test backend also resolve to kwsa_uat.

## 7) Risk assessment if production currently points to kwsa_uat
Risk level: HIGH for any direct promotion into kwsa_uat while production is live against that database.

Primary risks:
- Live-user impact: any overwrite/upsert mistake affects production paths immediately.
- Schema drift risk: source and target migration schemas are not fully identical.
- Data integrity risk: some columns differ in type/name across source and target.
- Rollback complexity increases if writes occur while services remain online.

Observed schema drift highlights (migration promotion tables):
- Same-named columns with different types:
  - migration.core_associates.temporary_growth_share_sponsor: source=text, target=bool
  - migration.core_associates.manual_cap: source=numeric, target=bool
  - migration.listing_property_areas.sub_features: source=text[], target=jsonb
- Source-only columns not in UAT:
  - migration.id_map_*.mapped_at
  - migration.listing_marketing_urls.created_at
  - migration.transaction_agents.net_comm
- UAT-only columns not in source (selected):
  - migration.transaction_agents.agent_name
  - migration.transaction_agents.outside_agency
  - many additional migration.core_transactions columns in UAT

Conclusion:
- A direct bulk copy/truncate strategy is unsafe.
- Promotion must be column-mapped and non-destructive, with explicit casts/defaults and strict maintenance controls.

## 8) Recommended safe promotion strategy
Recommended: DO NOT promote to kwsa_uat immediately.

Safer sequence:
1. Approval 12 (pre-promotion safety gate):
   - Freeze writes with maintenance window OR first move production off kwsa_uat.
   - Preferred: first switch production to kwsa_prod only after independent readiness validation.
2. Approval 13 (backup + dry-run plan signoff):
   - Fresh on-demand backup immediately before any UAT promotion.
   - Capture pre-promotion row counts and checksums for scoped tables.
3. Approval 14 (execution):
   - Run non-destructive, mapped upsert promotion to kwsa_uat for scoped migration tables only.
   - No public schema overwrite.
4. Approval 15 (post-promotion validation and smoke tests):
   - Validate counts, FK consistency, and app smoke tests before releasing maintenance state.

Strategy options assessment:
- Direct promotion to kwsa_uat now: NOT RECOMMENDED.
- Maintenance window in-place promotion: ACCEPTABLE if production cannot be moved first.
- Clone/restore approach: STRONGLY RECOMMENDED for backup and rollback readiness.
- First switching production away from kwsa_uat: MOST SAFE overall.

## 9) Tables to copy/promote
Promotion scope should be migration schema only and limited to mapped business tables from validated source.

Primary promotion set:
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions
- migration.id_map_market_centers
- migration.id_map_teams
- migration.id_map_associates
- migration.id_map_listings
- migration.listing_agents
- migration.listing_images
- migration.listing_marketing_urls
- migration.listing_property_areas
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections

Current source vs target row counts (read-only snapshot):
- core_market_centers: 48 -> 48
- core_teams: 219 -> 219
- core_associates: 9,243 -> 9,227
- core_listings: 129,123 -> 139,978
- core_transactions: 30,181 -> 30,120
- id_map_market_centers: 48 -> 48
- id_map_teams: 219 -> 219
- id_map_associates: 9,243 -> 9,225
- id_map_listings: 129,123 -> 139,968
- listing_agents: 146,571 -> 145,929
- listing_images: 2,531,507 -> 2,524,075
- listing_marketing_urls: 9,975 -> 34,462
- listing_property_areas: 0 -> 1,421,790
- transaction_agents: 46,824 -> 42,450
- transaction_agent_calculations: 42,533 -> 42,440
- load_rejections: 76,837 -> 0

## 10) Tables that must be preserved in kwsa_uat
Preserve all non-promotion tables and any UAT-specific migration/public data not part of explicit mapped upsert.

UAT migration tables present only in target (do not drop/overwrite blindly):
- migration.agent_deregistration_log
- migration.agent_reactivation_log
- migration.listing_transfer_log
- migration.mc_dashboard_daily_snapshots
- migration.mc_document_hub
- migration.team_associate_commissions
- migration.team_cap_history
- migration.team_caps
- migration.team_dates
- migration.team_notes
- migration.team_portal_settings
- migration.transaction_documents
- migration.transaction_status_history

Policy:
- No TRUNCATE/DROP against full migration schema.
- No writes outside approved promotion table list.

## 11) MAPP 2.0-only tables to preserve
Do not overwrite these UAT public tables during Phase 5 promotion.

Verified existing preserve set in kwsa_uat (read-only):
- public.app_users (15)
- public.users (0)
- public.roles (0)
- public.user_roles (0)
- public.audit_logs (0)
- public.public_leads (0)
- public.loom_user_tokens (1)
- public.cma_documents (9)
- public.marketing_plan_documents (3)
- public.listing_p24_feed_items (0)
- public.listing_third_party_integrations (124866)
- public.transaction_notes (0)
- public.transaction_documents (80599)
- public.transaction_bonds (0)

Not found in current UAT snapshot:
- public.rentals (table absent)

## 12) Exact proposed promotion commands (DO NOT RUN)
All commands below are planning-only proposals for a future approved execution window.

A) Pre-flight safety checks

PowerShell:

  git branch --show-current
  git rev-parse HEAD
  git status --short

  gcloud run services list --project kwsa-mapp --region africa-south1

SQL prechecks (must pass before any future promotion):

  SELECT current_database();

Expected per session:
- Source session: kwsa_import_staging
- Target session: kwsa_uat

B) Backup and evidence capture before promotion

Cloud SQL on-demand backup:

  gcloud sql backups create \
    --instance=kwsa-postgres \
    --project=kwsa-mapp \
    --description="pre-phase5-uat-promotion-YYYYMMDD-HHMM"

Logical export of kwsa_uat (full safety net):

  gcloud sql export sql kwsa-postgres gs://<backup-bucket>/kwsa_uat_pre_phase5_YYYYMMDD_HHMM.sql.gz \
    --database=kwsa_uat \
    --project=kwsa-mapp

C) Proposed mapped promotion execution (non-destructive, in maintenance window)

Option 1 (recommended): execute a vetted SQL mapping script with explicit per-table upserts and type casts.

  psql -h 127.0.0.1 -p 9470 -U <db_user> -d kwsa_uat \
    -v ON_ERROR_STOP=1 \
    -f scripts/migration/phase5/promote-import-staging-to-uat-mapped.sql

Script design rules:
- Only INSERT ... ON CONFLICT DO UPDATE by business keys.
- No TRUNCATE/DROP/DELETE of whole tables.
- Explicit casts for known type drifts.
- Column intersection for drifted tables.
- Preserve UAT-only columns using COALESCE(existing, incoming/default) rules.

D) Prohibited command class (for clarity)
- No direct full-schema pg_restore overwrite to kwsa_uat.
- No blanket TRUNCATE migration.*.
- No writes to public.*.

## 13) Backup steps required before promotion
Required immediately before any future execution:
1. Fresh Cloud SQL on-demand backup for instance kwsa-postgres.
2. Logical export of kwsa_uat database.
3. Row-count snapshot for all promotion tables (source and target).
4. Schema snapshot (information_schema columns) for promotion tables in source and target.
5. Capture Cloud Run revision IDs for prod/test/public-api services.
6. Confirm maintenance window start/end and rollback owner.

## 14) Rollback plan
If promotion fails or post-checks fail:

Immediate containment:
1. Keep maintenance mode active (or keep prod disconnected from kwsa_uat if decoupled first).
2. Stop further promotion scripts.

Database rollback options:
- Primary: restore from fresh pre-promotion backup.

  gcloud sql backups restore <pre_phase5_backup_id> \
    --backup-instance=kwsa-postgres \
    --target-instance=kwsa-postgres \
    --project=kwsa-mapp

- Secondary: import pre-promotion logical dump for kwsa_uat if targeted rollback is preferred.

Service rollback:
- If any service DB target was changed in a future approved phase, revert service revision/secret reference to pre-change values.

Verification after rollback:
- Row counts back to pre-promotion baseline.
- Critical endpoints healthy.
- No partial writes remain in scoped migration tables.

## 15) Post-promotion validation checklist
For the future approved execution phase:

Database validations:
- current_database() confirms kwsa_uat.
- Row counts for 16 promotion tables compared source vs target.
- Duplicate-key checks on business keys return 0 unexpected duplicates.
- Referential integrity checks for listing and transaction linkages return 0 unexpected orphans.
- Expected rejection categories reviewed and documented.

Application validations:
- Prod backend health and key endpoints.
- UAT backend smoke tests.
- Public API smoke tests.
- Listings, transactions, documents, and integrations key paths.

Operational validations:
- Cloud Run revisions stable.
- Error-rate and latency checks normal.
- No unauthorized env/secret/deployment drift.

## 16) Recommended next approval
Recommended next gate: Approval 12 (Phase 5 pre-execution safety gate).

Approval 12 should authorize planning-to-execution prerequisites only:
1. Confirm maintenance window and freeze plan.
2. Decide whether to move production off kwsa_uat first (recommended) or run in strict maintenance window.
3. Generate final mapped promotion SQL script for schema-drift-safe upserts.
4. Run dry-run SQL validation queries only (no writes).
5. Capture final backup command set with timestamps and owners.

Hard stop:
- No data copy to kwsa_uat until separate explicit execution approval is granted.

## Evidence inspected in Approval 11
- docs/migration-runs/2026-05-14-run-007/AZURE_TO_IMPORT_STAGING_RUN_REPORT.md
- docs/migration-runs/2026-05-14-run-008/PHASE4_MAPPING_DESIGN_AND_REVIEW.md
- docs/migration-runs/2026-05-14-run-009/PHASE4_SCRIPT_PATCH_AND_EXECUTION_PLAN.md
- docs/migration-runs/2026-05-14-run-010/PHASE4_EXECUTION_REPORT.md
- docs/MIGRATION_APPROVAL_POINTS.md
- docs/DATABASE_CUTOVER_PLAN_2026_07_01.md
- docs/GO_LIVE_DATABASE_CHECKLIST.md
- docs/DATABASE_ROLLBACK_PLAN.md
