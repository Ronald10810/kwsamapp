# Phase 5 Promotion to kwsa_uat (Execution-Gated)

This folder contains the pre-approved, controlled Phase 5 promotion package.

Scope:
- Source: kwsa_import_staging data exposed in schema phase5_src
- Target: kwsa_uat schema migration
- Promotion method: controlled table-by-table delete-and-reload for approved migration tables only
- Stop on first error: enabled through ON_ERROR_STOP and transaction failure handling

## Files
- 00-pre-promotion-validation.sql
- 01-promote-staging-to-uat.sql
- 02-post-promotion-validation.sql
- run-phase5-promotion-to-uat.ps1
- ROLLBACK_COMMANDS.md

## Approved promotion tables
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions
- migration.id_map_market_centers
- migration.id_map_teams
- migration.id_map_associates
- migration.id_map_listings
- migration.listing_agents
- migration.listing_images
- migration.listing_marketing_urls
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections

## Preserve scope (must not be overwritten)
- All public.* objects
- rentals and related rental tables
- MAPP 2.0-only tables and custom feature tables
- migration tables not explicitly listed in approved promotion tables

## Exact execution command sequence (only after explicit Approval 13B execution authorization)
```powershell
Set-Location "c:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console-clean-snapshot"

# 1) Ensure branch and clean tree before execution
 git branch --show-current
 git rev-parse HEAD
 git status --short

# 2) Run wrapper (includes pre-validation, promotion, and post-validation)
powershell -NoProfile -ExecutionPolicy Bypass -File \
  "scripts/migration/phase5/run-phase5-promotion-to-uat.ps1" \
  -ProjectId "kwsa-mapp" \
  -InstanceName "kwsa-postgres" \
  -SourceDb "kwsa_import_staging" \
  -TargetDb "kwsa_uat" \
  -ProxyHost "127.0.0.1" \
  -ProxyPort 9470 \
  -BackupId "1778860105623" \
  -DbUrlSecret "kwsa-backend-test-db-url" \
  -RunId "approval-13b"
```

## Hard stop conditions
Do not proceed if any of the following are true:
- current_database() is not kwsa_uat in target session
- backup 1778860105623 is not SUCCESSFUL
- production/test/public API no longer map to expected target
- pre-promotion validation fails
- rollback owner and go/no-go owner are not explicitly assigned
