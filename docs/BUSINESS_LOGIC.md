# Business Logic & Calculations

This document describes the critical business logic preserved from the legacy system that must be maintained in the new kwsa-cloud-console.

---

## 1. Commission & Payment Calculations

### 1.1 Gross Commission Income (GCI) Calculation

**Definition**: Total commission earned on a transaction.

**Formula**:
```
GCI = Sold Price × Commission Percentage
```

**Example**:
- Sold Price: R 1,500,000
- Commission: 6%
- GCI = 1,500,000 × 0.06 = R 90,000

**Implementation** (`backend/src/services/transactions/payment.service.ts`):
```typescript
function calculateGCI(soldPrice: number, commissionPercentage: number): number {
  return soldPrice * (commissionPercentage / 100);
}

// Usage in transaction.service.ts
const gci = calculateGCI(transaction.description.soldPrice, 6);
transaction.description.contractGCI = gci;
```

### 1.2 VAT on Commission

**Definition**: Value Added Tax (14%) on the GCI.

**Formula**:
```
VAT = GCI × 0.14
GCI Excluding VAT = GCI - VAT
```

OR equivalent:
```
GCI Excluding VAT = GCI / 1.14
VAT = GCI - (GCI / 1.14)
```

**Example**:
- GCI: R 90,000
- VAT: 90,000 × 0.14 = R 12,600
- GCI Excluding VAT: 90,000 - 12,600 = R 77,400

**Implementation**:
```typescript
function calculateVAT(gci: number, vatRate: number = 0.14): number {
  return gci * vatRate;
}

function calculateGCIExcludingVAT(gci: number, vatRate: number = 0.14): number {
  return gci / (1 + vatRate);
}

// In transaction service
const vat = calculateVAT(gci);
const gciExcludingVat = calculateGCIExcludingVAT(gci);
```

