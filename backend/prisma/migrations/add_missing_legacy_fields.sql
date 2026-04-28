-- Migration: add_missing_legacy_fields
-- Adds fields that exist in the legacy C# / Azure SQL system but were absent
-- from the Prisma schema.  All columns are nullable (or have safe defaults)
-- so existing rows are unaffected.
-- Apply to:  kwsa database (Cloud SQL PostgreSQL instance kwsa-postgres)
-- Run via:   psql "$DATABASE_URL" -f add_missing_legacy_fields.sql

-- ============================================================
-- associates
-- ============================================================
ALTER TABLE associates
  ADD COLUMN IF NOT EXISTS "nationalId" TEXT,
  ADD COLUMN IF NOT EXISTS "ffcNumber"  TEXT;

-- ============================================================
-- associate_business_details
-- ============================================================
ALTER TABLE associate_business_details
  ADD COLUMN IF NOT EXISTS "proposedGrowthShareSponsor"   TEXT,
  ADD COLUMN IF NOT EXISTS "growthShareSponsorId"         INTEGER REFERENCES associates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "temporaryGrowthShareSponsor"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "listingApprovalRequired"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "excludeFromIndividualReports" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vested"                       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vestingStartPeriod"           TIMESTAMP(3);

-- ============================================================
-- associate_contact_details
-- ============================================================
ALTER TABLE associate_contact_details
  ADD COLUMN IF NOT EXISTS "privateEmail" TEXT;

-- ============================================================
-- listings
-- ============================================================
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS "listingDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reducedDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pendingDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "withdrawnDate" TIMESTAMP(3);

-- ============================================================
-- listing_mandate_infos
-- ============================================================
ALTER TABLE listing_mandate_infos
  ADD COLUMN IF NOT EXISTS "signedDate"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onMarketSince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ratesTaxes"    DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "monthlyLevy"   DECIMAL(65,30);

-- ============================================================
-- listing_price_details
-- ============================================================
ALTER TABLE listing_price_details
  ADD COLUMN IF NOT EXISTS "agentPropertyValuation" DECIMAL(65,30);

-- ============================================================
-- transaction_descriptions
-- ============================================================
ALTER TABLE transaction_descriptions
  ADD COLUMN IF NOT EXISTS "varianceSaleListPricePerc" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "avgCommsPerc"              DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "soldDate"                  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expectedDate"              TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentNotes"              TEXT,
  ADD COLUMN IF NOT EXISTS "returnNotes"               TEXT;

-- ============================================================
-- transaction_associates
-- ============================================================
ALTER TABLE transaction_associates
  ADD COLUMN IF NOT EXISTS "splitPercentage" DECIMAL(65,30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "outsideAgency"   TEXT;

-- ============================================================
-- transaction_associate_payment_details
-- ============================================================
ALTER TABLE transaction_associate_payment_details
  ADD COLUMN IF NOT EXISTS "transactionGCIBeforeFees" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "productionRoyalties"      DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "growthShare"              DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "gciAfterFeesExclVAT"      DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "capRemaining"             DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "associateDollar"          DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "teamDollar"               DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "mcDollar"                 DECIMAL(65,30);
