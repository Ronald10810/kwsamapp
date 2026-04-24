import { Pool } from 'pg';
import { env, getRequiredDatabaseUrl } from './env.js';

let sharedPool: Pool | null | undefined;

export function getOptionalPgPool(): Pool | null {
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

export function getRequiredPgPool(): Pool {
  const pool = getOptionalPgPool();
  if (!pool) {
    getRequiredDatabaseUrl();
  }
  return pool as Pool;
}

export async function closeSharedPgPool(): Promise<void> {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = undefined;
}
