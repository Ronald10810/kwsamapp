# PRE_IMPORT_BACKUP_BASELINE_REPORT

Date: 2026-05-14 15:28:32
Approval scope: Approval 4 only (pre-import backup/export baseline)
Mode: Backup/export baseline only; no import, no env/secret changes, no cutover changes

## Git Checkpoint
- Git branch: clean-source-snapshot-before-db-cutover
- Git commit: 54ae20e27e802339c2fd64b1c8e3198fced43a7c
- Working tree before: clean
- Working tree after: dirty (expected; evidence and doc updates only)

## GCP Context
- GCP project: kwsa-mapp
- Cloud SQL instance: kwsa-postgres

## Database List Before Backup/Export
- postgres
- kwsa
- kwsa_parallel
- kwsa_uat
- kwsa_public
- kwsa_prod

## kwsa_prod Confirmation
- kwsa_prod exists and was included in baseline exports.

## Backup/Export Method Used
1. On-demand Cloud SQL backup (instance-level):
   - Command: gcloud sql backups create --instance=kwsa-postgres
   - Backup id: 1778765132025
   - Type: ON_DEMAND
   - Status: SUCCESSFUL
2. Read-only metadata/schema exports through Cloud SQL Proxy on localhost:9470 using PostgreSQL 18 client containers.
3. Data baseline evidence exported as row-count snapshots per table for each in-scope database.

## Backup/Export Files Created
- cloudsql-databases-before.json
- cloudsql-databases-after-export.json
- cloudsql-backups-before-create.txt
- cloudsql-backup-create-output.txt
- cloudsql-backups-after-create.json
- gcs-buckets.json
- export-context-masked.csv
- export-command-log.csv
- kwsa_uat_schema.sql
- kwsa_uat_columns.csv
- kwsa_uat_row_counts.csv
- kwsa_uat_indexes.csv
- kwsa_uat_constraints.csv
- kwsa_uat_foreign_keys.csv
- kwsa_uat_extensions.csv
- kwsa_prod_schema.sql
- kwsa_prod_columns.csv
- kwsa_prod_row_counts.csv
- kwsa_prod_indexes.csv
- kwsa_prod_constraints.csv
- kwsa_prod_foreign_keys.csv
- kwsa_prod_extensions.csv
- kwsa_public_schema.sql
- kwsa_public_columns.csv
- kwsa_public_row_counts.csv
- kwsa_public_indexes.csv
- kwsa_public_constraints.csv
- kwsa_public_foreign_keys.csv
- kwsa_public_extensions.csv
- kwsa_columns.csv
- kwsa_row_counts.csv
- kwsa_indexes.csv
- kwsa_constraints.csv
- kwsa_foreign_keys.csv
- kwsa_extensions.csv

## Row Count / Schema Evidence
- Row counts exported for kwsa_uat, kwsa_prod, kwsa_public, kwsa.
- Schema dumps exported for kwsa_uat, kwsa_prod, kwsa_public.
- Column-level schema evidence exported for kwsa_uat, kwsa_prod, kwsa_public, kwsa.
- Indexes, constraints, foreign keys, and extensions exported for all in-scope DBs.

## Backup/Export Blockers
- kwsa full schema dump failed due table lock permission limits for current DB user (migration/public tables).
- Mitigation applied: captured kwsa column-level schema evidence plus row counts/index/constraint/FK/extension metadata.
- This blocker does not alter data and does not affect the successful Cloud SQL backup creation.

## GCS Bucket Notes
- Existing buckets were captured in gcs-buckets.json.
- No GCS SQL export bucket was used in this approval because baseline was completed with:
  - successful Cloud SQL on-demand backup
  - local read-only metadata exports via proxy
- No new bucket was created.

## Safety Confirmations
- No Azure import was run.
- No data was copied into any database.
- No Cloud Run environment variable was changed.
- No secret was changed.
- Production was not changed.
- Current secret-backed target DB names remain:
  - prod -> kwsa_uat
  - UAT -> kwsa_uat
  - public API UAT -> kwsa_uat

## Required Next Approval Step
- Approval 5: validation fixes and schema/data mapping preparation only (still no production switch until later explicit approval).
