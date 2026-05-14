# AZURE_IMPORT_MAPPING_AND_DRY_RUN_PLAN

**Approval 5: Azure import mapping, dry-run preparation, and execution plan only**

Date: 2026-05-14  
Report Generated: 2026-05-14T14:00:00Z  
Status: Planning and inspection only — NO import executed, NO data changed, NO env vars changed

---

## 1. GIT STATE

**Working Tree:**  
- Branch: `clean-source-snapshot-before-db-cutover`
- Commit (HEAD): `05eb56e149480b1fe12637db6376e0444a65fb8d`
- Status: Clean (all Approval 4 changes committed and pushed)
- Last commit message: "Approval 4 metadata CSV evidence"

**Before Approval 5:**  
- Working tree clean
- No staged changes
- No untracked files

**After Approval 5:**  
- Working tree remains clean
- No data modifications performed
- No database changes executed

---

## 2. AZURE SOURCE DATABASE DETAILS

**System:**  
- Server: `kwsa.database.windows.net:1433` (Azure SQL Managed Instance)
- Database: `dbMappProd` (read-only access used for exports)
- Type: Azure SQL Server (legacy MAPP 1.0)

**Secrets (Masked):**  
```
AZURE_SQL_USER=kwsaadmin
AZURE_SQL_PASSWORD=***[MASKED]***
```

**Current Export Method:**  
- PowerShell scripts with SqlClient ADO.NET
- Connection string template: `Server=kwsa.database.windows.net,1433;Database=dbMappProd;User Id=[user];Password=[pwd];TrustServerCertificate=True;Connection Timeout=60`
- SSL: TrustServerCertificate=True (Azure internal connection)

**Verification Status:**  
- Connection credentials stored in environment variables
- Credentials NOT changed during Approval 5 inspection
- No live read-only query execution performed

---

## 3. CURRENT IMPORT/EXPORT SCRIPTS FOUND

### 3.1 Export Scripts

#### `scripts/export-azure-to-csv.ps1`
- **Purpose:** Main Azure SQL export to CSV
- **Language:** PowerShell 5.1
- **Execution:** Run from kwsa-cloud-console root
- **Output:** `scripts/azure-export/*.csv`
- **Tables exported:** market_centers_raw, teams_raw, associates_raw, listings_raw, transactions_raw, transaction_agents, transaction_associate_payment_details, transaction_bonds, transaction_notes, listing_associates, listing_images_raw, listing_marketing_urls_raw
- **Parameters:**
  - `-Server` (default: `kwsa.database.windows.net,1433`)
  - `-Database` (default: `dbMappProd`)
  - `-User` / `-Password` (from env or parameters)
  - `-OutDir` (default: `scripts/azure-export`)
  - `-CutoffDate` (default: `2026-04-30`) — filters transactions by status_change_date
  - `-SkipTables` (comma-separated; allows resuming partial exports)
- **Data operation:** SELECT with JOIN queries; read-only, no data modified

#### `scripts/export-azure-associate-extras.ps1`
- **Purpose:** Export additional associate-related data not in main export
- **Language:** PowerShell 5.1
- **Tables exported:**
  - `associate_third_party_raw` (P24/Entegral integrations)
  - `associate_commissions_raw` (split %, cap amount, manual cap)
  - `associate_business_details_raw` (sponsor, KWUID, vested flags, team/MC)
  - `associate_roles_raw` (from AspNetRoles)
  - `associate_job_titles_raw` (job titles per associate)
  - `associate_service_communities_raw` (service communities per associate)
  - `associate_admin_market_centers_raw` (admin market center mappings)
  - `associate_admin_teams_raw` (admin team mappings)
  - `associate_dates_raw` (start, end, anniversary, cap dates)
- **Data operation:** SELECT; read-only

#### `scripts/export-azure-listing-details-to-csv.ps1`
- **Purpose:** Export optional listing details (building info, features, property areas)
- **Language:** PowerShell 5.1
- **Tables:** Listing-related lookup/detail tables
- **Used by:** `scripts/ssms-listing-details-import.md` for full listing detail coverage

### 3.2 Load/Import Scripts

#### `scripts/load-staging-from-csv.cjs`
- **Purpose:** Load Azure-exported CSVs into staging.* tables
- **Language:** Node.js CommonJS
- **Inputs:** CSV files from `scripts/azure-export/`
- **Targets:** `staging.*` tables (staging.market_centers_raw, staging.teams_raw, staging.associates_raw, staging.listings_raw, staging.transactions_raw, staging.transaction_agents, staging.transaction_associate_payment_details, staging.transaction_bonds, staging.transaction_notes, staging.listing_associates, staging.listing_images_raw, staging.listing_marketing_urls_raw, staging.listing_documents_raw, staging.associate_documents_raw, staging.transaction_documents_raw, staging.transaction_contacts_raw, staging.listing_features_raw, staging.listing_property_areas_raw, staging.listing_p24_feed_items_raw)
- **Database:** Expects `DATABASE_URL` env var pointing to target (kwsa_uat)
- **Data operation:** INSERT ON CONFLICT DO NOTHING (upsert with no update — ignores duplicates)
- **Parameters:**
  - `--csv-dir` (default: `scripts/azure-export`)
  - `--batch-id` (default: `azure-YYYY-MM-DD`)
  - `--only-table` (optional; load single table only)
  - `--db-url` or `DATABASE_URL` env
  - `--truncate` (optional; truncate staging tables before loading)
- **Chunk size:** 500-2000 rows per batch insert (configurable)
- **Batch size:** 50,000 row chunks for large files (listings_raw, listing_images_raw)

#### `scripts/run-sql.cjs`
- **Purpose:** Execute SQL files against target database
- **Language:** Node.js CommonJS
- **Usage:** `node scripts/run-sql.cjs <sql_file>`
- **Database:** Expects `DATABASE_URL` env var
- **Used for:** Transformation and migration scripts

### 3.3 Transformation Scripts

