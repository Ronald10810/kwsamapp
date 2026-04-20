# Database Schema Documentation

PostgreSQL database schema for kwsa-cloud-console, preserved from legacy system with improvements.

## Entity Relationship Diagram (Conceptual)

```
User [1] ──── [*] UserRole ──── [*] Role
  │
  ├─ [1] Market Center [1] ──── [*] Team ──── [*] Associate
  │
  └─ [1] Address ──── [*] Geographic Data (Country, Province, City, Suburb)

Listing [*] ──── [1] Address
  │
  ├─ [*] Associate (via ListingAssociate - N:M relationship)
  │
  ├─ [1] ListingDescription
  │
  ├─ [1] ListingPriceDetail
  │
  ├─ [1] ListingBuildingInfo ──── [*] ListingBuildingAreaFeature ──── [*] ListingBuildingAreaFeatureType
  │
  ├─ [1] ListingLightStoneValidation
  │
  ├─ [1] ListingThirdPartyIntegration (P24, KWW, Lightstone refs)
  │
  ├─ [1] ListingMandateInfo ──── [1] ListingMandateType
  │
  ├─ [*] ListingImage
  │
  ├─ [*] ListingPropertyArea ──── [*] ListingPropertyAreaType
  │
  ├─ [*] ListingMarketingUrl ──── [*] ListingMarketingUrlType
  │
  └─ [*] ListingP24FeedItem (Queue for Property24 export)

Transaction [*] ──── [1] Listing
  │
  ├─ [1] TransactionStatus
  │
  ├─ [1] TransactionDescription
  │
  ├─ [1] TransactionBond ──── [1] TransactionFinancingType ──── [*] TransactionFinancialInstitution
  │                      │
  │                      └─ [1] TransactionFinancingChannel
  │
  ├─ [*] TransactionAssociate ──── [1] Associate
  │                             ├─ [1] TransactionAssociateType
  │                             └─ [1] TransactionAssociatePaymentDetail
  │
  ├─ [*] TransactionContact ──── [*] Contact ──── [1] TransactionContactType
  │
  ├─ [*] TransactionDocument ──── [*] Document
  │
  └─ [*] TransactionNote

Associate [*] ──── [1] AssociateStatus
  │
  ├─ [1] AssociateBusinessDetail
  │
  ├─ [*] AssociateThirdPartyIntegration (P24 Agent ID, Lightstone refs)
  │
  ├─ [*] AssociateContactDetail
  │
  ├─ [*] AssociateTransfer ──── [1] AssociateTransferStatus
  │                         ├─ [1] Source MarketCenter
  │                         ├─ [1] Target MarketCenter
  │                         ├─ [1] Source Team
  │                         └─ [1] Target Team
  │
  └─ [*] ListingAssociate (many listings, as agent)

MarketCenter [*] ──── [*] AssociateTransfer (source/target)
  │
  ├─ [1] MarketCenterStatus
  │
  ├─ [1] Address
  │
  └─ [*] Team
```

---

## Core Entity Descriptions

### Authentication & Authorization

#### `User`
Represents a system user.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | Primary key |
| `email` | String | No | Unique, lowercase |
| `password` | String | No | Bcrypt hash |
| `firstName` | String | No | |
| `lastName` | String | No | |
| `isActive` | Boolean | No | Default: true |
| `lastLogin` | DateTime | Yes | |
| `createdAt` | DateTime | No | Audit |
| `updatedAt` | DateTime | No | Audit |
| `deletedAt` | DateTime | Yes | Soft delete |

**Indexes**:
- Unique on `email`
- Index on `isActive`, `deletedAt`

#### `Role`
Represents user roles in the system.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | Primary key |
| `name` | String | No | REGIONAL_ADMIN, OFFICE_ADMIN, AGENT |
| `description` | String | Yes | |
| `permissions` | String | Yes | JSON array of permission slugs |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

