# PHASE4_EXECUTION_REPORT

Date: 2026-05-15
Approval Scope: Approval 10 execution attempt (Phase 4 in `kwsa_import_staging` only)
Execution Mode: Stopped on first script failure as required

## 1. Git branch and commit hash
- Worktree: C:/Users/ronal/OneDrive/Desktop/KWSA-Workspace/kwsa-cloud-console-clean-snapshot
- Branch: clean-source-snapshot-before-db-cutover
- Commit: c276fb699c296876ad9fd2642bcba4315f705429

## 2. Working tree status before and after
- Before execution: clean (`git status --short` returned no output).
- After execution attempt: documentation/log artifacts created under this run folder.

## 3. Database confirmation
Mandatory safety query before each script:

```sql
SELECT current_database();
```

Returned `kwsa_import_staging` for each precheck executed.

## 4. Scripts executed
Planned order:
1. `scripts/migration/phase4/01-core-listings-description-merge.sql`
2. `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql`
3. `scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql`
4. `scripts/migration/phase4/04-post-phase4-validation.sql`

Actual result:
- Script 1: executed successfully
- Script 2: failed, execution halted immediately
- Script 3: not executed
- Script 4: not executed

## 5. Start/end time and duration
- Start: 2026-05-15 13:09:55.009
- End: 2026-05-15 13:10:16.738 (halt on failure)
- Duration: ~00:00:21.7

## 6. Row counts before and after
Before counts:
- migration.core_market_centers = 0
- migration.core_teams = 0
- migration.core_associates = 0
- migration.core_listings = 0
- migration.core_transactions = 0
- migration.listing_agents = 0
- migration.listing_images = 0
- migration.listing_marketing_urls = 0
- migration.transaction_agents = 0
- migration.transaction_agent_calculations = 0
- migration.load_rejections = 0

After failure counts:
- migration.core_market_centers = 0
- migration.core_teams = 0
- migration.core_associates = 0
- migration.core_listings = 0
- migration.core_transactions = 0
- migration.listing_agents = 0
- migration.listing_images = 0
- migration.listing_marketing_urls = 0
- migration.transaction_agents = 0
- migration.transaction_agent_calculations = 0
- migration.load_rejections = 0

## 7. Market Centre transform results
- No change in this run (count remained 0).

## 8. Team transform results
- No change in this run (count remained 0).

## 9. Associate transform results
- No change in this run (count remained 0).

## 10. Listing and description transform results
- Script 1 ran (`01-core-listings-description-merge.sql`) and returned `UPDATE 0`.
- No listing row changes occurred (core listings count remained 0).

## 11. Listing associate transform results
- Script 2 did not execute successfully due to schema mismatch error before insert.
- No listing agent rows created.

## 12. Image/media transform results
- Not executed due to halt in script 2.
- No rows created.

## 13. Marketing URL transform results
- Not executed due to halt in script 2.
- No rows created.

## 14. Transaction transform results
- Not part of this script set and no changes occurred in this run.

## 15. Transaction agent/participant transform results
- Not executed (script 3 not run).

## 16. Financial/split/payment transform results
- Not executed (script 3 not run).

## 17. Rejection/audit counts
- migration.load_rejections remained 0 before and after halt.

## 18. Validation results
- `04-post-phase4-validation.sql` did not run due to earlier failure.
- Validation status: not executed.

## 19. Any warnings or risks
- Failure occurred because `migration.listing_agents` in current DB does not include `updated_at`, but script 2 inserts into `updated_at`.
- Current table columns for `migration.listing_agents` are:
  - id, listing_id, associate_id, agent_name, agent_role, is_primary, market_center_id, sort_order, created_at
- Risk: rerun will fail again until script 2 is patched for the live schema.

## 20. Confirmation only kwsa_import_staging was touched
- Confirmed. All SQL prechecks and execution target were `kwsa_import_staging` via Cloud SQL Auth Proxy.

## 21. Confirmation no Phase 5/UAT/prod promotion was run
- Confirmed. No script targeting `kwsa_uat`, `kwsa_prod`, or `kwsa` was executed.
- No promotion/public insertion scripts were run.

## 22. Recommended next approval step
- Approve an Approval 10a hotfix patch to remove `updated_at` from script 2 inserts (or add conditional schema handling), then rerun Approval 10 from script 2 onward with the same safety prechecks.

---

## Required failure details
1. Failed script:
- `scripts/migration/phase4/02-group-c-listing-links-media-marketing.sql`

2. Exact error:

