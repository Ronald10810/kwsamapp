# DATABASE_CUTOVER_PLAN_2026_07_01

Date: 2026-05-13
Mode: Inspection and planning only (no migration/import/deploy/env changes executed)

## 1) Current State (Verified)
- Git branch: clean-source-snapshot-before-db-cutover
- Latest commit: 4f3b5bc75c77e830a279ce412c65cb8093cdcc8b
- Working tree: clean at Approval 11 planning snapshot
- Active GCP project: kwsa-mapp
- Primary GCP region (backend + Cloud SQL): africa-south1
- Cloud SQL instance: kwsa-postgres
- Cloud SQL databases found (Pre-Approval 6):
  - postgres
  - kwsa
  - kwsa_parallel
  - kwsa_uat (ACTIVE — prod, UAT, public API point here)
  - kwsa_public
- Cloud SQL databases after Approval 6 (2026-05-14):
  - postgres
  - kwsa
  - kwsa_import_staging (NEW — staging import target)
  - kwsa_parallel
  - kwsa_prod
  - kwsa_public
  - kwsa_uat (ACTIVE — unchanged)
- Cloud Run services discovered:
  - kwsa-backend-prod (africa-south1, Ready=True, Cloud SQL attached)
  - kwsa-backend-test (africa-south1, Ready=True, Cloud SQL attached)
  - kwsa-public-api-uat (africa-south1, Ready=True, no Cloud SQL attachment)
  - kwsa-frontend-test (africa-south1, Ready=True)
  - kwsa-smoketest (africa-south1, Ready=True)
- Local runtime check:
  - frontend http://localhost:5174 => HTTP 200
  - backend http://localhost:3000/health => HTTP 200

## 2) Current State (Verified in Approval 11)
- kwsa-backend-prod -> DATABASE_URL@3 -> db token includes kwsa_uat (masked confirmation).
- kwsa-backend-test -> kwsa-backend-test-db-url@latest -> kwsa_uat (masked confirmation).
- kwsa-public-api-uat -> kwsa-public-api-db-url@latest -> kwsa_uat (masked confirmation).
- Live production-path services are still effectively on kwsa_uat.


## 3) Target State (Go-live)
- **CRITICAL FINDING (Approval 2):** kwsa_uat is currently LIVE (production, UAT, and public API all point here)
- **SAFETY DECISION (Approval 6):** Three-stage import flow to avoid production disruption
  - Stage 1: Azure → kwsa_import_staging (isolated; safe rehearsal)
  - Stage 2: Validated kwsa_import_staging → kwsa_uat (pre-production)
  - Stage 3: Validated kwsa_uat → kwsa_prod (production)
- Final long-term DBs:
  - kwsa_import_staging (staging/rehearsal; optional cleanup after Approval 9)
  - kwsa_uat (pre-production/backup after cutover)
  - kwsa_prod (production, final target)

## 4) Non-Negotiable Constraints
- No production deployment changes in this phase.
- No env var changes in this phase.
- No database migration/import/overwrite in this phase.
- No DB deletion/drop/rename in this phase.
- No bucket deletion/change in this phase.

## 5) Cutover Strategy (Planned)
* [2026-05-14] kwsa_prod database created (empty, no import yet, Approval 3 complete)
* [2026-05-14] Pre-import baseline backup/export complete (Approval 4): Cloud SQL backup id 1778765132025 plus run-004 schema/metadata evidence.
## 5) Cutover Strategy (Three-Stage with Approval 6 Safety Update)

### Stage 1: Isolated Rehearsal (Approval 7)
1. Export from Azure SQL to CSV files
2. Create staging schemas in kwsa_import_staging
3. Load staging.* tables from CSV (INSERT ON CONFLICT DO NOTHING)
4. Transform staging.* → migration.core_* (INSERT ON CONFLICT DO UPDATE)
5. Promote migration.core_* → public.* Prisma tables
6. Validate: row counts, orphans, duplicates, MAPP 2.0 preservation
7. Decision: Go to Stage 2 or Fix & Retry

