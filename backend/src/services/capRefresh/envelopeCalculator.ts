import {
  applyCapProgressionToCalculatedRowsWithMeta,
  type CalculatedRowMeta,
} from '../transactionCalculations.js';
import { isProjectedCapStatus } from './statusRules.js';
import type { CapRefreshPreviewMode } from './envelopeTypes.js';

function cloneEntries(entries: CalculatedRowMeta[]): CalculatedRowMeta[] {
  return entries.map((entry) => ({
    row: { ...entry.row },
    cap_progress_key: entry.cap_progress_key,
  }));
}

export function buildActualEnvelopeEntries(entries: CalculatedRowMeta[]): CalculatedRowMeta[] {
  return applyCapProgressionToCalculatedRowsWithMeta(cloneEntries(entries));
}

export function determinePreviewMode(targetEntries: CalculatedRowMeta[]): CapRefreshPreviewMode {
  const hasProjectedEligibleRow = targetEntries.some((entry) => isProjectedCapStatus(entry.row.transaction_status));
  const hasRegisteredRow = targetEntries.some((entry) => entry.row.is_registered);
  return hasProjectedEligibleRow && !hasRegisteredRow ? 'projected' : 'actual';
}

export function buildProjectedEnvelopeEntries(
  entries: CalculatedRowMeta[],
  targetTransactionAgentIds: number[]
): CalculatedRowMeta[] {
  const overrideIds = new Set(targetTransactionAgentIds);
  const projectedEntries = cloneEntries(entries).map((entry) => {
    if (!overrideIds.has(entry.row.transaction_agent_id)) {
      return entry;
    }

    if (!isProjectedCapStatus(entry.row.transaction_status)) {
      return entry;
    }

    return {
      row: {
        ...entry.row,
        is_registered: true,
      },
      cap_progress_key: entry.cap_progress_key,
    };
  });

  return applyCapProgressionToCalculatedRowsWithMeta(projectedEntries);
}
