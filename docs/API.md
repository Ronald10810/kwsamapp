# REST API Specification

Complete specification of all REST endpoints for kwsa-cloud-console backend.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Response Format](#response-format)
4. [Error Handling](#error-handling)
5. [Endpoints by Resource](#endpoints-by-resource)
   - [Health](#health)
   - [Authentication](#authentication-endpoints)
   - [Listings](#listings)
   - [Transactions](#transactions)
   - [Associates](#associates)
   - [Market Centers](#market-centers)
   - [Teams](#teams)
   - [Addresses](#addresses)
   - [Files](#files)

---

## Overview

**Base URL**: `http://localhost:3000/api` (development) | `https://api.kwsa-cloud.io/api` (production)

**API Version**: v1

**Content-Type**: `application/json`

**Authentication**: JWT Bearer Token (see [Authentication](#authentication))

---

## Authentication

### JWT Token

All authenticated endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Structure

```json
{
  "userId": "uuid-here",
  "email": "user@example.com",
  "roles": ["REGIONAL_ADMIN", "OFFICE_ADMIN"],
  "marketCenterId": "uuid-here",
  "iat": 1704960000,
  "exp": 1705046400
}
```

### Token Expiration

- **Access Token Expiry**: 7 days
- **Refresh Token Expiry**: 30 days
- Use `/auth/refresh` endpoint to get new token

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Operation successful"
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [
    { "id": "uuid", "name": "Item 1" },
    { "id": "uuid", "name": "Item 2" }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  },
  "message": "Retrieved successfully"
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Successful GET/PUT/DELETE |
| 201 | Created | Successful POST |
| 204 | No Content | DELETE successful, no response body |
| 400 | Bad Request | Invalid input, validation failed |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | User lacks permission |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 422 | Unprocessable Entity | Invalid data |
| 500 | Internal Server Error | Server error |

### Common Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_INPUT | 400 | Validation failed |
| UNAUTHORIZED | 401 | Missing authentication |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource doesn't exist |
| DUPLICATE | 409 | Resource already exists |
| INVALID_TRANSITION | 422 | Invalid status transition |
| DATABASE_ERROR | 500 | Database operation failed |

---

## Endpoints by Resource

---

## Health

### Get Server Health

**Endpoint**: `GET /health`

**Authentication**: None

**Description**: Check server health status

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "database": "connected",
  "version": "1.0.0"
}
```

---

## Authentication Endpoints

### Register New User

**Endpoint**: `POST /auth/register`

**Authentication**: None

**Request Body**:
```json
{
  "email": "agent@company.com",
  "password": "SecurePassword123!",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "agent@company.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "message": "User created successfully"
}
```

**Validation**:
- Email: valid email format, unique
- Password: min 8 chars, 1 uppercase, 1 number, 1 special char
- First/Last Name: required

---

### Login

**Endpoint**: `POST /auth/login`

**Authentication**: None

**Request Body**:
```json
{
  "email": "agent@company.com",
  "password": "SecurePassword123!"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "agent@company.com",
      "firstName": "John",
      "lastName": "Doe",
      "roles": ["AGENT"],
      "marketCenterId": "uuid"
    }
  }
}
```

---

### Refresh Token

**Endpoint**: `POST /auth/refresh`

**Authentication**: Refresh Token (in body or header)

**Request Body**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 604800
  }
}
```

---

### Logout

**Endpoint**: `POST /auth/logout`

**Authentication**: Required (Bearer Token)

**Response** (204):
No content

---

## Listings

### List Listings

**Endpoint**: `GET /listings`

**Authentication**: Required

**Query Parameters**:
```
page=1                    # Page number (default: 1)
pageSize=20              # Items per page (default: 20, max: 100)
status=ACTIVE            # Filter by status (ACTIVE, SOLD, WITHDRAWN)
marketCenterId=uuid      # Filter by market center
search=luxury apartment   # Full-text search
sortBy=createdAt         # Sort field (createdAt, price, listing_date)
sortOrder=desc           # asc or desc (default: desc)
minPrice=100000          # Minimum price
maxPrice=5000000         # Maximum price
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "listingNumber": "MC-2024-0001",
      "address": "123 Main Street, Cape Town",
      "price": 1500000,
      "status": "ACTIVE",
      "listingType": "RESIDENTIAL",
      "createdAt": "2024-01-10T08:00:00Z",
      "createdBy": { "id": "uuid", "firstName": "John", "lastName": "Doe" }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 145,
    "totalPages": 8
  }
}
```

---

### Get Listing Details

**Endpoint**: `GET /listings/{listingId}`

**Authentication**: Required

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "listingNumber": "MC-2024-0001",
    "address": {
      "id": "uuid",
      "streetNumber": "123",
      "streetName": "Main Street",
      "suburb": "Sea Point",
      "city": "Cape Town",
      "province": "Western Cape",
      "postalCode": "8005",
      "country": { "id": "uuid", "name": "South Africa" },
      "latitude": -33.9249,
      "longitude": 18.3945
    },
    "price": 1500000,
    "priceHistory": [
      { "price": 1600000, "changedAt": "2024-01-01", "reason": "Initial" },
      { "price": 1500000, "changedAt": "2024-01-10", "reason": "Price reduction" }
    ],
    "status": { "id": "uuid", "name": "ACTIVE" },
    "listingType": { "id": "uuid", "name": "RESIDENTIAL" },
    "description": {
      "propertyTitle": "Luxury 3-bedroom apartment",
      "description": "Well-maintained apartment...",
      "specialFeatures": "Pool, gym, sea views"
    },
    "buildingInfo": {
      "builtInYear": 2015,
      "totalArea": 250,
      "areaType": "SQM",
      "floorArea": 200,
      "landArea": 300
    },
    "features": [
      { "type": "BEDROOM", "count": 3 },
      { "type": "BATHROOM", "count": 2 },
      { "type": "GARAGE", "count": 1 },
      { "type": "POOL", "count": 1 }
    ],
    "images": [
      { "id": "uuid", "url": "gs://...path.jpg", "orderNumber": 1, "caption": "Front view" }
    ],
    "associates": [
      { "id": "uuid", "firstName": "John", "lastName": "Doe", "role": "LISTING_AGENT" }
    ],
    "mandate": {
      "type": { "name": "EXCLUSIVE" },
      "startDate": "2024-01-10",
      "endDate": "2024-04-10",
      "commission": 6.5
    },
    "thirdPartyIntegrations": {
      "property24Reference": "P2412345",
      "kwwReference": "KWW-uuid",
      "lightStonePropertyId": "LS-12345"
    },
    "createdAt": "2024-01-10T08:00:00Z",
    "updatedAt": "2024-01-15T14:30:00Z"
  }
}
```

---

### Create Listing

**Endpoint**: `POST /listings`

**Authentication**: Required (role: AGENT, OFFICE_ADMIN, REGIONAL_ADMIN)

**Request Body**:
```json
{
  "address": {
    "streetNumber": "123",
    "streetName": "Main Street",
    "suburb": "Sea Point",
    "city": "Cape Town",
    "province": "Western Cape",
    "postalCode": "8005",
    "countryId": "uuid",
    "latitude": -33.9249,
    "longitude": 18.3945
  },
  "price": 1500000,
  "listingTypeId": "uuid",
  "saleOrRentTypeId": "uuid",
  "ownershipTypeId": "uuid",
  "description": {
    "propertyTitle": "Luxury 3-bedroom apartment",
    "description": "Well-maintained apartment with....",
    "specialFeatures": "Pool, gym, sea views"
  },
  "buildingInfo": {
    "builtInYear": 2015,
    "totalArea": 250,
    "areaType": "SQM"
  },
  "features": [
    { "featureTypeId": "uuid", "count": 3 },
    { "featureTypeId": "uuid", "count": 2 }
  ],
  "mandateInfo": {
    "mandateTypeId": "uuid",
    "startDate": "2024-01-10",
    "endDate": "2024-04-10",
    "commission": 6.5
  }
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "listingNumber": "MC-2024-0001",
    "status": "PENDING"
  },
  "message": "Listing created successfully"
}
```

---

### Update Listing

**Endpoint**: `PUT /listings/{listingId}`

**Authentication**: Required (owner or admin)

**Request Body**: Same as Create (partial fields allowed)

**Response** (200):
```json
{
  "success": true,
  "data": { /* updated listing */ },
  "message": "Listing updated successfully"
}
```

---

### Update Listing Status

**Endpoint**: `PATCH /listings/{listingId}/status`

**Authentication**: Required (owner or admin)

**Request Body**:
```json
{
  "statusId": "uuid",  // ACTIVE, SOLD, WITHDRAWN, EXPIRED, PENDING
  "reason": "Price reduction - market adjustment"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": { "id": "uuid", "status": "ACTIVE" },
  "message": "Status updated successfully"
}
```

---

### Upload Listing Image

**Endpoint**: `POST /listings/{listingId}/upload-image`

**Authentication**: Required

**Content-Type**: `multipart/form-data`

**Form Data**:
```
file: <binary file>
caption: "Front view" (optional)
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "path": "gs://bucket/listings/uuid/images/uuid.jpg",
    "url": "https://signed-url-here",
    "orderNumber": 1
  }
}
```

---

### Delete Listing

**Endpoint**: `DELETE /listings/{listingId}`

**Authentication**: Required (owner or admin)

**Response** (204):
No content (soft delete)

---

### Queue Listing to Property24

**Endpoint**: `POST /listings/{listingId}/queue-p24`

**Authentication**: Required (admin)

**Response** (200):
```json
{
  "success": true,
  "data": {
    "feedItemId": "uuid",
    "status": "PENDING",
    "queuedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## Transactions

### List Transactions

**Endpoint**: `GET /transactions`

**Authentication**: Required

**Query Parameters**:
```
page=1
pageSize=20
status=ACTIVE
listingId=uuid
associateId=uuid
search=transaction-number
sortBy=createdAt
sortOrder=desc
minAmount=500000
maxAmount=10000000
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transactionNumber": "T-2024-001",
      "listingNumber": "MC-2024-0001",
      "soldPrice": 1500000,
      "status": "ACTIVE",
      "estimatedClosureDate": "2024-03-15",
      "createdAt": "2024-01-10T08:00:00Z"
    }
  ],
  "pagination": { /* ... */ }
}
```

---

### Get Transaction Details

**Endpoint**: `GET /transactions/{transactionId}`

**Authentication**: Required

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "transactionNumber": "T-2024-001",
    "listing": { /* listing details */ },
    "status": "ACTIVE",
    "description": {
      "soldPrice": 1500000,
      "contractGCI": 90000,
      "vat": 12600,
      "gciExcludingVat": 77400
    },
    "bond": {
      "hasBond": true,
      "bondAmount": 1200000,
      "financingType": "MORTGAGE",
      "institution": "FIRSTRAND_BANK"
    },
    "associates": [
      {
        "id": "uuid",
        "name": "John Doe",
        "role": "LISTING_AGENT",
        "commission": 50,
        "paymentAmount": 38700,
        "isPaid": false
      },
      {
        "id": "uuid",
        "name": "Jane Smith",
        "role": "SELLING_AGENT",
        "commission": 50,
        "paymentAmount": 38700,
        "isPaid": false
      }
    ],
    "contacts": [
      {
        "id": "uuid",
        "name": "Attorney John",
        "type": "ATTORNEY",
        "email": "john@attorney.com"
      }
    ],
    "documents": [
      {
        "id": "uuid",
        "fileName": "OTP.pdf",
        "url": "gs://...OTP.pdf",
        "uploadedAt": "2024-01-15T10:00:00Z"
      }
    ],
    "createdAt": "2024-01-10T08:00:00Z"
  }
}
```

---

### Create Transaction

**Endpoint**: `POST /transactions`

**Authentication**: Required (AGENT, OFFICE_ADMIN, REGIONAL_ADMIN)

**Request Body**:
```json
{
  "listingId": "uuid",
  "soldPrice": 1500000,
  "commissionPercentage": 6,
  "estimatedClosureDate": "2024-03-15",
  "associates": [
    {
      "associateId": "uuid",
      "roleId": "uuid",  // LISTING_AGENT
      "commissionPercentage": 50
    },
    {
      "associateId": "uuid",
      "roleId": "uuid",  // SELLING_AGENT
      "commissionPercentage": 50
    }
  ],
  "bond": {
    "hasBond": true,
    "bondAmount": 1200000,
    "financingTypeId": "uuid",
    "institutionId": "uuid"
  }
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "transactionNumber": "T-2024-001",
    "status": "ACTIVE",
    "gciExcludingVat": 77400
  }
}
```

---

### Update Transaction

**Endpoint**: `PUT /transactions/{transactionId}`

**Authentication**: Required

**Request Body**: Same as Create (partial fields allowed)

**Response** (200):
```json
{
  "success": true,
  "data": { /* updated transaction */ }
}
```

---

### Update Transaction Status

**Endpoint**: `PATCH /transactions/{transactionId}/status`

**Authentication**: Required

**Request Body**:
```json
{
  "statusId": "uuid",  // ACTIVE, PENDING, CLOSED, CANCELLED
  "reason": "Bond approved"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": { "id": "uuid", "status": "PENDING" }
}
```

---

### Record Payment

**Endpoint**: `POST /transactions/{transactionId}/payments/{paymentId}/mark-paid`

**Authentication**: Required (OFFICE_ADMIN, REGIONAL_ADMIN)

**Request Body**:
```json
{
  "paymentMethod": "BANK_TRANSFER",
  "paidDate": "2024-02-01",
  "reference": "SWIFT123456"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": { "id": "uuid", "isPaid": true, "paidDate": "2024-02-01" }
}
```

---

### Delete Transaction

**Endpoint**: `DELETE /transactions/{transactionId}`

**Authentication**: Required (creator or admin)

**Response** (204):
No content (soft delete)

---

## Associates

### List Associates

**Endpoint**: `GET /associates`

**Authentication**: Required

**Query Parameters**:
```
page=1
pageSize=20
status=ACTIVE
marketCenterId=uuid
teamId=uuid
search=name
sortBy=firstName
sortOrder=asc
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@company.com",
      "status": "ACTIVE",
      "marketCenter": "Sea Point Office",
      "team": "Residential Sales",
      "licenseNumber": "FSP123456",
      "joinDate": "2023-01-15",
      "p24AgentId": "P2412345"
    }
  ],
  "pagination": { /* ... */ }
}
```

---

### Get Associate Details

**Endpoint**: `GET /associates/{associateId}`

**Authentication**: Required

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@company.com",
    "status": "ACTIVE",
    "marketCenter": {
      "id": "uuid",
      "name": "Sea Point Office"
    },
    "team": {
      "id": "uuid",
      "name": "Residential Sales"
    },
    "businessDetail": {
      "kwuid": "KW-UUID",
      "breeNumber": "BREE123",
      "directPhone": "0218001234",
      "directCell": "0821234567",
      "commission": 6.5
    },
    "thirdPartyIntegrations": {
      "property24": "P2412345",
      "kww": "KW-UUID",
      "lightstone": "LS-UUID"
    },
    "listings": [
      {
        "id": "uuid",
        "listingNumber": "MC-2024-0001",
        "address": "123 Main Street, Cape Town",
        "status": "ACTIVE"
      }
    ],
    "transactions": [
      {
        "id": "uuid",
        "transactionNumber": "T-2024-001",
        "amount": 1500000
      }
    ],
    "joinDate": "2023-01-15",
    "createdAt": "2023-01-15T08:00:00Z"
  }
}
```

---

### Create Associate

**Endpoint**: `POST /associates`

**Authentication**: Required (OFFICE_ADMIN, REGIONAL_ADMIN)

**Request Body**:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@company.com",
  "marketCenterId": "uuid",
  "teamId": "uuid",
  "licenseNumber": "FSP123456",
  "joinDate": "2024-01-15",
  "businessDetail": {
    "kwuid": "KW-UUID",
    "breeNumber": "BREE123",
    "directPhone": "0218001234",
    "directCell": "0821234567"
  }
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

---

### Update Associate

**Endpoint**: `PUT /associates/{associateId}`

**Authentication**: Required (owner or admin)

**Request Body**: Same as Create (partial fields allowed)

---

### Transfer Associate

**Endpoint**: `POST /associates/{associateId}/transfer`

**Authentication**: Required (REGIONAL_ADMIN, OFFICE_ADMIN)

**Request Body**:
```json
{
  "toMarketCenterId": "uuid",
  "toTeamId": "uuid",
  "transferDate": "2024-02-01",
  "reason": "Regional restructure",
  "includeTransactions": false
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "PENDING",
    "fromMarketCenter": "Sea Point Office",
    "toMarketCenter": "Century City Office",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

---

### Get Associate GCI Report

**Endpoint**: `GET /associates/{associateId}/report/gci`

**Authentication**: Required

**Query Parameters**:
```
startDate=2024-01-01
endDate=2024-01-31
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "associate": { "id": "uuid", "name": "John Doe" },
    "period": { "startDate": "2024-01-01", "endDate": "2024-01-31" },
    "totalEarnings": 156800,
    "transactionCount": 2,
    "averageCommission": 78400,
    "transactions": [
      {
        "transactionNumber": "T-2024-001",
        "amount": 77400,
        "closureDate": "2024-01-20"
      },
      {
        "transactionNumber": "T-2024-002",
        "amount": 79400,
        "closureDate": "2024-01-28"
      }
    ]
  }
}
```

---

### Delete Associate

**Endpoint**: `DELETE /associates/{associateId}`

**Authentication**: Required (REGIONAL_ADMIN)

**Response** (204):
No content (soft delete)

---

## Market Centers

### List Market Centers

**Endpoint**: `GET /market-centers`

**Authentication**: Required

**Query Parameters**:
```
page=1
pageSize=20
status=ACTIVE
region=WC
search=name
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Sea Point Office",
      "address": "City Centre, Sea Point",
      "status": "ACTIVE",
      "teamCount": 3,
      "associateCount": 12,
      "phone": "021-4483700",
      "email": "seapoint@kwsa.co.za"
    }
  ],
  "pagination": { /* ... */ }
}
```

---

### Get Market Center Details

**Endpoint**: `GET /market-centers/{marketCenterId}`

**Authentication**: Required

---

### Create Market Center

**Endpoint**: `POST /market-centers`

**Authentication**: Required (REGIONAL_ADMIN)

---

### Update Market Center

**Endpoint**: `PUT /market-centers/{marketCenterId}`

**Authentication**: Required (REGIONAL_ADMIN)

---

## Teams

### List Teams

**Endpoint**: `GET /teams`

**Authentication**: Required

**Query Parameters**: supports filtering by marketCenterId, status

---

### Create Team

**Endpoint**: `POST /teams`

**Authentication**: Required (OFFICE_ADMIN, REGIONAL_ADMIN)

---

### Update Team

**Endpoint**: `PUT /teams/{teamId}`

**Authentication**: Required (team manager or admin)

---

## Addresses

### Search Addresses

**Endpoint**: `GET /addresses/search`

**Authentication**: Required

**Query Parameters**:
```
query=Sea Point    # Search suburbs/cities
countryId=uuid
provinceId=uuid
limit=10
```

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fullAddress": "Sea Point, Cape Town, Western Cape, South Africa",
      "suburb": "Sea Point",
      "city": "Cape Town",
      "province": "Western Cape",
      "country": "South Africa",
      "latitude": -33.9249,
      "longitude": 18.3945
    }
  ]
}
```

