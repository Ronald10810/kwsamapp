# KWSA Cloud Console - Migration Summary & Architecture

## Complete Architecture Design

This document outlines the new [`kwsa-cloud-console`](kwsa-cloud-console ) architecture, mapping legacy modules to modern equivalents while preserving all business logic.

---

## 1. Legacy → Modern Module Mapping

| Legacy Module | Location | New Module | Technology |
|---|---|---|---|
| MAPP (Blazor Server) | `current-system/MAPP/` | React SPA | `frontend/src/pages/` |
| Application.Services | `current-system/Application/Services/` | Express Controllers + Services | `backend/src/controller/` + `backend/src/services/` |
| Domain.Entities | `current-system/Domain/Entities/` | Prisma Schema | `backend/prisma/schema.prisma` |
| EntityFrameworkCore | `current-system/EntityFrameworkCore/` | Prisma ORM | `backend/prisma/` |
| ListingP24Feed (WebJob) | `current-system/ListingP24Feed/` | Node.js Service | `backend/src/services/` |
| Azure Blob Storage | Azure | Google Cloud Storage | `backend/src/services/gcs/` |

---

## 2. Business Logic & Calculations to Preserve

### 2.1 Associate Management
**Legacy File**: [`current-system/Application/Services/AssociateTransferService.cs`](current-system/Application/Services/AssociateTransferService.cs )

**Preserved Workflows**:
- ✅ Associate transfer between market centers
- ✅ Team reassignment during transfers
- ✅ Optional transaction movement with transfers
- ✅ Property24 agent ID sync during transfers
- ✅ Pending transfer queue with state management
- ✅ Transfer completion validation

**Database Entities**: `AssociateTransfer`, `Associate`, `AssociateBusinessDetail`, `AssociateThirdPartyIntegration`

### 2.2 Listing Management
**Legacy Files**: 
- [`current-system/Application/Services/ListingService.cs`](current-system/Application/Services/ListingService.cs )
- [`current-system/Application/Services/Property24Service.cs`](current-system/Application/Services/Property24Service.cs )
- [`current-system/Application/Services/KWWFeedService.cs`](current-system/Application/Services/KWWFeedService.cs )

**Preserved Workflows**:
- ✅ Listing CRUD with full property details
- ✅ Listing status & status tags tracking
- ✅ Price details including POA, transfer duty, repossession flags
- ✅ Building info with area features (bedrooms, bathrooms, garages, etc.)
- ✅ Property24 feed conversion to JSON format
- ✅ KWW feed with GZIP compression handling
- ✅ Lightstone property validation
- ✅ Third-party integration reference tracking (P24, KWW, Lightstone, Entegral)
- ✅ Mandate types (exclusive, inclusive, multi-listing, etc.)
- ✅ Listing permissions by role (Regional Admin, Office Admin, Agent)

**Database Entities**: `Listing`, `ListingDescription`, `ListingPriceDetail`, `ListingBuildingInfo`, `ListingThirdPartyIntegration`, `ListingP24FeedItem`

### 2.3 Transaction Management
**Legacy File**: [`current-system/Application/Services/TransactionService.cs`](current-system/Application/Services/TransactionService.cs )

**Preserved Workflows**:
- ✅ Transaction CRUD with status tracking
- ✅ Transaction associates with type roles (seller, buyer agent, co-agent, etc.)
- ✅ Transaction payment details & commission calculations
- ✅ Transaction bond info with financing types, channels, institutions
- ✅ Transaction contact management
- ✅ Document attachments
- ✅ Email history tracking
- ✅ Status-based transaction filtering (active, pending, completed, cancelled)
- ✅ GCI calculation with VAT exclusion

**Database Entities**: `Transaction`, `TransactionAssociate`, `TransactionBond`, `TransactionDescription`, `TransactionContact`

### 2.4 Third-Party Integrations
**Preserved Integrations**:
- ✅ **Property24**: Agent IDs, listing feed queue, JSON conversion
- ✅ **KWW**: KWUID per market center, listing feed with UUID refs, gzip compression
- ✅ **Lightstone**: Property validation & LightStone IDs
- ✅ **Entegral**: Reference tracking (currently commented in legacy)

**Integration Reference Fields in Database**:
- `AssociateThirdPartyIntegration.p24AgentId`
- `ListingThirdPartyIntegration.property24Reference`
- `ListingThirdPartyIntegration.kwwReference`
- `ListingThirdPartyIntegration.lightStonePropertyId`
- `MarketCenter.frontdoorId` (KWW)

---

## 3. Azure-Specific Parts → GCP Replacements