**Standard Roles**:
- `REGIONAL_ADMIN`: Full access to region data
- `OFFICE_ADMIN`: Full access to their office/market center
- `AGENT`: Limited to their own listings & transactions
- VIEW_ONLY`: Read-only access

#### `UserRole`
Join table for users and roles (N:M relationship).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | Primary key |
| `userId` | UUID | No | Foreign key to User |
| `roleId` | UUID | No | Foreign key to Role |
| `assignedAt` | DateTime | No | |
| `createdAt` | DateTime | No | |

**Indexes**:
- Unique composite on `userId`, `roleId`

---

### Geographic Data

#### `Country`
Countries supported for listings.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "South Africa" |
| `code` | String | No | 2-letter ISO code, unique |
| `p24CountryId` | String | Yes | Property24 country ID |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `Province`
Provinces within countries.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "Western Cape" |
| `code` | String | Yes | Optional province code |
| `countryId` | UUID | No | Foreign key |
| `p24ProvinceId` | String | Yes | Property24 province ID |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

**Indexes**:
- Foreign key on `countryId`
- Composite unique on `countryId`, `name`

#### `City`
Cities within provinces.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "Cape Town" |
| `provinceId` | UUID | No | Foreign key |
| `p24CityId` | String | Yes | Property24 city ID |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `Suburb`
Suburbs within cities.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "Constantia" |
| `cityId` | UUID | No | Foreign key |
| `p24SuburbId` | String | Yes | Property24 suburb ID |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `Address`
Complete addresses for properties and market centers.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `streetNumber` | String | Yes | e.g., "123" |
| `streetName` | String | No | e.g., "Main Street" |
| `suburb` | String | No | e.g., "Constantia" |
| `city` | String | No | e.g., "Cape Town" |
| `province` | String | No | e.g., "Western Cape" |
| `postalCode` | String | Yes | e.g., "8000" |
| `countryId` | UUID | No | Foreign key |
| `latitude` | Float | Yes | For mapping |
| `longitude` | Float | Yes | For mapping |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |

**Indexes**:
- Index on `suburb`, `city` (for fast address lookups)

---

### Organization Structure

#### `MarketCenter`
Physical or virtual market center (office).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "Constantia Office" |
| `addressId` | UUID | Yes | Foreign key to office address |
| `frontdoorId` | String | Yes | KWW Frontdoor ID |
| `statusId` | UUID | No | Foreign key (Active, Inactive, etc.) |
| `phone` | String | Yes | Office phone |
| `email` | String | Yes | Office email |
| `regionCode` | String | Yes | WC, EC, GP, etc. |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |

**Indexes**:
- Index on `name`, `statusId`
- Foreign key on `statusId`

#### `MarketCenterStatus`
Status enum for market centers.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | ACTIVE, INACTIVE, TRANSFERRED |

**Seeded Values**:
- ACTIVE
- INACTIVE
- TRANSFERRED

#### `Team`
Teams within a market center.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | e.g., "Residential Sales" |
| `marketCenterId` | UUID | No | Foreign key |
| `statusId` | UUID | No | Foreign key |
| `description` | String | Yes | Team description |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |

#### `TeamStatus`
Status enum for teams.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | ACTIVE, INACTIVE |

---

### Associates (Agents)

#### `Associate`
Real estate agent.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `firstName` | String | No | |
| `lastName` | String | No | |
| `email` | String | No | |
| `marketCenterId` | UUID | No | Foreign key (current office) |
| `teamId` | UUID | Yes | Foreign key (current team) |
| `statusId` | UUID | No | Foreign key |
| `joinDate` | DateTime | Yes | When agent joined |
| `licenseNumber` | String | Yes | Agent license FAIS number |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |

#### `AssociateStatus`
Status enum for associates.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | ACTIVE, INACTIVE, ON_LEAVE, TRANSFERRED |

#### `AssociateBusinessDetail`
Additional business details for associate.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `associateId` | UUID | No | Foreign key (unique) |
| `kwuid` | String | Yes | KWW unique identifier |
| `breeNumber` | String | Yes | BREE identification number |
| `directPhone` | String | Yes | Direct contact number |
| `directCell` | String | Yes | Personal cell number |
| `faxNumber` | String | Yes | |
| `commission` | Decimal(5,2) | Yes | Default commission % |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `AssociateThirdPartyIntegration`
Third-party platform IDs for associate.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `associateId` | UUID | No | Foreign key |
| `platform` | String | No | PROPERTY24, KWW, LIGHTSTONE |
| `externalId` | String | Yes | ID from external system |
| `syncedAt` | DateTime | Yes | Last sync timestamp |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

**Example Data**:
- `platform: "PROPERTY24"`, `externalId: "12345"` (Property24 Agent ID)

#### `AssociateContactDetail`
Contact information for associate.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `associateId` | UUID | No | Foreign key |
| `phone` | String | Yes | |
| `email` | String | Yes | |
| `fax` | String | Yes | |
| `website` | String | Yes | Personal website |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `AssociateTransfer`
Record of associate moving between market centers or teams.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `associateId` | UUID | No | Foreign key |
| `fromMarketCenterId` | UUID | No | Source office |
| `toMarketCenterId` | UUID | No | Destination office |
| `fromTeamId` | UUID | Yes | Source team |
| `toTeamId` | UUID | Yes | Destination team |
| `transferDate` | DateTime | No | When transfer occurs |
| `reason` | String | Yes | Reason for transfer |
| `includeTransactions` | Boolean | No | Default: false (move transactions?) |
| `statusId` | UUID | No | Foreign key (PENDING, COMPLETED, CANCELLED) |
| `completedAt` | DateTime | Yes | Completion time |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `AssociateTransferStatus`
Status enum.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | PENDING, COMPLETED, CANCELLED |

---

### Listings

#### `Listing`
Property listing for sale or rent.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingNumber` | String | No | Unique. Format: "[MC]-[YYYY]-[SEQ]" |
| `addressId` | UUID | No | Foreign key |
| `listingTypeId` | UUID | No | Foreign key (Residential, Commercial, etc.) |
| `saleOrRentTypeId` | UUID | No | Foreign key (Sale, Rent) |
| `statusId` | UUID | No | Foreign key (Pending, Active, Sold, etc.) |
| `ownershipTypeId` | UUID | Yes | Foreign key |
| `zoneTypeId` | UUID | Yes | Foreign key |
| `createdBy` | UUID | No | Associate who created listing |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |
| `listingDate` | DateTime | No | When listed |
| `delistDate` | DateTime | Yes | When delisted |
| `rejectionReason` | String | Yes | Why rejected (if applicable) |

