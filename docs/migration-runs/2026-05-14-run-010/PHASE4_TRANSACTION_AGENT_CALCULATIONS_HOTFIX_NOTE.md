# PHASE4_TRANSACTION_AGENT_CALCULATIONS_HOTFIX_NOTE

Date: 2026-05-15
Approval Scope: Approval 10o (diagnose and patch transaction_agent_calculations INSERT failure only)

## Root Cause Analysis

**Why transaction_agent_calculations inserted 0 rows:**

The INSERT INTO migration.transaction_agent_calculations statement in script 3 (line 120+) has a **schema column mismatch**:

1. **Missing column in INSERT list:** `source_associate_id`
   - The table requires this column (column position 5)
   - The SELECT statement does NOT provide this value
   - Result: INSERT statement fails silently or returns 0 rows

2. **INSERT column list (21 columns):**
   - transaction_id, transaction_agent_id, associate_id, agent_name, office_name, transaction_side, effective_reporting_date, is_registered, split_percentage, transaction_gci_before_fees, production_royalties, growth_share, total_pr_and_gs, gci_after_fees_excl_vat, associate_dollar, cap_remaining, team_dollar, market_center_dollar, is_outside_agent, created_at, updated_at

3. **Actual table columns (31 total):**
   - id, transaction_agent_id, transaction_id, associate_id, **source_associate_id**, is_outside_agent, agent_name, office_name, transaction_side, split_percentage, variance_sale_list_pct, sales_value_component, transaction_gci_before_fees, average_commission_pct, production_royalties, growth_share, total_pr_and_gs, gci_after_fees_excl_vat, associate_split_pct, market_center_split_pct, associate_dollar, cap_amount, cap_contribution, cap_remaining, team_dollar, market_center_dollar, cap_cycle_start_date, cap_cycle_end_date, effective_reporting_date, is_registered, created_at, updated_at

4. **Missing from SELECT (script provides no source_associate_id):**
   - Should provide: `ta.source_associate_id`
   - Other missing columns (can be NULL): variance_sale_list_pct, sales_value_component, average_commission_pct, associate_split_pct, market_center_split_pct, cap_amount, cap_contribution, cap_cycle_start_date, cap_cycle_end_date

## Exact Join Issue

**Current SELECT:**
```sql
SELECT
  ct.id AS transaction_id,
  ta.id AS transaction_agent_id,
  ta.associate_id,
  COALESCE(ca.full_name, ta.source_associate_id, 'Unknown Agent') AS agent_name,
  mc.name AS office_name,
  ... (other columns)
FROM staging.transaction_associate_payment_details_raw tapd
JOIN migration.core_transactions ct ON ct.source_transaction_id::text = tapd.source_transaction_id::text
LEFT JOIN LATERAL (
  SELECT ta_match.* FROM migration.transaction_agents ta_match
  WHERE ta_match.transaction_id = ct.id
    AND ta_match.source_associate_id::text = tapd.source_associate_id::text
  ORDER BY ta_match.id LIMIT 1
) ta ON true
LEFT JOIN migration.core_associates ca ON ca.id = ta.associate_id
LEFT JOIN migration.core_market_centers mc ON mc.id = ca.market_center_id
```

**Issue:** The SELECT references `ta.source_associate_id` in expressions (e.g., COALESCE for agent_name) but **never selects it into a column**. The INSERT expects this as a standalone column position 5.

## Corrected INSERT Statement

Add `source_associate_id` as column 5 in INSERT list, and add `ta.source_associate_id AS source_associate_id` to SELECT (after `ta.associate_id`):

