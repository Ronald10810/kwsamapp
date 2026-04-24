import { Pool } from 'pg';
export declare function getOptionalPgPool(): Pool | null;
export declare function getRequiredPgPool(): Pool;
export declare function closeSharedPgPool(): Promise<void>;
//# sourceMappingURL=db.d.ts.map