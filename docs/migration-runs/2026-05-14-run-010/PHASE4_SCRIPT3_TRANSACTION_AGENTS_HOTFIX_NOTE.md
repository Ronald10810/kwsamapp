# PHASE4_SCRIPT3_TRANSACTION_AGENTS_HOTFIX_NOTE

Date: 2026-05-15
Approval: 10j (script 3 transaction_agents schema hotfix)

## Actual migration.transaction_agents columns
id, transaction_id, associate_id, source_associate_id, agent_role, split_percentage, net_comm, sort_order, created_at, updated_at

Does NOT have: agent_name, outside_agency

## Actual migration.transaction_agent_calculations columns
id, transaction_agent_id, transaction_id, associate_id, source_associate_id, is_outside_agent, agent_name, office_name, transaction_side, split_percentage, variance_sale_list_pct, sales_value_component, transaction_gci_before_fees, average_commission_pct, production_royalties, growth_share, total_pr_and_gs, gci_after_fees_excl_vat, associate_split_pct, market_center_split_pct, associate_dollar, cap_amount, cap_contribution, cap_remaining, team_dollar, market_center_dollar, cap_cycle_start_date, cap_cycle_end_date, effective_reporting_date, is_registered, created_at (updated_at presence uncertain — pager cut off output; not failing yet)

## Missing columns found in script 3

### migration.transaction_agents INSERT (both blocks)
- agent_name: does NOT exist in migration.transaction_agents
- outside_agency: does NOT exist in migration.transaction_agents

### transaction_agent_calculations SELECT
- ta.agent_name: ta is aliased to migration.transaction_agents which has no agent_name → fails
- ta.outside_agency: ta is aliased to migration.transaction_agents which has no outside_agency → fails

## What was patched (scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql)

### INSERT 1 (authoritative raw source → transaction_agents)
- Removed `agent_name` from column list
- Removed `outside_agency` from column list
- Removed `COALESCE(ca.full_name, NULLIF(BTRIM(tas.associate_name), ''), 'Unknown Agent') AS agent_name` from SELECT
- Removed `COALESCE(tas.outside_agency, false)` from SELECT

### INSERT 2 (compatibility fallback → transaction_agents)
- Removed `agent_name` from column list
- Removed `outside_agency` from column list
- Removed `COALESCE(ca.full_name, NULLIF(BTRIM(sta.associate_name), ''), 'Unknown Agent') AS agent_name` from SELECT
- Removed `false` (outside_agency value) from SELECT

### transaction_agent_calculations SELECT
- Replaced `ta.agent_name` with `COALESCE(ca.full_name, ta.source_associate_id, 'Unknown Agent') AS agent_name`
  (ca is already joined on ta.associate_id, so ca.full_name is the correct name source)
- Replaced `COALESCE(ta.outside_agency, false)` with `false AS is_outside_agent`

## How agent display/name fields are handled without agent_name in transaction_agents
- agent_name is NOT stored on migration.transaction_agents.
- For transaction_agent_calculations (which does have agent_name), the value is derived at INSERT time
  using COALESCE(ca.full_name, ta.source_associate_id, 'Unknown Agent').
- ca is joined via ca.id = ta.associate_id, which is the correct association.
- If ca.full_name is null, falls back to the raw source_associate_id string, then 'Unknown Agent'.
- This means agent display names are stored only in transaction_agent_calculations, not in transaction_agents.

## Whether outside_agency is preserved elsewhere
- outside_agency is available in staging.transaction_agents_raw_source as `tas.outside_agency`
  and in the raw_payload JSONB field (confirmed — the load_rejections logic already serialises it).
- It is NOT stored in migration.transaction_agents.
- In migration.transaction_agent_calculations, the `is_outside_agent` column is populated with `false`
  as a safe default. If outside_agency from the source needs to be preserved, a follow-up enrichment pass
  could join back to staging.transaction_agents_raw_source on source_associate_id/transaction_id.

## Exact cleanup SQL needed before rerun (do not run yet)
```sql
-- Remove the 46,824 payment-details rejection rows added by the failed partial script 3 run.
-- These are false-positives: transaction_agents was empty when they were inserted,
-- so all payment-details rows appeared to be unmatched. They will be re-evaluated on rerun.
DELETE FROM migration.load_rejections
WHERE entity_name = 'transaction_associate_payment_details_raw'
  AND reason = 'No matching transaction_agent for payment detail row';
```
Expected: DELETE 46,824 rows (or however many remain with this entity_name/reason combination).

## Confirmation no data was changed
- No data was changed. Only the SQL script file was patched.

## Recommended next approval
- Approval 10k: Commit/push this hotfix, run the cleanup SQL above, then rerun Approval 10e
  (step 0 cleanup + step 4 only, or full sequence from step 4 if core tables are intact).

---

### Summary for audit/report:
1. Files changed: scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql
2. No data was changed.
3. No kwsa_uat, kwsa_prod, kwsa, secrets, env vars, or deployments were touched.
4. Next step: Approval 10k (commit/push, cleanup SQL, rerun).