| Legacy (Azure) | Component | New (GCP) |
|---|---|---|
| Azure Blob Storage | File uploads | Google Cloud Storage (GCS) |
| Azure WebJobs (Timer-triggered) | Scheduled P24 feed | Cloud Tasks + Cloud Run |
| Azure Identity | Auth | Custom JWT + Firebase Auth (optional) |
| Azure Application Insights | Logging | Cloud Logging + Stackdriver |
| Azure SQL Server | Database | PostgreSQL on Cloud SQL |
| Azure Service Bus Queues | Message queues | Cloud Tasks (or Pub/Sub) |

**Implementation**: 
- `backend/src/services/gcs.ts` - Google Cloud Storage client
- `backend/src/services/integration/` - Property24, KWW, Lightstone clients
- Environment variables for GCS credentials in `.env.example`

---

## 4. Modern Architecture for kwsa-cloud-console

### 4.1 Backend Stack
- **Framework**: Express.js (Node.js)
- **ORM**: Prisma with PostgreSQL
- **Language**: TypeScript
- **Validation**: Zod for runtime type checking
- **Logging**: Pino for structured logs
- **Auth**: JWT tokens (with optional Firebase for OAuth)
- **File Storage**: Google Cloud Storage via @google-cloud/storage

### 4.2 Frontend Stack
- **Framework**: React 18 with TypeScript
- **UI Library**: TailwindCSS + Headless UI
- **State**: React Query + Zustand
- **Build**: Vite
- **HTTP Client**: Axios

### 4.3 Key Improvements Over Legacy

#### UX/UI Improvements
✅ Modern React SPA instead of Blazor Server (better responsiveness)
✅ Tailwind CSS for professional design (vs old UI)
✅ Responsive sidebar navigation
✅ Cleaner form layouts with validation feedback
✅ Dashboard with key metrics & widgets
✅ Advanced filtering & search on all list views
✅ Optimistic updates via React Query
✅ Toast notifications for user feedback

#### Architecture Improvements
✅ Business logic in services, not UI (testable)
✅ Strict TypeScript types everywhere
✅ Zod validation for request/response contracts
✅ Middleware-based error handling
✅ Structured logging with context
✅ Clean separation of concerns
✅ Docker for reproducible local dev
✅ Ready for serverless deployment (Cloud Run)

#### Developer Experience
✅ Hot module reload during dev
✅ TypeScript strict mode prevents bugs
✅ Comprehensive type hints via Prisma
✅ Easy database migrations
✅ Local development is first-class concern
✅ Clear folder structure & conventions
✅ Ready for unit & integration tests

---

## 5. PostgreSQL Entity Model

**File**: `backend/prisma/schema.prisma`

### Core Entities (Preserved from Legacy)

```
Users & Auth
├── User (email, password, firstName, lastName)
├── Role (REGIONAL_ADMIN, OFFICE_ADMIN, AGENT)
└── UserRole (join table)

Geographic Boundaries
├── Country (name, p24Id for Property24 sync)
├── Province (name, p24Id, countryId)
├── City (name, p24Id, provinceId)
├── Suburb (name, p24Id, cityId)
└── Address (all components, soft-deletable)

Organizational Structure
├── MarketCenter (name, addressId, frontdoorId for KWW, statusId)
├── Team (name, marketCenterId, statusId)
├── TeamStatus (Active, Inactive, etc.)
└── MarketCenterStatus

Associates (Agents)
├── Associate (firstName, lastName, statusId, marketCenterId, teamId)
├── AssociateStatus
├── AssociateBusinessDetail (kwuid for KWW, breeNumber)
├── AssociateThirdPartyIntegration (p24AgentId)
├── AssociateContactDetail (email, phone, fax)
└── AssociateTransfer (transfer workflow, optional transaction move)

Listings
├── Listing (listingNumber, addressId, various statuses/types)
├── ListingDescription (propertyTitle, description, listingTypeId)
├── ListingPriceDetail (price, poa, transferDuty flags, repossessed)
├── ListingBuildingInfo (features, area types)
├── ListingLightStoneValidation (lightStonePropertyId)
├── ListingThirdPartyIntegration (p24Reference, kwwReference)
├── ListingMandateInfo (mandateTypeId)
├── ListingAssociate (join for associates on listing)
├── ListingImage (documents with order)
├── ListingPropertyArea (bedrooms, bathrooms, garages with sizes)
├── ListingMarketingUrl (URLs for marketing)
└── ListingP24FeedItem (queue for Property24 feed)

Transactions
├── Transaction (transactionNumber, listingId, statusId)
├── TransactionStatus (Active, Pending, Completed, etc.)
├── TransactionDescription (soldPrice, contractGCI, date)
├── TransactionBond (bond details, financing type/institution)
├── TransactionAssociate (role, payment details)
├── TransactionAssociateType (seller agent, buyer agent, co-list, etc.)
├── TransactionAssociatePaymentDetail (amount, commission %)
├── TransactionContact (attorneys, brokers, etc.)
├── TransactionContactType
├── TransactionDocument (attached files)
└── TransactionNote (notes/comments)

Shared
├── Contact (for attorneys, brokers, financing contacts)
└── Document (file metadata with URL)
```