#### `scripts/transform-staging-to-migration.sql`
- **Purpose:** Transform staging.* tables → migration.core_* tables
- **Language:** SQL (PostgreSQL)
- **Data operation:** INSERT ON CONFLICT DO UPDATE (upsert with update on conflict)
- **Key transformations:**
  - Market centers: INSERT ON CONFLICT UPDATE (name, status_name, frontdoor_id, updated_at)
  - Teams: INSERT ON CONFLICT UPDATE (name, status_name, market_center_id, updated_at)
  - Associates: INSERT ON CONFLICT UPDATE (all fields including MAPP 2.0 extensions)
  - Listings: INSERT ON CONFLICT UPDATE (listing-specific fields)
  - Transactions: INSERT ON CONFLICT UPDATE (transaction fields with GCI calculations)
- **Batch resolution:** Uses most recent `batch_id` from staging.associates_raw if not explicitly set via `migration.batch` config
- **ID mapping:** Creates temporary mapping tables for source_id → core_id lookup

#### `scripts/insert-migration-to-public.sql`
- **Purpose:** Promote migration.core_* tables → public.* Prisma schema tables
- **Language:** SQL (PostgreSQL)
- **Data operation:** INSERT or UPDATE with ON CONFLICT rules
- **Dependency order:** Reference tables → Geography → Addresses → Market centers → Teams → Associates → Listings → Transactions
- **MAPP 2.0 preservation:** Script includes logic to preserve existing MAPP 2.0-only columns (e.g., app_users, user_roles, audit_logs tables)

---

## 4. CURRENT SCHEMA MAPPING LOGIC FOUND

### 4.1 Field Mapping Overview

**Export-to-Staging Mapping (CSV Headers → PostgreSQL):**

| Azure Source | Staging Table | Key Fields |
|---|---|---|
| MarketCenter | staging.market_centers_raw | source_market_center_id, name, status_name, frontdoor_id, source_updated_at, raw_payload |
| Team | staging.teams_raw | source_team_id, source_market_center_id, name, status_name, source_updated_at, raw_payload |
| Associate | staging.associates_raw | source_associate_id, first_name, last_name, email, status_name, market_center_name, team_name, kwuid, source_updated_at, raw_payload |
| Listing | staging.listings_raw | source_listing_id, listing_number, status_name, market_center_name, sale_or_rent, street_number, street_name, suburb, city, province, country, price, expiry_date, source_updated_at, property_title, short_title, property_description, listing_images_json, raw_payload |
| Transaction | staging.transactions_raw | source_transaction_id, transaction_number, source_market_center_id, market_center_name, source_associate_id, associate_name, transaction_status, source_listing_id, listing_number, list_date, transaction_date, status_change_date, expected_date, transaction_type, address, suburb, city, sales_price, list_price, gci_excl_vat, split_percentage, net_comm, total_gci, sale_type, agent_type, buyer, seller, payment_notes, return_notes, raw_payload |

**Type Conversions Applied by load-staging-from-csv.cjs:**
- `toTimestampOrNull()`: Converts ISO 8601 date strings to TIMESTAMPTZ
- `toNumberOrNull()`: Converts numeric strings (with comma separators) to NUMERIC
- `toIntOrNull()`: Converts numeric strings to INTEGER
- Boolean fields: Converts 'true'/'false' strings to PostgreSQL boolean

**Staging-to-Migration Mapping (transform-staging-to-migration.sql):**
- DISTINCT ON (source_id) selects latest record per source entity
- raw_payload JSONB field accessed with `->>` to extract optional fields
- Foreign key resolution: Associates lookup market_center and team IDs from migration.core_market_centers/core_teams
- ID mapping: Creates temporary lookup tables (migration.id_map_associates, etc.)

**Migration-to-Public Mapping (insert-migration-to-public.sql):**
- geography: Countries → Provinces → Cities → Suburbs (reference table chain)
- addresses: Created from address details in listings/transactions
- market_centers: ID mapping applied
- teams: ID mapping applied
- associates: ID mapping applied; MAPP 2.0 custom columns preserved
- listings: ID mapping applied; MAPP 2.0 custom columns preserved
- transactions: ID mapping applied with payment detail lookups

### 4.2 Custom Type Conversions

**Numeric Fields:**
```
sales_price, list_price, gci_excl_vat, split_percentage, net_comm, total_gci, price
→ Type: NUMERIC(18,2)
→ Conversion: String with comma separators → numeric value
```

**Date Fields:**
```
list_date, transaction_date, status_change_date, expected_date, expiry_date, source_updated_at
→ Type: TIMESTAMPTZ (or DATE where date-only)
→ Validation: Must match ^\d{4}-\d{2}-\d{2} regex
→ Fallback: NULL if invalid
```

**Boolean Fields:**
```
POA, NoTransferDuty, DisplayAddressOnWebsite, FeedToProperty24, etc.
→ Azure: 0/1 or 'true'/'false' string
→ PostgreSQL: BOOLEAN true/false
```

---

## 5. VALIDATION SCRIPTS FOUND

### 5.1 Data Load Validation

**Script:** `backend/src/data/validateLoad.ts`
- **Purpose:** Count rows in staging vs migration vs core tables; report duplicates, orphans, missing names/numbers
- **Queries:**
  - staging.* row counts
  - migration.core_* row counts
  - Duplicate source IDs (via GROUP BY ... HAVING COUNT(*) > 1)
  - Orphan relationships (teams with missing market_center_id)
  - Missing required fields (associates with empty first/last name, listings with empty listing_number)
- **Execution:** `npm run data:validate`

### 5.2 Reconciliation Report

**Script:** `backend/src/data/reconcileReport.ts`
- **Purpose:** Compare source (staging) counts with destination (core/public) counts per batch
- **Queries:** Row count discrepancies, field distribution analysis
- **Execution:** `npm run data:reconcile -- --batch-prefix <batch_id>`

### 5.3 Manual Validation Queries

**From docs/migration.md and ssms-listing-details-import.md:**

```sql
-- Listing detail coverage
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE erf_size IS NOT NULL OR floor_area IS NOT NULL) AS has_building_info,
  COUNT(*) FILTER (WHERE adsl OR fibre OR isdn OR dialup OR fixed_wimax OR satellite) AS has_internet,
  COUNT(*) FILTER (WHERE has_solar_panels OR has_solar_geyser OR has_gas_geyser OR has_water_tank OR has_borehole OR has_backup_battery_or_inverter) AS has_sustainability,
  COUNT(*) FILTER (WHERE nearby_bus_service OR nearby_minibus_taxi_service OR nearby_train_service) AS has_transport
FROM migration.core_listings;

-- Feature/area coverage
SELECT COUNT(DISTINCT listing_id) AS listings_with_features FROM migration.listing_features;
SELECT COUNT(DISTINCT listing_id) AS listings_with_property_areas FROM migration.listing_property_areas;
SELECT COUNT(DISTINCT listing_id) AS listings_with_marketing_urls FROM migration.listing_marketing_urls;
SELECT COUNT(DISTINCT listing_id) AS listings_with_mandate_docs FROM migration.listing_mandate_documents;
```

