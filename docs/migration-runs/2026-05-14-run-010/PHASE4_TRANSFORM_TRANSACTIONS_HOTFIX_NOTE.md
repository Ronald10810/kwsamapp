# PHASE4_TRANSFORM_TRANSACTIONS_HOTFIX_NOTE

Date: 2026-05-15
Approval: 10h (transform script transactions hotfix)

## Actual migration.core_transactions columns
- id
- source_transaction_id
- primary_market_center_id
- transaction_number
- transaction_status
- transaction_type
- source_listing_id
- listing_number
- address
- suburb
- city
- sales_price
- list_price
- gci_excl_vat
- net_comm
- total_gci
- sale_type
- buyer
- seller
- list_date
- transaction_date
- status_change_date
- expected_date
- created_at
- updated_at

## Non-existent columns referenced by the script
- source_associate_id (does not exist)
- associate_id (does not exist)
- market_center_id (should be primary_market_center_id)
- split_percentage (does not exist)

## What was patched
- Removed references to source_associate_id, associate_id, split_percentage, and market_center_id in the INSERT and SELECT for migration.core_transactions.
- Aligned the INSERT and SELECT columns with the actual schema of migration.core_transactions.
- ON CONFLICT clause updated to match only valid columns.

## Whether transaction-agent relationships remain handled in Group D/script 3
- Yes, transaction-agent/associate relationships are handled in scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql, not in core_transactions.

## Confirmation no data was changed
- No data was changed. Only the SQL script was patched.

## Recommended next approval
- Approval 10i: Commit/push this hotfix, then rerun Approval 10e (full transform and Phase 4 sequence).

---

### Summary for audit/report:
1. Actual columns checked: migration.core_transactions (see above).
2. Script mismatches found: source_associate_id, associate_id, split_percentage, market_center_id (should be primary_market_center_id).
3. Files changed: scripts/transform-staging-to-migration.sql.
4. No data was changed.
5. No kwsa_uat, kwsa_prod, kwsa, secrets, env vars, or deployments were touched.
6. Next step: Approval 10i (commit/push, then rerun Approval 10e).