**Indexes**:
- Unique on `listingNumber`
- Index on `statusId`, `addressId`, `createdBy`

#### `ListingStatus`
Status enum for listings.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | PENDING, ACTIVE, SOLD, WITHDRAWN, EXPIRED |

#### `ListingStatusTag`
Tags applied to listings (e.g., "New on Market", "Price Reduced").

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | Unique |

#### `ListingType`
Property type (e.g., House, Apartment, Commercial).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | RESIDENTIAL, COMMERCIAL, VACANT_LAND |
| `p24TypeId` | String | Yes | Property24 type ID |

#### `ListingSaleOrRentType`
Is property for sale or rent?

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | SALE, RENT, BOTH |

#### `ListingOwnershipType`
Type of ownership.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | FREEHOLD, SECTIONAL_TITLE, ERF, etc. |

#### `ListingBuildingZoningType`
Zoning classification.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | RESIDENTIAL, COMMERCIAL, MIXED_USE |

#### `ListingDescription`
Long-form description of listing.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `propertyTitle` | String | Yes | Short title |
| `description` | String | Yes | Full description (max 5000 chars) |
| `specialFeatures` | String | Yes | Highlights |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingPriceDetail`
Pricing information.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `price` | Decimal(14,2) | No | Asking price |
| `poa` | Boolean | No | Price on Application? |
| `priceHistory` | JSON | Yes | Array of price changes |
| `transferDuty` | Boolean | No | Is transfer duty included? |
| `transferDutyAmount` | Decimal(12,2) | Yes | Calculated transfer duty |
| `isRepossessed` | Boolean | No | Is property repossessed? |
| `repossessionDetails` | String | Yes | Details if repossessed |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingBuildingInfo`
Physical building details.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `builtInYear` | Int | Yes | Year built |
| `totalArea` | Decimal(10,2) | Yes | Total area in m² |
| `areaType` | String | Yes | SQM or SQFT |
| `floorArea` | Decimal(10,2) | Yes | Living area m² |
| `landArea` | Decimal(10,2) | Yes | Plot/land area m² |
| `storeys` | Int | Yes | Number of floors |
| `roofType` | String | Yes | Tile, Thatch, Concrete |
| `exteriorMaterial` | String | Yes | Brick, Stone, Plaster |
| `parkingSpaces` | Int | Yes | Number of parking spaces |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingBuildingAreaFeature`
Features like bedrooms, bathrooms, kitchens.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `featureTypeId` | UUID | No | Foreign key |
| `count` | Int | No | How many (e.g., 3 bedrooms) |
| `description` | String | Yes | Additional detail |
| `createdAt` | DateTime | No | |

#### `ListingBuildingAreaFeatureType`
Types of area features.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | BEDROOM, BATHROOM, KITCHEN, LOUNGE, DINING |
| `p24FeatureId` | String | Yes | Property24 mapping |

#### `ListingLightStoneValidation`
Lightstone property validation results.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `lightStonePropertyId` | String | Yes | Lightstone property ID |
| `isValidated` | Boolean | No | Default: false |
| `validationStatus` | String | Yes | VALID, INVALID, PENDING |
| `validatedAt` | DateTime | Yes | |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingThirdPartyIntegration`
References in external systems.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `property24Reference` | String | Yes | P24 listing ID |
| `kwwReference` | String | Yes | KWW listing UUID |
| `lightStonePropertyId` | String | Yes | Lightstone ID |
| `entegralPropertyId` | String | Yes | Entegral ID |
| `syncedAt` | DateTime | Yes | Last sync time |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingMandateInfo`
Mandate information (exclusive, inclusive, etc.).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key (1:1) |
| `mandateTypeId` | UUID | No | Foreign key |
| `startDate` | DateTime | No | When mandate starts |
| `endDate` | DateTime | No | When mandate expires |
| `exclusivityTerm` | Int | Yes | Days of exclusivity |
| `commission` | Decimal(5,2) | No | Commission % or amount |
| `createdAt` | DateTime | No | |

#### `ListingMandateType`
Types of mandates.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | EXCLUSIVE, INCLUSIVE, OPEN, OPEN_EXCLUSIVELY |

#### `ListingAssociate`
Associates (agents) working on a listing.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `associateId` | UUID | No | Foreign key |
| `role` | String | No | LISTING_AGENT, CO_AGENT, LISTING_OFFICE_MANAGER |
| `commission` | Decimal(5,2) | Yes | % for this agent |
| `joinedAt` | DateTime | No | |
| `createdAt` | DateTime | No | |

#### `ListingImage`
Photos and media.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `url` | String | No | GCS URL |
| `caption` | String | Yes | Image caption |
| `orderNumber` | Int | No | Display order |
| `uploadedAt` | DateTime | No | |
| `createdAt` | DateTime | No | |

#### `ListingPropertyArea`
Property area measurements.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `areaTypeId` | UUID | No | Foreign key |
| `areaSize` | Decimal(12,2) | No | Size in m² or sqft |
| `createdAt` | DateTime | No | |

#### `ListingPropertyAreaType`
Area type classifications.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | LIVING_AREA, LAND_AREA, TOTAL_AREA, FLOOR_AREA |

#### `ListingMarketingUrl`
Marketing URLs (Airbnb, Booking, etc.).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `urlTypeId` | UUID | No | Foreign key |
| `url` | String | No | Full URL |
| `createdAt` | DateTime | No | |

#### `ListingMarketingUrlType`
URL platform types.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | AIRBNB, BOOKING_COM, OWN_WEBSITE, etc. |

#### `ListingP24FeedItem`
Queue items for Property24 feed export.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `listingId` | UUID | No | Foreign key |
| `statusId` | UUID | No | Foreign key (PENDING, EXPORTED, FAILED) |
| `exportedAt` | DateTime | Yes | |
| `failureReason` | String | Yes | Error message if failed |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `ListingP24FeedItemStatus`
Status enum for feed items.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | PENDING, EXPORTED, FAILED, SKIPPED |

---

### Transactions

#### `Transaction`
Property transaction (sale/rental).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionNumber` | String | No | Unique |
| `listingId` | UUID | No | Foreign key |
| `statusId` | UUID | No | Foreign key |
| `transactionDate` | DateTime | Yes | When transaction occurred |
| `estimatedClosureDate` | DateTime | Yes | Expected closing date |
| `actualClosureDate` | DateTime | Yes | When actually closed |
| `createdBy` | UUID | No | Associate who created |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |
| `deletedAt` | DateTime | Yes | Soft delete |

