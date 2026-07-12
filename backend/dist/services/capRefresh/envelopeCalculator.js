import { applyCapProgressionToCalculatedRowsWithMeta, } from '../transactionCalculations.js';
import { isProjectedCapStatus } from './statusRules.js';
function cloneEntries(entries) {
    return entries.map((entry) => ({
        row: { ...entry.row },
        cap_progress_key: entry.cap_progress_key,
    }));
}
export function buildActualEnvelopeEntries(entries) {
    return applyCapProgressionToCalculatedRowsWithMeta(cloneEntries(entries));
}
export function determinePreviewMode(targetEntries) {
    const hasProjectedEligibleRow = targetEntries.some((entry) => isProjectedCapStatus(entry.row.transaction_status));
    const hasRegisteredRow = targetEntries.some((entry) => entry.row.is_registered);
    return hasProjectedEligibleRow && !hasRegisteredRow ? 'projected' : 'actual';
}
export function buildProjectedEnvelopeEntries(entries, targetTransactionAgentIds) {
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
//# sourceMappingURL=envelopeCalculator.js.map