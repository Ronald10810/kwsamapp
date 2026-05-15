# PHASE5_FINAL_EXECUTION_REVIEW

Date: 2026-05-15
Approval Scope: Approval 13A only (final execution decision and command review)
Execution Mode: Read-only inspection and execution-package preparation only

## 1. Git branch and commit hash
- Branch: clean-source-snapshot-before-db-cutover
- Commit: 305af29a60a48490a71ee9602be413d710a2fdb9

## 2. Working tree status
- Status at start: clean (`git status --short` returned no output)
- Status at end: documentation/report updates only (no data operations)

## 3. Source database
- kwsa_import_staging

## 4. Target database
- kwsa_uat

## 5. Fresh backup ID and status
- Backup ID: 1778860105623
- Type: ON_DEMAND
- Status: SUCCESSFUL
- Created: 2026-05-15

## 6. Confirmation production still points to kwsa_uat
- Confirmed: Yes.
- Cloud Run prod service references `DATABASE_URL` secret version 3.
- Masked secret target extraction still indicates `kwsa_uat`.

## 7. Maintenance window recommendation
- Required.
- Promotion to kwsa_uat must be executed only during an approved maintenance window while production still resolves to kwsa_uat.

## 8. Rollback owner placeholder
- Rollback Owner: TBD (must be explicitly assigned before execution)
- Decision Authority (Go/No-Go): TBD

## 9. Tables to promote
Promotion scope (migration schema only):
- migration.core_market_centers
- migration.core_teams
- migration.core_associates
- migration.core_listings
- migration.core_transactions
- migration.listing_agents
- migration.listing_images
- migration.listing_marketing_urls
- migration.transaction_agents
- migration.transaction_agent_calculations
- migration.load_rejections
- (Optional if required by app logic and prechecked): migration.id_map_market_centers, migration.id_map_teams, migration.id_map_associates, migration.id_map_listings

## 10. Tables to preserve
Must preserve and not blanket-overwrite:
- All migration tables not in promotion scope
- UAT-only migration tables:
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
- All public schema objects
- All staging schema objects

## 11. Exact promotion strategy
Strategy: Hybrid controlled method (table-by-table)

Reasoning from schema/key inspection:
- Some core tables have stable business unique keys (source IDs), suitable for upsert.
- Several detail tables in kwsa_uat only have PK uniqueness on `id` and lack reliable business unique constraints for conflict-target upsert.

Chosen controlled method:
- Upsert by business key for core reference tables:
  - core_market_centers (source_market_center_id)
  - core_teams (source_team_id)
  - core_associates (source_associate_id)
  - core_listings (source_listing_id)
  - core_transactions (source_transaction_id)
- Controlled delete-and-reload (targeted table-level) for high-volume detail tables lacking robust unique business constraints in UAT:
  - listing_agents
  - listing_images
  - listing_marketing_urls
  - transaction_agents
  - transaction_agent_calculations
  - load_rejections
- Optional id_map_* handling only after explicit verification of target usage and schema compatibility.

Important:
- No schema clone.
- No full dump/restore as promotion method.
- No blanket truncate of all migration tables.
- No writes to public.* in this phase.

## 12. Exact proposed SQL commands (do not run)
The following SQL is proposal-only for execution in a future approved gate.

