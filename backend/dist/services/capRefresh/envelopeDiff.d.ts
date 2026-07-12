import type { CalculatedRowMeta, Queryable } from '../transactionCalculations.js';
import type { CapRefreshDiffRow, CurrentTacEnvelopeRow, ProtectedFieldCheckResult } from './envelopeTypes.js';
export declare function fetchCurrentEnvelopeTacRows(db: Queryable, transactionAgentIds: number[]): Promise<Map<number, CurrentTacEnvelopeRow>>;
export declare function buildCapRefreshDiffRows(currentByAgentId: Map<number, CurrentTacEnvelopeRow>, proposedEntries: CalculatedRowMeta[], projected: boolean): CapRefreshDiffRow[];
export declare function checkProtectedFieldMismatches(currentByAgentId: Map<number, CurrentTacEnvelopeRow>, proposedEntries: CalculatedRowMeta[]): ProtectedFieldCheckResult;
//# sourceMappingURL=envelopeDiff.d.ts.map