All entities support:
- **Soft delete**: `deletedAt` field
- **Audit trail**: `createdAt`, `updatedAt`
- **Relationships**: Proper foreign keys with cascade rules

---

## 6. Google Cloud Storage File Structure

**GCS Bucket**: `kwsa-cloud-storage`

```
kwsa-cloud-storage/
├── listings/
│   ├── {listingId}/
│   │   ├── images/
│   │   │   └── {uuid}.{ext}  # Photos, ordered by orderNumber
│   │   └── documents/
│   │       └── {uuid}.{ext}  # Marketing materials, floor plans, etc.
│
├── transactions/
│   ├── {transactionId}/
│   │   ├── documents/
│   │   │   └── {uuid}.{ext}  # OTP, contracts, transfer docs
│   │   └── emails/
│   │       └── {uuid}.eml    # Email archives
│
├── associates/
│   ├── {associateId}/
│   │   ├── profile/
│   │   │   └── avatar.{ext}   # Profile photo
│   │   └── documents/
│   │       └── {uuid}.{ext}   # Licenses, certs
│
└── reports/
    └── {reportId}/
        └── report-{date}.pdf  # Generated reports
```

**Access Control**:
- Public read for listing images & marketing URLs
- Private for transaction documents
- Signed URLs for temporary access
- Metadata includes original filename & content type

---

## 7. New Module Folder Structure

