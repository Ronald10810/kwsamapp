import { Pool } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

let publicReadOnlyPool: Pool | null | undefined;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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

function defaultRejectUnauthorized(sslMode: string | null, isDevelopment: boolean): boolean {
  // For development, always skip SSL verification issues
  if (isDevelopment) {
    return false;
  }

  if (!sslMode) {
    return true;
  }

  const normalizedMode = sslMode.trim().toLowerCase();
  if (normalizedMode === 'verify-full' || normalizedMode === 'verify-ca') {
    return true;
  }

  return false;
}

export function getPublicReadOnlyPgPool(): Pool | null {
  if (publicReadOnlyPool !== undefined) {
    return publicReadOnlyPool;
  }

  const readOnlyUrl = env.publicDatabase.url ?? env.database.url;
  if (!readOnlyUrl || env.database.client !== 'postgres') {
    publicReadOnlyPool = null;
    return publicReadOnlyPool;
  }

  const normalized = normalizeConnectionString(readOnlyUrl);
  const sslModeEnabled = normalized.sslMode ? normalized.sslMode !== 'disable' : hasSslModeEnabled(normalized.connectionString);
  const rejectUnauthorized = parseBoolean(
    process.env.PUBLIC_DB_SSL_REJECT_UNAUTHORIZED,
    defaultRejectUnauthorized(normalized.sslMode, env.isDevelopment)
  );
  const maxConnections = parsePositiveInt(process.env.PUBLIC_DB_MAX_CONNECTIONS, 10);
  const connectionTimeoutMillis = parsePositiveInt(process.env.PUBLIC_DB_CONNECTION_TIMEOUT_MS, 15000);

  publicReadOnlyPool = new Pool({
    connectionString: normalized.connectionString,
    ssl: sslModeEnabled ? { rejectUnauthorized } : undefined,
    max: maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis,
  });

  publicReadOnlyPool.on('connect', (client) => {
    void client
      .query("SELECT set_config('TimeZone', $1, false)", [env.appTimeZone])
      .catch((err) => {
        logger.warn({ err, timeZone: env.appTimeZone }, 'failed to set PostgreSQL session timezone for public read-only pool');
      });

    void client
      .query("SET default_transaction_read_only = on")
      .catch((err) => {
        logger.error({ err }, 'failed to force read-only mode for public database session');
      });
  });

  publicReadOnlyPool.on('error', (err) => {
    logger.warn({ err }, 'public read-only pg pool idle client error');
  });

  return publicReadOnlyPool;
}

export async function closePublicReadOnlyPgPool(): Promise<void> {
  if (!publicReadOnlyPool) return;
  await publicReadOnlyPool.end();
  publicReadOnlyPool = undefined;
}
