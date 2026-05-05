import { Pool } from 'pg';
import { env, getRequiredDatabaseUrl } from './env.js';
import { logger } from './logger.js';

let sharedPool: Pool | null | undefined;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function hasSslModeEnabled(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    return Boolean(sslMode && sslMode !== 'disable');
  } catch {
    return /sslmode=/i.test(connectionString);
  }
}

function normalizeConnectionString(connectionString: string): { connectionString: string; sslMode: string | null } {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase() ?? null;
    if (sslMode) {
      url.searchParams.delete('sslmode');
    }

    return {
      connectionString: url.toString(),
      sslMode,
    };
  } catch {
    return {
      connectionString,
      sslMode: null,
    };
  }
}

export function getOptionalPgPool(): Pool | null {
  if (sharedPool !== undefined) {
    return sharedPool;
  }

  if (!env.database.url || env.database.client !== 'postgres') {
    sharedPool = null;
    return sharedPool;
  }

  const normalized = normalizeConnectionString(env.database.url);
  const sslModeEnabled = normalized.sslMode ? normalized.sslMode !== 'disable' : hasSslModeEnabled(normalized.connectionString);
  const rejectUnauthorized = parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, !env.isDevelopment);

  sharedPool = new Pool({
    connectionString: normalized.connectionString,
    ssl: sslModeEnabled ? { rejectUnauthorized } : undefined,
  });

  // Prevent idle connection drops from crashing the process.
  // pg-pool emits 'error' on idle clients when the server closes the connection.
  sharedPool.on('error', (err) => {
    logger.warn({ err }, 'pg pool idle client error — connection will be re-established on next query');
  });

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
