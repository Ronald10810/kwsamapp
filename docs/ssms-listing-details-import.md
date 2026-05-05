# Listing Details Import Runbook (Azure SQL -> Cloud SQL)

This runbook fills missing listing detail data required by Listings Edit and portal API mappings.

## 1. Export listing details from Azure SQL

Preferred (direct, no SSMS UI export):

```powershell
Set-Location "c:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console"
$env:AZURE_SQL_USER = "<azure_user>"
$env:AZURE_SQL_PASSWORD = "<azure_password>"
.\scripts\export-azure-listing-details-to-csv.ps1
```

This writes the expected files to `C:/exports` by default.

Fallback (manual):

Run [scripts/ssms-export-listing-details.sql](scripts/ssms-export-listing-details.sql) in SSMS and export each result set to CSV (UTF-8, include headers).

Export the following datasets to CSV (UTF-8, include headers):

1. ListingBuildingInfo
2. ListingBuildingInfoInternet
3. ListingBuildingInfoPublicTransport
4. ListingBuildingInfoSustainability
5. ListingBuildingInfoAreaFeatureExpanded (joined with area/feature names)
6. ListingPropertyAreaExpanded (joined with area type names)
7. ListingPropertyAreaFeatureExpanded (joined with feature names)
8. fListingAreaFeatures

Keep the column names aligned with [scripts/import-ssms-listing-details-from-csv.sql](scripts/import-ssms-listing-details-from-csv.sql).

## 2. Create staging tables in PostgreSQL

Run:

```powershell
Set-Location "c:\Users\ronal\OneDrive\Desktop\KWSA-Workspace\kwsa-cloud-console"
node scripts/run-sql.cjs scripts/bootstrap-ssms-listing-details-staging.sql
```

## 3. Import CSVs into staging

By default, [scripts/import-ssms-listing-details-from-csv.sql](scripts/import-ssms-listing-details-from-csv.sql) reads from `C:/exports`.

If you exported elsewhere, update the CSV paths in [scripts/import-ssms-listing-details-from-csv.sql](scripts/import-ssms-listing-details-from-csv.sql).

Run with psql (this file uses \copy, so do not run via run-sql.cjs):

```powershell
psql "$env:DATABASE_URL" -f "scripts/import-ssms-listing-details-from-csv.sql"
```

## 4. Map staging data into migration tables

Run:

```powershell
node scripts/run-sql.cjs scripts/map-ssms-listing-details-into-migration.sql
```

This hydrates:

1. migration.core_listings (building/internet/transport/sustainability)
2. migration.listing_features (Building Features, Property Descriptives, Lifestyle Tags)
3. migration.listing_property_areas (areas + sub-features)

## 5. Verify coverage

Run in Postgres:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE erf_size IS NOT NULL OR floor_area IS NOT NULL) AS has_building_info,
  COUNT(*) FILTER (WHERE adsl OR fibre OR isdn OR dialup OR fixed_wimax OR satellite) AS has_internet,
  COUNT(*) FILTER (WHERE has_solar_panels OR has_solar_geyser OR has_gas_geyser OR has_water_tank OR has_borehole OR has_backup_battery_or_inverter) AS has_sustainability,
  COUNT(*) FILTER (WHERE nearby_bus_service OR nearby_minibus_taxi_service OR nearby_train_service) AS has_transport
FROM migration.core_listings;

SELECT COUNT(DISTINCT listing_id) AS listings_with_features
FROM migration.listing_features;

SELECT COUNT(DISTINCT listing_id) AS listings_with_property_areas
FROM migration.listing_property_areas;
```

## 6. Validate in app

Open Listings Edit for known records and confirm these sections populate:

1. Property Details
2. Building Info
3. General Property Features
4. Sustainability
5. Internet
6. Public Transport
7. Building Features
8. Property Descriptives
9. Lifestyle Tags
10. Property Areas/Rooms
