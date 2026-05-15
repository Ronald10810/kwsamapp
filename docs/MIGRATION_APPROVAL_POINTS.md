# MIGRATION_APPROVAL_POINTS

Date: 2026-05-13

## Approval 1: Inspection documents complete
Required evidence:
- All planning docs in docs/ completed.
- Current branch/commit/status captured.
- Current env->DB map captured with masked values.

## Approval 2: Backups/snapshots/schema exports allowed
Required evidence:
- Backup runbook approved.
- Target backup folder pattern approved.


## Approval 3: kwsa_uat and kwsa_prod creation/confirmation allowed
Completed 2026-05-14:
- Confirmed existing DBs and owners.
- Confirmed no destructive changes required.
- Created empty kwsa_prod database (no import, no overwrite, no env/secret change).

## Approval 4: Pre-import backup/export baseline only
Completed 2026-05-14:
- Confirmed target DB set includes kwsa, kwsa_uat, kwsa_prod, kwsa_public, kwsa_parallel, postgres.
- Created Cloud SQL on-demand backup for kwsa-postgres (id 1778765132025, SUCCESSFUL).
- Exported schema/row-count/index/constraint/FK/extension evidence for in-scope DBs.
- No Azure import run, no data copy, no env or secret change.

## Approval 5: Azure import mapping, dry-run preparation, and execution plan only
Completed: 2026-05-14
Evidence file: docs/migration-runs/2026-05-14-run-005/AZURE_IMPORT_MAPPING_AND_DRY_RUN_PLAN.md

Deliverables:
- Azure source database details (masked secrets)
- Current import/export scripts inventory
- Schema mapping logic documented
- Validation scripts identified
- Azure source tables listed (~50 tables)
- PostgreSQL target tables listed and impact assessed
- Data operation types identified (INSERT ON CONFLICT DO NOTHING/UPDATE = UPSERT)
- MAPP 2.0-only tables and columns identified and preservation plan documented
- Risky tables flagged (listing_images ~2.6M rows, transaction_associate_payment_details, listing_documents)
- First import target recommended: kwsa_import_staging (NEW SAFETY GATE per Approval 6)
- Three-stage import flow: kwsa_import_staging → kwsa_uat → kwsa_prod
- Dry-run command plan provided
- Full import command sequence provided
- Post-import validation queries provided (11 validation sets)
- Rollback plan documented

## Approval 6: Create and prepare dedicated staging database (NEW SAFETY GATE)
Completed: 2026-05-14
Evidence file: docs/migration-runs/2026-05-14-run-006/IMPORT_STAGING_DATABASE_REPORT.md

Critical Finding: kwsa_uat is currently LIVE (production, UAT, and public API all point here)
Safety Decision: Create kwsa_import_staging for safe rehearsal before touching kwsa_uat

Deliverables:
- GCP project confirmed (kwsa-mapp)
- Cloud SQL instance confirmed (kwsa-postgres, africa-south1)
- Database list before creation captured (6 databases)
- kwsa_import_staging database created (2026-05-14)
- Database list after creation captured (7 databases)
- kwsa_import_staging confirmed empty and accessible
- No Azure import executed (inspection only)
- No data loaded (preparation only)
- No existing databases modified
- No env vars or secrets changed
- Three-stage import flow documented:
  - Stage 1: Azure → kwsa_import_staging (isolated rehearsal)
  - Stage 2: Validated kwsa_import_staging → kwsa_uat (pre-production)
  - Stage 3: Validated kwsa_uat → kwsa_prod (production)
- Risks and blockers documented
- Preparation checklist for Approval 7 provided

## Approval 7: Stage 1 — Execute first Azure import to kwsa_import_staging
Completed: 2026-05-15
Evidence file: docs/migration-runs/2026-05-14-run-007/AZURE_TO_IMPORT_STAGING_RUN_REPORT.md

Deliverables:
- Batch loaded: azure-2026-05-14-staging-run-001
- Database touched: kwsa_import_staging only
- Total rows loaded: 5,238,234
- Group D transaction mapping: 0 unmatched transaction IDs
- No kwsa_uat, kwsa_prod, or kwsa writes
- No env var/secret/deploy changes

## Approval 6: kwsa_prod preparation from validated kwsa_uat allowed
Required evidence:
- UAT validation sign-off.
- Rollback artifacts ready.

## Approval 7: Asset migration dry-run allowed
Required evidence:
- Job config reviewed.
- Dry-run scope and batch limits approved.

## Approval 8: Phase 4 mapping design and review only
Completed: 2026-05-15
Evidence file: docs/migration-runs/2026-05-14-run-008/PHASE4_MAPPING_DESIGN_AND_REVIEW.md

Deliverables:
- Full Phase 4 source-to-target mapping design across Groups A-D
- Existing transform/validation script review and compatibility gaps
- Proposed Phase 4 execution order and post-validation checks
- Preservation rules for MAPP 2.0-only tables/columns
- Risk register and mitigation plan
- Explicit no-execution confirmation (design only)

## Approval 9: Local and UAT may be pointed to kwsa_uat
Required evidence:
- Local smoke test on kwsa_uat passed.
- UAT smoke test on kwsa_uat passed.

## Approval 10: Production may be pointed to kwsa_prod
Required evidence:
- All import and asset validations passed.
- Final go-live checklist signed.
- Explicit production switch approval recorded.