```text
ERROR:  column "updated_at" of relation "listing_agents" does not exist
LINE 10:   updated_at
```

3. Current database:
- `kwsa_import_staging`

4. Scripts completed before failure:
- `scripts/migration/phase4/01-core-listings-description-merge.sql` (success, UPDATE 0)

5. Current row counts in affected migration/core tables:
- All key migration/core counts remained 0 (see sections 6 and 17)

6. Whether any partial transformation occurred:
- No material data transformation occurred. Script 1 executed but updated 0 rows.

7. Recommended rollback or fix:
- No rollback needed (no row-count changes).
- Fix script 2 to match live `migration.listing_agents` schema (remove `updated_at` in insert list/values), then rerun from script 2.

## Artifacts
- Execution log: `docs/migration-runs/2026-05-14-run-010/phase4-execution.log`

---

## 2026-05-15 Approval 10e rerun (FAILED)

### Execution Sequence and Results

**0. Targeted cleanup of migration.load_rejections:**
- Ran: DELETE FROM migration.load_rejections WHERE reason LIKE '%core_listings%' AND rejected_at > now() - interval '2 days';
- Result: 0 rows deleted. Current count: 72,546

**1. scripts/transform-staging-to-migration.sql:**
- Ran after verifying current_database() = kwsa_import_staging
- Result: FAILED at core_transactions step
- Error: column "source_associate_id" of relation "core_transactions" does not exist
- No rows inserted into migration.core_transactions
- All other core tables populated:
    - migration.core_market_centers: 48
    - migration.core_teams: 219
    - migration.core_associates: 9,243
    - migration.core_listings: 129,123

**2–5. Phase 4 scripts:**
- NOT RUN (execution halted on error)

### Validation and Audit
- Only kwsa_import_staging was touched.
- No secrets, env vars, or deployments were changed.
- Working tree is clean.
- No uncommitted changes.

### Row Counts After Failure
- migration.core_market_centers: 48
- migration.core_teams: 219
- migration.core_associates: 9,243
- migration.core_listings: 129,123
- migration.core_transactions: 0
- migration.load_rejections: 72,546

### Failure Details
- Step failed: scripts/transform-staging-to-migration.sql (core_transactions)
- Error: column "source_associate_id" of relation "core_transactions" does not exist
- Steps completed before failure: targeted cleanup, transform for all core tables except transactions
- No partial transformation for core_transactions (0 rows)

### Recommended Fix
- Patch scripts/transform-staging-to-migration.sql to remove or correct reference to source_associate_id in core_transactions step, aligning with actual schema:
    - Actual columns: id, source_transaction_id, primary_market_center_id, transaction_number, transaction_status, transaction_type, source_listing_id, listing_number, address, suburb, city, sales_price, list_price, gci_excl_vat, net_comm, total_gci, sale_type, buyer, seller, list_date, transaction_date, status_change_date, expected_date, created_at, updated_at
- Re-run Approval 10e after patch.

---

## 2026-05-15 Approval 10e rerun #2 (FAILED at Step 4)

### Pre-flight
- current_database() confirmed: kwsa_import_staging
- staging.transactions_raw all required columns confirmed present (transaction_type, net_comm, total_gci, buyer, seller)

### Execution Sequence and Results

**Step 0: Targeted cleanup of migration.load_rejections:**
- DELETE: 72,546 false-positive rows removed.

**Step 1: scripts/transform-staging-to-migration.sql — SUCCEEDED**
- core_market_centers: 48 (idempotent), core_teams: 219 (idempotent)
- core_associates: 9,243 (idempotent), core_listings: 129,123 (idempotent)
- core_transactions: 30,181 (new rows)

**Step 2: 01-core-listings-description-merge.sql — SUCCEEDED**
- UPDATE 129,123 listings with descriptions.

**Step 3: 02-group-c-listing-links-media-marketing.sql — SUCCEEDED**
- listing_agents: 146,571 | listing_images: 2,531,507 | listing_marketing_urls: 9,975

**Step 4: 03-group-d-transaction-participants-and-financials.sql — FAILED**
- Error 1 (line 48): column "agent_name" of relation "transaction_agents" does not exist
- Error 2 (line 93): column "agent_name" of relation "transaction_agents" does not exist
- Error 3 (line 204): column ta.agent_name does not exist (HINT: Perhaps you meant ta.agent_role)
- Actual migration.transaction_agents columns: id, transaction_id, associate_id, source_associate_id, agent_role, split_percentage, net_comm, sort_order, created_at, updated_at
- Non-existent referenced: agent_name, outside_agency (in migration.transaction_agents)
- Note: agent_name and is_outside_agent DO exist in migration.transaction_agent_calculations.