```sql
-- =========================================================
-- PHASE 5 PROPOSED PROMOTION SQL (DO NOT RUN IN 13A)
-- Source: kwsa_import_staging (via dblink_fdw/postgres_fdw or staged import)
-- Target: kwsa_uat
-- =========================================================

-- 0) Safety precheck
SELECT current_database();
-- expected in execution session: kwsa_uat

-- 1) Optional: transaction wrapper (split into batches for very large tables)
BEGIN;

-- 2) Core upsert set (business-key based)
-- NOTE: use explicit column lists and casts where source/target drift exists.

-- 2.1 core_market_centers
INSERT INTO migration.core_market_centers (
  source_market_center_id, name, status_name, frontdoor_id,
  company_registered_name, address_source_id, logo_document_id,
  contact_number, contact_email, kw_office_id,
  has_individual_cap, agent_default_cap, market_center_default_split,
  agent_default_split, productivity_coach, property24_opt_in,
  property24_auction_approved, market_center_property24_id,
  private_property_id, entegral_opt_in, entegral_url, entegral_portals,
  logo_image_url, country, province, city, suburb,
  erf_number, unit_number, door_number, estate_name,
  street_number, street_name, postal_code,
  longitude, latitude, override_display_location,
  display_longitude, display_latitude,
  created_at, updated_at
)
SELECT
  source_market_center_id, name, status_name, frontdoor_id,
  company_registered_name, address_source_id, logo_document_id,
  contact_number, contact_email, kw_office_id,
  has_individual_cap, agent_default_cap, market_center_default_split,
  agent_default_split, productivity_coach, property24_opt_in,
  property24_auction_approved, market_center_property24_id,
  private_property_id, entegral_opt_in, entegral_url, entegral_portals,
  logo_image_url, country, province, city, suburb,
  erf_number, unit_number, door_number, estate_name,
  street_number, street_name, postal_code,
  longitude, latitude, override_display_location,
  display_longitude, display_latitude,
  created_at, now()
FROM phase5_src.core_market_centers
ON CONFLICT (source_market_center_id) DO UPDATE
SET
  name = EXCLUDED.name,
  status_name = EXCLUDED.status_name,
  frontdoor_id = EXCLUDED.frontdoor_id,
  company_registered_name = EXCLUDED.company_registered_name,
  address_source_id = EXCLUDED.address_source_id,
  logo_document_id = EXCLUDED.logo_document_id,
  contact_number = EXCLUDED.contact_number,
  contact_email = EXCLUDED.contact_email,
  kw_office_id = EXCLUDED.kw_office_id,
  updated_at = now();

-- 2.2 core_teams
INSERT INTO migration.core_teams (
  source_team_id, source_market_center_id, market_center_id,
  name, status_name, created_at, updated_at
)
SELECT
  source_team_id, source_market_center_id, market_center_id,
  name, status_name, created_at, now()
FROM phase5_src.core_teams
ON CONFLICT (source_team_id) DO UPDATE
SET
  source_market_center_id = EXCLUDED.source_market_center_id,
  market_center_id = EXCLUDED.market_center_id,
  name = EXCLUDED.name,
  status_name = EXCLUDED.status_name,
  updated_at = now();

-- 2.3 core_associates
-- Critical drift handling:
-- source temporary_growth_share_sponsor=text, target=bool
-- source manual_cap=numeric, target=bool
INSERT INTO migration.core_associates (
  source_associate_id, source_market_center_id, source_team_id,
  market_center_id, team_id, first_name, last_name, full_name,
  email, status_name, kwuid, created_at, updated_at,
  national_id, ffc_number, private_email, mobile_number, office_number,
  proposed_growth_share_sponsor,
  temporary_growth_share_sponsor,
  vested, vesting_period_start_date,
  listing_approval_required, exclude_from_individual_reports,
  image_url, kwsa_email, property24_opt_in, agent_property24_id,
  property24_status, entegral_opt_in, agent_entegral_id, entegral_status,
  private_property_opt_in, private_property_status,
  cap, manual_cap, agent_split, projected_cos, projected_cap,
  start_date, end_date, anniversary_date, cap_date,
  growth_share_sponsor
)
SELECT
  source_associate_id, source_market_center_id, source_team_id,
  market_center_id, team_id, first_name, last_name, full_name,
  email, status_name, kwuid, created_at, now(),
  national_id, ffc_number, private_email, mobile_number, office_number,
  proposed_growth_share_sponsor,
  CASE
    WHEN lower(coalesce(temporary_growth_share_sponsor::text,'')) IN ('true','t','1','yes','y') THEN true
    WHEN lower(coalesce(temporary_growth_share_sponsor::text,'')) IN ('false','f','0','no','n') THEN false
    ELSE false
  END,
  vested, vesting_period_start_date,
  listing_approval_required, exclude_from_individual_reports,
  image_url, kwsa_email, property24_opt_in, agent_property24_id,
  property24_status, entegral_opt_in, agent_entegral_id, entegral_status,
  private_property_opt_in, private_property_status,
  cap,
  CASE WHEN coalesce(manual_cap,0) <> 0 THEN true ELSE false END,
  agent_split, projected_cos, projected_cap,
  start_date, end_date, anniversary_date, cap_date,
  growth_share_sponsor
FROM phase5_src.core_associates
ON CONFLICT (source_associate_id) DO UPDATE
SET
  source_market_center_id = EXCLUDED.source_market_center_id,
  source_team_id = EXCLUDED.source_team_id,
  market_center_id = EXCLUDED.market_center_id,
  team_id = EXCLUDED.team_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  status_name = EXCLUDED.status_name,
  updated_at = now();

-- 2.4 core_listings
INSERT INTO migration.core_listings (
  source_listing_id, source_market_center_id, market_center_id,
  listing_number, status_name, sale_or_rent,
  street_number, street_name, suburb, city, province, country,
  price, expiry_date, created_at, updated_at,
  property_title, short_title, property_description,
  listing_images_json, listing_payload,
  agent_property_valuation, poa, no_transfer_duty,
  signed_date, on_market_since_date, rates_and_taxes, monthly_levy,
  mandate_type, address_line, listing_status_tag, ownership_type,
  property_type, property_sub_type, descriptive_feature, retirement_living,
  short_description, erf_number, unit_number, door_number, estate_name,
  postal_code, longitude, latitude,
  override_display_location, override_display_longitude, override_display_latitude,
  reduced_date, property_auction, occupation_date,
  erf_size, floor_area, construction_date, height_restriction, out_building_size,
  zoning_type, is_furnished, pet_friendly, has_standalone_building, has_flatlet,
  has_backup_water, wheelchair_accessible, has_generator, has_borehole,
  has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
  has_solar_geyser, has_water_tank,
  adsl, fibre, isdn, dialup, fixed_wimax, satellite,
  nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
  is_draft, is_published
)
SELECT
  source_listing_id, source_market_center_id, market_center_id,
  listing_number, status_name, sale_or_rent,
  street_number, street_name, suburb, city, province, country,
  price, expiry_date, created_at, now(),
  property_title, short_title, property_description,
  listing_images_json, listing_payload,
  agent_property_valuation, poa, no_transfer_duty,
  signed_date, on_market_since_date, rates_and_taxes, monthly_levy,
  mandate_type, address_line, listing_status_tag, ownership_type,
  property_type, property_sub_type, descriptive_feature, retirement_living,
  short_description, erf_number, unit_number, door_number, estate_name,
  postal_code, longitude, latitude,
  override_display_location, override_display_longitude, override_display_latitude,
  reduced_date, property_auction, occupation_date,
  erf_size, floor_area, construction_date, height_restriction, out_building_size,
  zoning_type, is_furnished, pet_friendly, has_standalone_building, has_flatlet,
  has_backup_water, wheelchair_accessible, has_generator, has_borehole,
  has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
  has_solar_geyser, has_water_tank,
  adsl, fibre, isdn, dialup, fixed_wimax, satellite,
  nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
  is_draft, is_published
FROM phase5_src.core_listings
ON CONFLICT (source_listing_id) DO UPDATE
SET
  status_name = EXCLUDED.status_name,
  sale_or_rent = EXCLUDED.sale_or_rent,
  price = EXCLUDED.price,
  expiry_date = EXCLUDED.expiry_date,
  property_title = EXCLUDED.property_title,
  short_title = EXCLUDED.short_title,
  property_description = EXCLUDED.property_description,
  updated_at = now();

-- 2.5 core_transactions
-- UAT has extra columns; only populate common columns.
INSERT INTO migration.core_transactions (
  source_transaction_id, primary_market_center_id,
  transaction_number, transaction_status, transaction_type,
  source_listing_id, listing_number, address, suburb, city,
  sales_price, list_price, gci_excl_vat, net_comm, total_gci,
  sale_type, buyer, seller,
  list_date, transaction_date, status_change_date, expected_date,
  created_at, updated_at
)
SELECT
  source_transaction_id, primary_market_center_id,
  transaction_number, transaction_status, transaction_type,
  source_listing_id, listing_number, address, suburb, city,
  sales_price, list_price, gci_excl_vat, net_comm, total_gci,
  sale_type, buyer, seller,
  list_date, transaction_date, status_change_date, expected_date,
  created_at, now()
FROM phase5_src.core_transactions
ON CONFLICT (source_transaction_id) DO UPDATE
SET
  transaction_number = EXCLUDED.transaction_number,
  transaction_status = EXCLUDED.transaction_status,
  transaction_type = EXCLUDED.transaction_type,
  source_listing_id = EXCLUDED.source_listing_id,
  updated_at = now();

-- 3) Controlled reload set (tables without reliable business-key uniques in UAT)
DELETE FROM migration.listing_agents;
INSERT INTO migration.listing_agents (
  id, listing_id, associate_id, agent_name, agent_role,
  is_primary, market_center_id, sort_order, created_at
)
SELECT
  id, listing_id, associate_id, agent_name, agent_role,
  is_primary, market_center_id, sort_order, created_at
FROM phase5_src.listing_agents;

DELETE FROM migration.listing_images;
INSERT INTO migration.listing_images (
  id, listing_id, file_name, file_url, media_type,
  sort_order, uploaded_by, uploaded_at
)
SELECT
  id, listing_id, file_name, file_url, media_type,
  sort_order, uploaded_by, uploaded_at
FROM phase5_src.listing_images;

DELETE FROM migration.listing_marketing_urls;
INSERT INTO migration.listing_marketing_urls (
  id, listing_id, url, url_type, display_name, sort_order
)
SELECT
  id, listing_id, url, url_type, display_name, sort_order
FROM phase5_src.listing_marketing_urls;

DELETE FROM migration.transaction_agents;
INSERT INTO migration.transaction_agents (
  id, transaction_id, associate_id, source_associate_id,
  agent_role, split_percentage, sort_order, created_at, updated_at
)
SELECT
  id, transaction_id, associate_id, source_associate_id,
  agent_role, split_percentage, sort_order, created_at, updated_at
FROM phase5_src.transaction_agents;

DELETE FROM migration.transaction_agent_calculations;
INSERT INTO migration.transaction_agent_calculations (
  id, transaction_id, transaction_agent_id, associate_id,
  source_associate_id, is_outside_agent,
  agent_name, office_name, transaction_side,
  effective_reporting_date, is_registered,
  split_percentage, variance_sale_list_pct, sales_value_component,
  transaction_gci_before_fees, average_commission_pct,
  production_royalties, growth_share, total_pr_and_gs,
  gci_after_fees_excl_vat, associate_split_pct, market_center_split_pct,
  associate_dollar, cap_amount, cap_contribution, cap_remaining,
  team_dollar, market_center_dollar,
  cap_cycle_start_date, cap_cycle_end_date,
  created_at, updated_at
)
SELECT
  id, transaction_id, transaction_agent_id, associate_id,
  source_associate_id, is_outside_agent,
  agent_name, office_name, transaction_side,
  effective_reporting_date, is_registered,
  split_percentage, variance_sale_list_pct, sales_value_component,
  transaction_gci_before_fees, average_commission_pct,
  production_royalties, growth_share, total_pr_and_gs,
  gci_after_fees_excl_vat, associate_split_pct, market_center_split_pct,
  associate_dollar, cap_amount, cap_contribution, cap_remaining,
  team_dollar, market_center_dollar,
  cap_cycle_start_date, cap_cycle_end_date,
  created_at, updated_at
FROM phase5_src.transaction_agent_calculations;

DELETE FROM migration.load_rejections;
INSERT INTO migration.load_rejections (
  id, entity_name, source_id, reason, payload, rejected_at
)
SELECT
  id, entity_name, source_id, reason, payload, rejected_at
FROM phase5_src.load_rejections;

COMMIT;
```

