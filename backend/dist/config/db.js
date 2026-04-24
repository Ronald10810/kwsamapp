import { Pool } from 'pg';
import { env, getRequiredDatabaseUrl } from './env.js';
let sharedPool;
export function getOptionalPgPool() {
    if (sharedPool !== undefined) {
        return sharedPool;
    }
    if (!env.database.url || env.database.client !== 'postgres') {
        sharedPool = null;
        return sharedPool;
    }
    sharedPool = new Pool({ connectionString: env.database.url });
    return sharedPool;
}
export function getRequiredPgPool() {
    const pool = getOptionalPgPool();
    if (!pool) {
        getRequiredDatabaseUrl();
    }
    return pool;
}
export async function closeSharedPgPool() {
    if (!sharedPool)
        return;
    await sharedPool.end();
    sharedPool = undefined;
}
//# sourceMappingURL=db.js.map