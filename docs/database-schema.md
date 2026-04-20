# Database Schema

## Core Entities

### Users
- id (PK)
- email (unique)
- firstName
- lastName
- googleId (nullable)
- isActive
- createdAt, updatedAt

### Associates
- id (PK)
- firstName
- lastName
- email (unique)
- phone (nullable)
- marketCenterId (FK)
- teamId (FK)
- commissionRate
- isActive
- createdAt, updatedAt

### Listings
- id (PK)
- listingNumber
- address fields (streetNumber, streetName, etc.)
- price
- isPOA
- description
- propertyType
- bedrooms, bathrooms, garages
- listingStatus
- saleOrRent
- primaryAgentId (FK)
- p24Reference (nullable)
- kwwReference (nullable)
- lightstonePropertyId (nullable)
- createdAt, updatedAt

### Transactions
- id (PK)
- transactionNumber
- listingId (FK)
- transactionStatus
- soldPrice
- contractGCIExclVAT
- transactionDate
- statusChangeDate
- createdAt, updatedAt

### TransactionAssociates
- id (PK)
- transactionId (FK)
- associateId (FK)
- associateType
- commissionPercentage
- commissionAmount
- marketCenterId
- teamId
- createdAt, updatedAt

### Referrals
- id (PK)
- referralNumber
- description
- referralType
- status
- referringAssociateId (FK)
- receivingAssociateId (FK)
- commissionAmount
- createdAt, updatedAt

## Indexes and Constraints

- Unique constraints on email fields
- Foreign key relationships
- Appropriate indexes for performance
- Soft delete support where needed