## 13. Exact proposed PowerShell/psql execution command (do not run)
```powershell
# DO NOT RUN IN APPROVAL 13A
# Requires: approved maintenance window, rollback owner, explicit Approval 13B execution signoff

$raw = gcloud secrets versions access latest --secret="kwsa-backend-test-db-url" --project="kwsa-mapp" --quiet
$m = [regex]::Match($raw, '^postgres(?:ql)?://([^:]+):([^@]+)@')
if (-not $m.Success) { throw "Failed to parse DB credentials" }
$dbUser = $m.Groups[1].Value
$dbPass = $m.Groups[2].Value
$env:PGPASSWORD = $dbPass
$psql = (Get-ChildItem "C:\Program Files*\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName

# Safety prechecks
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_import_staging -v ON_ERROR_STOP=1 -c "SELECT current_database();"
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -c "SELECT current_database();"

# Proposed execution script (future gate only)
& $psql -h 127.0.0.1 -p 9470 -U $dbUser -d kwsa_uat -v ON_ERROR_STOP=1 -f "scripts/migration/phase5/promote-import-staging-to-uat-hybrid.sql"

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```

## 14. Pre-promotion checks
Mandatory (must pass before 13B execution):
1. Maintenance window active and announced.
2. Rollback owner assigned.
3. Fresh backup 1778860105623 confirmed SUCCESSFUL.
4. `SELECT current_database()` checks:
   - source session = kwsa_import_staging
   - target session = kwsa_uat
