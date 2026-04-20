# kwsa-cloud-console Architecture

## 1. New system goals

- Preserve the legacy business rules, workflows, and integration behavior from `current-system`.
- Modernise the platform with clean architecture, a professional console UX, and GCP-native deployment.
- Keep all calculations and formulas in testable backend service layers.
- Avoid carrying forward poor legacy UI or tightly coupled module structure.
- Deliver localhost-first development with a direct path to Cloud Run + Cloud Storage.

## 2. Module mapping

Legacy module -> New module

- `current-system/MAPP` -> `frontend/` + `backend/Api`
- `current-system/Application/Services` -> `backend/Application`
- `current-system/Application/Interfaces` -> `backend/Application/Contracts`
- `current-system/Domain/Entities` -> `backend/Domain/Entities`
- `current-system/EntityFrameworkCore` -> `backend/Infrastructure/Persistence`
- `current-system/ListingP24Feed` -> `backend/Infrastructure/Integration/Property24Queue`
- `current-system/Application/Services/BlobService.cs` -> `backend/Infrastructure/Storage/GoogleCloudStorageService`

## 3. Business logic and workflows to preserve exactly

- Associate transfer workflow and transaction movement rules
  - `AssociateTransferService.SaveAsync`
  - `UpdateAssociateOfficeAsync`
  - `MoveTransactionsAsync`
  - the status transitions and `AssociateTransactionMove` flag
- Listing publication and synchronization flow
  - `Property24Service.AddListingToPublishQueue`
  - conversion logic from `Listing` to P24 JSON models
  - `KWWFeedService.FeedListingToKWW` and response handling
  - property status, pricing, POA, show dates, rental info, and feature/tag mapping
- Listing index and access filters
  - role-based listing visibility for RegionalAdmin, OfficeAdmin, Agent
  - search and filter semantics in `ListingService.GetListingsForIndexAsync`
- Transaction retrieval and indexing
  - transaction status filtering, transaction email history, contract GCI logic
- Lightstone validation and unique selection checks
  - `ListingService.ValidateLightstoneSelectionAsync`
- Address/geography integration behavior
  - country/province/city/suburb sync workflows from Property24 integration

## 4. Azure-specific parts to replace

- Azure Storage / Blob storage
  - Replace `Azure.Storage.Blobs` with Google Cloud Storage
  - Replace legacy `BlobService` with `GcpStorageService`
- Azure WebJobs scheduled jobs
  - Replace `Microsoft.Azure.WebJobs` timer trigger functions with Cloud Run + Cloud Scheduler or Cloud Functions scheduled jobs
  - Replace queue semantics with Pub/Sub if async queue is required, or keep database-backed queue table + scheduler
- Azure-specific configuration and connection strings
  - Replace `AzureStorage`, Azure WebJobs storage connection, and Azure SDK configuration patterns with GCP service endpoints and Secret Manager

## 5. Proposed modern architecture

### Backend

- ASP.NET Core Web API (.NET 8/9)
- Clean Architecture with projects / layers:
  - `Api` - controller endpoints, request/response mapping, OpenAPI
  - `Application` - use cases, domain services, validation, commands/queries
  - `Domain` - entities, enums, value objects, domain exceptions
  - `Infrastructure` - EF Core PostgreSQL, GCS file storage, external HTTP clients, identity
- Business logic remains in `Application` and `Domain`
- Use `FluentValidation` or custom validators for service inputs
- Use `MedatR` optional if command/query separation helps, otherwise explicit service methods
- Unit tests for all calculations and workflows in `tests/`

### Frontend

- React + TypeScript
- Component-driven page architecture
- UX patterns:
  - dashboard and summary pages
  - listing and transaction index pages with filters
  - detail and edit pages with progress/status banners
  - modals or step flows for complex actions like associate transfer
- Use Material UI / Tailwind / modern component library
- Local-first dev with hot reload and API proxy configuration

### Deployment

- Build backend and frontend inside same mono-repo
- Deploy backend to Cloud Run
- Deploy frontend to Cloud Run or Cloud Storage + Cloud CDN
- Use Cloud SQL for PostgreSQL
- Use Cloud Storage buckets for files
- Use Secret Manager for runtime secrets
- Optionally use Pub/Sub + Cloud Scheduler for periodic sync jobs