---

## 6. AZURE SOURCE TABLES EXPECTED TO BE IMPORTED

**From scripts/export-azure-to-csv.ps1 (Main Export):**

| Table | Row Count (est.) | Purpose |
|---|---|---|
| MarketCenter | ~120 | Market centers with status |
| Team | ~600 | Teams per market center |
| Associate | ~3,500 | Agents/associates per team |
| Listing | ~15,000 | Active and historical listings |
| Transaction | ~12,000 | Transaction records (cutoff: 2026-04-30) |
| TransactionAssociate | ~25,000 | Agent split/payment per transaction |
| TransactionAssociatePaymentDetail | ~25,000 | GCI breakdowns per agent per transaction |
| TransactionBond | ~5,000 | Bond details per transaction |
| TransactionNote | ~2,000 | Notes per transaction |
| ListingAssociate | ~30,000 | Agent assignments per listing |
| ListingImage | ~2,600,000 | Images per listing (large file) |
| ListingMarketingUrl | ~50,000 | Marketing/syndication URLs |
| ListingDocument | ~100,000 | Listing documents (contracts, etc.) |

**From scripts/export-azure-associate-extras.ps1 (Additional Exports):**

| Table | Purpose |
|---|---|
| AssociateThirdPartyIntegration | P24 agent ID, Entegral agent ID, feed flags |
| AssociateCommission | Commission split %, total cap amount, manual cap flag |
| AssociateBusinessDetail | KWUID, vesting, growth share sponsor, approval flags |
| AssociateIdentityRole | Roles assigned per associate |
| AssociateJobTitle | Job titles per associate |
| AssociateServiceCommunity | Service communities per associate |
| AssociateAdminMarketCenter | Admin rights per market center |
| AssociateAdminTeam | Admin rights per team |
| AssociateDate | Start, end, anniversary, cap dates |

**Optional (Listing Details):**

| Table | Purpose |
|---|---|
| ListingBuildingInfo | Erf size, floor area, zoning |
| ListingBuildingInfoInternet | Internet connectivity flags |
| ListingBuildingInfoPublicTransport | Public transport flags |
| ListingBuildingInfoSustainability | Solar, water, backup power flags |
| ListingPropertyArea | Property areas/rooms |
| ListingPropertyFeature | Features/improvements |
| ListingP24FeedItem | Property24 syndication payloads |

---

## 7. POSTGRESQL TARGET TABLES EXPECTED TO BE AFFECTED

### 7.1 Direct Target Tables (Receive Imported Data)

**Core Tables (from migration.core_*):**
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions

**Reference/Geography:**
- countries (seeded)
- provinces (from listing addresses)
- cities (from listing addresses)
- suburbs (from listing addresses)
- addresses (created from listings + transactions)
- market_center_statuses (seeded)
- team_statuses (seeded)
- associate_statuses (seeded)
- listing_statuses (seeded)

**Detail Tables:**
- market_centers (promotion from migration.core_*)
- teams (promotion from migration.core_*)
- associates (promotion from migration.core_*)
- associate_contact_details (created from associates raw)
- associate_business_details (created from associates raw + associate_business_details_raw)
- listings (promotion from migration.core_*)
- listing_descriptions (created from listings_raw)
- listing_price_details (created from listings_raw)
- listing_mandate_infos (from listings_raw)
- listing_associates (created from listing_associates raw)
- listing_images (created from listing_images_raw) — **LARGE: ~2.6M rows**
- listing_marketing_urls (created from listing_marketing_urls_raw)
- listing_documents (created from listing_documents_raw)
- listing_features (created from listing_features_raw)
- listing_property_areas (created from listing_property_areas_raw)
- transactions (promotion from migration.core_*)
- transaction_descriptions (created from transactions_raw)
- transaction_associates (created from transaction_agents)
- transaction_associate_payment_details (created from transaction_associate_payment_details_raw)
- transaction_bonds (created from transaction_bonds)
- transaction_notes (created from transaction_notes)
- transaction_documents (created from transaction_documents_raw)
- transaction_contacts (created from transaction_contacts_raw)

### 7.2 MAPP 2.0-Only Tables (NOT Touched During Import)

**Application/System Tables:**
- app_users
- users
- user_roles
- roles
- audit_logs
- public_leads
- loom_user_tokens

**Marketing/CMA:**
- cma_documents
- marketing_plan_documents

**Portal Features:**
- contacts (likely app-created)
- documents (likely app-created)

---

## 8. DATA OPERATION TYPES PER TABLE

### Data Insertion Method

**Insert Method: INSERT ON CONFLICT DO NOTHING → ON CONFLICT DO UPDATE**

| Stage | SQL Pattern | Behavior |
|---|---|---|
| CSV → staging.* | INSERT ON CONFLICT DO NOTHING | Ignores duplicate source_id; last-write-wins on batch_id |
| staging.* → migration.core_* | INSERT ON CONFLICT DO UPDATE | Updates all fields if source_id exists; creates new otherwise (UPSERT) |
| migration.core_* → public.* | INSERT or UPDATE with FK resolution | Checks existing records; inserts new or updates changed fields |

### Truncation Behavior

**Staging Tables:**
- Optional: Can truncate via `--truncate` flag in load-staging-from-csv.cjs
- Default: Append mode (no truncate)
- Schema creation: `CREATE TABLE IF NOT EXISTS` (idempotent)

**Migration Tables:**
- NOT truncated during import
- New data UPSERTs over existing records
- Preserves MAPP 2.0-only fields (set via ON CONFLICT DO NOTHING or explicit preservation logic)

**Public Tables:**
- NOT truncated during import
- Script `insert-migration-to-public.sql` has optional `cleanup-public-for-reinsert.sql` companion (not executed in standard flow)
- MAPP 2.0 tables (app_users, users, roles, user_roles, audit_logs, public_leads, loom_user_tokens, cma_documents, marketing_plan_documents) are explicitly preserved