```
kwsa-cloud-console/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── logger.ts              # Pino configuration
│   │   │   ├── database.ts            # Prisma client setup
│   │   │   └── gcs.ts                 # Google Cloud Storage client
│   │   │
│   │   ├── middleware/
│   │   │   ├── errorHandler.ts        # Global error handler
│   │   │   ├── auth.ts                # JWT verification
│   │   │   ├── roles.ts               # Role-based access control
│   │   │   └── logging.ts             # Request/response logging
│   │   │
│   │   ├── controllers/
│   │   │   ├── listings.ts            # Listing HTTP handlers
│   │   │   ├── transactions.ts        # Transaction HTTP handlers
│   │   │   ├── associates.ts          # Associate HTTP handlers
│   │   │   └── files.ts               # File upload/download handlers
│   │   │
│   │   ├── services/                  # BUSINESS LOGIC (CRITICAL)
│   │   │   ├── listings/
│   │   │   │   ├── listing.service.ts # Listing CRUD & workflows
│   │   │   │   ├── p24.service.ts     # Property24 integration
│   │   │   │   ├── kww.service.ts     # KWW feed integration
│   │   │   │   └── lightstone.service.ts # Lightstone validation
│   │   │   │
│   │   │   ├── transactions/
│   │   │   │   ├── transaction.service.ts # Transaction workflows
│   │   │   │   ├── payment.service.ts  # Commission calculations
│   │   │   │   └── bond.service.ts     # Bond/financing calculations
│   │   │   │
│   │   │   ├── associates/
│   │   │   │   ├── associate.service.ts # Associate CRUD
│   │   │   │   └── transfer.service.ts  # Transfer workflows
│   │   │   │
│   │   │   ├── files/
│   │   │   │   └── storage.service.ts    # GCS upload/download
│   │   │   │
│   │   │   └── integrations/
│   │   │       ├── property24.ts      # Property24 API client
│   │   │       ├── kww.ts             # KWW API client
│   │   │       ├── lightstone.ts      # Lightstone API client
│   │   │       └── email.ts           # Email service
│   │   │
│   │   ├── routes/
│   │   │   ├── listings.ts
│   │   │   ├── transactions.ts
│   │   │   ├── associates.ts
│   │   │   ├── files.ts
│   │   │   └── index.ts               # Route aggregator
│   │   │
│   │   ├── types/
│   │   │   ├── listing.ts             # TypeScript types
│   │   │   ├── transaction.ts
│   │   │   ├── associate.ts
│   │   │   └── common.ts              # Shared types
│   │   │
│   │   ├── utils/
│   │   │   ├── validation.ts          # Zod schemas
│   │   │   ├── errors.ts              # Custom error classes
│   │   │   └── helpers.ts             # Utility functions
│   │   │
│   │   └── index.ts                   # Server entry point
│   │
│   ├── prisma/
│   │   ├── schema.prisma              # Database schema
│   │   ├── migrations/                # Version history
│   │   └── seed.ts                    # Seed data for dev
│   │
│   ├── tests/
│   │   ├── unit/
│   │   │   ├── services/              # Service logic tests
│   │   │   └── utils/                 # Utility function tests
│   │   └── integration/
│   │       └── api/                   # API endpoint tests
│   │
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Select.tsx
│   │   │   │   └── Table.tsx
│   │   │   │
│   │   │   ├── layout/
│   │   │   │   ├── Layout.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Navbar.tsx
│   │   │   │
│   │   │   └── features/
│   │   │       ├── listings/          # Listing-specific components
│   │   │       ├── transactions/      # Transaction-specific components
│   │   │       └── associates/        # Associate-specific components
│   │   │
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Listings.tsx
│   │   │   ├── ListingDetail.tsx
│   │   │   ├── Transactions.tsx
│   │   │   ├── TransactionDetail.tsx
│   │   │   ├── Associates.tsx
│   │   │   └── AssociateDetail.tsx
│   │   │
│   │   ├── services/
│   │   │   ├── api.ts                 # Axios instance & base config
│   │   │   ├── listings.ts            # Listing API calls
│   │   │   ├── transactions.ts        # Transaction API calls
│   │   │   └── associates.ts          # Associate API calls
│   │   │
│   │   ├── hooks/
│   │   │   ├── useListings.ts         # Custom React hooks
│   │   │   ├── useTransactions.ts
│   │   │   ├── useAssociates.ts
│   │   │   └── useAuth.ts
│   │   │
│   │   ├── context/
│   │   │   ├── AuthContext.tsx        # Auth state
│   │   │   └── ThemeContext.tsx       # UI theme state
│   │   │
│   │   ├── types/
│   │   │   ├── listing.ts             # Frontend types
│   │   │   ├── transaction.ts
│   │   │   ├── associate.ts
│   │   │   └── api.ts                 # API response types
│   │   │
│   │   ├── styles/
│   │   │   ├── index.css              # Global styles
│   │   │   └── tailwind.css           # Tailwind directives
│   │   │
│   │   ├── utils/
│   │   │   ├── format.ts              # Formatting utilities
│   │   │   ├── validation.ts          # Client-side validation
│   │   │   └── constants.ts           # App constants
│   │   │
│   │   ├── App.tsx
│   │   └── main.tsx                   # Entry point
│   │
│   ├── public/
│   │   ├── favicon.ico
│   │   └── logo.png
│   │
│   ├── tests/
│   │   ├── components/                # Component tests
│   │   └── integration/               # E2E tests
│   │
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   └── .env.example
│
├── docs/
│   ├── ARCHITECTURE.md                # System design (THIS FILE)
│   ├── DATABASE.md                    # Schema details
│   ├── API.md                         # REST endpoint specs
│   ├── BUSINESS_LOGIC.md              # Formulas & workflows
│   ├── GCS_STRUCTURE.md              # Cloud Storage layout
│   ├── DEPLOYMENT.md                  # GCP deployment
│   ├── DEVELOPMENT.md                 # Local dev setup
│   └── MIGRATION_NOTES.md             # Legacy mapping
│
├── docker-compose.yml                 # PostgreSQL + Redis
├── .env.example                       # Root environment template
├── .gitignore
└── package.json                       # Root workspace
```

---

## 8. Phased Rebuild Plan

### **Phase 1: Foundation (Active)**
✅ Project structure & tooling
✅ Backend Express + Prisma skeleton
✅ Frontend React + Tailwind setup  
✅ PostgreSQL schema with all entities
✅ Docker Compose for local dev
**Timeline**: Week 1
**Deliverables**: Running local dev environment, empty API endpoints

### **Phase 2: User & Organization (Week 2-3)**
- [ ] User authentication (JWT)
- [ ] Role-based access control (RBAC)
- [ ] Market centers CRUD
- [ ] Teams CRUD
- [ ] Associate CRUD
- [ ] Dashboard with key metrics

**API Endpoints**:
```
POST   /api/auth/login
GET    /api/market-centers
POST   /api/market-centers
GET    /api/market-centers/:id
PUT    /api/market-centers/:id
GET    /api/teams
POST   /api/teams
GET    /api/associates
POST   /api/associates
GET    /api/associates/:id
PUT    /api/associates/:id
```

