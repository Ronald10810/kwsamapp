import {
  buildPreCapCalculatedRowsWithMeta,
  fetchRawRows,
  groupByTransaction,
  type CalculatedRowMeta,
  type Queryable,
} from '../transactionCalculations.js';
import type { CapEnvelopeDescriptor, ResolvedCapRefreshContext } from './envelopeTypes.js';

function buildEnvelopeKey(entry: CalculatedRowMeta): string {
  return `${entry.cap_progress_key}|${entry.row.cap_cycle_start_date}`;
}

function buildEnvelopeDescriptor(entry: CalculatedRowMeta): CapEnvelopeDescriptor {
  const envelopeType = entry.cap_progress_key.startsWith('team-') ? 'team' : 'associate';
  const entityId = envelopeType === 'team'
    ? entry.cap_progress_key.slice('team-'.length)
    : (entry.row.associate_id == null ? entry.row.source_associate_id : String(entry.row.associate_id));

  return {
    envelopeKey: buildEnvelopeKey(entry),
    capProgressKey: entry.cap_progress_key,
    envelopeType,
    entityId: entityId ?? null,
    cycleStartDate: entry.row.cap_cycle_start_date,
    cycleEndDate: entry.row.cap_cycle_end_date,
    transactionAgentIds: [],
    transactionIds: [],
  };
}

export async function resolveCapRefreshContext(db: Queryable, transactionId: number): Promise<ResolvedCapRefreshContext> {
  const rawRows = await fetchRawRows(db);
  const groups = groupByTransaction(rawRows);
  const baseEntries = buildPreCapCalculatedRowsWithMeta(groups);
  const targetEntries = baseEntries.filter((entry) => entry.row.transaction_id === transactionId);

  if (targetEntries.length === 0) {
    throw new Error('Transaction was not found in the cap refresh source set.');
  }

  const envelopeKeySet = new Set(
    targetEntries
      .filter((entry) => !entry.row.is_outside_agent)
      .map((entry) => buildEnvelopeKey(entry))
  );

  const envelopeEntries = baseEntries.filter((entry) => envelopeKeySet.has(buildEnvelopeKey(entry)));
  const impactedEnvelopeMap = new Map<string, CapEnvelopeDescriptor>();

  for (const entry of envelopeEntries) {
    const envelopeKey = buildEnvelopeKey(entry);
    const existing = impactedEnvelopeMap.get(envelopeKey) ?? buildEnvelopeDescriptor(entry);
    existing.transactionAgentIds.push(entry.row.transaction_agent_id);
    if (!existing.transactionIds.includes(entry.row.transaction_id)) {
      existing.transactionIds.push(entry.row.transaction_id);
    }
    impactedEnvelopeMap.set(envelopeKey, existing);
  }

  return {
    transactionId,
    transactionNumber: targetEntries[0]?.row.transaction_number ?? null,
    baseEntries,
    targetEntries,
    envelopeEntries,
    impactedEnvelopes: Array.from(impactedEnvelopeMap.values()),
  };
}

export function buildEnvelopeKeyForEntry(entry: CalculatedRowMeta): string {
  return buildEnvelopeKey(entry);
}
