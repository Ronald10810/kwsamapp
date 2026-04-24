import 'dotenv/config';
import { type PoolClient } from 'pg';
export declare function withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
export declare function closePool(): Promise<void>;
export declare function runInTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
//# sourceMappingURL=db.d.ts.map