---

## Files

### Upload File (Generic)

**Endpoint**: `POST /files/upload`

**Authentication**: Required

**Form Data**:
```
file: <binary>
entityType: listings|transactions|associates
entityId: uuid
category: images|documents|profile
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "path": "gs://bucket/...",
    "url": "https://signed-url",
    "size": 1024000
  }
}
```

---

### Download File

**Endpoint**: `GET /files/{fileId}/download`

**Authentication**: Required

**Response**: 302 redirect to signed URL or file stream

---

### Delete File

**Endpoint**: `DELETE /files/{fileId}`

**Authentication**: Required (owner or admin)

**Response** (204):
No content

---

## Rate Limiting

All endpoints are rate-limited:
- **Anonymous**: 10 requests/minute
- **Authenticated**: 100 requests/minute
- **Admin (REGIONAL_ADMIN)**: 500 requests/minute

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1704960060
```

---

## Pagination

All list endpoints support pagination:

**Query Parameters**:
- `page`: page number (1-based, default: 1)
- `pageSize`: items per page (default: 20, max: 100)

**Response Headers**:
```json
{
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## Sorting

List endpoints support sorting:

**Query Parameters**:
- `sortBy`: field name (createdAt, firstName, price, etc.)
- `sortOrder`: asc | desc (default: desc)

---

## Filtering

List endpoints support filtering:

Example: `/listings?status=ACTIVE&marketCenterId=uuid&minPrice=500000`

---

## Versioning

API supports versioned endpoints:
- `/api/v1/...` (current)
- `/api/v2/...` (future)

---

## Deprecation

Deprecated endpoints will include header:
```
Deprecation: true
Sunset: Mon, 31 Dec 2024 23:59:59 GMT
Link: </api/v2/endpoint>; rel="successor-version"
```

---

This API specification is actively maintained. For questions or to suggest improvements, please open an issue in the repository.