#### `TransactionStatus`
Status enum.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | ACTIVE, PENDING, CLOSED, CANCELLED, ON_HOLD |

#### `TransactionDescription`
Financial details.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key (1:1) |
| `soldPrice` | Decimal(14,2) | No | Final sale price |
| `contractGCI` | Decimal(12,2) | No | Gross Commission Income |
| `vat` | Decimal(12,2) | Yes | VAT (14% of GCI) |
| `gciExcludingVat` | Decimal(12,2) | No | GCI - VAT |
| `notes` | String | Yes | |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `TransactionBond`
Financing/bond information.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key (1:1) |
| `hasBond` | Boolean | No | Is property bonded? |
| `bondAmount` | Decimal(14,2) | Yes | Bond value |
| `financingTypeId` | UUID | Yes | Foreign key |
| `channelId` | UUID | Yes | Foreign key |
| `institutionId` | UUID | Yes | Foreign key |
| `bondRegistrationNumber` | String | Yes | Official bond number |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `TransactionFinancingType`
Type of financing (e.g., Home Loan, Cash, Transfer).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | CASH, MORTGAGE, TRANSFER, DEFAULT |

#### `TransactionFinancingChannel`
Channel through which financing occurred.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | DIRECT, BANK_REFERRED, BROKER, EMAIL |

