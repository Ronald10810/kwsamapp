import { Pool } from 'pg';
export declare function getOptionalPgPool(): Pool | null;
export declare function getRequiredPgPool(): Pool;
export declare function withPgPoolRetry<T>(work: (pool: Pool) => Promise<T>): Promise<T>;
export declare function closeSharedPgPool(): Promise<void>;
//# sourceMappingURL=db.d.ts.map