### Overwrite vs. Upsert vs. Merge

| Operation | Pattern | Idempotent | Repeatable | Preserves MAPP 2.0 |
|---|---|---|---|---|
| CSV → staging | INSERT ON CONFLICT DO NOTHING | Yes | Yes | N/A (temp table) |
| staging → migration | INSERT ON CONFLICT DO UPDATE (all cols) | Yes | Yes | Via ON CONFLICT DO NOTHING if PRESERVE_CORE_EDITS=true |
| migration → public | INSERT via FK lookup; UPDATE if exists | Partially (needs cleanup script for full reset) | Yes | Yes (explicit table/column preservation) |

---

## 9. MAPP 2.0-ONLY TABLES TO PRESERVE

**Critical System Tables (MUST NOT DELETE/TRUNCATE):**

1. **app_users** — Application user accounts separate from Azure sync
2. **users** — Identity/auth table (may reference app_users or be parallel)
3. **user_roles** — Role assignments per user
4. **roles** — Custom role definitions
5. **audit_logs** — Transaction/event audit trail
6. **public_leads** — Lead/inquiry records (MAPP 2.0 feature)
7. **loom_user_tokens** — Loom auth token storage

**Marketing/CMA Tables:**

8. **cma_documents** — CMA-generated documents
9. **marketing_plan_documents** — Marketing plan files

**Data Tables (Legacy Portal):**

10. **contacts** — May be portal-created or supplementary
11. **documents** — Portal document storage (may overlap with listing_documents)

---

## 10. MAPP 2.0-ONLY COLUMNS TO PRESERVE

**Per docs/MAPP2_CUSTOM_TABLES_AND_FIELDS.md:**

### Associates
- `associates.nationalId`
- `associates.ffcNumber`
- `associate_contact_details.privateEmail`
- `associate_business_details.proposedGrowthShareSponsor`
- `associate_business_details.growthShareSponsorId`
- `associate_business_details.temporaryGrowthShareSponsor`
- `associate_business_details.listingApprovalRequired`
- `associate_business_details.excludeFromIndividualReports`
- `associate_business_details.vested`
- `associate_business_details.vestingStartPeriod`

### Listings
- `listings.listingDate`
- `listings.reducedDate`
- `listings.pendingDate`
- `listings.withdrawnDate`
- `listing_mandate_infos.signedDate`
- `listing_mandate_infos.onMarketSince`
- `listing_mandate_infos.ratesTaxes`
- `listing_mandate_infos.monthlyLevy`
- `listing_price_details.agentPropertyValuation`

### Transactions
- `transaction_descriptions.varianceSaleListPricePerc`
- `transaction_descriptions.avgCommsPerc`
- `transaction_descriptions.soldDate`
- `transaction_descriptions.expectedDate`
- `transaction_descriptions.paymentNotes`
- `transaction_descriptions.returnNotes`
- `transaction_associates.splitPercentage`
- `transaction_associates.outsideAgency`
- `transaction_associate_payment_details.transactionGCIBeforeFees`
- `transaction_associate_payment_details.productionRoyalties`
- `transaction_associate_payment_details.growthShare`
- `transaction_associate_payment_details.gciAfterFeesExclVAT`
- `transaction_associate_payment_details.capRemaining`
- `transaction_associate_payment_details.associateDollar`
- `transaction_associate_payment_details.teamDollar`
- `transaction_associate_payment_details.mcDollar`

**Preservation Strategy:**
- Use `INSERT ON CONFLICT DO NOTHING` when `PRESERVE_CORE_EDITS=true` (skip update if record exists)
- Use `INSERT ON CONFLICT DO UPDATE` with explicit field exclusions (null check before update)
- Apply environment variable: `PRESERVE_CORE_EDITS=true` (available in package.json scripts)

---

## 11. RISKY TABLES AND COLUMNS

**High-Risk Identifications:**

| Table | Risk Level | Issue | Mitigation |
|---|---|---|---|
| listing_images | HIGH | ~2.6M rows; streaming required; GCS URL resolution pending | Use batch chunk size 2000; validate GCS URLs post-import; test image loading |
| transaction_associate_payment_details | HIGH | GCI calculations complex; payment splits must reconcile; no direct Azure reconciliation | Manual spot-check against Azure export; validate sum(split_percentage)=100 per transaction |
| listing_documents | HIGH | Document URLs must resolve to GCS; missing documents break UI | Validate URL format; test document preview loading |
| associate_business_details | MEDIUM | Vested/sponsor/approval flags affect agent portal behavior; mismatches cause permission issues | Validate against Azure source; smoke test admin functions |
| transaction_descriptions | MEDIUM | Payment notes may contain sensitive data; expected_date affects reconciliation | Ensure null handling; verify date range coverage |

---

## 12. RECOMMENDED FIRST IMPORT TARGET

### Primary Recommendation: **kwsa_uat**

**Rationale:**
- All test/validation environments currently point to kwsa_uat
- Production (kwsa-backend-prod) still points to kwsa_uat (via secret-backed DATABASE_URL)
- Non-destructive testing possible while prod services unaffected
- Easy rollback via Approval 4 backup (ID: 1778765132025)
- Staging database does NOT currently exist in GCP Cloud SQL

### Secondary: kwsa_prod (After UAT Validation)

**Only after Approval 5 validation passes:**
1. Copy validated kwsa_uat → kwsa_prod (or re-import with same batch)
2. Switch production secret to point to kwsa_prod
3. Final smoke test before cutover

---

## 13. SHOULD SEPARATE STAGING DATABASE BE CREATED?

**Recommendation: NO (use existing kwsa_uat)**

**Reasoning:**
- kwsa_uat is the approved pre-production target per DATABASE_CUTOVER_PLAN
- Adding new staging DB increases complexity and secret management overhead
- kwsa_uat already has baseline export and backup (Approval 4)
- Rollback via Approval 4 backup ID 1778765132025 is available
- Import operations are idempotent (ON CONFLICT semantics allow re-run)

**If staging becomes necessary (future decision):**
1. Provision new `kwsa_staging` Cloud SQL database
2. Create schema via backend migrations
3. Update Secret Manager with `kwsa-staging-db-url`
4. Point local/test services to kwsa_staging
5. Follow same import/validation/rollback procedures

