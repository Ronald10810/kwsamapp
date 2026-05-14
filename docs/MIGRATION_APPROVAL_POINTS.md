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
- First import target recommended: kwsa_uat (non-destructive, with Approval 4 rollback available)
- Staging database recommendation: NO (use existing kwsa_uat)
- Exact dry-run command plan provided (market_centers_raw sample)
- Exact full import command sequence provided (5 command blocks)
- Post-import validation queries provided (11 validation sets)
- Rollback plan documented using Backup ID 1778765132025 (3 rollback levels)
- Next approval step recommended: Approval 6 (kwsa_prod preparation)

## Approval 6: kwsa_prod preparation from validated kwsa_uat allowed
Required evidence:
- UAT validation sign-off.
- Rollback artifacts ready.

## Approval 7: Asset migration dry-run allowed
Required evidence:
- Job config reviewed.
- Dry-run scope and batch limits approved.

## Approval 8: Asset migration run 1 allowed
Required evidence:
- Dry-run results accepted.
- Retry strategy approved.

## Approval 9: Local and UAT may be pointed to kwsa_uat
Required evidence:
- Local smoke test on kwsa_uat passed.
- UAT smoke test on kwsa_uat passed.

## Approval 10: Production may be pointed to kwsa_prod
Required evidence:
- All import and asset validations passed.
- Final go-live checklist signed.
- Explicit production switch approval recorded.
