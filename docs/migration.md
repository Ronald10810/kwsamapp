# Migration Guide

## From Legacy System

The legacy system (`current-system`) contains the source of truth for business logic. Key preservation areas:

### Must Preserve Exactly
- All financial calculations (GCI, commissions, splits)
- Transaction status workflows
- Associate transfer logic
- P24/KWW integration data mappings
- Lightstone validation rules

### Modernize Freely
- UI/UX design and interactions
- Database schema (EF → PostgreSQL)
- API design (RESTful)
- Infrastructure (Azure → GCP)
- Code organization and patterns

## Migration Phases

1. **Foundation**: Database schema, core entities
2. **Services**: Business logic implementation
3. **APIs**: REST endpoints
4. **Frontend**: React components
5. **Integration**: P24, KWW, Lightstone
6. **Testing**: Comprehensive test coverage
7. **Deployment**: GCP setup

## Current Status (2026-04-28)

- Parallel migration mode is active: legacy system remains available while cloud console is being validated.
- Prisma schema is repaired and pushed to GCP PostgreSQL.
- Reference and lookup data imports are largely complete, including previously blocked mapping tables.
- Local backend health endpoint is confirmed running at `/health`.
- Frontend local startup was validated after resolving PowerShell execution-policy blocking.
- A full rollback snapshot backup was created before proceeding:
  - `backups/kwsa-cloud-console-20260428-092038/`
  - Includes: `repo-all.bundle`, `status.txt`, `staged.diff`, `working-tree.diff`, `base-commit.txt`.

## Next Best Move (Execution Order)

1. **Freeze a staging API target**
	- Deploy backend to staging Cloud Run with fixed environment values (DB, CORS, auth, storage).
	- Confirm `GET /health` returns 200 on staging URL.

2. **Link frontend to staging API**
	- Set frontend runtime API base for staging.
	- Keep local proxy behavior for local development unchanged.

3. **Run a focused smoke pass**
	- Auth: Google login and token flow.
	- Core reads: market centers/agents/listings/transactions list endpoints.
	- Core writes: create/update one entity in each critical module.
	- File flow: upload and retrieve one document/image path.

4. **Data migration continuation (core entities)**
	- Import in dependency order: market centers -> teams -> associates -> listings -> transactions.
	- Reconcile counts and spot-check business calculations (commissions/splits/GCI).

5. **Parallel run gate for go-live**
	- Run both systems in parallel for agreed validation window.
	- Compare operational outputs daily (counts, statuses, critical financial totals).
	- Approve cutover only after acceptance criteria are met.

## Immediate Task Queue

- [ ] Prepare staging backend env manifest for Cloud Run deploy.
- [ ] Set staging frontend API base URL and verify CORS.
- [ ] Execute and record smoke-test results.
- [ ] Start core-entity imports with reconciliation report.

## Staging Commands (Ready Now)

- Frontend staging env file:
	- `frontend/.env.staging`
- Staging API smoke script:
	- `scripts/smoke-staging-api.ps1`

Run smoke checks:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
Set-Location .\kwsa-cloud-console
.\scripts\smoke-staging-api.ps1
```

## Staging Verification Pass (2026-04-28)

Completed checks:

- PASS `GET /health` -> `200`
- PASS `GET /api/ops/summary` (auth enforced) -> `401`
- PASS `GET /api/agents` (auth enforced) -> `401`
- PASS `POST /api/auth/google` with invalid credential -> `401` (`Invalid Google credential`)

Database auth-user persistence check (after real staging login):

- Runtime database target (Cloud Run `DATABASE_URL` secret): `kwsa`
- `public.app_users`: `total_users = 1`, `last_update = 2026-04-28T08:00:34.676Z`
- `migration.app_users`: `total_users = 4`, `last_update = 2026-04-24T19:48:05.674Z`

Interpretation:

- API/auth route and auth guard behavior are healthy in staging.
- OAuth `origin_mismatch` was resolved by updating Authorized JavaScript origins in Google Cloud Console.
- Real Google login now persists correctly to `public.app_users` on the active runtime database.

## Production Readiness Gate (Completed 2026-04-28)

Completed and verified:

1. Real Google login performed successfully on staging frontend.
2. Backend `/api/auth/google` returned `200` on revision `kwsa-backend-test-00014-l95`.
3. Auth-user upsert confirmed in runtime DB (`public.app_users`).
4. Staging smoke checks re-run and passing (`/health` 200, protected endpoints 401 as expected).

Cutover note:

- Earlier local DB checks used `kwsa_parallel`; staging runtime writes are against `kwsa` from Secret Manager.
- Production cutover can proceed with standard rollback safeguards.

---

## Azure → GCP Full Data Migration (2026-04-28)

### Overview

Goal: Load all real Azure SQL (`dbMappUAT`) data into GCP PostgreSQL (`kwsa`) for staging testing.

Pipeline:
```
Azure SQL (readonly)
	↓  scripts/export-azure-to-csv.ps1           (JOIN queries → CSV files)
	↓  scripts/load-staging-from-csv.cjs          (CSV → staging.* tables)
	↓  scripts/transform-staging-to-migration.sql (staging.* → migration.core_*)
	↓  scripts/insert-migration-to-public.sql      (migration.core_* → public.* Prisma tables)
