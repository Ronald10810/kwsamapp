# PHASE4_CALCULATIONS_NULL_FINANCIALS_HOTFIX_NOTE

Date: 2026-05-15
Approval Scope: Approval 10s (patch-only; no execution)

## NULL-Risk Fields Found

For qualifying transaction_agent_calculations candidate rows, the following nullable source fields were previously identified as potential NOT NULL target failures:

- tapd.gci_before_fees (NULL rows: 940)
- tapd.production_royalties (NULL rows: 939)
- tapd.growth_share (NULL rows: 939)
- tapd.gci_after_fees_excl_vat (NULL rows: 939)
- tapd.associate_dollar (NULL rows: 952)
- tapd.cap_remaining (NULL rows: 944)
- tapd.team_dollar (NULL rows: 952)
- tapd.mc_dollar (NULL rows: 952)

## Exact Fields Patched with COALESCE

File patched:
- scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql

In the transaction_agent_calculations INSERT SELECT list:

- Kept (from Approval 10r):
  - COALESCE(tapd.gci_before_fees, 0)

- Added in Approval 10s:
  - COALESCE(tapd.production_royalties, 0)
  - COALESCE(tapd.growth_share, 0)
  - COALESCE(tapd.gci_after_fees_excl_vat, 0)
  - COALESCE(tapd.associate_dollar, 0)
  - COALESCE(tapd.cap_remaining, 0)
  - COALESCE(tapd.team_dollar, 0)
  - COALESCE(tapd.mc_dollar, 0)

## Why COALESCE to 0 Is Acceptable at Migration Staging Phase

- The target table enforces NOT NULL for these numeric financial columns.
- For this migration stage, preserving load continuity and deterministic row creation is the priority.
- Using 0 for missing numeric components prevents statement failure while preserving full row traceability for later reconciliation.
- This behavior is consistent with table-level default semantics already used for many financial columns in migration.transaction_agent_calculations.

## Structural Re-Check (No SQL Execution)

- INSERT target columns in transaction_agent_calculations block: 22
- SELECT expressions in corresponding SELECT list: 22
- Count match: YES

Referenced INSERT target columns in this statement are consistent with previously verified table schema for migration.transaction_agent_calculations.

## Confirmation

- No data was changed.
- No SQL was executed in Approval 10s.
- Script 3 was not executed.
- Script 4 was not executed.
- No kwsa_uat, kwsa_prod, or kwsa access.
- No secrets, env vars, deployments, or production changes.

## Recommended Next Approval

Approval 10t:
1. Execute patched script 3 in kwsa_import_staging only (via proxy 127.0.0.1:9470).
2. If script 3 succeeds, execute script 4 validation.
3. Stop on first failure and capture full diagnostics.
4. Update execution report and log; no commit/push until approved.