#### `TransactionFinancialInstitution`
Banks and financial institutions.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | CAPITEC, FNB, STANDARD_BANK, etc. |

#### `TransactionAssociate`
People involved in transaction with roles.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key |
| `associateId` | UUID | No | Foreign key |
| `roleId` | UUID | No | Foreign key |
| `createdAt` | DateTime | No | |

**Note**: Associates can have multiple roles per transaction.

#### `TransactionAssociateType`
Roles associates can have.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | LISTING_AGENT, SELLING_AGENT, CO_AGENT, REFERRAL |

#### `TransactionAssociatePaymentDetail`
Payment to each associate.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionAssociateId` | UUID | No | Foreign key |
| `paymentAmount` | Decimal(12,2) | No | Amount paid |
| `commission` | Decimal(5,2) | No | Commission % |
| `isPaid` | Boolean | No | Default: false |
| `paidDate` | DateTime | Yes | |
| `paymentMethod` | String | Yes | BANK_TRANSFER, CHEQUE, etc. |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `TransactionContact`
Contacts involved in transaction (attorneys, brokers).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key |
| `contactId` | UUID | No | Foreign key |
| `typeId` | UUID | No | Foreign key |
| `createdAt` | DateTime | No | |

#### `TransactionContactType`
Types of contacts.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | ATTORNEY, BROKER, MANAGER, ACCOUNTANT |

#### `TransactionDocument`
Attached documents.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key |
| `documentId` | UUID | No | Foreign key |
| `createdAt` | DateTime | No | |

#### `TransactionNote`
Notes on transaction.

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `transactionId` | UUID | No | Foreign key |
| `note` | String | No | Note text |
| `createdBy` | UUID | No | User who added note |
| `createdAt` | DateTime | No | |

---

### Shared Entities

#### `Contact`
Shared contact information (attorneys, brokers, institutions).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `name` | String | No | |
| `phone` | String | Yes | |
| `email` | String | Yes | |
| `address` | String | Yes | |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

#### `Document`
File metadata (not the file itself).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `fileUrl` | String | No | GCS URL |
| `fileName` | String | No | Original file name |
| `fileSizeBytes` | BigInt | No | File size |
| `mimeType` | String | No | e.g., "application/pdf" |
| `uploadedBy` | UUID | No | User who uploaded |
| `uploadedAt` | DateTime | No | |
| `documentType` | String | Yes | OTP, LEASE, CONTRACT, etc. |
| `createdAt` | DateTime | No | |

#### `AuditLog`
System audit trail (optional but recommended).

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | UUID | No | |
| `entityType` | String | No | What was modified |
| `entityId` | UUID | No | Which record |
| `action` | String | No | CREATE, UPDATE, DELETE |
| `changedFields` | JSON | Yes | Delta of changes |
| `changedBy` | UUID | No | User who changed |
| `changedAt` | DateTime | No | When changed |
| `createdAt` | DateTime | No | |

**Note**: Audit logs can be auto-generated via Prisma middleware.

---

## Key Design Decisions

### 1. Soft Deletes
All main entities have `deletedAt` field (except lookups/enums). This allows:
- Data recovery
- Historical reporting
- Compliance with data retention policies

### 2. Audit Trail
All entities have `createdAt`, `updatedAt` for basic audit. Optional `AuditLog` table for detailed change tracking.

### 3. Third-Party Integration
All integration IDs stored in dedicated tables:
- `AssociateThirdPartyIntegration` - Platform IDs per associate
- `ListingThirdPartyIntegration` - Integration references per listing

This prevents tight coupling and allows adding new integrations easily.

### 4. Price History
`ListingPriceDetail.priceHistory` is JSON array to track all price changes without creating new row for each change.

**Example**:
```json
[
  { "price": 1000000, "changedAt": "2024-01-10", "reason": "Initial" },
  { "price": 950000, "changedAt": "2024-02-15", "reason": "Price reduction" },
  { "price": 975000, "changedAt": "2024-03-01", "reason": "Price increase" }
]
```

### 5. Commission Calculation
Commission tracked at multiple levels:
- `ListingMandateInfo.commission` - Mandate-level commission %
- `ListingAssociate.commission` - Agent-specific commission on listing
- `TransactionAssociatePaymentDetail.commission` - Final payment % on transaction

This allows flexible, role-based commission structures.

### 6. Numeric Precision
All monetary fields use `Decimal(14,2)` for:
- Price accuracies to cent
- Prevention of floating-point rounding errors
- Financial reporting compliance

---

## Indexing Strategy

### High-Priority Indexes (Performance)
```sql
-- User lookups
CREATE UNIQUE INDEX idx_user_email ON "User"(email) WHERE "deletedAt" IS NULL;
CREATE INDEX idx_user_active ON "User"("isActive") WHERE "deletedAt" IS NULL;