### Stage 2: Pre-Production (Approval 8)
1. Copy validated kwsa_import_staging schema + data to kwsa_uat OR re-import with same batch ID
2. Smoke test UAT services (kwsa-backend-test points here)
3. Validate: login, dashboard, listings, transactions, reports
4. Decision: Go to Stage 3 or Rollback from Approval 4 backup

### Stage 3: Production Cutover (Approval 9)
1. Copy validated kwsa_uat schema + data to kwsa_prod OR re-import with same batch ID
2. Final smoke test (no services point here yet)
3. Switch production secret DATABASE_URL → kwsa_prod
4. Verify production services healthy
5. Monitor for 24-48 hours
6. Decision: Commit or Rollback via secret revert

## 6) Pre-Change Evidence Folders
- docs/migration-runs/2026-05-13-run-001/ — Initial inspection (postgres-metadata.json)
- docs/migration-runs/2026-05-14-run-002/ — Approval 2: Backup/snapshot/schema exports (7661164)
  - **Key Finding:** kwsa_uat is LIVE (prod/UAT/public API point here)
- docs/migration-runs/2026-05-14-run-003/ — Approval 3: kwsa_prod creation (54ae20e)
- docs/migration-runs/2026-05-14-run-004/ — Approval 4: Pre-import baseline + metadata (6694df0, 05eb56e)
  - **Backup ID:** 1778765132025 (SUCCESSFUL, can restore kwsa_uat if needed)
- docs/migration-runs/2026-05-14-run-005/ — Approval 5: Azure import mapping & dry-run plan
- docs/migration-runs/2026-05-14-run-006/ — Approval 6: kwsa_import_staging database created (26b0ae9)
- docs/migration-runs/2026-05-14-run-007/ — Approval 7: Phase 3 import complete to kwsa_import_staging (5,238,234 rows)
- docs/migration-runs/2026-05-14-run-008/ — Approval 8: Phase 4 mapping design and review (design only)

## 7) Risks
- Promoting to kwsa_uat while production points there creates direct live risk.
- Source/target schema drift exists across promotion tables; blanket copy can fail or corrupt.
- In-place promotion without maintenance control can cause partial state exposure.
- Sensitive values currently exist in local env files and deployment scripts; secret hygiene risk.
- Current local backend DATABASE_URL points to local kwsa and ENFORCE_LOCAL_UAT_DB=false, which conflicts with target policy.

## 8) Mitigations
- Freeze deploy actions until approval checklist is complete.
- Enforce branch + commit tagging before each migration step.
- Move all secret-bearing values to Secret Manager references only.
- Add explicit preflight script that blocks non-kwsa_uat local targets.

## 9) Required Manual Approval Gates (Three-Stage Flow)
- Approval 1: inspection documents complete. ✓
- Approval 2: backups/snapshots/schema exports completed. ✓
- Approval 3: kwsa_uat + kwsa_prod created. ✓
- Approval 4: pre-import baseline backup + export completed. ✓ (Backup ID: 1778765132025)
- Approval 5: Azure import mapping & dry-run plan completed. ✓
- **Approval 6:** kwsa_import_staging created; three-stage flow documented. ✓ (NEW SAFETY GATE)
- **Approval 7:** Stage 1 import to kwsa_import_staging completed. ✓
  - Batch azure-2026-05-14-staging-run-001 loaded; no non-staging DB changes
- **Approval 8:** Phase 4 mapping design and review completed (design only). ✓
  - No transforms executed; no promotion executed
- **Approval 9:** Execute Phase 4 transforms in kwsa_import_staging only. ✓
- **Approval 10:** Complete Phase 4 validation in kwsa_import_staging. ✓
- **Approval 11:** Phase 5 promotion planning and safety review only. ✓
- **Approval 12:** Phase 5 pre-execution safety gate (recommended next).
  - Approve maintenance window/freeze plan.
  - Approve fresh pre-promotion backup commands and owners.
  - Approve mapped upsert promotion SQL (no blanket truncate/drop).
