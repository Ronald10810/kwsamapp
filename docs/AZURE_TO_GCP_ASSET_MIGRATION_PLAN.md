# AZURE_TO_GCP_ASSET_MIGRATION_PLAN

Date: 2026-05-13
Status: Planning only.

## Scope
Migrate Azure Blob-based image/document URLs to Google Cloud Storage while retaining original Azure URLs for rollback and audit.

## Current Findings
- Azure blob URLs are heavily present in imported listing datasets (kwsadocuments.blob.core.windows.net/devblob/... observed in backend/data/incoming/listings.csv).
- Current PostgreSQL URL-bearing counts snapshot (kwsa database):
  - documents.url: 2,826,651
  - listing_images.documentId references: 2,489,338
  - transaction_documents.documentId references: 80,599
  - listing_marketing_urls.url: 9,883
- Current backend upload service supports GCS upload generation, but no bulk Azure->GCS migration pipeline/job exists yet.

## Required Data Model (Tracking)
Proposed tables (naming aligned to existing snake_case style):
- migration_runs
  - id, run_name, source_system, started_at, completed_at, status, notes
- migration_file_assets
  - id, source_table, source_record_id, source_field_name, asset_type,
  - azure_blob_url, gcp_storage_url, migration_run_id,
  - migration_status, migrated_at, error_message,
  - file_size, checksum, retry_count, created_at, updated_at
- migration_validation_results
  - id, migration_run_id, validation_type, table_name,
  - expected_count, actual_count, difference, status, notes, created_at

## Execution Architecture
Preferred: Cloud Run Job
- Runs server-side in GCP (not laptop-bound).
- Configurable modes:
  - dry-run
  - run
  - retry-failed
  - new-only
- Configurable batch size and limits.
- Idempotent by checking migration_file_assets status before processing.

Alternative: temporary Compute Engine VM (only if Cloud Run Job constraints require it).

## URL Retention Rule (Mandatory)
For each migrated asset:
- Keep original Azure URL unchanged.
- Store new GCS URL alongside it.
- Never destructively replace source URL without traceability.

## Bucket Recommendation
Recommended: separate buckets per environment
- kwsa-mapp-assets-uat
- kwsa-mapp-assets-prod

Rationale:
- Strong environment isolation
- Easier IAM boundaries
- Lower blast radius
- Cleaner lifecycle/retention policies

Suggested prefix structure in each bucket:
- listings/
- agents/
- documents/
- transactions/
- migration-runs/

## Planned Report Output
Future run report file:
- docs/ASSET_MIGRATION_REPORT_RUN_001.md

Must include:
- total found
- already migrated
- newly migrated
- skipped
- failed
- by asset type
- failed list with reason
- sample records with azure+gcs URL side-by-side

## Risks
- Large volume (millions of assets) can exceed local execution capacity.
- Duplicate processing without state tracking.
- Broken foreign linkages if source-table mapping is not explicit.

## Mitigations
- Use migration_file_assets state machine.
- Process in deterministic batches.
- Persist checkpoints per run.
- Validate per-table linkage after each batch.
