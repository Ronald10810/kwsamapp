# PHASE4_SCRIPT3_FALLBACK_DUPLICATE_HOTFIX_NOTE

Date: 2026-05-15
Approval Scope: Approval 10l (patch script 3 fallback duplicate handling only)

## Why the duplicate key happened
- In script 3, the authoritative insert (from `staging.transaction_agents_raw_source`) inserted 46,824 rows into `migration.transaction_agents`.
- The compatibility fallback insert (from `staging.transaction_agents`) then attempted to insert rows with the same `(transaction_id, source_associate_id)` pairs.
- `migration.transaction_agents` enforces unique key `transaction_agents_transaction_id_source_associate_id_key`, so fallback collided and failed.

## What fallback insert was patched
- File patched: `scripts/migration/phase4/03-group-d-transaction-participants-and-financials.sql`
- Patched block: compatibility fallback insert into `migration.transaction_agents`.
- Change made: fallback de-duplication check now skips rows that already exist by the unique key pair only.

Old fallback NOT EXISTS predicate:
- `existing.transaction_id = ct.id`
- `COALESCE(existing.source_associate_id, '') = COALESCE(sta.source_associate_id, '')`
- `agent_role` equality check
- `split_percentage` equality check

New fallback NOT EXISTS predicate:
- `existing.transaction_id = ct.id`
- `existing.source_associate_id IS NOT DISTINCT FROM sta.source_associate_id`

## Patch strategy used
- Strategy: `NOT EXISTS` on `(transaction_id, source_associate_id)` unique key.
- `ON CONFLICT DO NOTHING` was not used.

## Safety of existing 46,824 transaction_agents rows
- Safe to leave in place.
- They were created by the authoritative source insert and are exactly the rows the fallback was duplicating.

## Will rerunning script 3 now continue to transaction_agent_calculations?
- Expected: Yes.
- With fallback duplicates skipped by key, script 3 should proceed past fallback insert and continue into `transaction_agent_calculations` logic.
- Existing `transaction_agents` rows remain available for the `LEFT JOIN LATERAL` matching used by the calculations insert.

## Idempotency/safety note for rerun
- This patch improves idempotency for reruns where authoritative rows already exist.
- Fallback insert should no longer fail on duplicate key for already-loaded `(transaction_id, source_associate_id)` pairs.

## Confirmation no data was changed
- Confirmed. This approval applied a script file patch and documentation only.
- No SQL scripts were run.
- No insert/update/delete/truncate operations were executed.

## Recommended next approval
- Approval 10m: run script 3 only (with current database safety checks before each SQL step), stop on first failure, capture counts and errors.
- If script 3 succeeds, then run script 4 validation under a separate approval or as explicitly approved in the same step.
