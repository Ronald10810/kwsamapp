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
Required evidence:
- Confirm existing DBs and owners.
- Confirm no destructive changes required.

## Approval 4: Azure import into staging or kwsa_uat allowed
Required evidence:
- Schema comparison approved.
- Mapping rules approved.
- MAPP 2.0 preservation plan approved.

## Approval 5: Validation fixes allowed
Required evidence:
- Validation report with row/count/relationship diffs.
- List of required transformations/defaults.

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
