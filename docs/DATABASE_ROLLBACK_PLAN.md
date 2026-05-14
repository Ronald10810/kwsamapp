# DATABASE_ROLLBACK_PLAN

Date: 2026-05-13 (Updated 2026-05-14 with three-stage flow)
Status: Three-stage rollback procedures documented per approval.

## Rollback Triggers (Three-Stage Flow)

### Stage 1 (kwsa_import_staging)
- Import timeout or crash
- Row count variance >5%
- Duplicate source IDs found
- Orphaned records >10
- MAPP 2.0 tables/columns missing
- Data validation queries fail

### Stage 2 (kwsa_uat)
- UAT service smoke test fails
- Login/dashboard broken
- Listings or transactions missing
- Report generation fails
- Row count mismatch after copy

### Stage 3 (kwsa_prod)
- Production services unhealthy post-switch
- Image/document URLs broken
- Critical user-facing functionality fails
- Performance degradation >20%
- 24-hour monitoring shows issues

## Rollback Procedures by Stage

### Stage 1 Rollback (Fastest — kwsa_import_staging)
If import to kwsa_import_staging fails or validation rejects:

**Action:** Delete and recreate staging database (non-destructive)
```bash
gcloud sql databases delete kwsa_import_staging --instance=kwsa-postgres
gcloud sql databases create kwsa_import_staging --instance=kwsa-postgres --charset=UTF8
```

**Time to restore:** <5 minutes  
**RPO:** Empty; start fresh import  
**Impact:** None (no production services point here)

### Stage 2 Rollback (Cloud SQL Restore — kwsa_uat)
If copy from kwsa_import_staging to kwsa_uat fails or UAT validation rejects:

**Action:** Restore kwsa_uat from Approval 4 backup (ID: 1778765132025)
```bash
gcloud sql backups restore 1778765132025 \
  --backup-instance=kwsa-postgres \
  --target-instance=kwsa-postgres
# Restores kwsa_uat to pre-import state (2026-05-14T13:27:53.864Z)
```

**WARNING:** This will overwrite kwsa_uat. Export post-import data first if needed.

**Time to restore:** 30-60 minutes  
**RPO:** Approval 4 baseline (pre-import state)  
**Impact:** MEDIUM (UAT and test services will be stale; then updated)  
**Mitigation:** Run only during agreed maintenance window

### Stage 3 Rollback (Secret Revert — kwsa_prod)
If production services unhealthy after switching DATABASE_URL:

**Action:** Revert Cloud Run secret to kwsa_uat endpoint
```bash
gcloud run services update kwsa-backend-prod \
  --set-env-vars DATABASE_URL=<kwsa_uat_secret_url> \
  --region africa-south1
# Restart service to pick up reverted env var
```

**Time to revert:** <10 minutes (secret change) + 5-10 minutes (service restart)  
**RPO:** Pre-cutover state (services fallback to kwsa_uat)  
**Impact:** LOW (immediate revert to known-good database)  
**Next Step:** Debug issues in kwsa_prod offline; retry Stage 3 when ready

## Required Pre-change Artifacts (must exist before import/cutover)
- Backup of current UAT DB
- Backup of current prod DB (kwsa_prod created 2026-05-14, empty)
- Backup of any active migration DB (kwsa_import_staging created 2026-05-14)
- Schema export per DB
- Row counts per table per DB
- Index + constraint exports
- Extension list per DB
- Snapshot of MAPP 2.0-only tables and fields

## Artifact Location
- docs/migration-runs/2026-05-14-run-002/ — Approval 2 backups/snapshots/schema exports
- docs/migration-runs/2026-05-14-run-003/ — Approval 3 kwsa_prod creation evidence
- docs/migration-runs/2026-05-14-run-004/ — Approval 4 pre-import baseline backup (ID: 1778765132025) + metadata
- docs/migration-runs/2026-05-14-run-005/ — Approval 5 azure import mapping & dry-run plan
- docs/migration-runs/2026-05-14-run-006/ — Approval 6 kwsa_import_staging creation evidence
- Cloud SQL on-demand backup id: 1778765132025 (SUCCESSFUL, for Stage 2 rollback)

## Validation After Rollback
- Service readiness and health endpoints
- Login + dashboard
- Listings + images + documents
- Transactions and reports
- Core admin functions

## Operational Notes
- Rollback runbook must be executable by an on-call engineer without hidden context.
- Stage 1 rollback is fast and low-risk (delete/recreate database).
- Stage 2 rollback is slow but reliable (restore from backup ID 1778765132025).
- Stage 3 rollback is fast (secret revert to kwsa_uat endpoint).
- After Stage 3 rollback, debug production issues offline before retrying.
