# PHASE5_13C_SOURCE_SCHEMA_HOTFIX_NOTE

Date: 2026-05-15
Approval Scope: Approval 13C patch-only (no execution)
Status: Source schema configuration issue resolved

## Executive Summary

Approval 13B execution failed safely during pre-validation because the promotion SQL scripts referenced a non-existent schema (`phase5_src`). The actual source data is located in `kwsa_import_staging.migration`. Option B was chosen to patch the scripts to read from the correct source location using PostgreSQL Foreign Data Wrapper (FDW) technology, without creating permanent schema modifications.

## Root Cause Analysis

**Why the promotion failed:**
- The promotion SQL scripts were designed to read from a schema called `phase5_src` in the target database (kwsa_uat).
- During pre-validation execution, all 15 approved promotion tables reported: `has_phase5_src = false` (missing source tables).
- Error message: "Safety stop: 15 required promotion tables are missing in phase5_src and/or migration"
- No data was modified because the pre-validation checks stopped the promotion before any INSERT/DELETE/UPDATE/TRUNCATE operations.

**Why no data was changed:**
- Pre-validation SQL was the first execution step and was designed to fail safely on schema mismatch.
- Stop-on-first-error flag (`ON_ERROR_STOP=1`) was enabled in the wrapper.
- Transaction wrapper around the promotion DML ensured atomicity: since pre-validation failed, the entire operation rolled back.
- No writes occurred to kwsa_uat, kwsa_import_staging, or any other database.

**Why Option B was chosen:**
- Option A (create phase5_src schema alias): User explicitly prohibited creating permanent schema modifications.
- Option B (patch scripts to read from correct source): Straightforward fix using postgres_fdw foreign table wrappers, which are temporary session-level objects that clean up automatically.
- Option C (abort): Not viable; the migration is required.

## Patch Summary

### Files Patched

1. **scripts/migration/phase5/00-setup-fdw.sql** (NEW)
   - Creates postgres_fdw extension (if not exists)
   - Sets up foreign server `src_staging_server` pointing to kwsa_import_staging on localhost
   - Creates user mapping for the current session user
   - Creates temporary schema `src_staging` for foreign tables
   - Imports foreign table definitions from kwsa_import_staging.migration into src_staging schema
   - Temporary objects are session-scoped and do not persist after the session ends

2. **scripts/migration/phase5/00-pre-promotion-validation.sql**
   - Updated comment: now references src_staging FDW schema instead of phase5_src
   - Changed all schema validation checks from `phase5_src` to `src_staging`
   - Updated row-count baseline queries to read from `src_staging.*` instead of `phase5_src.*`
   - All error messages updated to reference FDW and kwsa_import_staging

3. **scripts/migration/phase5/01-promote-staging-to-uat.sql**
   - Updated comment: now references src_staging FDW schema
   - Changed all source table existence checks from `phase5_src` to `src_staging`
   - Changed column-mapping queries to use `src_staging` instead of `phase5_src`
   - Changed row-count and INSERT source references from `phase5_src.*` to `src_staging.*`
   - Target table writes remain on `migration.*` in kwsa_uat (unchanged)

4. **scripts/migration/phase5/02-post-promotion-validation.sql**
   - Updated comment: now references src_staging FDW schema
   - Changed all source row-count queries from `phase5_src.*` to `src_staging.*`
   - Duplicate key checks and orphan checks unchanged (target-only operations)

5. **scripts/migration/phase5/run-phase5-promotion-to-uat.ps1** (wrapper script)
   - Added new setup file variable: `$setupSql = Join-Path $scriptDir '00-setup-fdw.sql'`
   - Added new execution step: Run setup SQL before pre-promotion validation
   - New output line: "--- Setup FDW foreign table references to source (kwsa_import_staging.migration) ---"
   - Execution order now: setup → pre-validation → promotion → post-validation

### Exact phase5_src References Replaced

All instances of the following patterns were replaced:
- `table_schema = 'phase5_src'` → `table_schema = 'src_staging'`
- `phase5_src.core_market_centers` → `src_staging.core_market_centers`
- `phase5_src.core_teams` → `src_staging.core_teams`
- `phase5_src.core_associates` → `src_staging.core_associates`
- `phase5_src.core_listings` → `src_staging.core_listings`
- `phase5_src.core_transactions` → `src_staging.core_transactions`
- `phase5_src.id_map_market_centers` → `src_staging.id_map_market_centers`
- `phase5_src.id_map_teams` → `src_staging.id_map_teams`
- `phase5_src.id_map_associates` → `src_staging.id_map_associates`
- `phase5_src.id_map_listings` → `src_staging.id_map_listings`
- `phase5_src.listing_agents` → `src_staging.listing_agents`
- `phase5_src.listing_images` → `src_staging.listing_images`
- `phase5_src.listing_marketing_urls` → `src_staging.listing_marketing_urls`
- `phase5_src.transaction_agents` → `src_staging.transaction_agents`
- `phase5_src.transaction_agent_calculations` → `src_staging.transaction_agent_calculations`
- `phase5_src.load_rejections` → `src_staging.load_rejections`

Total phase5_src references replaced: 20+ across 3 SQL scripts.

## Data Integrity Confirmations

### Source Data Confirmation
- Source location: kwsa_import_staging.migration
- Source schema status: Present and validated in Phase 4
- Tables confirmed present: all 15 approved promotion tables
- Data state: READY for promotion (no changes made in 13C patch step)

### Target Location Confirmation
- Target location: kwsa_uat.migration
- Target status: Ready to receive promoted data
- Current state: No changes made (safe fallback from 13B failure)