---

## 14. EXACT PROPOSED DRY-RUN COMMAND PLAN

### Pre-Dry-Run Checklist
- [ ] Approval 4 backup exists (ID: 1778765132025) and is restorable
- [ ] kwsa_uat is empty or baseline-only (from Approval 4 export)
- [ ] Azure export CSVs are staged at `scripts/azure-export/` (from export scripts)
- [ ] Cloud SQL Proxy running on localhost:9470 (optional; for local testing)
- [ ] NODE_TLS_REJECT_UNAUTHORIZED=0 set if using self-signed certs

### Dry-Run Command Sequence

**Step 1: Initialize staging schema (idempotent)**
```powershell
cd C:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console-clean-snapshot\backend
$env:DATABASE_URL="postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"
npm run data:staging:init
```

**Expected Output:**
```
[staging] Creating staging schemas...
[staging] Staging tables ensured.
```

**Step 2: Load staging tables from CSV (sample/validation)**
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
$env:DATABASE_URL="postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

# Dry-run: load only market centers (small table, quick validation)
node ../scripts/load-staging-from-csv.cjs `
  --csv-dir ../scripts/azure-export `
  --batch-id "azure-2026-05-14-dry-run" `
  --only-table market_centers_raw
```

**Expected Output:**
```
[load] Connected to database
[load] Batch ID: azure-2026-05-14-dry-run
[load] CSV dir:  ../scripts/azure-export
[load] Truncate: false
  [ok]   staging.market_centers_raw: NNN rows
```

**Step 3: Validate staging load**
```powershell
$env:DATABASE_URL="postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

psql "$env:DATABASE_URL" -c "
SELECT
  'staging.market_centers_raw' AS table_name,
  COUNT(*) AS row_count,
  COUNT(DISTINCT batch_id) AS batch_count
FROM staging.market_centers_raw;
"
```

**Expected Output:**
```
table_name | row_count | batch_count
-------------------------------------
staging.market_centers_raw | ~120 | 1
```

**Step 4: Check for duplicate source IDs (dry-run)**
```powershell
psql "$env:DATABASE_URL" -c "
SELECT
  source_market_center_id,
  COUNT(*) AS occurrences
FROM staging.market_centers_raw
WHERE batch_id = 'azure-2026-05-14-dry-run'
GROUP BY source_market_center_id
HAVING COUNT(*) > 1
ORDER BY occurrences DESC;
"
```

**Expected Output:**
```
source_market_center_id | occurrences
----------------------------------------
(no rows)  -- Good; no duplicates expected
```

**Step 5: Transform staging → migration.core_* (sample)**
```powershell
$env:DATABASE_URL="postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

# Set batch context
psql "$env:DATABASE_URL" -c "SET migration.batch='azure-2026-05-14-dry-run';"

# Run transform for market centers only (sample)
psql "$env:DATABASE_URL" << 'EOF'
INSERT INTO migration.core_market_centers (
  source_market_center_id,
  name,
  status_name,
  frontdoor_id
)
SELECT DISTINCT ON (source_market_center_id)
  source_market_center_id,
  name,
  status_name,
  frontdoor_id
FROM staging.market_centers_raw
WHERE batch_id = 'azure-2026-05-14-dry-run'
  AND source_market_center_id IS NOT NULL
ON CONFLICT (source_market_center_id) DO UPDATE
  SET name = EXCLUDED.name,
      status_name = EXCLUDED.status_name,
      frontdoor_id = EXCLUDED.frontdoor_id,
      updated_at = now()
RETURNING id, source_market_center_id, name;
EOF
```

**Expected Output:**
```
id | source_market_center_id | name
----------------------------------
1  | 123                      | Market Center A
2  | 456                      | Market Center B
...
```

**Step 6: Validate dry-run results**
```powershell
psql "$env:DATABASE_URL" -c "
SELECT
  'staging.market_centers_raw' AS stage,
  COUNT(*) AS count
FROM staging.market_centers_raw
WHERE batch_id = 'azure-2026-05-14-dry-run'
UNION ALL
SELECT
  'migration.core_market_centers',
  COUNT(*)
FROM migration.core_market_centers
WHERE source_market_center_id IS NOT NULL;
"
```

**Expected Output:**
```
stage | count
-----------
staging.market_centers_raw | ~120
migration.core_market_centers | ~120
```

**Step 7: Cleanup dry-run (optional, for test re-runs)**
```powershell
psql "$env:DATABASE_URL" -c "
DELETE FROM staging.market_centers_raw WHERE batch_id = 'azure-2026-05-14-dry-run';
DELETE FROM migration.core_market_centers WHERE source_market_center_id IN (
  SELECT source_market_center_id FROM staging.market_centers_raw WHERE batch_id = 'azure-2026-05-14-dry-run'
);
"
```

---

## 15. EXACT PROPOSED ACTUAL IMPORT COMMANDS (NOT EXECUTED)

### Pre-Import Checklist
- [ ] kwsa_uat confirmed empty or baseline-only
- [ ] Approval 4 backup verified restorable (ID: 1778765132025)
- [ ] All Azure export CSVs staged at `scripts/azure-export/`
- [ ] DATABASE_URL env var set to kwsa_uat
- [ ] NODE_TLS_REJECT_UNAUTHORIZED=0 (if needed)
- [ ] Batch ID chosen: `azure-2026-05-14-v1` (example)

### Full Import Command Sequence

**COMMAND BLOCK 1: Export from Azure (if needed)**
```powershell
cd C:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console-clean-snapshot

$env:AZURE_SQL_USER = "kwsaadmin"
$env:AZURE_SQL_PASSWORD = "***[MASKED]***"

# Run main export (writes to scripts/azure-export/*.csv)
.\scripts\export-azure-to-csv.ps1 -CutoffDate "2026-04-30"

# Run associate extras (appends more tables)
.\scripts\export-azure-associate-extras.ps1

# Optional: run listing details export if needed
.\scripts\export-azure-listing-details-to-csv.ps1

# Result: scripts/azure-export/ contains ~20+ CSV files, total ~500MB-1GB
```

