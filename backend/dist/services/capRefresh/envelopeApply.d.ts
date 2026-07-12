import type { Queryable } from '../transactionCalculations.js';
import type { CapRefreshActor, CapRefreshApplyResult, CapRefreshDiffRow, CapRefreshDryRunResult } from './envelopeTypes.js';
export declare function acquireEnvelopeLocks(db: Queryable, envelopeKeys: string[]): Promise<void>;
export declare function persistEnvelopeChanges(db: Queryable, rows: CapRefreshDiffRow[]): Promise<void>;
export declare function dryRunCapRefresh(db: Queryable, transactionId: number): Promise<CapRefreshDryRunResult>;
export declare function applyCapRefresh(db: Queryable, actor: CapRefreshActor, transactionId: number): Promise<CapRefreshApplyResult>;
//# sourceMappingURL=envelopeApply.d.ts.map