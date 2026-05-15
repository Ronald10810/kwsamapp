# PHASE5_PRE_PROMOTION_SAFETY_GATE

Date: 2026-05-15
Approval Scope: Approval 12 only (Phase 5 pre-promotion safety gate)
Execution Mode: Read-only verification + fresh backup creation only

## 1. Git branch and commit hash
- Branch: clean-source-snapshot-before-db-cutover
- Commit: 218b9f4de819a5c07fa5b808bb97bafb3e1e6dc2

## 2. Working tree status before and after
- Before Approval 12 actions: clean (`git status --short` returned no output)
- After Approval 12 actions: planning/report docs modified only (no data operations run)

## 3. GCP project
- Active project: kwsa-mapp

## 4. Cloud SQL instance
- Instance: kwsa-postgres
- Region: africa-south1
- Engine: POSTGRES_18
- Status: RUNNABLE

## 5. Database list
- postgres
- kwsa
- kwsa_parallel
- kwsa_uat
- kwsa_public
- kwsa_prod
- kwsa_import_staging

## 6. Fresh Cloud SQL backup ID, timestamp, and status
Fresh backup was created successfully as required.

- Backup description: approval12-pre-promotion-20260515-174822
- Backup ID: 1778860105623
- Type: ON_DEMAND
- Status: SUCCESSFUL
- Start time (UTC): 2026-05-15T15:48:25.633Z
- End time (UTC): 2026-05-15T15:50:06.923Z

## 7. Confirmation whether production still points to kwsa_uat
- Yes. Production backend service still references secret `DATABASE_URL` (version 3), and masked inspection confirms the DB token includes `kwsa_uat`.

## 8. Current Cloud Run service DB targets (masked)
Service env references:
- kwsa-backend-prod -> DATABASE_URL (secret version 3)
- kwsa-backend-test -> kwsa-backend-test-db-url (latest)
- kwsa-public-api-uat -> kwsa-public-api-db-url (latest)

Masked secret target results:
- DATABASE_URL@3 -> db token includes `kwsa_uat`, host masked, port masked
- kwsa-backend-test-db-url@latest -> db=`kwsa_uat`, host=`loc***ost`, port=`5432`
- kwsa-public-api-db-url@latest -> db=`kwsa_uat`, host=`34.***173`, port=`5432`

## 9. Source database
- Source: kwsa_import_staging

## 10. Target database
- Target: kwsa_uat

## 11. Source mapped row counts (kwsa_import_staging)
- core_market_centers = 48
- core_teams = 219
- core_associates = 9,243
- core_listings = 129,123
- core_transactions = 30,181
- listing_agents = 146,571
- listing_images = 2,531,507
- listing_marketing_urls = 9,975
- transaction_agents = 46,824
- transaction_agent_calculations = 42,533
- load_rejections = 76,837

## 12. Current kwsa_uat row counts (same mapped tables)
- core_market_centers = 48
- core_teams = 219
- core_associates = 9,227
- core_listings = 139,978
- core_transactions = 30,120
- listing_agents = 145,929
- listing_images = 2,524,075
- listing_marketing_urls = 34,462
- transaction_agents = 42,450
- transaction_agent_calculations = 42,440
- load_rejections = 0

## 13. Tables proposed for promotion
Promotion scope should be restricted to selected `migration` tables using mapped upsert logic:

Core mapped tables:
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions

Link/detail mapped tables:
- migration.listing_agents
- migration.listing_images
- migration.listing_marketing_urls
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections

Optional companion map tables (only if required by downstream logic and schema-validated first):
- migration.id_map_market_centers
- migration.id_map_teams
- migration.id_map_associates
- migration.id_map_listings

## 14. Tables that must be preserved in kwsa_uat
Do not overwrite or truncate UAT-only migration tables:
- migration.agent_deregistration_log
- migration.agent_reactivation_log
- migration.listing_transfer_log
- migration.mc_dashboard_daily_snapshots
- migration.mc_document_hub
- migration.team_associate_commissions
- migration.team_cap_history
- migration.team_caps
- migration.team_dates
- migration.team_notes
- migration.team_portal_settings
- migration.transaction_documents
- migration.transaction_status_history

Also preserve all non-target schemas/tables (`public`, `staging`) unless explicitly approved.

## 15. MAPP 2.0-only tables to preserve
Mandatory preserve set (read-only existence/count check completed in kwsa_uat):
- public.users (exists, 0)
- public.app_users (exists, 15)
- public.roles (exists, 0)
- public.user_roles (exists, 0)
- public.audit_logs (exists, 0)
- public.public_leads (exists, 0)
- public.loom_user_tokens (exists, 1)
- public.cma_documents (exists, 9)
- public.marketing_plan_documents (exists, 3)
- public.rentals (not present)
- public.listing_p24_feed_items (exists, 0)
- public.listing_third_party_integrations (exists, 124,866)
- public.transaction_notes (exists, 0)
- public.transaction_documents (exists, 80,599)
- public.transaction_bonds (exists, 0)