```sql
INSERT INTO migration.transaction_agent_calculations (
  transaction_id,
  transaction_agent_id,
  associate_id,
  source_associate_id,                    -- NEW
  agent_name,
  office_name,
  transaction_side,
  effective_reporting_date,
  is_registered,
  split_percentage,
  transaction_gci_before_fees,
  production_royalties,
  growth_share,
  total_pr_and_gs,
  gci_after_fees_excl_vat,
  associate_dollar,
  cap_remaining,
  team_dollar,
  market_center_dollar,
  is_outside_agent,
  created_at,
  updated_at
)
SELECT
  ct.id AS transaction_id,
  ta.id AS transaction_agent_id,
  ta.associate_id,
  ta.source_associate_id,                 -- NEW
  COALESCE(ca.full_name, ta.source_associate_id, 'Unknown Agent') AS agent_name,
  mc.name AS office_name,
  COALESCE(NULLIF(BTRIM(ta.agent_role), ''), NULLIF(BTRIM(ct.sale_type), ''), 'Agent') AS transaction_side,
  COALESCE(ct.status_change_date::date, ct.transaction_date::date, ct.created_at::date) AS effective_reporting_date,
  CASE WHEN LOWER(BTRIM(COALESCE(ct.transaction_status, ''))) IN ('registered', 'paid') THEN true ELSE false END AS is_registered,
  tapd.split_percentage,
  tapd.gci_before_fees,
  tapd.production_royalties,
  tapd.growth_share,
  COALESCE(tapd.production_royalties, 0) + COALESCE(tapd.growth_share, 0) AS total_pr_and_gs,
  tapd.gci_after_fees_excl_vat,
  tapd.associate_dollar,
  tapd.cap_remaining,
  tapd.team_dollar,
  tapd.mc_dollar,
  false AS is_outside_agent,
  now(),
  now()
FROM staging.transaction_associate_payment_details_raw tapd
JOIN migration.core_transactions ct
  ON ct.source_transaction_id::text = tapd.source_transaction_id::text
LEFT JOIN LATERAL (
  SELECT ta_match.*
  FROM migration.transaction_agents ta_match
  WHERE ta_match.transaction_id = ct.id
    AND ta_match.source_associate_id::text = tapd.source_associate_id::text
  ORDER BY ta_match.id
  LIMIT 1
) ta ON true
LEFT JOIN migration.core_associates ca
  ON ca.id = ta.associate_id
LEFT JOIN migration.core_market_centers mc
  ON mc.id = ca.market_center_id
WHERE (
    current_setting('migration.batch', true) IS NULL
    OR current_setting('migration.batch', true) = ''
    OR tapd.batch_id = current_setting('migration.batch', true)
  )
  AND ta.id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM migration.transaction_agent_calculations existing
    WHERE existing.transaction_agent_id = ta.id
      AND existing.transaction_id = ct.id
      AND COALESCE(existing.split_percentage, 0) = COALESCE(tapd.split_percentage, 0)
      AND COALESCE(existing.transaction_gci_before_fees, 0) = COALESCE(tapd.gci_before_fees, 0)
  );
```

## Expected Rows After Fix

- **Pre-fix state:** 0 rows
- **Expected after fix:** 42,533 rows (matching payment details with valid transaction_agents)
- **Non-matching payment details (to be rejected):** 4,291 (already in load_rejections)
- **Total payment detail rows:** 46,824 ✓

## Safety Considerations

**Existing transaction_agents = 46,824 can remain in place:**
- ✓ YES. These rows are safe and required for transaction_agent_calculations to join.
- The corrected INSERT does NOT touch transaction_agents; it only reads from it.

**Existing load_rejections = 72,546 can remain in place:**
- ✓ YES. The rejected rows (from earlier failures) are separate and do not affect this fix.
- Only new transaction_agent_calculations rows will be inserted.

## Confirmation

- No data was changed during this approval (Approval 10o is read-only diagnostics only).
- Script 3 was NOT executed.
- Script 4 was NOT executed.
- No kwsa_uat, kwsa_prod, kwsa, secrets, env vars, or deployments were touched.
- Only diagnostic queries were run; no INSERT/UPDATE/DELETE executed.

## Recommended Next Approval

- **Approval 10p:** Patch script 3 with the corrected transaction_agent_calculations INSERT (add source_associate_id column + value), then run script 3 only to populate the 42,533 missing transaction_agent_calculations rows.
- Then run script 4 validation to confirm Phase 4 completion.