## 6. Proposed stack

- Backend: .NET 8 or .NET 9 Web API
- Frontend: React + TypeScript
- Database: PostgreSQL via Cloud SQL
- Storage: Google Cloud Storage
- Scheduler: Cloud Scheduler + Cloud Run / Cloud Tasks
- Secrets: Secret Manager
- Local dev: Docker Compose with PostgreSQL + Fake GCS server
- Testing: xUnit / NUnit for backend, React Testing Library / Jest for frontend

## 7. Proposed PostgreSQL entity model

Key tables:

- `users` / `roles` / `user_roles`
- `associates`
- `associate_business_details`
- `associate_third_party_integrations`
- `associate_transfers`
- `transactions`
- `transaction_associates`
- `transaction_statuses`
- `listings`
- `listing_third_party_integrations`
- `listing_p24_feed_items`
- `listing_p24_feed_item_statuses`
- `listing_statuses`
- `listing_status_tags`
- `listing_price_details`
- `listing_descriptions`
- `listing_lightstone_validations`
- `listing_property_areas`
- `listing_property_area_types`
- `listing_marketing_urls`
- `marketing_url_types`
- `addresses`
- `countries`, `provinces`, `cities`, `suburbs`
- `market_centers`
- `teams`
- `documents`, `document_types`, `email_histories`, `email_types`

Relationships:

- `listing` has one `address`, `description`, `price_detail`, `status`, `status_tag`, `mandate_info`, `third_party_integration`
- `listing` has many `listing_associates`, `property_areas`, `marketing_urls`, `images`
- `associate` has one `associate_business_detail`, `associate_third_party_integration`
- `associate_transfer` references `associate`, `market_center_from`, `market_center_to`, `team`
- `transaction` has many `transaction_associates`, one `status`, one `description`
- `listing_p24_feed_item` references `listing` and `status`

Notes:

- Use normalized relational tables for core business data.
- Use JSONB only for optional extensible metadata such as ad-hoc listing feature tags or integration payload audits.

## 8. Google Cloud Storage file structure

Recommended bucket layout:

- `gs://kwsa-cloud-console-docs`:
  - `documents/` - uploaded contracts, proofs, reports
  - `listing-images/` - listing photo assets
  - `user-avatars/`
  - `exports/` - generated exports and reports
  - `temp/` - short-lived upload staging

- Optional bucket for logs and analytics:
  - `gs://kwsa-cloud-console-logs`
  - `gs://kwsa-cloud-console-backups`

Local emulator paths:

- `http://localhost:4443/storage/v1`
- create buckets on startup: `documents`, `listing-images`, `user-avatars`, `exports`

## 9. Proposed module folder structure

```
kwsa-cloud-console/
  README.md
  docker-compose.yml
  .gitignore
  docs/
    architecture.md
  backend/
    README.md
    src/
      Api/
      Application/
      Domain/
      Infrastructure/
    tests/
  frontend/
    README.md
    src/
      app/
      features/
      components/
      hooks/
      services/
      pages/
      styles/
  deployments/
  scripts/
```

## 10. Phased rebuild plan

Phase 1: Foundation
- Create repo structure, README, local Docker Compose environment.
- Define backend clean architecture projects and frontend page skeleton.
- Add PostgreSQL and local GCS emulator support.

Phase 2: Core domain model and persistence
- Build domain entities and EF Core mappings.
- Implement core services for listings, associates, transactions, and transfers.
- Add backend unit tests for calculations and workflow logic.

Phase 3: Integration and business flows
- Add Property24/KWW/Lightstone integration service adapters.
- Add listing feed queue and processing workflows.
- Add email and document upload storage support.

Phase 4: UI and UX
- Build a modern React console with dashboard, listings, transactions, and transfer pages.
- Implement search/filter UX, responsive tables, and edit forms.
- Add status summaries, notifications, and polished navigation.

Phase 5: GCP readiness
- Add Cloud Run deployment manifests, Cloud SQL config, Secret Manager integration.
- Add GCS upload/download support.
- Add Cloud Scheduler job definitions for periodic syncs.

Phase 6: Data migration and verification
- Create migration scripts to map legacy data into PostgreSQL.
- Validate legacy business logic against migrated samples.
- Perform QA of pricing, listing feed calculation, transaction movement, and role filtering.
