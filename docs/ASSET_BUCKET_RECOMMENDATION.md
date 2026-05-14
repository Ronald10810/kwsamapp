# ASSET_BUCKET_RECOMMENDATION

Date: 2026-05-13
Status: Recommendation only; no bucket changes executed.

## Recommendation
Use separate buckets per environment:
- kwsa-mapp-assets-uat
- kwsa-mapp-assets-prod

## Why this is preferred
- Cleaner IAM boundaries between UAT and prod.
- Safer rollbacks and forensic tracing.
- Lower accidental cross-environment writes.
- Independent lifecycle and retention policies.

## Prefix layout
For each bucket:
- listings/
- agents/
- documents/
- transactions/
- migration-runs/
  - run-001/
  - run-002/

## Object naming convention
- <asset_type>/<source_table>/<source_record_id>/<sha256_or_uuid>.<ext>

Example:
- listings/listing_images/123456/6f3a...c9.jpg

## Metadata tags to store per object
- source_system=azure
- source_table
- source_record_id
- source_field_name
- migration_run_id
- checksum
- migrated_at

## Database linkage rule
For each migrated asset row, store:
- azure_blob_url (original)
- gcp_storage_url (new)
- migration status + timestamps

## Note
Current backend config already references GCS bucket usage for uploads; this plan addresses bulk historical asset migration and dual-URL traceability.