5. Cloud Run DB mapping reconfirmed (masked) for prod/test/public API.
6. Row-count baselines captured for source and target promotion tables.
7. Schema drift review acknowledged (types/columns deltas accepted by execution owner).
8. No unapproved secrets/env/deploy changes in progress.

## 15. Post-promotion checks
1. Row counts for promoted tables captured in kwsa_uat.
2. Compare source-vs-target counts and deltas documented.
3. Referential integrity checks:
   - orphan listing agents/images/urls
   - orphan transaction_agents/transaction_agent_calculations
4. Duplicate key checks on source business keys.
5. load_rejections categories reviewed.
6. Runtime smoke checks:
   - kwsa-backend-prod health/API
   - kwsa-backend-test health/API
   - kwsa-public-api-uat endpoints
7. Functional smoke checks:
   - login, dashboard, listings, transactions, core reports

## 16. Rollback commands using backup ID 1778860105623
```powershell
# DO NOT RUN IN APPROVAL 13A
# Use only if approved execution fails and rollback trigger is hit

gcloud sql backups restore 1778860105623 `
  --backup-instance=kwsa-postgres `
  --target-instance=kwsa-postgres `
  --project=kwsa-mapp
```

Post-rollback verification commands (proposal):
```powershell
gcloud sql backups list --instance=kwsa-postgres --project=kwsa-mapp --limit=5 --sort-by=~endTime
# Then rerun baseline counts and service health checks
```

## 17. Risk assessment
Overall risk: HIGH if executed without maintenance controls.

Key risks:
- Production still points to kwsa_uat.
- Schema drift between source and target on some promoted tables.
- Controlled reload set can impact production-path reads during execution.
- Incomplete rollback ownership can delay incident response.

Mitigations:
- Mandatory maintenance window.
- Named rollback owner and explicit stop/go authority.
- Fresh backup already in place.
- Pre/post validation and smoke checks formalized.
- No public schema writes in promotion package.

## 18. Final go/no-go checklist
Go only if all are YES:
- [ ] Maintenance window approved and active
- [ ] Rollback owner assigned
- [ ] Backup 1778860105623 confirmed SUCCESSFUL
- [ ] Production impact acknowledged (prod still on kwsa_uat)
- [ ] Final SQL reviewed and approved
- [ ] Precheck queries passed
- [ ] Post-check owner assigned
- [ ] Rollback trigger criteria documented

No-go if any are NO.

## 19. Exact recommended next approval
- Approval 13B: Phase 5 promotion execution (maintenance-window controlled)

Approval 13B should explicitly authorize:
1. Execution of approved hybrid SQL package from kwsa_import_staging to kwsa_uat.
2. Execution operator and rollback owner names.
3. Live stop/go checkpoints during window.
4. Immediate rollback using backup 1778860105623 if trigger conditions occur.

---

## 13A scope confirmation
- No promotion SQL executed.
- No data copied to kwsa_uat.
- No DML (insert/update/delete/truncate) executed.
- No touches to kwsa_prod or kwsa.
- No secret/env/deployment changes executed.
- No asset migration executed.
