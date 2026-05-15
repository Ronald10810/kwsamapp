# SCHEMA_COMPARISON_AZURE_TO_GCP

Date: 2026-05-13
Status: Initial inspection snapshot.

## A) PostgreSQL (Current Snapshot)
Source: docs/migration-runs/2026-05-13-run-001/postgres-metadata.json
- Database sampled: kwsa
- Base tables: 77
- Columns: 478
- Foreign keys: 68
- Indexes: 136

### Full PostgreSQL table inventory
SoftDeleteHelper
addresses
app_users
associate_business_details
associate_contact_details
associate_statuses
associate_third_party_integrations
associate_transfer_statuses
associate_transfers
associates
audit_logs
cities
cma_documents
contacts
countries
documents
email_types
icon_types
listing_associate_types
listing_associates
listing_building_area_feature_types
listing_building_area_features
listing_building_infos
listing_building_zoning_types
listing_descriptions
listing_document_types
listing_images
listing_lightstone_validation_statuses
listing_lightstone_validations
listing_loom_validation_statuses
listing_mandate_infos
listing_mandate_types
listing_marketing_url_types
listing_marketing_urls
listing_ownership_types
listing_p24_feed_item_statuses
listing_p24_feed_items
listing_price_details
listing_property_area_types
listing_property_areas
listing_property_feature_listing_sub_types
listing_property_feature_listing_types
listing_sale_or_rent_types
listing_status_tags
listing_statuses
listing_sub_types
listing_third_party_integrations
listing_types
listings
loom_user_tokens
market_center_statuses
market_centers
marketing_plan_documents
provinces
public_leads
referral_statuses
referral_types
roles
suburbs
team_statuses
teams
transaction_associate_payment_details
transaction_associate_types
transaction_associates
transaction_bonds
transaction_contact_types
transaction_contacts
transaction_descriptions
transaction_documents
transaction_financial_institutions
transaction_financing_channels
transaction_financing_types
transaction_notes
transaction_statuses
transactions
user_roles
users

## B) Azure Source Tables (From Current Export Logic)
Note: This is the table set referenced by export scripts, not a live sys.tables dump.

Address
Associate
AssociateBusinessDetail
AssociateContactDetail
AssociateDocument
AssociateStatus
City
Contact
Country
Document
Listing
ListingAssociate
ListingDescription
ListingDocument
ListingDocumentType
ListingImage
ListingMandateInfo
ListingMandateType
ListingMarketingUrl
ListingP24FeedItems
ListingPriceDetails
ListingPropertyArea
ListingPropertyAreaListingPropertyFeature
ListingPropertyAreaType
ListingPropertyFeature
ListingSaleOrRentTypes
ListingStatus
ListingThirdPartyIntegration
MarketCenter
MarketCenterStatus
Province
Suburb
Team
TeamStatus
Transaction
TransactionAssociate
TransactionAssociatePaymentDetail
TransactionAssociateType
TransactionBond
TransactionContact
TransactionContactType
TransactionDescription
TransactionDocuments
TransactionFinancialInstitution
TransactionFinancingChannel
TransactionFinancingType
TransactionNotes
TransactionStatus

## C) Initial Difference Summary
### PostgreSQL tables not represented in current Azure export mapping (likely MAPP 2.0/system tables)
app_users
audit_logs
cma_documents
loom_user_tokens
marketing_plan_documents
public_leads
roles
user_roles
users
(and additional lookup/bridge tables not selected by export script)

### Azure entities mapped to PostgreSQL with naming differences
- MarketCenter -> market_centers
- Team -> teams
- Associate -> associates
- Listing -> listings
- Transaction -> transactions
- ListingImage -> listing_images
- ListingDocument -> documents/listing linkage flow
- TransactionDocuments -> transaction_documents

## D) Column-Level Comparison Status
- Full live Azure column inventory: pending (requires approved query against Azure sys.columns).
- PostgreSQL column inventory: available in snapshot JSON.
- Scripted Azure->staging selected fields: available via scripts/export-azure-to-csv.ps1.

## E) Required Next SQL (Approval 2)
- Export Azure schema (tables, columns, indexes, constraints)
- Export PostgreSQL schema for kwsa_uat and kwsa_prod targets
- Generate deterministic diff report:
  - Azure-only columns
  - PostgreSQL-only columns
  - type differences
  - nullability differences
  - key/index differences

## F) Approval 8 Design Findings (2026-05-15)
- In kwsa_import_staging, app-ready working targets currently exist in migration schema, not public schema.
- public schema in kwsa_import_staging currently contains only _prisma_migrations.
- staging schema includes Phase 3 Group C/D source-rich tables:
  - listing_descriptions_raw_source
  - listing_images_raw_source
  - transaction_agents_raw_source
  - transaction_associate_payment_details_raw
- Existing transform scripts must be aligned to current Phase 3 table shapes before execution:
  - listing_associates now uses listing_id/associate_id text source keys
  - listing description merge must join by source_listing_id only
  - Group D mappings should prioritize *_raw_source and payment_details_raw tables