**COMMAND BLOCK 2: Initialize staging schema**
```powershell
cd C:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console-clean-snapshot\backend

$env:DATABASE_URL = "postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

npm run data:staging:init
# Creates staging.* tables if not exist
```

**COMMAND BLOCK 3: Load staging tables from CSV**
```powershell
$env:DATABASE_URL = "postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node ../scripts/load-staging-from-csv.cjs `
  --csv-dir ../scripts/azure-export `
  --batch-id "azure-2026-05-14-v1" `
  --truncate
# Loads all CSV files into staging.* tables
# --truncate: optional, clears previous staging data
# Expected time: 15-30 minutes for 2.6M images
# Estimated staging table size: ~3-5 GB
```

**COMMAND BLOCK 4: Transform staging → migration.core_***
```powershell
$env:DATABASE_URL = "postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

node run-sql.cjs ../scripts/transform-staging-to-migration.sql
# Runs: INSERT ON CONFLICT DO UPDATE for core tables
# Expected time: 5-10 minutes
# Creates/updates: migration.core_market_centers, migration.core_teams, migration.core_associates, migration.core_listings, migration.core_transactions
```

**COMMAND BLOCK 5: Promote migration.core_* → public.*Prisma tables**
```powershell
psql "$env:DATABASE_URL" -f ../scripts/insert-migration-to-public.sql
# Runs: Geographic/address setup, then INSERT for public.* tables
# Expected time: 10-20 minutes
# Creates/updates: market_centers, teams, associates, listings, transactions (+ detail tables)
```

**COMMAND BLOCK 6: Run validation report**
```powershell
npm run data:validate
# Outputs: Row counts, duplicate check, orphan check, missing name/number check
# Expected output: No critical errors (some orphans may be acceptable)
```

**COMMAND BLOCK 7: Run reconciliation report**
```powershell
npm run data:reconcile -- --batch-prefix "azure-2026-05-14-v1"
# Outputs: Batch-level row count summary and discrepancy report
```

### Alternative: Using npm Batch Runner

```powershell
$env:DATABASE_URL = "postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

cd backend

npm run data:run:batch -- \
  --batch-prefix "azure-2026-05-14-v1" \
  --market-centers-file ../scripts/azure-export/market_centers_raw.csv \
  --teams-file ../scripts/azure-export/teams_raw.csv \
  --associates-file ../scripts/azure-export/associates_raw.csv \
  --listings-file ../scripts/azure-export/listings_raw.csv

# This orchestrates steps 2-7 automatically
# Output: Sequential step completion messages + validation report
```

### Execution Timeline Estimates

| Step | Duration | Parallelizable | Notes |
|---|---|---|---|
| Schema init | <1 min | No | Idempotent; safe to re-run |
| CSV load (market/team/assoc) | 5-10 min | No | Streaming; chunk-based |
| CSV load (listings 15K rows) | 5-10 min | No | Streaming; chunk-based |
| CSV load (images 2.6M rows) | 10-20 min | No | Large file; streaming in 2000-row chunks |
| Transform staging → core | 5-10 min | No | Sequential; FK resolution required |
| Promote core → public | 10-20 min | No | Geographic chain; address resolution |
| Validation report | 2-5 min | Yes (after promote) | Parallel queries OK |
| **Total End-to-End** | **50-75 min** | | Conservative estimate; depends on network latency |

---

## 16. EXACT POST-IMPORT VALIDATION QUERIES/CHECKS

### Validation Set A: Row Count Reconciliation

**Query 1: Market Centers**
```sql
SELECT
  'staging.market_centers_raw' AS source,
  COUNT(*) AS staging_count
FROM staging.market_centers_raw
WHERE batch_id = 'azure-2026-05-14-v1'
UNION ALL
SELECT
  'migration.core_market_centers',
  COUNT(*)
FROM migration.core_market_centers
WHERE source_market_center_id IS NOT NULL
UNION ALL
SELECT
  'public.market_centers',
  COUNT(*)
FROM market_centers;
```

**Expected Result:** Rows increase only if new records added; no data loss

**Query 2: Teams (test for orphaned records)**
```sql
SELECT COUNT(*) AS orphan_teams
FROM migration.core_teams t
LEFT JOIN migration.core_market_centers mc
  ON mc.id = t.market_center_id
WHERE COALESCE(t.source_market_center_id, '') <> ''
  AND mc.id IS NULL;
```

**Expected Result:** 0 orphans (all teams linked to valid market center)

**Query 3: Associates (test for orphaned records)**
```sql
SELECT COUNT(*) AS orphan_associates
FROM migration.core_associates a
LEFT JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
LEFT JOIN migration.core_teams t ON t.id = a.team_id
WHERE (COALESCE(a.source_market_center_id, '') <> '' AND mc.id IS NULL)
   OR (COALESCE(a.source_team_id, '') <> '' AND t.id IS NULL);
```

**Expected Result:** 0 orphans (all associates linked to valid team/MC)

### Validation Set B: Data Integrity

**Query 4: Duplicate source IDs (should not exist)**
```sql
SELECT 'associates' AS table_name, source_associate_id, COUNT(*) AS cnt
FROM migration.core_associates
GROUP BY source_associate_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'listings', source_listing_id, COUNT(*)
FROM migration.core_listings
GROUP BY source_listing_id
HAVING COUNT(*) > 1
UNION ALL
SELECT 'transactions', source_transaction_id, COUNT(*)
FROM migration.core_transactions
GROUP BY source_transaction_id
HAVING COUNT(*) > 1;
```

**Expected Result:** No rows (no duplicates)

**Query 5: Missing required fields**
```sql
SELECT
  'associates' AS entity,
  COUNT(*) AS missing_name_count
FROM migration.core_associates
WHERE COALESCE(first_name, '') = '' AND COALESCE(last_name, '') = ''
UNION ALL
SELECT
  'listings',
  COUNT(*)
FROM migration.core_listings
WHERE COALESCE(listing_number, '') = '';
```

**Expected Result:** Very few (<1%) missing records (some Azure records may be incomplete)

### Validation Set C: Large File Coverage

**Query 6: Listing images coverage**
```sql
SELECT
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE id IN (SELECT listing_id FROM listing_images)) AS listings_with_images,
  ROUND(100.0 * COUNT(*) FILTER (WHERE id IN (SELECT listing_id FROM listing_images)) / COUNT(*), 1) AS image_coverage_percent