**Database Storage** ([`backend/prisma/schema.prisma - TransactionDescription`](backend/prisma/schema.prisma#L900)):
```
contractGCI: Decimal(12,2)
vat: Decimal(12,2)
gciExcludingVat: Decimal(12,2)
```

### 1.3 Commission Split Between Agents

**Definition**: Distribution of commission among listing agent, selling agent, and co-agents.

**Scenarios**:

#### Scenario A: Single Agent (Listing & Selling)
```
Listing Agent Commission = GCI Excluding VAT × 100%
```

#### Scenario B: Listing + Selling Agent Split (Typical 50/50)
```
Listing Agent Commission = GCI Excluding VAT × 50%
Selling Agent Commission = GCI Excluding VAT × 50%
```

#### Scenario C: With Co-Agents
```
Listing Agent Commission = GCI Excluding VAT × 40%
Selling Agent Commission = GCI Excluding VAT × 40%
Co-Listing Agent Commission = GCI Excluding VAT × 20%
```

Commission rules vary by market center/office policy.

**Implementation**:
```typescript
interface CommissionAllocation {
  associateId: string;
  role: 'LISTING_AGENT' | 'SELLING_AGENT' | 'CO_AGENT';
  commissionPercentage: number;
  amount: number;
}

function allocateCommission(
  gciExcludingVat: number,
  allocations: Array<{ role: string; percentage: number }>
): CommissionAllocation[] {
  return allocations.map(alloc => ({
    role: alloc.role,
    commissionPercentage: alloc.percentage,
    amount: gciExcludingVat * (alloc.percentage / 100)
  }));
}
```

**Database** ([`TransactionAssociatePaymentDetail`](backend/prisma/schema.prisma#L950)):
```
paymentAmount: Decimal(12,2)   # Exact amount paid
commission: Decimal(5,2)       # Commission % of GCI
```

### 1.4 Transfer Duty Calculation

**Definition**: Government tax on property transfer (typically 0-8% based on price).

**Legacy Implementation** (from C# code):
```csharp
// From legacy system (approximate brackets)
public decimal CalculateTransferDuty(decimal purchasePrice)
{
    if (purchasePrice <= 30000) return 0;
    else if (purchasePrice <= 100000) return purchasePrice * 0.01m;
    else if (purchasePrice <= 500000) return purchasePrice * 0.02m;
    else if (purchasePrice <= 1000000) return purchasePrice * 0.03m;
    else return purchasePrice * 0.04m;  // Max 4% over 1M
}
```

**Updated Formula** (2024 South African tax brackets):
```typescript
function calculateTransferDuty(purchasePrice: number): number {
  // South African transfer duty brackets (as of 2024)
  if (purchasePrice <= 30000) return 0;
  else if (purchasePrice <= 100000) return purchasePrice * 0.01;
  else if (purchasePrice <= 500000) return purchasePrice * 0.02;
  else if (purchasePrice <= 1000000) return purchasePrice * 0.03;
  else return purchasePrice * 0.04;
}

// Usage
const transferDuty = calculateTransferDuty(listing.priceDetail.price);
listing.priceDetail.transferDutyAmount = transferDuty;
```

**Database Field**:
```
ListingPriceDetail.transferDutyAmount: Decimal(12,2)
ListingPriceDetail.transferDuty: Boolean  # Is transfer duty included in price?
```

### 1.5 Referral Bonuses (Optional Feature)

**Definition**: Additional commission for referral agents.

**Formula**:
```
Referral Bonus = Transaction GCI × Referral Percentage (typically 5-10%)
```

**Example**:
- Transaction GCI: R 77,400 (excl VAT)
- Referral Percentage: 5%
- Referral Bonus: 77,400 × 0.05 = R 3,870

**Implementation**:
```typescript
function calculateReferralBonus(gciExcludingVat: number, referralPercentage: number): number {
  return gciExcludingVat * (referralPercentage / 100);
}

// In transaction service, check for referral agent
if (transactionAssociate.roleId === REFERRAL_ROLE_ID) {
  const bonus = calculateReferralBonus(gciExcludingVat, 0.05);
  payment.paymentAmount = bonus;
}
```

---

## 2. Listing Management Workflows

### 2.1 Listing Lifecycle States

```
PENDING → ACTIVE → WITHDRAWN or SOLD or EXPIRED
        ↑       ↑
        └───────┘ (can return to ACTIVE)
```

**State Transitions**:

| From State | To State | Condition | Notes |
|---|---|---|---|
| PENDING | ACTIVE | Listed date set | Manual action or auto after valid data |
| ACTIVE | WITHDRAWN | Agent requests | Can be re-listed |
| ACTIVE | SOLD | Transaction closed | Moves to SOLD, delist date recorded |
| ACTIVE | EXPIRED | Mandate expires | Auto-trigger or manual |
| WITHDRAWN | ACTIVE | Agent re-lists | Returns to market |
| SOLD | (terminal) | Historical record | Cannot transition further |

**Implementation**:
```typescript
async function updateListingStatus(
  listingId: string,
  newStatus: ListingStatus,
  reason: string
): Promise<void> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  
  // Validate transition
  if (!isValidTransition(listing.statusId, newStatus)) {
    throw new Error(`Invalid transition: ${listing.statusId} → ${newStatus}`);
  }

  // Update status
  await prisma.listing.update({
    where: { id: listingId },
    data: {
      statusId: newStatus,
      delistDate: newStatus === 'SOLD' ? new Date() : null,
      updatedAt: new Date()
    }
  });

  // Log audit trail
  await auditLog.record({
    entityType: 'Listing',
    entityId: listingId,
    action: 'STATUS_CHANGE',
    changedFields: { status: newStatus, reason },
    changedBy: currentUser.id
  });
}
```

### 2.2 Listing Mandate Expiry

**Definition**: Mandate automatically expires after specified period.

**Workflow**:
1. Mandate start date set
2. Mandate end date calculated (start + term in days)
3. Automatic check: If today > end date, mark status as EXPIRED
4. Agent can renew mandate or delist property

**Implementation**:
```typescript
async function checkMandateExpiry(listingId: string): Promise<void> {
  const mandate = await prisma.listingMandateInfo.findUnique({
    where: { listingId },
    include: { listing: { include: { status: true } } }
  });

  if (!mandate) return;

  const isExpired = new Date() > mandate.endDate;

  if (isExpired && mandate.listing.status.name !== 'EXPIRED') {
    await updateListingStatus(listingId, 'EXPIRED', 'Mandate expiry');
  }
}

// Run as scheduled job (daily or on-demand)
async function runMandateExpiryCheck(): Promise<void> {
  const activeListings = await prisma.listing.findMany({
    where: { status: { name: 'ACTIVE' } },
    select: { id: true }
  });

  for (const listing of activeListings) {
    await checkMandateExpiry(listing.id);
  }
}
```

### 2.3 Listing Price History

**Definition**: Track all price changes for a listing.

**Storage**: JSON array in `ListingPriceDetail.priceHistory`

**Example data**:
```json
[
  {
    "price": 1250000,
    "changedAt": "2024-01-10T08:00:00Z",
    "reason": "Initial listing"
  },
  {
    "price": 1200000,
    "changedAt": "2024-02-15T14:30:00Z",
    "reason": "Price reduction - market adjustment"
  },
  {
    "price": 1225000,
    "changedAt": "2024-03-01T10:00:00Z",
    "reason": "Price increase - increased interest"
  }
]
```

**Implementation**:
```typescript
async function updateListingPrice(
  listingId: string,
  newPrice: number,
  reason: string
): Promise<void> {
  const priceDetail = await prisma.listingPriceDetail.findUnique({
    where: { listingId }
  });

  const history = priceDetail?.priceHistory || [];
  history.push({
    price: priceDetail?.price,  // Old price
    changedAt: new Date().toISOString(),
    reason: reason || 'Price update'
  });

  await prisma.listingPriceDetail.update({
    where: { listingId },
    data: {
      price: newPrice,
      priceHistory: history,
      updatedAt: new Date()
    }
  });
}
```

### 2.4 Listing Building Features

**Definition**: Standardized property features (bedrooms, bathrooms, etc.).

**Standard Features**:
| Feature | Unit | Count | Example |
|---------|------|-------|---------|
| BEDROOM | rooms | 1-10+ | "3" |
| BATHROOM | rooms | 1-5+ | "2" |
| KITCHEN | rooms | 1 | "1" |
| LOUNGE | rooms | 1 | "1" |
| DINING | rooms | 1 | "1" |
| GARAGE | spaces | 1-4+ | "2" |
| CARPORT | spaces | 1-4+ | "1" |
| STORE_ROOM | count | 0-1+ | "1" |
| LAUNDRY | rooms | 0-1 | "1" |
| POOL | boolean | 0-1 | "1" = yes |
| GARDEN | boolean | 0-1 | "1" = yes |
| PATIO | boolean | 0-1 | "1" = yes |

**Database Model** ([`ListingBuildingAreaFeature`](backend/prisma/schema.prisma#L600)):
```
listingId: UUID
featureTypeId: UUID (Foreign key to ListingBuildingAreaFeatureType)
count: Int (e.g., 3 for 3 bedrooms)
description: String (optional, e.g., "Master en-suite")
```

**Implementation**:
```typescript
// Creating a listing with features
async function createListingWithFeatures(
  listingData: {
    address: string;
    price: number;
    features: { featureName: string; count: number }[];
  }
): Promise<void> {
  // Create listing
  const listing = await prisma.listing.create({
    data: {
      listingNumber: generateListingNumber(),
      address: { create: { /* ... */ } },
      description: { create: { /* ... */ } },
      priceDetail: { create: { price: listingData.price } }
    }
  });

  // Add features
  for (const feature of listingData.features) {
    const featureType = await prisma.listingBuildingAreaFeatureType.findUnique({
      where: { name: feature.featureName }
    });

    await prisma.listingBuildingAreaFeature.create({
      data: {
        listing: { connect: { id: listing.id } },
        featureType: { connect: { id: featureType.id } },
        count: feature.count
      }
    });
  }
}
```

---

## 3. Associate Management Workflows

### 3.1 Associate Transfer Workflow

**Definition**: Move an agent from one market center (office) to another.

**Workflow Steps**:
1. **Initiate Transfer**: Admin creates `AssociateTransfer` record with status PENDING
2. **Optional**: Choose whether to move transactions associated with agent
3. **Confirmation**: System validates:
   - Source market center exists
   - Target market center exists
   - Associate currently in source market center
   - No duplicate pending transfers
4. **Execution**: 
   - Update `Associate.marketCenterId` to target
   - Update `Associate.teamId` if provided
   - Update `ListingAssociate.marketCenterId` (if co-moving listings)
   - Optionally move `TransactionAssociate` records
5. **Completion**: Mark transfer as COMPLETED, record completion date

**Database Model** ([`AssociateTransfer`](backend/prisma/schema.prisma#L250)):
```
associateId: UUID
fromMarketCenterId: UUID
toMarketCenterId: UUID
fromTeamId: UUID (optional)
toTeamId: UUID (optional)
transferDate: DateTime
reason: String (optional)
includeTransactions: Boolean (default: false)
statusId: UUID (PENDING, COMPLETED, CANCELLED)
completedAt: DateTime (set when status = COMPLETED)
```

**Implementation**:
```typescript
// backend/src/services/associates/transfer.service.ts

async function initiateTransfer(request: {
  associateId: string;
  toMarketCenterId: string;
  toTeamId?: string;
  transferDate: Date;
  reason?: string;
  includeTransactions: boolean;
}): Promise<AssociateTransfer> {
  // Validate
  const associate = await prisma.associate.findUnique({
    where: { id: request.associateId }
  });

  if (!associate) throw new Error('Associate not found');
  if (associate.marketCenterId === request.toMarketCenterId) {
    throw new Error('Associate already in target market center');
  }

  // Create transfer
  const transfer = await prisma.associateTransfer.create({
    data: {
      associateId: request.associateId,
      fromMarketCenterId: associate.marketCenterId,
      toMarketCenterId: request.toMarketCenterId,
      fromTeamId: associate.teamId,
      toTeamId: request.toTeamId,
      transferDate: request.transferDate,
      reason: request.reason,
      includeTransactions: request.includeTransactions,
      statusId: TRANSFER_STATUS_PENDING,
    }
  });

  return transfer;
}

async function completeTransfer(transferId: string): Promise<void> {
  const transfer = await prisma.associateTransfer.findUnique({
    where: { id: transferId },
    include: { associate: true }
  });

  if (!transfer) throw new Error('Transfer not found');
  if (transfer.statusId !== TRANSFER_STATUS_PENDING) {
    throw new Error('Transfer is not in PENDING status');
  }

  // Start transaction to ensure consistency
  await prisma.$transaction(async (tx) => {
    // 1. Update associate
    await tx.associate.update({
      where: { id: transfer.associateId },
      data: {
        marketCenterId: transfer.toMarketCenterId,
        teamId: transfer.toTeamId,
        updatedAt: new Date()
      }
    });

    // 2. Update listings if specified
    if (transfer.includeTransactions) {
      await tx.listingAssociate.updateMany({
        where: { associateId: transfer.associateId },
        data: {
          marketCenterId: transfer.toMarketCenterId,
          updatedAt: new Date()
        }
      });

      await tx.transactionAssociate.updateMany({
        where: { associateId: transfer.associateId },
        data: {
          updatedAt: new Date()
        }
      });
    }

    // 3. Mark transfer as complete
    await tx.associateTransfer.update({
      where: { id: transferId },
      data: {
        statusId: TRANSFER_STATUS_COMPLETED,
        completedAt: new Date(),
        updatedAt: new Date()
      }
    });

    // 4. Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'Associate',
        entityId: transfer.associateId,
        action: 'TRANSFER_COMPLETED',
        changedFields: {
          fromMarketCenter: transfer.fromMarketCenterId,
          toMarketCenter: transfer.toMarketCenterId
        },
        changedBy: currentUser.id,
        changedAt: new Date()
      }
    });
  });
}
```

### 3.2 Associate Third-Party IDs

**Definition**: Sync associate IDs with external platforms (Property24, KWW).

**Platforms**:
- **Property24**: Agent ID (numeric)
- **KWW**: KWUID (alphanumeric)
- **Lightstone**: Agent ID

**Storage** ([`AssociateThirdPartyIntegration`](backend/prisma/schema.prisma#L270)):
```
associateId: UUID
platform: String (PROPERTY24, KWW, LIGHTSTONE)
externalId: String
syncedAt: DateTime
```

**Implementation**:
```typescript
async function syncAssociateToProperty24(associateId: string, p24AgentId: string): Promise<void> {
  // Find or create integration record
  const integration = await prisma.associateThirdPartyIntegration.upsert({
    where: {
      associateId_platform: {
        associateId,
        platform: 'PROPERTY24'
      }
    },
    update: {
      externalId: p24AgentId,
      syncedAt: new Date()
    },
    create: {
      associateId,
      platform: 'PROPERTY24',
      externalId: p24AgentId,
      syncedAt: new Date()
    }
  });

  return integration;
}
```

---

## 4. Transaction Management Workflows

### 4.1 Transaction Status Workflow

```
ACTIVE → PENDING → CLOSED or CANCELLED
  ↑                  ↑
  └──────────────────┘ (can reopen)
       ON_HOLD (pause)
```

**Status Meanings**:
- `ACTIVE`: Transaction in progress, all parties engaged
- `PENDING`: Awaiting key action (inspection, bond approval, attorney confirmation)
- `CLOSED`: Transaction completed, funds transferred
- `CANCELLED`: Transaction cancelled, not completed
- `ON_HOLD`: Temporarily paused, can resume

### 4.2 Transaction Closure Calculation

**Definition**: Final financial settlement when transaction closes.

**Calculation Steps**:
1. Calculate GCI (already done on creation)
2. Deduct VAT (14% of GCI)
3. Allocate commission to agents (based on roles)
4. Calculate any additional fees (bank fees, attorney fees)
5. Generate payment instructions for each party

**Implementation**:
```typescript
async function finalizeTransaction(transactionId: string): Promise<void> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      description: true,
      bond: true,
      associates: {
        include: { payments: true, role: true, associate: true }
      },
      contacts: { include: { contact: true } }
    }
  });

  if (!transaction) throw new Error('Transaction not found');

  // 1. Calculate final GCI
  const gciExcludingVat = transaction.description.gciExcludingVat;

  // 2. Revalidate payment allocations
  let totalAllocated = 0;
  for (const assoc of transaction.associates) {
    const amount = gciExcludingVat * (assoc.payments.commission / 100);
    totalAllocated += amount;
    assoc.payments.paymentAmount = amount;
  }

  if (Math.abs(totalAllocated - gciExcludingVat) > 0.01) {
    throw new Error('Commission allocation does not match GCI');
  }

  // 3. Set payment flags
  for (const assoc of transaction.associates) {
    await prisma.transactionAssociatePaymentDetail.update({
      where: { id: assoc.payments.id },
      data: { isPaid: false }  // Mark as ready to pay
    });
  }

  // 4. Mark transaction as CLOSED
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      statusId: TRANSACTION_STATUS_CLOSED,
      actualClosureDate: new Date(),
      updatedAt: new Date()
    }
  });

  // 5. Audit
  await auditLog.record({
    entityType: 'Transaction',
    entityId: transactionId,
    action: 'TRANSACTION_CLOSED',
    changedFields: { status: 'CLOSED', gci: gciExcludingVat },
    changedBy: currentUser.id
  });
}
```

### 4.3 Commission Payment Tracking

**Definition**: Record when each agent is paid their commission.

**Workflow**:
1. Transaction closes (see 4.2)
2. Payments calculated and marked as "Ready to Pay"
3. Accountant reviews and approves
4. Payment executed (bank transfer, check, etc.)
5. Mark payment as "Paid" with date and method

**Database** ([`TransactionAssociatePaymentDetail`](backend/prisma/schema.prisma#L950)):
```
transactionAssociateId: UUID
paymentAmount: Decimal(12,2)
commission: Decimal(5,2)
isPaid: Boolean
paidDate: DateTime
paymentMethod: String (BANK_TRANSFER, CHEQUE, CASH, etc.)
```

**Implementation**:
```typescript
async function recordPayment(paymentId: string, method: string): Promise<void> {
  const payment = await prisma.transactionAssociatePaymentDetail.update({
    where: { id: paymentId },
    data: {
      isPaid: true,
      paidDate: new Date(),
      paymentMethod: method,
      updatedAt: new Date()
    }
  });

  // Send notification to associate
  await emailService.sendPaymentConfirmation({
    associateEmail: payment.associate.email,
    amount: payment.paymentAmount,
    method,
    transactionNumber: payment.transaction.transactionNumber
  });
}

// Report: Payments pending
async function getPendingPayments(): Promise<PendingPayment[]> {
  return await prisma.transactionAssociatePaymentDetail.findMany({
    where: { isPaid: false },
    include: {
      transactionAssociate: {
        include: {
          associate: { select: { firstName: true, lastName: true, email: true } },
          transaction: { select: { transactionNumber: true } }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
}
```

---

## 5. Property24 & KWW Integration

### 5.1 Property24 Feed Export

**Definition**: Queue listings to be exported to Property24 (external portal).

**Workflow**:
1. Listing marked as ACTIVE
2. System creates `ListingP24FeedItem` with status PENDING
3. Scheduled job reads PENDING items
4. For each item:
   - Convert listing to Property24 JSON format
   - Call Property24 API
   - Mark as EXPORTED or FAILED
5. On failure, retain error message for review

**Database** ([`ListingP24FeedItem`](backend/prisma/schema.prisma#L660)):
```
listingId: UUID
statusId: UUID (PENDING, EXPORTED, FAILED, SKIPPED)
exportedAt: DateTime
failureReason: String
```

**Implementation**:
```typescript
// backend/src/services/listings/p24.service.ts

async function queueForP24Export(listingId: string): Promise<ListingP24FeedItem> {
  const item = await prisma.listingP24FeedItem.create({
    data: {
      listingId,
      statusId: FEED_STATUS_PENDING,
      createdAt: new Date()
    }
  });

  return item;
}

async function convertToP24Format(listing: Listing): Promise<P24ListingFormat> {
  return {
    AgentID: listing.createdBy.p24AgentId,  // From AssociateThirdPartyIntegration
    ListID: listing.thirdPartyIntegration.property24Reference,
    ListType: mapListingType(listing.listingType),
    SubType: 'House',  // Simplification
    Title: listing.description.propertyTitle,
    Description: listing.description.description,
    Price: listing.priceDetail.price,
    Currency: 'ZAR',
    Address: `${listing.address.streetNumber} ${listing.address.streetName}`,
    Suburb: listing.address.suburb,
    City: listing.address.city,
    Province: listing.address.province,
    Country: 'South Africa',
    Latitude: listing.address.latitude,
    Longitude: listing.address.longitude,
    Bedrooms: listing.buildingInfo.features.BEDROOM?.count,
    Bathrooms: listing.buildingInfo.features.BATHROOM?.count,
    Garages: listing.buildingInfo.features.GARAGE?.count,
    Pool: listing.buildingInfo.features.POOL?.count > 0,
    Garden: listing.buildingInfo.features.GARDEN?.count > 0,
    Images: listing.images.map(img => ({ URL: img.url, Caption: img.caption }))
  };
}

async function exportToProperty24(feedItem: ListingP24FeedItem): Promise<void> {
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: feedItem.listingId },
      include: { /* all related data */ }
    });

    const p24Format = await convertToP24Format(listing);
    const response = await property24Api.submitListing(p24Format);

    // Mark as exported
    await prisma.listingP24FeedItem.update({
      where: { id: feedItem.id },
      data: {
        statusId: FEED_STATUS_EXPORTED,
        exportedAt: new Date()
      }
    });

    logger.info(`P24 export successful: ${feedItem.listingId}`);
  } catch (error) {
    // Mark as failed with reason
    await prisma.listingP24FeedItem.update({
      where: { id: feedItem.id },
      data: {
        statusId: FEED_STATUS_FAILED,
        failureReason: error.message
      }
    });

    logger.error(`P24 export failed: ${feedItem.listingId} - ${error.message}`);
  }
}

// Scheduled job (runs every hour)
async function processP24FeedQueue(): Promise<void> {
  const pendingItems = await prisma.listingP24FeedItem.findMany({
    where: { statusId: FEED_STATUS_PENDING },
    take: 100  // Process 100 at a time
  });

  for (const item of pendingItems) {
    await exportToProperty24(item);
  }
}
```

### 5.2 KWW Feed Export

**Definition**: Queue listings for KWW feed with GZIP compression.

**Workflow**: Similar to P24, with KWW-specific format and GZIP compression.

**KWW-Specific Fields**:
- `frontdoorId`: Market center's KWW ID (stored in `MarketCenter.frontdoorId`)
- `kwuid`: Property UUID for KWW reference
- Compression: GZIP (.gz format)

**Implementation**:
```typescript
// backend/src/services/listings/kww.service.ts

async function convertToKWWFormat(listing: Listing): Promise<KWWListingFormat> {
  return {
    UUID: listing.thirdPartyIntegration.kwwReference || generateUUID(),
    Frontdoor: listing.createdBy.marketCenter.frontdoorId,
    Title: listing.description.propertyTitle,
    Description: listing.description.description,
    Price: listing.priceDetail.price,
    Address: listing.address.streetNumber + ' ' + listing.address.streetName,
    Suburb: listing.address.suburb,
    City: listing.address.city,
    Province: listing.address.province,
    // ... other fields
    Images: listing.images.map(img => img.url)
  };
}

async function exportToKWW(listing: Listing): Promise<void> {
  const kwwFormat = await convertToKWWFormat(listing);
  const json = JSON.stringify(kwwFormat);

  // GZIP compression
  const compressed = await gzip(Buffer.from(json));

  // Upload to KWW
  await kwwApi.submitListing({
    frontdoorId: listing.createdBy.marketCenter.frontdoorId,
    data: compressed
  });

  // Update reference
  await prisma.listingThirdPartyIntegration.update({
    where: { listingId: listing.id },
    data: {
      kwwReference: kwwFormat.UUID,
      syncedAt: new Date()
    }
  });
}
```

---

## 6. Reporting & Analytics

### 6.1 GCI Reports by Associate

**Definition**: Sum of all commission earned by each agent in period.

**SQL Query**:
```sql
SELECT
  a.firstName,
  a.lastName,
  SUM(tap.paymentAmount) as totalEarnings,
  COUNT(DISTINCT ta.transactionId) as transactionCount,
  AVG(tap.paymentAmount) as averageCommission
FROM AssociateA
LEFT JOIN TransactionAssociate ta ON a.id = ta.associateId
LEFT JOIN TransactionAssociatePaymentDetail tap ON ta.id = tap.transactionAssociateId
WHERE
  tap.isPaid = true
  AND tap.paidDate BETWEEN @startDate AND @endDate
GROUP BY a.id, a.firstName, a.lastName
ORDER BY totalEarnings DESC;
```

**Implementation**:
```typescript
async function getAssociateGCIReport(
  marketCenterId: string,
  startDate: Date,
  endDate: Date
): Promise<AssociateGCIReport[]> {
  const results = await prisma.$queryRaw`
    SELECT
      a.id,
      a.firstName,
      a.lastName,
      COALESCE(SUM(tap.paymentAmount), 0) as totalEarnings,
      COUNT(DISTINCT ta.transactionId) as transactionCount,
      COALESCE(AVG(tap.paymentAmount), 0) as averageCommission
    FROM Associate a
    LEFT JOIN TransactionAssociate ta ON a.id = ta.associateId
    LEFT JOIN TransactionAssociatePaymentDetail tap ON ta.id = tap.transactionAssociateId
    WHERE
      a.marketCenterId = ${marketCenterId}
      AND tap.isPaid = true
      AND tap.paidDate >= ${startDate}
      AND tap.paidDate <= ${endDate}
    GROUP BY a.id, a.firstName, a.lastName
    ORDER BY totalEarnings DESC
  `;

  return results;
}
```

### 6.2 Listings by Status Report

```sql
SELECT
  st.name as status,
  COUNT(l.id) as count,
  SUM(lpd.price) as totalValue,
  AVG(lpd.price) as averagePrice
FROM Listing l
JOIN ListingStatus st ON l.statusId = st.id
LEFT JOIN ListingPriceDetail lpd ON l.id = lpd.listingId
WHERE l.marketCenterId = @marketCenterId
  AND l.deletedAt IS NULL
GROUP BY st.name
ORDER BY st.name;
```

---

## 7. Validation Rules

### 7.1 Listing Validation

```typescript
export const listingValidationSchema = z.object({
  listingNumber: z.string().min(3).max(50),
  address: z.string().min(5).max(500),
  price: zod.number().positive('Price must be positive').max(999999999),
  statusId: z.string().uuid(),
  images: z.array(z.object({
    url: z.string().url(),
    caption: z.string().optional()
  })).min(1, 'At least one image required').max(50),
  features: z.array(z.object({
    featureTypeId: z.string().uuid(),
    count: z.number().int().positive()
  }))
});
```

### 7.2 Transaction Validation

```typescript
export const transactionValidationSchema = z.object({
  transactionNumber: z.string().min(3).max(50),
  listingId: z.string().uuid(),
  soldPrice: z.number().positive(),
  commissionPercentage: z.number().min(0).max(100),
  estimatedClosureDate: z.date(),
  associates: z.array(z.object({
    associateId: z.string().uuid(),
    roleId: z.string().uuid(),
    commissionPercentage: z.number().min(0).max(100)
  })).min(1)
});
```

---

## 8. Audit & Compliance

All changes to critical entities are logged:

```typescript
await auditLog.record({
  entityType: 'Listing' | 'Transaction' | 'Associate',
  entityId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSFER_COMPLETED' | 'STATUS_CHANGE',
  changedFields: Record<string, any>,  // Delta of changes
  changedBy: string,  // User ID
  changedAt: new Date()
});
```

This ensures:
- Compliance with data protection regulations
- Audit trail for disputes/inquiries
- Ability to reconstruct history
- Accountability for all actions

---

## Implementation Notes

1. **Always perform calculations in services**, not in controllers or database triggers
2. **Store results in database** for audit and reporting purposes
3. **Validate monetary amounts** using Decimal, never floating-point
4. **Test all formulas** against legacy system outputs to ensure compatibility
5. **Use database transactions** when multiple tables are modified together
6. **Log all changes** to audit table for compliance

---

This business logic must be preserved exactly as implemented to maintain data integrity and regulatory compliance.