```

### Step 1 — Apply schema migration to GCP PostgreSQL

Fields added to Prisma schema and `prisma/migrations/add_missing_legacy_fields.sql`:

| Table | New columns |
|---|---|
| `associates` | `nationalId`, `ffcNumber` |
| `associate_business_details` | `proposedGrowthShareSponsor`, `growthShareSponsorId`, `temporaryGrowthShareSponsor`, `listingApprovalRequired`, `excludeFromIndividualReports`, `vested`, `vestingStartPeriod` |
| `associate_contact_details` | `privateEmail` |
| `listings` | `listingDate`, `reducedDate`, `pendingDate`, `withdrawnDate` |
| `listing_mandate_infos` | `signedDate`, `onMarketSince`, `ratesTaxes`, `monthlyLevy` |
| `listing_price_details` | `agentPropertyValuation` |
| `transaction_descriptions` | `varianceSaleListPricePerc`, `avgCommsPerc`, `soldDate`, `expectedDate`, `paymentNotes`, `returnNotes` |
| `transaction_associates` | `splitPercentage`, `outsideAgency` |
| `transaction_associate_payment_details` | `transactionGCIBeforeFees`, `productionRoyalties`, `growthShare`, `gciAfterFeesExclVAT`, `capRemaining`, `associateDollar`, `teamDollar`, `mcDollar` |

```powershell
$env:PGPASSWORD = "<postgres_password>"
psql -h 34.35.113.173 -U postgres -d kwsa -f backend/prisma/migrations/add_missing_legacy_fields.sql
```

### Step 2 — Export from Azure SQL

```powershell
Install-Module -Name SqlServer -AllowClobber -Scope CurrentUser  # once, as admin
cd kwsa-cloud-console
 $env:AZURE_SQL_USER = "kwsaadmin"
 $env:AZURE_SQL_PASSWORD = "<azure_password>"
.\scripts\export-azure-to-csv.ps1
# output: scripts/azure-export/*.csv
```

### Step 3 — Load into staging tables

```powershell
cd kwsa-cloud-console/backend
$env:DATABASE_URL = "postgresql://postgres:<pw>@34.35.113.173/kwsa?sslmode=require"
node ../scripts/load-staging-from-csv.cjs --csv-dir ../scripts/azure-export --batch-id "azure-2026-05-01"
```

### Step 4 — Transform staging → migration.core_*

```powershell
psql $env:DATABASE_URL -f scripts/transform-staging-to-migration.sql
```

### Step 5 — Promote to public (Prisma) tables

```powershell
psql $env:DATABASE_URL -f scripts/insert-migration-to-public.sql
```

Dependency order: reference tables → geography → addresses → market_centers → teams → associates → listings → transactions.

### Reconciliation spot-checks

```sql
SELECT 'market_centers', COUNT(*) FROM market_centers
UNION ALL SELECT 'teams',        COUNT(*) FROM teams
UNION ALL SELECT 'associates',   COUNT(*) FROM associates
UNION ALL SELECT 'listings',     COUNT(*) FROM listings
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions;
```

### Azure connection details

| Field | Value |
|---|---|
| Server | `kwsa.database.windows.net` |
| Database | `dbMappUAT` |
| User | `kwsaadmin` |
| Access | readonly |

> Credentials in `current-system/MAPP/appsettings.json` — do not commit changes.

### First Staging Run Order

Use this order for the first real-data load into the new system. This creates data in the new PostgreSQL environment only; it does not change Azure.

1. Confirm target database is staging, not the future live cutover database.
2. Apply `backend/prisma/migrations/add_missing_legacy_fields.sql`.
3. Export Azure data to CSV with `scripts/export-azure-to-csv.ps1`.
4. Load CSVs into `staging.*` with `scripts/load-staging-from-csv.cjs`.
5. Transform `staging.*` to `migration.core_*` with `scripts/transform-staging-to-migration.sql`.
6. Promote `migration.core_*` into `public.*` with `scripts/insert-migration-to-public.sql`.
7. Run count checks and spot-checks before opening the staging site for testing.

Concrete commands for a first run:

```powershell
cd C:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console