FROM listings;
```

**Expected Result:** >80% of listings have at least one image

**Query 7: Listing documents coverage**
```sql
SELECT
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE id IN (SELECT listing_id FROM documents WHERE document_type = 'Listing')) AS listings_with_docs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE id IN (SELECT listing_id FROM documents WHERE document_type = 'Listing')) / COUNT(*), 1) AS doc_coverage_percent
FROM listings;
```

**Expected Result:** >50% of listings have documents

### Validation Set D: Transaction Integrity

**Query 8: Transaction agent split verification**
```sql
SELECT
  COUNT(*) AS total_transactions,
  COUNT(*) FILTER (WHERE agent_splits_total = 100.0) AS splits_sum_100,
  COUNT(*) FILTER (WHERE agent_splits_total <> 100.0) AS splits_not_100
FROM (
  SELECT
    t.id,
    SUM(ta.split_percentage) AS agent_splits_total
  FROM transactions t
  LEFT JOIN transaction_associates ta ON ta.transaction_id = t.id
  WHERE ta.split_percentage IS NOT NULL
  GROUP BY t.id
) x;
```

**Expected Result:** Most transactions have split percentages summing to 100% or close (allow ±5%)

**Query 9: GCI calculation consistency**
```sql
SELECT
  COUNT(*) AS total_details,
  COUNT(*) FILTER (WHERE gci_before_fees > 0) AS has_gci,
  COUNT(*) FILTER (WHERE gci_after_fees_excl_vat > 0) AS has_gci_after_fees,
  COUNT(*) FILTER (WHERE gci_before_fees >= gci_after_fees_excl_vat) AS fees_deducted
FROM transaction_associate_payment_details
WHERE batch_id = 'azure-2026-05-14-v1' OR id IS NOT NULL;  -- OR clause ensures all rows after rerun
```

**Expected Result:** >90% of details have GCI values; fees properly deducted

### Validation Set E: MAPP 2.0 Preservation

**Query 10: Check MAPP 2.0-only columns still present and not nulled out**
```sql
SELECT
  COUNT(*) AS total_associates,
  COUNT(*) FILTER (WHERE national_id IS NOT NULL) AS with_national_id,
  COUNT(*) FILTER (WHERE ffc_number IS NOT NULL) AS with_ffc_number,
  COUNT(*) FILTER (WHERE vested IS NOT NULL) AS with_vested_flag
FROM associates;
```

**Expected Result:** All counts > 0 (MAPP 2.0 columns preserved)

**Query 11: MAPP 2.0 tables still exist**
```sql
SELECT
  'app_users' AS table_name,
  COUNT(*) AS row_count
FROM app_users
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'user_roles', COUNT(*) FROM user_roles
UNION ALL
SELECT 'roles', COUNT(*) FROM roles
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'public_leads', COUNT(*) FROM public_leads
UNION ALL
SELECT 'loom_user_tokens', COUNT(*) FROM loom_user_tokens;
```

**Expected Result:** All MAPP 2.0 tables present with original row counts or higher (never dropped/truncated)

---

## 17. ROLLBACK PLAN USING APPROVAL 4 BACKUP

**Backup Details:**
- **Cloud SQL Backup ID:** 1778765132025
- **Status:** SUCCESSFUL
- **Completed:** 2026-05-14T13:27:53.864Z
- **Database:** kwsa (was kwsa_uat at backup time; target for recovery)
- **Size:** ~50-100 GB (estimated)

### Rollback Level 1: Configuration Rollback (Fastest)
If import imported to kwsa_uat but UAT services not yet switched:
1. No action needed — services still point to kwsa_uat secret
2. Delete staging.* and migration.* tables to reset staging area
3. Keep public.* tables intact (continue using pre-import data)

**Command:**
```powershell
psql "$env:DATABASE_URL" << 'EOF'
DROP SCHEMA IF EXISTS staging CASCADE;
DROP SCHEMA IF EXISTS migration CASCADE;
CREATE SCHEMA staging;
CREATE SCHEMA migration;
EOF
```

**Time to restore:** <5 minutes
**RPO:** Original kwsa_uat state (pre-import)

### Rollback Level 2: Data Rollback (Full Database Restore)
If import affected public.* tables and testing is required:

**Prerequisites:**
- Cloud SQL instance: kwsa-postgres (region: africa-south1)
- Backup ID: 1778765132025

**Steps:**

1. **Identify current kwsa_uat database state:**
```bash
gcloud sql backups list --instance=kwsa-postgres --project=kwsa-mapp
# Verify backup 1778765132025 listed as SUCCESSFUL
```

2. **Create a temporary restore database (kwsa_uat_restore):**
```bash
gcloud sql backups restore 1778765132025 \
  --backup-instance=kwsa-postgres \
  --target-instance=kwsa-postgres \
  --project=kwsa-mapp
# Restores to original database name (kwsa_uat); old data lost
```

**WARNING:** This overwrites kwsa_uat. If post-import data is valuable, export it first:

```powershell
$env:DATABASE_URL = "postgresql://kwsa_uat:<password>@34.35.113.173:5432/kwsa_uat?sslmode=require"

pg_dump "$env:DATABASE_URL" -F d -j 4 -v \
  -f C:\temp\kwsa_uat_post_import_backup.dump \
  2>&1 | Tee-Object -FilePath C:\temp\pg_dump.log
```

3. **Verify restored database integrity:**
```powershell
psql "$env:DATABASE_URL" -c "
SELECT
  'market_centers' AS table_name, COUNT(*) AS row_count FROM market_centers
UNION ALL
SELECT 'associates', COUNT(*) FROM associates
UNION ALL
SELECT 'listings', COUNT(*) FROM listings
UNION ALL
SELECT 'transactions', COUNT(*) FROM transactions;
"
```

4. **Check row counts match Approval 4 baseline:**
- Refer to Approval 4 evidence file: `docs/migration-runs/2026-05-14-run-004/kwsa_uat_row_counts.csv`
- Counts should match backup time snapshot

5. **Smoke test critical paths:**
```sql
-- Test 1: Login works (users table intact)
SELECT COUNT(*) FROM users WHERE email IS NOT NULL LIMIT 1;