Additional feature/custom public tables found (examples, preserve):
- public.transaction_associate_payment_details
- public.transaction_associates
- public.transaction_descriptions
- public.transaction_financing_types
- public.listing_descriptions
- public.listing_price_details
- public.listing_property_areas
- public.listing_lightstone_validations
- public.associate_business_details
- public.associate_contact_details
- public.contacts
- public.documents
- public.public_agents_v
- public.public_listings_v
- public.public_market_centres_v
- public.public_teams_v
(and other public schema objects in current kwsa_uat inventory)

## 16. Exact proposed promotion method
Recommended method: table-by-table mapped upsert only.

- Use explicit column lists and casts for schema drift.
- Do not use schema clone or full dump/restore into kwsa_uat for this phase.
- Do not use blanket controlled delete-and-reload while production points to kwsa_uat.
- No TRUNCATE, no DROP, no overwrite of entire schema.

## 17. Exact proposed promotion commands (do not run)
All commands below are proposals only.

A) Preflight checks

```powershell
git branch --show-current
git rev-parse HEAD
git status --short

gcloud config get-value project
gcloud sql instances list --project kwsa-mapp --format="table(name,region,databaseVersion,state)"
gcloud run services list --project kwsa-mapp --region africa-south1
```

B) Backup before execution window

```powershell
gcloud sql backups create `
  --instance=kwsa-postgres `
  --project=kwsa-mapp `
  --description="pre-phase5-promotion-<timestamp>"

gcloud sql backups list `
  --instance=kwsa-postgres `
  --project=kwsa-mapp `
  --limit=5 `
  --sort-by=~endTime
```

C) Proposed mapped upsert execution (future approval only)

```powershell
# Prereq: Cloud SQL Auth Proxy running on 127.0.0.1:9470
$raw = gcloud secrets versions access latest --secret="kwsa-backend-test-db-url" --project="kwsa-mapp" --quiet
$m = [regex]::Match($raw, '^postgres(?:ql)?://([^:]+):([^@]+)@')
$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$env:PGPASSWORD = $dbPass
$psql = (Get-ChildItem "C:\Program Files*\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName

# Safety checks
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SELECT current_database();"
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -c "SELECT current_database();"

# Future approved step only (DO NOT RUN in Approval 12)
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -f "scripts/migration/phase5/promote-import-staging-to-uat-mapped-upsert.sql"

Remove-Item Env:PGPASSWORD
```

D) Characteristics the future SQL must enforce
- INSERT ... ON CONFLICT DO UPDATE only for approved migration tables.
- Explicit per-column mappings with casts for known drift.
- Preserve UAT-only columns via COALESCE(existing, incoming/default).
- No writes to `public.*` in this promotion step.

## 18. Risk assessment of promoting while production still points to kwsa_uat
Risk level: HIGH.

Why high risk:
- Production-path service currently resolves to kwsa_uat.
- Any promotion mistakes become production-impacting immediately.
- Source/target schema drift exists across migration columns and types.
- Potential partial-state exposure if writes occur during live traffic.

## 19. Recommendation on whether a maintenance window is required
- A maintenance window is required if promotion goes to kwsa_uat while production remains pointed there.
- Preferred safer path: first move production off kwsa_uat (separately approved), then run promotion with reduced risk.

## 20. Rollback plan using the fresh backup
If promotion fails in a future approved execution:

1) Stop promotion immediately.
2) Keep maintenance mode/freeze active.
3) Restore from fresh backup:

```powershell
gcloud sql backups restore 1778860105623 `
  --backup-instance=kwsa-postgres `
  --target-instance=kwsa-postgres `
  --project=kwsa-mapp
```

4) Re-run smoke checks.
5) Keep production state unchanged until validation is green.

## 21. Post-promotion validation checklist
Database checks:
- `SELECT current_database()` confirms kwsa_uat.
- Row counts compared across approved promotion tables.
- Duplicate key checks on business keys.
- Referential integrity checks (listing/associate/transaction linkages).
- Rejection counts reviewed and categorized.

Runtime checks:
- kwsa-backend-prod health and core API routes.
- kwsa-backend-test health and core API routes.
- kwsa-public-api-uat key endpoints.

Functional spot checks:
- Login/dashboard
- Listings + images + docs
- Transactions + associated calculations
- Critical reports and integrations

Safety checks:
- No secret/env var drift
- No unauthorized deployment drift
- No writes outside approved tables

## 22. Exact recommended next approval
Recommended next gate: Approval 13 (Phase 5 execution authorization with maintenance controls).

Approval 13 should explicitly approve:
1. Promotion maintenance window and freeze owner.
2. Final mapped upsert SQL file review/signoff.
3. Execution of approved promotion SQL from kwsa_import_staging to kwsa_uat.
4. Immediate rollback trigger criteria and owner using backup `1778860105623`.

---

## Approval 12 scope confirmation
- No data copy to kwsa_uat performed.
- No promotion SQL executed.
- No truncate/delete/insert/update/overwrite run.
- No touches to kwsa_prod or kwsa.
- No secret/env/deployment changes.
- No asset migration executed.