### **Phase 3: Listings (Week 4-5)**
- [ ] Listing CRUD
- [ ] Address management with P24 sync
- [ ] Listing images & documents
- [ ] Listing status & status tags
- [ ] Listing mandates & pricing
- [ ] Building info features
- [ ] Listing list view with filters, search, pagination
- [ ] Listing detail view

**Services to Implement**:
- `listings.service.ts` - Core listing workflows
- `property24.service.ts` - P24 reference syncing

### **Phase 4: Transactions (Week 6-7)**
- [ ] Transaction CRUD
- [ ] Transaction status workflows
- [ ] Transaction associates with payments
- [ ] Transaction descriptions & pricing
- [ ] Transaction bonds & financing
- [ ] Transaction contacts
- [ ] Transaction list view
- [ ] Transaction detail view

**Services to Implement**:
- `transaction.service.ts` - Core transaction workflows
- `payment.service.ts` - Commission calculations
- `bond.service.ts` - Bond calculations

### **Phase 5: Advanced Features (Week 8-9)**
- [ ] Associate transfers workflow
- [ ] File upload to Google Cloud Storage
- [ ] Listing P24 feed integration
- [ ] Listing KWW feed integration
- [ ] Email notifications
- [ ] Audit logging
- [ ] Reporting

**Services to Implement**:
- `transfer.service.ts` - Associate transfer workflows
- `storage.service.ts` - GCS integration
- `p24.service.ts` - Property24 feed
- `kww.service.ts` - KWW feed

### **Phase 6: Polish & Deployment (Week 10+)**
- [ ] UI/UX refinements
- [ ] Performance optimization
- [ ] Error handling & validation
- [ ] Unit & integration tests
- [ ] GCP setup (Cloud Run, Cloud Storage, Cloud SQL)
- [ ] CI/CD pipeline
- [ ] Security hardening
- [ ] User acceptance testing
- [ ] Data migration from legacy system (optional)

---

## 9. Technical Stack Rationale

### Why Node.js + Express?
✅ JavaScript/TypeScript across full stack
✅ Fast startup & deployment to Cloud Run
✅ Excellent async/await support
✅ Rich ecosystem (Prisma, Zod, Pino)
✅ Easy horizontal scaling

### Why React?
✅ Component-based UI is maintainable
✅ React Query handles data fetching beautifully
✅ Tailwind CSS enables rapid UI development
✅ TypeScript prevents entire categories of bugs
✅ Hot Module Reload during dev

### Why PostgreSQL?
✅ Mature, reliable, well-tested
✅ Full ACID guarantees
✅ Excellent JSON support
✅ Prisma ORM abstraction
✅ Easy to migrate/replicate

### Why Prisma?
✅ Type-safe database access
✅ Zero-runtime-dependency ORM
✅ Automatic migration generation
✅ Excellent developer experience
✅ Query optimization

### Why Google Cloud?
✅ Excellent serverless offerings (Cloud Run)
✅ GCS for file storage
✅ Cloud SQL for managed PostgreSQL
✅ Cloud Tasks for job scheduling
✅ Native integration with Google services

---

## 10. Testing & Quality Assurance

### Backend Testing
- **Unit tests**: Service layer logic (vitest)
- **Integration tests**: API endpoints with test database
- **E2E tests**: Critical user workflows

### Frontend Testing
- **Component tests**: React components (vitest + testing-library)
- **Integration tests**: Multi-component workflows
- **Snapshot tests**: UI components (optional)

### Code Quality
- TypeScript strict mode everywhere
- ESLint for code standards
- Prettier for formatting
- Pre-commit hooks for linting

---

## 11. Deployment Pipeline

### Local Development
```bash
docker-compose up -d                # Start PostgreSQL
npm install                         # Install dependencies
npm run dev                         # Start backend + frontend
```
Backend: http://localhost:3000
Frontend: http://localhost:5173

### Staging (GCP)
- Cloud Run for backend
- Firebase Hosting for frontend
- Cloud SQL for PostgreSQL
- GCS for file storage

### Production
- Same as staging, with additional hardening
- WAF (Cloud Armor) protection
- CDN for frontend (Cloud CDN)
- Monitoring & alerting (Cloud Monitoring)

---

## 12. Success Criteria

✅ All legacy business logic preserved and tested
✅ Modern, professional UI exceeds legacy
✅ Full localhost development support
✅ Deployable to GCP with single command
✅ TypeScript strict mode throughout
✅ All calculations testable in services
✅ <100ms median API latency
✅ Real-time error notifications
✅ Comprehensive audit logging
✅ Zero data loss during migration

---

This architecture provides a solid foundation for rebuilding kwsa-cloud-console as a modern, production-grade platform while preserving all legacy business logic and improving architectural quality.