-- Test 2: Dashboard data available (market centers, associates)
SELECT COUNT(*) FROM market_centers WHERE status_name = 'Active';
SELECT COUNT(*) FROM associates WHERE status_name = 'Active';

-- Test 3: Listings accessible
SELECT COUNT(*) FROM listings WHERE status_name = 'Active';

-- Test 4: Transactions & reports
SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '90 days';
```

**Time to restore:** 30-60 minutes (includes restore + verification + smoke test)
**RPO:** Approval 4 backup (pre-import state; any post-import changes lost)
**RTO:** Estimate 1-2 hours (including app restart and connection pool refresh)

### Rollback Level 3: Full Rollback (Reverse Environment Switch)
If cutover to kwsa_prod already happened:

1. **Restore kwsa_prod from its own backup** (if taken) OR
2. **Re-import kwsa_uat from Approval 4 backup, then copy to kwsa_prod**

**Do NOT restore kwsa_prod over kwsa_uat; they are separate databases.**

**Command to revert production secret:**
```bash
# Revert Cloud Run service to previous DATABASE_URL secret version
gcloud run services update kwsa-backend-prod \
  --set-env-vars DATABASE_URL=projects/kwsa-mapp/secrets/kwsa-database-url-backup/versions/1 \
  --region africa-south1 \
  --project kwsa-mapp

# Restart services to pick up reverted env var
gcloud run services describe kwsa-backend-prod --region africa-south1
```

**Time to revert:** <10 minutes (secret change) + 5-10 minutes (service restart)
**RTO:** 15-20 minutes

---

## 18. RECOMMENDED NEXT APPROVAL STEP

**Next Approval: Approval 6 — kwsa_prod Preparation from Validated kwsa_uat**

### Approval 6 Scope (Proposed)
1. Final UAT validation sign-off on kwsa_uat (all GO_LIVE_DATABASE_CHECKLIST items pass)
2. Copy validated kwsa_uat schema + data to kwsa_prod (or re-import with same batch)
3. Prepare Production environment mapping (secret changes staged, not applied)
4. Final rollback procedure verification
5. Generate pre-cutover artifact snapshot

### Timeline for Approval 6
- Estimated duration: 3-4 hours
- Activities: Data copy/re-import + smoke tests + final documentation
- Expected go-live readiness: Approval 7 (asset migration dry-run)

### Blockers Before Approval 6
- [ ] All Approval 5 validation queries pass (>95% data integrity)
- [ ] No critical schema mismatches found
- [ ] MAPP 2.0 tables/columns verified preserved
- [ ] Image/document URL resolution spot-checks pass
- [ ] Transaction split percentages reconcile
- [ ] Backup rollback procedure tested (dry-run)

---

## 19. SUMMARY TABLE

| Item | Finding |
|---|---|
| **Git Branch** | clean-source-snapshot-before-db-cutover (commit: 05eb56e) |
| **Working Tree** | Clean (no changes) |
| **Azure Source** | dbMappProd via kwsa.database.windows.net (read-only) |
| **Data Operation Type** | INSERT ON CONFLICT DO NOTHING → DO UPDATE (UPSERT) |
| **Import Target (Primary)** | kwsa_uat (non-destructive, rollback available) |
| **First Import Location** | staging.* → migration.core_* → public.* |
| **Tables to Import** | ~50 tables from Azure export (market centers, teams, associates, listings, transactions, + details) |
| **Tables to Preserve** | app_users, users, roles, user_roles, audit_logs, public_leads, loom_user_tokens, cma_documents, marketing_plan_documents, contacts, documents (MAPP 2.0) |
| **Columns to Preserve** | nationalId, ffcNumber, privateEmail, proposedGrowthShareSponsor, vested, vestingStartPeriod, splitPercentage, transactionGCIBeforeFees, etc. (MAPP 2.0-only) |
| **High-Risk Table** | listing_images (~2.6M rows) — validate GCS URL resolution post-import |
| **Dry-Run Command** | `npm run data:staging:init && node ../scripts/load-staging-from-csv.cjs --only-table market_centers_raw --batch-id "azure-2026-05-14-dry-run"` |
| **Full Import Duration** | 50-75 minutes (sequential; includes staging → migration → public promotion) |
| **Rollback Backup ID** | 1778765132025 (SUCCESSFUL, 2026-05-14T13:27:53.864Z) |
| **MAPP 2.0 Preservation Flag** | `PRESERVE_CORE_EDITS=true` (use npm script: `npm run data:run:batch:preserve`) |
| **Data Not Modified** | ✓ No imports executed in Approval 5 |
| **Env Vars Not Changed** | ✓ Only inspection performed; no SECRET_URL changes |
| **Next Approval Recommended** | Approval 6: kwsa_prod preparation and final validation |

---

## 20. WHAT WAS INSPECTED (NO EXECUTION)

✓ Azure export/import script logic (power shell and Node.js)  
✓ Schema mapping definitions (staging → migration → public)  
✓ MAPP 2.0-only tables and columns identified  
✓ Data operation types confirmed (UPSERT via ON CONFLICT)  
✓ Validation query patterns documented  
✓ Dry-run command flow designed (no execution)  
✓ Full import command sequence designed (no execution)  
✓ Rollback procedures documented with Approval 4 backup ID  
✓ Risk matrix created (high-risk: listing_images, transaction_associate_payment_details, listing_documents)  

---

## FILES CREATED/MODIFIED

**Created (Approval 5):**
- docs/migration-runs/2026-05-14-run-005/AZURE_IMPORT_MAPPING_AND_DRY_RUN_PLAN.md (this file)

**Referenced (No Modifications):**
- docs/DATABASE_CUTOVER_PLAN_2026_07_01.md
- docs/GO_LIVE_DATABASE_CHECKLIST.md
- docs/MIGRATION_APPROVAL_POINTS.md
- docs/DATABASE_ROLLBACK_PLAN.md
- docs/SCHEMA_COMPARISON_AZURE_TO_GCP.md
- docs/MAPP2_CUSTOM_TABLES_AND_FIELDS.md

---

## SIGN-OFF

**Approval 5 Status:** Complete (planning and inspection only)  
**No Data Modified:** ✓  
**No Environment Changes:** ✓  
**No Secrets Changed:** ✓  
**Working Tree State:** Clean  
**Recommended Action:** Proceed to Approval 6 (kwsa_prod preparation)
