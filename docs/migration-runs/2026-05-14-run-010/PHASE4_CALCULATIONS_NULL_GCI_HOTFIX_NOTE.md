# PHASE4_CALCULATIONS_NULL_GCI_HOTFIX_NOTE

Date: 2026-05-15
Approval Scope: Approval 10r (patch only, no execution)

## Exact Failure

Script 3 failed at:
- scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql:196

Error:
- null value in column "transaction_gci_before_fees" of relation "transaction_agent_calculations" violates not-null constraint

## Affected Rows

Read-only diagnostic count for qualifying calculation rows with NULL source GCI:
- NULL tapd.gci_before_fees: 940 rows

## Approved Patch Applied

File patched:
- scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql

Exact change in transaction_agent_calculations INSERT SELECT list:
- From: tapd.gci_before_fees
- To: COALESCE(tapd.gci_before_fees, 0)

## Why COALESCE to 0 Is Safe for This Migration Stage

- Target column migration.transaction_agent_calculations.transaction_gci_before_fees is NOT NULL with default 0.
- The migration objective at this stage is completeness and deterministic load behavior for all qualifying rows.
- Using 0 for missing source GCI prevents hard failure and preserves row-level traceability while allowing downstream reconciliation.
- This aligns with existing schema defaults for multiple financial columns in transaction_agent_calculations.

## Additional NOT NULL Risks Found (Read-Only)

The table has other NOT NULL numeric columns that are currently populated directly from nullable source fields in script 3.

For the same qualifying candidate set, observed NULL source values:
- production_royalties: 939
- growth_share: 939
- gci_after_fees_excl_vat: 939
- associate_dollar: 952
- cap_remaining: 944
- team_dollar: 952
- market_center_dollar (tapd.mc_dollar): 952

Observed non-risk from current mapping:
- split_percentage: 0 NULLs in candidate rows

Note:
- These additional risk fields were not patched in Approval 10r because scope was limited to NULL gci_before_fees handling only.

## Confirmation

- No data was changed.
- Script 3 was not executed after patching.
- Script 4 was not executed.
- No INSERT/UPDATE/DELETE/TRUNCATE was run.
- No kwsa_uat, kwsa_prod, or kwsa access.
- No secrets, Cloud Run env vars, deployments, or production changes.

## Recommended Next Approval

Approval 10s:
1. Patch additional NOT NULL-risk financial mappings in script 3 with COALESCE(..., 0) for the identified columns.
2. Execute script 3 in kwsa_import_staging only.
3. If script 3 succeeds, execute script 4 validation.
4. Stop on first failure and document outcomes.
