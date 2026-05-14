# DATABASE_CUTOVER_PLAN_2026_07_01

Date: 2026-05-13
Mode: Inspection and planning only (no migration/import/deploy/env changes executed)

## 1) Current State (Verified)
- Git branch: master
- Latest commit: 5b6f7f60a23be6d6e6846e3c3b0c9bdd217a191a
- Working tree: NOT clean (modified + untracked files present)
- Active GCP project: kwsa-mapp
- Primary GCP region (backend + Cloud SQL): africa-south1
- Cloud SQL instance: kwsa-postgres
- Cloud SQL databases found:
  - postgres
  - kwsa
  - kwsa_parallel
  - kwsa_uat
  - kwsa_public
- Cloud Run services discovered:
  - kwsa-backend-prod (africa-south1, Ready=True, Cloud SQL attached)
  - kwsa-backend-test (africa-south1, Ready=True, Cloud SQL attached)
  - kwsa-public-api-uat (africa-south1, Ready=True, no Cloud SQL attachment)
  - kwsa-frontend-prod (us-central1, Ready=True)
  - kwsa-frontend-uat (us-central1, Ready=True)
  - kwsa-frontend-test (africa-south1, Ready=False)
- Local runtime check:
  - frontend http://localhost:5174 => HTTP 200
  - backend http://localhost:3000/health => HTTP 200

## 2) Current State (Needs Confirmation in Approval Phase)
- Exact database name used by Cloud Run prod secret DATABASE_URL (secret value access failed from current operator context).
- Exact database name used by Cloud Run test secret kwsa-backend-test-db-url (secret value access failed).
- Live Azure SQL table/column inventory from sys.tables/sys.columns (not executed; credentials/approval pending).


## 3) Target State (Go-live)
- Local development -> kwsa_uat
- UAT -> kwsa_uat
- Production (kwmapp.co.za) -> kwsa_prod
- Final long-term DBs:
  - kwsa_uat
  - kwsa_prod (created 2026-05-14, empty, no data imported)

## 4) Non-Negotiable Constraints
- No production deployment changes in this phase.
- No env var changes in this phase.
- No database migration/import/overwrite in this phase.
- No DB deletion/drop/rename in this phase.
- No bucket deletion/change in this phase.

## 5) Cutover Strategy (Planned)
* [2026-05-14] kwsa_prod database created (empty, no import yet, Approval 3 complete)
* [2026-05-14] Pre-import baseline backup/export complete (Approval 4): Cloud SQL backup id 1778765132025 plus run-004 schema/metadata evidence.
1. Snapshot and export all involved Cloud SQL databases (schema + data backup + row-count baselines).
2. Generate Azure vs PostgreSQL schema diff report.
3. Run Azure export into staging/import tables.
4. Map into current MAPP 2.0 schema (preserve MAPP 2.0-only tables/fields).
5. Validate counts, relationships, and key UX records in kwsa_uat.
6. Promote validated dataset to kwsa_prod.
7. Switch production DATABASE_URL only after explicit approval and checklist pass.

## 6) Pre-Change Evidence Folder
- docs/migration-runs/2026-05-13-run-001/
  - postgres-metadata.json (current kwsa metadata snapshot)

## 7) Risks
- Working tree is not clean; accidental deploy of uncommitted changes is possible.
- Sensitive values currently exist in local env files and deployment scripts; secret hygiene risk.
- Current local backend DATABASE_URL points to local kwsa and ENFORCE_LOCAL_UAT_DB=false, which conflicts with target policy.
- UAT/prod secret-value level DB confirmation could not be completed from current IAM context.

## 8) Mitigations
- Freeze deploy actions until approval checklist is complete.
- Enforce branch + commit tagging before each migration step.
- Move all secret-bearing values to Secret Manager references only.
- Add explicit preflight script that blocks non-kwsa_uat local targets.

## 9) Required Manual Approval Gates
- Approval 1: inspection documents complete.
- Approval 2: backups/snapshots/schema exports allowed.
- Approval 3: kwsa_uat + kwsa_prod creation/confirmation allowed.
- Approval 4: Azure import to staging/kwsa_uat allowed.
- Approval 5: validation fixes allowed.
- Approval 6: kwsa_prod preparation from validated kwsa_uat allowed.
- Approval 7: asset migration dry-run allowed.
- Approval 8: asset migration run 1 allowed.
- Approval 9: local + UAT env switching allowed.
- Approval 10: production env switching allowed.
