import type { Pool, PoolClient } from 'pg';
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export declare function recomputeAllTransactionAgentCalculations(db: Queryable): Promise<void>;
export {};
//# sourceMappingURL=transactionCalculations.d.ts.map