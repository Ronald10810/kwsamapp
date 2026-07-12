import { type CalculatedRowMeta } from '../transactionCalculations.js';
import type { CapRefreshPreviewMode } from './envelopeTypes.js';
export declare function buildActualEnvelopeEntries(entries: CalculatedRowMeta[]): CalculatedRowMeta[];
export declare function determinePreviewMode(targetEntries: CalculatedRowMeta[]): CapRefreshPreviewMode;
export declare function buildProjectedEnvelopeEntries(entries: CalculatedRowMeta[], targetTransactionAgentIds: number[]): CalculatedRowMeta[];
//# sourceMappingURL=envelopeCalculator.d.ts.map