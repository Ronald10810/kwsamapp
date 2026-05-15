# PHASE5_13B_PRE_EXECUTION_GO_NO_GO

Date: 2026-05-15
Approval Scope: Approval 13B pre-execution go/no-go package only
Execution Mode: Preparation only (no promotion run)

## 1. Git branch and commit hash
Pre-package verification snapshot:
- Branch: clean-source-snapshot-before-db-cutover
- Commit: 7fa803141132e8aff5e49ff12269c655b30f45b0

## 2. Working tree status
Pre-package verification snapshot:
- Clean (`git status --short` returned no output)

Current status after preparing this package:
- Documentation/script changes present and uncommitted (expected for review)

## 3. Source and target databases
- Source database: kwsa_import_staging
- Target database: kwsa_uat

## 4. Production/UAT/public DB target confirmation (masked)
Read-only confirmation (masked DB target token only):
- Production backend DB target: kwsa_uat
- Test backend DB target: kwsa_uat
- Public API DB target: kwsa_uat

## 5. Backup ID and rollback point
- Backup ID: 1778860105623
- Backup status: SUCCESSFUL
- Backup type: ON_DEMAND
- Rollback anchor for this promotion window: 1778860105623

## 6. Maintenance-window requirement
Required.
Because production still points to kwsa_uat, promotion must run only in an approved maintenance window with active go/no-go authority and rollback owner assigned.

## 7. Rollback owner placeholder
- Rollback Owner: TBD
- Go/No-Go Authority: TBD
- Incident Commander: TBD

## 8. Exact SQL file created for promotion
- scripts/migration/phase5/01-promote-staging-to-uat.sql

Design:
- Controlled table-by-table delete-and-reload.
- Approved migration tables only.
- Row-count validation for each table.
- Stop on first error.
- Wrapped in a transaction.

## 9. Exact PowerShell wrapper created for promotion
- scripts/migration/phase5/run-phase5-promotion-to-uat.ps1

Wrapper behavior:
- Resolves psql path.
- Reads DB credentials from secret (no secret changes).
- Verifies source and target current_database().
- Verifies backup status.
- Runs pre-validation SQL.
- Runs promotion SQL.
- Runs post-validation SQL.
- Writes execution log.

## 10. Exact commands that will be run if execution is approved
```powershell
Set-Location "c:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console-clean-snapshot"

git branch --show-current
git rev-parse HEAD
git status --short

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/migration/phase5/run-phase5-promotion-to-uat.ps1" `
  -ProjectId "kwsa-mapp" `
  -InstanceName "kwsa-postgres" `
  -SourceDb "kwsa_import_staging" `
  -TargetDb "kwsa_uat" `
  -ProxyHost "127.0.0.1" `
  -ProxyPort 9470 `
  -BackupId "1778860105623" `
  -DbUrlSecret "kwsa-backend-test-db-url" `
  -RunId "approval-13b"
```

## 11. Pre-promotion validation checks
Implemented in:
- scripts/migration/phase5/00-pre-promotion-validation.sql

Checks include:
1. Session safety check: current_database() must equal kwsa_uat.
2. Required source/target table presence for approved promotion tables.
3. Baseline row counts (source vs target) across all approved tables.
4. Preserve indicators for selected public tables.
5. Stop on first validation error.

## 12. Post-promotion validation checks
Implemented in:
- scripts/migration/phase5/02-post-promotion-validation.sql

Checks include:
1. Session safety check: current_database() must equal kwsa_uat.
2. Source-vs-target row-count parity across approved tables.
3. Orphan checks for listing/transaction child tables.
4. Duplicate checks on source business-key columns.
5. Stop on first validation error.

## 13. Tables to promote
Approved migration promotion set:
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
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections

## 14. Tables to preserve
Preserve and do not overwrite:
- public.users
- public.app_users (if present)
- public.roles
- public.user_roles
- public.audit_logs
- public.public_leads
- public.loom_user_tokens
- public.cma_documents
- public.marketing_plan_documents
- rentals schema and related rental tables
- cloud/system/auth/config tables not in explicit promotion set
- MAPP 2.0-only feature tables
- all migration tables not listed in the approved promotion set

## 15. Known risks
- Production currently points to kwsa_uat; promotion has direct production-path impact.
- Schema drift can cause load errors if unexpected column mismatches exist.
- Table-level delete-and-reload can lock/impact reads during execution window.
- Long-running table reloads increase maintenance-window pressure.
- Missing rollback owner increases incident-response delay.

## 16. Go/no-go checklist
All must be YES before execution:
- [ ] Branch is clean-source-snapshot-before-db-cutover
- [ ] Commit baseline acknowledged: 7fa803141132e8aff5e49ff12269c655b30f45b0
- [ ] Maintenance window active and announced
- [ ] Rollback owner and go/no-go authority assigned
- [ ] Backup 1778860105623 reconfirmed SUCCESSFUL
- [ ] Cloud SQL proxy available on 127.0.0.1:9470
- [ ] Production/test/public targets reconfirmed (masked) and expected
- [ ] Pre-validation SQL passes
- [ ] Promotion SQL reviewed and approved
- [ ] Post-validation owner assigned
- [ ] Rollback trigger criteria acknowledged

No-go if any item is NO.

## 17. Exact next approval wording required to execute
Use exactly this phrase to authorize execution:

"I approve Approval 13B execution now. Execute scripts/migration/phase5/run-phase5-promotion-to-uat.ps1 during the active maintenance window against kwsa_uat only, using backup 1778860105623 as rollback anchor, with stop-on-first-error and immediate rollback on trigger."

## Additional precondition confirmations completed
1. Current GCP project confirmed: kwsa-mapp.
2. Cloud SQL instance confirmed: kwsa-postgres (RUNNABLE).
3. Source and target DB presence confirmed in instance DB list.
4. Backup 1778860105623 exists and is usable for restore.
5. Cloud SQL Auth Proxy confirmed available:
   - cloud-sql-proxy process running
   - 127.0.0.1:9470 listening

## Files prepared in this package
- docs/migration-runs/2026-05-14-run-013/PHASE5_13B_PRE_EXECUTION_GO_NO_GO.md
- scripts/migration/phase5/README.md
- scripts/migration/phase5/00-pre-promotion-validation.sql
- scripts/migration/phase5/01-promote-staging-to-uat.sql
- scripts/migration/phase5/02-post-promotion-validation.sql
- scripts/migration/phase5/run-phase5-promotion-to-uat.ps1
- scripts/migration/phase5/ROLLBACK_COMMANDS.md

## Scope guard confirmation
- No promotion SQL executed.
- No data copied.
- No truncate/delete/insert/update/overwrite operations executed.
- No touch to kwsa_prod.
- No touch to kwsa.
- No changes to secrets or Cloud Run env vars.
- No deployments.
- No asset migration.
- No commit or push performed in this step.
