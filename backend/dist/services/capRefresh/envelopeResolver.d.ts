import { type CalculatedRowMeta, type Queryable } from '../transactionCalculations.js';
import type { ResolvedCapRefreshContext } from './envelopeTypes.js';
export declare function resolveCapRefreshContext(db: Queryable, transactionId: number): Promise<ResolvedCapRefreshContext>;
export declare function buildEnvelopeKeyForEntry(entry: CalculatedRowMeta): string;
//# sourceMappingURL=envelopeResolver.d.ts.map