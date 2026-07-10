import type { CalculatedRowMeta, Queryable } from '../transactionCalculations.js';
import type {
  CapRefreshDiffRow,
  CapRefreshValueSet,
  CurrentTacEnvelopeRow,
  ProtectedFieldCheckResult,
} from './envelopeTypes.js';
import { buildEnvelopeKeyForEntry } from './envelopeResolver.js';

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoneyString(value: number): string {
  return value.toFixed(2);
}

function currentValueSet(row: CurrentTacEnvelopeRow | null): CapRefreshValueSet {
  return {
    market_center_dollar: toMoneyString(toNumber(row?.market_center_dollar)),
    team_dollar: toMoneyString(toNumber(row?.team_dollar)),
    associate_dollar: toMoneyString(toNumber(row?.associate_dollar)),
    cap_contribution: toMoneyString(toNumber(row?.cap_contribution)),
    cap_remaining: toMoneyString(toNumber(row?.cap_remaining)),
  };
}

function proposedValueSet(entry: CalculatedRowMeta): CapRefreshValueSet {
  return {
    market_center_dollar: toMoneyString(entry.row.market_center_dollar),
    team_dollar: toMoneyString(entry.row.team_dollar),
    associate_dollar: toMoneyString(entry.row.associate_dollar),
    cap_contribution: toMoneyString(entry.row.cap_contribution),
    cap_remaining: toMoneyString(entry.row.cap_remaining),
  };
}

function deltaValueSet(current: CapRefreshValueSet, proposed: CapRefreshValueSet): CapRefreshValueSet {
  return {
    market_center_dollar: toMoneyString(toNumber(proposed.market_center_dollar) - toNumber(current.market_center_dollar)),
    team_dollar: toMoneyString(toNumber(proposed.team_dollar) - toNumber(current.team_dollar)),
    associate_dollar: toMoneyString(toNumber(proposed.associate_dollar) - toNumber(current.associate_dollar)),
    cap_contribution: toMoneyString(toNumber(proposed.cap_contribution) - toNumber(current.cap_contribution)),
    cap_remaining: toMoneyString(toNumber(proposed.cap_remaining) - toNumber(current.cap_remaining)),
  };
}

function valueSetsDiffer(current: CapRefreshValueSet, proposed: CapRefreshValueSet): boolean {
  return current.market_center_dollar !== proposed.market_center_dollar
    || current.team_dollar !== proposed.team_dollar
    || current.associate_dollar !== proposed.associate_dollar
    || current.cap_contribution !== proposed.cap_contribution
    || current.cap_remaining !== proposed.cap_remaining;
}

export async function fetchCurrentEnvelopeTacRows(db: Queryable, transactionAgentIds: number[]): Promise<Map<number, CurrentTacEnvelopeRow>> {
  if (transactionAgentIds.length === 0) {
    return new Map<number, CurrentTacEnvelopeRow>();
  }

  const result = await db.query<CurrentTacEnvelopeRow>(
    `
    SELECT
      transaction_agent_id,
      market_center_dollar::text AS market_center_dollar,
      team_dollar::text AS team_dollar,
      associate_dollar::text AS associate_dollar,
      cap_contribution::text AS cap_contribution,
      cap_remaining::text AS cap_remaining,
      transaction_gci_before_fees::text AS transaction_gci_before_fees,
      gci_after_fees_excl_vat::text AS gci_after_fees_excl_vat,
      production_royalties::text AS production_royalties,
      growth_share::text AS growth_share,
      total_pr_and_gs::text AS total_pr_and_gs
    FROM migration.transaction_agent_calculations
    WHERE transaction_agent_id = ANY($1::int[])
    `,
    [transactionAgentIds]
  );

  return new Map(result.rows.map((row) => [Number(row.transaction_agent_id), row]));
}

export function buildCapRefreshDiffRows(
  currentByAgentId: Map<number, CurrentTacEnvelopeRow>,
  proposedEntries: CalculatedRowMeta[],
  projected: boolean
): CapRefreshDiffRow[] {
  const rows: CapRefreshDiffRow[] = [];

  for (const entry of proposedEntries) {
    const current = currentValueSet(currentByAgentId.get(entry.row.transaction_agent_id) ?? null);
    const proposed = proposedValueSet(entry);
    if (!valueSetsDiffer(current, proposed)) continue;

    rows.push({
      transactionAgentId: entry.row.transaction_agent_id,
      transactionId: entry.row.transaction_id,
      transactionNumber: entry.row.transaction_number,
      transactionStatus: entry.row.transaction_status,
      capProgressKey: entry.cap_progress_key,
      envelopeKey: buildEnvelopeKeyForEntry(entry),
      current,
      proposed,
      delta: deltaValueSet(current, proposed),
      projected,
    });
  }

  return rows;
}

export function checkProtectedFieldMismatches(
  currentByAgentId: Map<number, CurrentTacEnvelopeRow>,
  proposedEntries: CalculatedRowMeta[]
): ProtectedFieldCheckResult {
  const violations = [] as ProtectedFieldCheckResult['violations'];

  for (const entry of proposedEntries) {
    const current = currentByAgentId.get(entry.row.transaction_agent_id);
    if (!current) continue;

    const checks: Array<[string, string, string]> = [
      ['transaction_gci_before_fees', toMoneyString(toNumber(current.transaction_gci_before_fees)), toMoneyString(entry.row.transaction_gci_before_fees)],
      ['gci_after_fees_excl_vat', toMoneyString(toNumber(current.gci_after_fees_excl_vat)), toMoneyString(entry.row.gci_after_fees_excl_vat)],
      ['production_royalties', toMoneyString(toNumber(current.production_royalties)), toMoneyString(entry.row.production_royalties)],
      ['growth_share', toMoneyString(toNumber(current.growth_share)), toMoneyString(entry.row.growth_share)],
      ['total_pr_and_gs', toMoneyString(toNumber(current.total_pr_and_gs)), toMoneyString(entry.row.total_pr_and_gs)],
    ];

    for (const [field, currentValue, proposedValue] of checks) {
      if (currentValue === proposedValue) continue;
      violations.push({
        transactionAgentId: entry.row.transaction_agent_id,
        field,
        current: currentValue,
        proposed: proposedValue,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    protectedNonTacWritesBlocked: true,
  };
}