-- Listing filters
CREATE INDEX idx_listing_status ON "Listing"("statusId") WHERE "deletedAt" IS NULL;

 CREATE INDEX idx_listing_address ON "Listing"("addressId");
CREATE INDEX idx_listing_market_center ON "Associate"("marketCenterId");
CREATE INDEX idx_listing_created_by ON "Listing"("createdBy");

-- Transaction filters
CREATE INDEX idx_transaction_listing ON "Transaction"("listingId");
CREATE INDEX idx_transaction_status ON "Transaction"("statusId") WHERE "deletedAt" IS NULL;

-- Address geo-lookups
CREATE INDEX idx_address_suburb_city ON "Address"(suburb, city);
```

### Medium-Priority Indexes (Business Logic)
```sql
-- Associate transfers
CREATE INDEX idx_transfer_market_center ON "AssociateTransfer" ("fromMarketCenterId", "toMarketCenterId");
CREATE INDEX idx_transfer_status ON "AssociateTransfer"("statusId");

-- Listing feeds
CREATE INDEX idx_p24_feed_status ON "ListingP24FeedItem"("statusId");
```

---

## Relationships Summary

| Entity | Type | Connected To | Cardinality |
|--------|------|--------------|-------------|
| User | 1:M | UserRole | One user many roles |
| Associate | 1:M | ListingAssociate | One agent many listings |
| Associate | 1:M | TransactionAssociate | One agent many transactions |
| Listing | 1:M | ListingImage | One listing many photos |
| Listing | 1:M | ListingAssociate | One listing many agents |
| Listing | 1:M | Transaction | One property many transactions |
| Transaction | 1:M | TransactionAssociate | One transaction many associates |
| MarketCenter | 1:M | Team | One office many teams |
| MarketCenter | 1:M | Associate | One office many agents |
| Country | 1:M | Province | One country many provinces |

---

## Foreign Key Constraints

All foreign keys use `CASCADE` on delete to maintain referential integrity:

```prisma
model ListingAssociate {
  id        String
  listing   Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  listingId String
  associate Associate @relation(fields: [associateId], references: [id], onDelete: Cascade)
  associateId String
}
```

This ensures:
- Deleting a listing cascades to listing images, descriptions, etc.
- Deleting an associate cascades to their transfer records
- Data consistency maintained automatically

---

## Migration Notes from Legacy System

### Field Mapping
| Legacy (.NET) | New (PostgreSQL) |
|---|---|
| `Guid` | `UUID` |
| `DateTime` | `DateTime` |
| `decimal` | `Decimal(precision, scale)` |
| `bool` | `Boolean` |
| `string` | `String` |
| `List<T>` | `[T]` array or 1:M relation |

For legacy blob references (files), all stored in Google Cloud Storage with metadata in `Document` table.

---

This schema represents the current state of the database. Changes should be made via Prisma migrations:

```bash
npx prisma migrate dev --name describe_your_change
```

All migrations are version-controlled in `backend/prisma/migrations/`.
