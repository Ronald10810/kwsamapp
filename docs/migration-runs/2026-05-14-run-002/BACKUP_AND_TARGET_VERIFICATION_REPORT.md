# BACKUP_AND_TARGET_VERIFICATION_REPORT

Date: 2026-05-14
Approval scope: Approval 2 only
Mode: Read-only backup evidence, schema export, row count export, index/FK/constraint export, and target verification only

## Git Checkpoint
- Git branch: clean-source-snapshot-before-db-cutover
- Git commit: 12b5dd8b3fe96907c9363d99e6eca27150c4527e
- Working tree status at end of run: DIRTY (expected, due only to new untracked evidence files under docs/migration-runs/2026-05-14-run-002)
- Remote branch: origin/clean-source-snapshot-before-db-cutover

## GCP Context
- GCP project: kwsa-mapp
- Active gcloud account: kwsamapp@gmail.com
- Cloud SQL instance: kwsa-postgres
- Cloud SQL instance region: africa-south1
- Cloud SQL instance IP: 34.35.113.173

## Existing Cloud SQL Databases
Verified from Cloud SQL instance metadata:
- postgres
- kwsa
- kwsa_parallel
- kwsa_public
- kwsa_uat

## kwsa_prod Status
- Verified: kwsa_prod does not currently exist on Cloud SQL instance kwsa-postgres.
- Evidence: cloudsql-databases.json contains postgres, kwsa, kwsa_parallel, kwsa_public, kwsa_uat only.

## Cloud Run Services
Verified services:
- kwsa-backend-prod (africa-south1, Ready=True)
- kwsa-backend-test (africa-south1, Ready=True)
- kwsa-public-api-uat (africa-south1, Ready=True)
- kwsa-smoketest (africa-south1, Ready=True)
- kwsa-frontend-test (africa-south1, Ready=False)
- kwsa-frontend-prod (us-central1, Ready=True)
- kwsa-frontend-uat (us-central1, Ready=True)

## Current Database Targets
### Current local DB target
- Direct verification from isolated clean worktree was not possible because backend/.env is not present in this worktree.
- Clean-worktree local Docker default: kwsa (from docker-compose.yml POSTGRES_DB)
- Remaining caveat: this is a checked-in default, not a verified live local DATABASE_URL value.

### Current UAT DB target
- Verified from secret-backed DATABASE_URL values: kwsa_uat
- Verified sources:
  - kwsa-backend-test -> secret kwsa-backend-test-db-url:latest -> db name kwsa_uat
  - kwsa-public-api-uat -> secret kwsa-public-api-db-url:latest -> db name kwsa_uat

### Current prod DB target
- Verified from secret-backed DATABASE_URL value: kwsa_uat
- Verified source:
  - kwsa-backend-prod -> secret DATABASE_URL:3 -> db name kwsa_uat

### Secret-backed DB target names, masked
- kwsa-backend-test / kwsa-backend-test-db-url:latest -> user kw***, db kwsa_uat
- kwsa-backend-prod / DATABASE_URL:3 -> user kw***, db kwsa_uat
- kwsa-public-api-uat / kwsa-public-api-db-url:latest -> user kw***, db kwsa_uat

## Cloud Run Service Target Wiring
- kwsa-backend-test:
  - Region: africa-south1
  - Cloud SQL attachment: kwsa-mapp:africa-south1:kwsa-postgres
  - DATABASE_URL secret: kwsa-backend-test-db-url:latest
  - Current DB target name: kwsa_uat
- kwsa-backend-prod:
  - Region: africa-south1
  - Cloud SQL attachment: kwsa-mapp:africa-south1:kwsa-postgres
  - DATABASE_URL secret: DATABASE_URL:3
  - Current DB target name: kwsa_uat
- kwsa-public-api-uat:
  - Region: africa-south1
  - Cloud SQL attachment: none
  - DATABASE_URL secret: kwsa-public-api-db-url:latest
  - Current DB target name: kwsa_uat

## Backup Evidence
- Cloud SQL backup list query executed in read-only mode.
- Result returned by gcloud at time of run: empty list ([]).
- Evidence file: cloudsql-backups.json
- Interpretation: no backup records were returned in current operator context for kwsa-postgres at this time.

## Schema Export Evidence
Read-only export executed successfully against current target database kwsa_uat through local Cloud SQL Proxy.
- Schema-only dump file: kwsa_uat_schema.sql
- Column metadata file: kwsa_uat_columns.csv
- Column metadata rows exported: 1770

## Row Count Evidence
Read-only per-table row counts exported successfully against kwsa_uat.
- Row-count file: kwsa_uat_row_counts.csv
- Tables counted: 180

## Index / FK / Constraint / Extension Evidence
Read-only metadata exports executed successfully against kwsa_uat.
- Indexes file: kwsa_uat_indexes.csv
  - Rows exported: 374
- Constraints file: kwsa_uat_constraints.csv
  - Rows exported: 880
- Foreign keys file: kwsa_uat_foreign_keys.csv
  - Rows exported: 88
- Extensions file: kwsa_uat_extensions.csv
  - Rows exported: 3

## Evidence Files Created In This Run
- cloudrun-db-target-summary.json
- cloudrun-services-africa-south1.json
- cloudrun-services-us-central1.json
- cloudsql-backups.json
- cloudsql-databases.json
- kwsa_uat_columns.csv
- kwsa_uat_constraints.csv
- kwsa_uat_extensions.csv
- kwsa_uat_foreign_keys.csv
- kwsa_uat_indexes.csv
- kwsa_uat_row_counts.csv
- kwsa_uat_schema.sql
- local-db-target-raw.txt
- secret-backed-db-targets-masked.json
- BACKUP_AND_TARGET_VERIFICATION_REPORT.md

## Verification Outcome
Verified successfully:
- Active Git branch and commit checkpoint
- Current working tree state
- GCP project kwsa-mapp
- Cloud SQL instance kwsa-postgres
- Existing Cloud SQL databases
- kwsa_prod absence
- Cloud Run service inventory
- Secret-backed UAT DB target name
- Secret-backed prod DB target name
- Secret-backed public API UAT DB target name
- Schema export from current target DB kwsa_uat
- Row counts per table from kwsa_uat
- Index, constraint, foreign key, and extension metadata from kwsa_uat

## Remaining Blockers
- Current live local DATABASE_URL value could not be directly verified from the isolated clean worktree because backend/.env is absent in this worktree.
- Cloud SQL backup list returned no backup entries in current operator context; if backups are expected, this should be clarified before any cutover execution approval.
- Current prod secret-backed DB target is still kwsa_uat, not kwsa_prod.
- kwsa_prod still does not exist and must be created later under a later approval step.

## Recommended Next Approval Step
- Recommended next approval: Approval 3
- Purpose of Approval 3:
  - create and confirm kwsa_prod
  - verify intended final DB targets explicitly
  - keep all actions limited to database creation/confirmation and target preparation only
- Do not proceed to import, asset migration, environment switching, or production cutover before Approval 3 is completed and recorded.