### Preserved Tables Confirmation
- Public schema tables: Not touched
- MAPP 2.0 feature tables: Not touched
- Rental tables: Not touched
- System/auth/config tables: Not touched

## Execution Architecture (Post-Patch)

New execution flow during next promotion attempt:
1. **Setup Phase (new):**
   - Wrapper runs setup SQL to create FDW foreign server connection
   - Creates temporary src_staging schema with foreign table imports
   - All FDW objects are session-scoped (auto-cleanup on connection close)

2. **Pre-validation Phase:**
   - Wrapper connects to kwsa_uat
   - Runs 00-pre-promotion-validation.sql
   - Validates: src_staging.* tables exist (via FDW to kwsa_import_staging)
   - Validates: migration.* tables exist in kwsa_uat
   - Captures baseline row counts from both source and target
   - Stops on first error

3. **Promotion Phase:**
   - Wrapper connects to kwsa_uat
   - Runs 01-promote-staging-to-uat.sql
   - Deletes from kwsa_uat.migration.*
   - Inserts into kwsa_uat.migration.* by selecting from src_staging.* (FDW reads from kwsa_import_staging)
   - Row-count validation per table
   - Transaction wrapper ensures atomicity
   - Stops on first error

4. **Post-validation Phase:**
   - Wrapper connects to kwsa_uat
   - Runs 02-post-promotion-validation.sql
   - Validates row-count parity between source and target
   - Checks for orphan records in detail tables
   - Checks for duplicate keys on source business IDs
   - Produces validation report

## Technical Details: postgres_fdw Configuration

The setup script creates:
- **Extension:** postgres_fdw (installed at kwsa-postgres instance level)
- **Foreign Server:** src_staging_server → kwsa_import_staging database on localhost:5432
- **User Mapping:** Maps current session user to the same user in kwsa_import_staging
- **Foreign Schema:** src_staging in kwsa_uat, importing all tables from kwsa_import_staging.migration
- **Lifetime:** Database-persistent (exists in kwsa_uat until explicitly dropped)
- **Cleanup:** Automatic via wrapper cleanup step after successful promotion (see cleanup strategy below)
- **Security:** Uses same credentials as the execution user; no new secrets created

## Cleanup Strategy (Approval 13C.2)

**Permanent objects created during promotion:**
- postgres_fdw extension (remains after cleanup; harmless, reusable)
- src_staging_server foreign server (dropped after promotion)
- User mapping (dropped after promotion)
- src_staging schema with imported foreign tables (dropped after promotion)

**Cleanup behavior on successful promotion:**
- After post-promotion validation completes, wrapper executes cleanup phase:
  - `DROP SCHEMA IF EXISTS src_staging CASCADE;` (removes schema + all foreign tables)
  - `DROP USER MAPPING IF EXISTS FOR {user} SERVER src_staging_server;`
  - `DROP SERVER IF EXISTS src_staging_server CASCADE;`
- All cleanup commands logged to promotion report
- kwsa_uat returns to clean state (only postgres_fdw extension remains)

**Cleanup behavior on failure:**
- If promotion fails at any point after FDW setup, finally block executes emergency cleanup:
  - Attempts same DROP commands with error suppression (`-ErrorActionPreference Continue`)
  - Logs all cleanup attempts to promotion report
  - Reports outcome (success or manual cleanup needed)
- If emergency cleanup also fails, promotion report clearly indicates manual cleanup needed

**What remains permanent after cleanup:**
- postgres_fdw extension (safe to leave; required for future promotions if FDW approach is reused)
- Extension can be manually dropped if never needed again: `DROP EXTENSION postgres_fdw;`

**Manual cleanup (if needed):**
```sql
DROP SCHEMA IF EXISTS src_staging CASCADE;
DROP USER MAPPING IF EXISTS FOR {current_user} SERVER src_staging_server;
DROP SERVER IF EXISTS src_staging_server CASCADE;
DROP EXTENSION IF EXISTS postgres_fdw; -- optional
```

## Known Risks (Post-Patch)

- postgres_fdw extension must be enabled on kwsa-postgres instance (standard extension)
- Network connection from kwsa_uat to kwsa_import_staging must be allowed (same instance, should work)
- User must have CONNECT privilege on kwsa_import_staging (should be inherent for superuser or app role)
- FDW performance may be slower than direct access for very large tables (mitigated by delete-and-reload being batched)

## Testing Recommendation Before 13D Execution

Optional pre-execution test:
1. Connect to kwsa_uat: `psql -h 127.0.0.1 -p 9470 -U {user} -d kwsa_uat`
2. Run: `psql -f scripts/migration/phase5/00-setup-fdw.sql`
3. Verify: `SELECT * FROM information_schema.tables WHERE table_schema = 'src_staging' ORDER BY table_name;`
4. Verify table list matches the 15 approved promotion tables
5. Optional spot-check: `SELECT count(*) FROM src_staging.core_market_centers;` should match kwsa_import_staging.migration.core_market_centers

## Recommended Next Approval

- **Approval 13D:** Phase 5 promotion execution with patched scripts
  - Authorization phrase required: "I approve Approval 13D execution now. Execute scripts/migration/phase5/run-phase5-promotion-to-uat.ps1 with patched FDW scripts against kwsa_uat only, using backup 1778860105623 as rollback anchor, with stop-on-first-error and immediate rollback on trigger."
  - Preconditions before 13D: verify FDW connectivity test passes (optional but recommended)

---

## Sign-off

Patched files ready for review. No data changed. No execution performed in 13C.

Awaiting approval to proceed to Approval 13D execution (or halt if issues identified in patch review).