# Step 1: schema patch
$env:PGPASSWORD = "<postgres_password>"
psql -h 34.35.113.173 -U postgres -d kwsa -f backend/prisma/migrations/add_missing_legacy_fields.sql

# Step 2: Azure export (read-only)
$env:AZURE_SQL_USER = "<azure_user>"
$env:AZURE_SQL_PASSWORD = "<azure_password>"
.\scripts\export-azure-to-csv.ps1

# Step 3: load to staging
cd .\backend
$env:DATABASE_URL = "postgresql://postgres:<pw>@34.35.113.173/kwsa?sslmode=require"
node ..\scripts\load-staging-from-csv.cjs --csv-dir ..\scripts\azure-export --batch-id "azure-2026-04-28"

# Step 4: transform to migration.core_*
cd ..
psql $env:DATABASE_URL -c "SET migration.batch='azure-2026-04-28';" -f scripts/transform-staging-to-migration.sql

# Step 5: promote into public.*
psql $env:DATABASE_URL -f scripts/insert-migration-to-public.sql
```

### Validation Queries For First Run

Core table counts:

```sql
SELECT 'market_centers' AS table_name, COUNT(*) FROM market_centers
UNION ALL
SELECT 'teams', COUNT(*) FROM teams
UNION ALL
SELECT 'associates', COUNT(*) FROM associates
UNION ALL
SELECT 'listings', COUNT(*) FROM listings
UNION ALL
SELECT 'transactions', COUNT(*) FROM transactions
ORDER BY 1;
```

Detail-table checks:

```sql
SELECT COUNT(*) AS associates_with_contact_details
FROM associate_contact_details;

SELECT COUNT(*) AS listings_with_price_details
FROM listing_price_details;

SELECT COUNT(*) AS transactions_with_descriptions
FROM transaction_descriptions;

SELECT COUNT(*) AS transaction_agents
FROM transaction_associates;
```

Spot-check the newly aligned legacy fields:

```sql
SELECT id, "firstName", "lastName", "nationalId", "ffcNumber"
FROM associates
ORDER BY id DESC
LIMIT 10;

SELECT id, "listingNumber", "listingDate", "expiryDate"
FROM listings
ORDER BY id DESC
LIMIT 10;

SELECT id, "transactionNumber", "statusId"
FROM transactions
ORDER BY id DESC
LIMIT 10;
```

### Go / No-Go For Staging

Go if all of these are true:

- Schema patch applies without errors.
- Azure export completes and produces the expected CSV set.
- Staging load completes without fatal insert errors.
- `migration.core_*` tables are populated after the transform step.
- Public app tables are populated after the promote step.
- Counts are directionally correct and relationships look intact.
- Login and core pages work against the imported dataset.

No-go if any of these happen:

- The target database is not confirmed as staging.
- The export account is not confirmed safe for read-only extraction.
- Core counts are obviously incomplete or inflated.
- Listings are missing market centers, or transactions are missing listings/agents.
- Staging pages fail on real data after the import.

### Expected Outcome

If this run completes cleanly, the new cloud console will have real copied data from Azure in the new PostgreSQL system and can be tested end-to-end without any downtime on the current Azure system.