**Step 5: 04-post-phase4-validation.sql — NOT RUN (halted)**

### Row Counts After Failure
- core_market_centers: 48 | core_teams: 219 | core_associates: 9,243
- core_listings: 129,123 | core_transactions: 30,181
- listing_agents: 146,571 | listing_images: 2,531,507 | listing_marketing_urls: 9,975
- transaction_agents: 0 | transaction_agent_calculations: 0
- load_rejections: 119,370 (46,824 new rows from payment-details rejection logic)

### Audit
- Only kwsa_import_staging was touched.
- No secrets, env vars, or deployments were changed.
- Working tree is clean.

### Recommended Fix
- Approval 10j: Patch 03-group-d-transaction-participants-and-financials.sql
    - Remove agent_name and outside_agency from INSERT into migration.transaction_agents (both inserts, lines ~8 and ~50)
    - In transaction_agent_calculations INSERT, replace ta.agent_name with COALESCE(ca.full_name, 'Unknown Agent')
    - Replace ta.outside_agency with false or an appropriate fallback

---

## 2026-05-15 Approval 10k targeted cleanup + rerun from script 3 (FAILED at Script 3)

### Scope and Safety
- Branch: clean-source-snapshot-before-db-cutover
- Checkpoint: 2c036eedf24ccf1373d06a3373c9362f86f7610a
- Target DB host/port: 127.0.0.1:9470 (Cloud SQL Auth Proxy)
- Target database: kwsa_import_staging only
- Safety check: `SELECT current_database();` was executed before each SQL step and returned `kwsa_import_staging`.

### Approved cleanup executed
SQL run:

```sql
DELETE FROM migration.load_rejections
WHERE entity_name = 'transaction_associate_payment_details_raw'
    AND reason = 'No matching transaction_agent for payment detail row';
```

Pre-cleanup counts:
- total migration.load_rejections: 119,370
- entity_name = transaction_associate_payment_details_raw: 46,824
- reason = No matching transaction_agent for payment detail row: 46,824

Cleanup result:
- DELETE 46,824

Post-cleanup counts:
- total migration.load_rejections: 72,546
- entity_name = transaction_associate_payment_details_raw: 0
- reason = No matching transaction_agent for payment detail row: 0

### Script execution outcome
Planned execution:
1. scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql
2. scripts/migration/phase4/04-post-phase4-validation.sql

Actual:
- Script 3: started and partially inserted transaction agents, then failed.
- Script 4: not run (stopped immediately on first failure).

### Failure details (required)
1. Failed step:
- scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql

2. Exact error:

```text
psql:C:/Users/ronal/OneDrive/Desktop/KWSA-Workspace/kwsa-cloud-console-clean-snapshot/scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql:85: ERROR:  duplicate key value violates unique constraint "transaction_agents_transaction_id_source_associate_id_key"
```

3. Current database at failure:
- kwsa_import_staging

4. Steps completed before failure:
- pre_cleanup_counts
- targeted_cleanup_delete
- post_cleanup_counts
- partial execution of script 3 (first INSERT executed)

5. Whether any partial transformation occurred:
- Yes. Partial transformation occurred in `migration.transaction_agents`.

6. Current row counts in affected migration tables:
- migration.transaction_agents: 46,824
- migration.transaction_agent_calculations: 0
- migration.load_rejections (total): 72,546
- migration.load_rejections where entity_name='transaction_associate_payment_details_raw' and reason='No matching transaction_agent for payment detail row': 0

7. Recommended fix:
- Script 3 currently runs two inserts into `migration.transaction_agents` (authoritative source + compatibility fallback).
- The second insert is colliding with rows inserted by the first insert under unique constraint `transaction_agents_transaction_id_source_associate_id_key`.
- Next approved hotfix should make the fallback insert skip already-loaded keys by `(transaction_id, source_associate_id)` (or disable fallback when authoritative rows are present), then rerun script 3 and script 4.

### Rejection categories after failure
- listing_images_raw_source | NULL source_listing_id preserved and not mapped | 72,546

### Audit confirmations
- Only `kwsa_import_staging` was touched.
- No cleanup beyond the approved targeted delete was run.
- No transform/Phase 4 scripts 1 or 2 were rerun.
- No UAT/prod DBs were touched.
- No secrets, env vars, deployments, or asset migration steps were changed/run.

**End of report.**
