# MAPP2_CUSTOM_TABLES_AND_FIELDS

Date: 2026-05-13
Status: Initial identification from current PostgreSQL snapshot and codebase.

## Likely MAPP 2.0-only Tables (not part of Azure legacy core export)
- app_users
- users
- roles
- user_roles
- audit_logs
- cma_documents
- marketing_plan_documents
- loom_user_tokens
- public_leads

## Likely MAPP 2.0-only / Extended Fields (examples)
- associates.nationalId
- associates.ffcNumber
- associate_contact_details.privateEmail
- associate_business_details.proposedGrowthShareSponsor
- associate_business_details.growthShareSponsorId
- associate_business_details.temporaryGrowthShareSponsor
- associate_business_details.listingApprovalRequired
- associate_business_details.excludeFromIndividualReports
- associate_business_details.vested
- associate_business_details.vestingStartPeriod
- listings.listingDate
- listings.reducedDate
- listings.pendingDate
- listings.withdrawnDate
- listing_mandate_infos.signedDate
- listing_mandate_infos.onMarketSince
- listing_mandate_infos.ratesTaxes
- listing_mandate_infos.monthlyLevy
- listing_price_details.agentPropertyValuation
- transaction_descriptions.varianceSaleListPricePerc
- transaction_descriptions.avgCommsPerc
- transaction_descriptions.soldDate
- transaction_descriptions.expectedDate
- transaction_descriptions.paymentNotes
- transaction_descriptions.returnNotes
- transaction_associates.splitPercentage
- transaction_associates.outsideAgency
- transaction_associate_payment_details.transactionGCIBeforeFees
- transaction_associate_payment_details.productionRoyalties
- transaction_associate_payment_details.growthShare
- transaction_associate_payment_details.gciAfterFeesExclVAT
- transaction_associate_payment_details.capRemaining
- transaction_associate_payment_details.associateDollar
- transaction_associate_payment_details.teamDollar
- transaction_associate_payment_details.mcDollar

## Rentals Module Status
- Current sampled database (kwsa) did not expose rental_* tables in public schema snapshot.
- Existing repository scripts indicate rental-related migrations/plans exist, but active table presence must be verified against target DBs used by UAT/prod during Approval 2.

## Preservation Rule for Import
- Do not drop or recreate MAPP 2.0 tables.
- Do not null out MAPP 2.0-only columns when source Azure data has no equivalent field.
- Apply upsert/merge mapping with explicit field-level default policy.
