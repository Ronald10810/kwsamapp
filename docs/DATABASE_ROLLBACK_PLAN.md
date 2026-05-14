# DATABASE_ROLLBACK_PLAN

Date: 2026-05-13
Status: Planned rollback only.

## Rollback Triggers
- Import validation thresholds fail.
- Broken FK/integrity checks.
- Critical UI/API regressions.
- Asset URL resolution failures above tolerance.


## Required Pre-change Artifacts (must exist before import/cutover)
- Backup of current UAT DB
- Backup of current prod DB (kwsa_prod created 2026-05-14, empty)
- Backup of any active migration DB
- Schema export per DB
- Row counts per table per DB
- Index + constraint exports
- Extension list per DB
- Snapshot of MAPP 2.0-only tables and fields

## Artifact Location
- docs/migration-runs/YYYY-MM-DD-run-XXX/
- Latest baseline evidence: docs/migration-runs/2026-05-14-run-004/
- Cloud SQL on-demand backup id: 1778765132025 (SUCCESSFUL)

## Rollback Levels
### Level 1: Configuration rollback
- Revert Cloud Run service to previous DATABASE_URL secret version.
- Re-point frontend API base URL only if changed in same window.

### Level 2: Data rollback
- Restore Cloud SQL backup/snapshot for impacted DB.
- Re-apply last known good schema if needed.

### Level 3: Full rollback
- Revert env + DB + app revision to pre-cutover baseline.
- Freeze writes and run incident validation checklist.

## Validation After Rollback
- Service readiness and health endpoints
- Login + dashboard
- Listings + images + documents
- Transactions and reports
- Core admin functions

## Operational Notes
- Rollback runbook must be executable by an on-call engineer without hidden context.
- Time-to-restore target and RPO/RTO to be finalized before Approval 10.
