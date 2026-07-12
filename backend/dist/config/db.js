import { Pool } from 'pg';
import { env, getRequiredDatabaseUrl } from './env.js';
import { logger } from './logger.js';
let sharedPool;
function isRetryableConnectionError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (message.includes('connection terminated unexpectedly')
        || message.includes('connection terminated due to connection timeout')
        || message.includes('terminating connection due to administrator command')
        || message.includes('ecconnreset')
        || message.includes('econnreset')
        || message.includes('client has encountered a connection error'));
}
function parseBoolean(value, fallback) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}
function hasSslModeEnabled(connectionString) {
    try {
        const url = new URL(connectionString);
        const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
        return Boolean(sslMode && sslMode !== 'disable');
    }
    catch {
        return /sslmode=/i.test(connectionString);
    }
}
function normalizeConnectionString(connectionString) {
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
    }
    catch {
        return {
            connectionString,
            sslMode: null,
        };
    }
}
function defaultRejectUnauthorized(sslMode, isDevelopment) {
    // Match libpq semantics by default:
    // - verify-full / verify-ca => verify certificates
    // - require / prefer / allow / disable => do not require CA verification
    // Explicit env var DB_SSL_REJECT_UNAUTHORIZED can still override this behavior.
    if (!sslMode) {
        return !isDevelopment;
    }
    const normalizedMode = sslMode.trim().toLowerCase();
    if (normalizedMode === 'verify-full' || normalizedMode === 'verify-ca') {
        return true;
    }
    return false;
}
export function getOptionalPgPool() {
    if (sharedPool !== undefined) {
        return sharedPool;
    }
    if (!env.database.url || env.database.client !== 'postgres') {
        sharedPool = null;
        return sharedPool;
    }
    const normalized = normalizeConnectionString(env.database.url);
    const sslModeEnabled = normalized.sslMode ? normalized.sslMode !== 'disable' : hasSslModeEnabled(normalized.connectionString);
    const rejectUnauthorized = parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, defaultRejectUnauthorized(normalized.sslMode, env.isDevelopment));
    sharedPool = new Pool({
        connectionString: normalized.connectionString,
        ssl: sslModeEnabled ? { rejectUnauthorized } : undefined,
        // Keep production conservative for Cloud SQL limits, but allow more headroom in local dev.
        max: env.isDevelopment ? 15 : 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: env.isDevelopment ? 15000 : 5000,
    });
    sharedPool.on('connect', (client) => {
        void client
            .query("SELECT set_config('TimeZone', $1, false)", [env.appTimeZone])
            .catch((err) => {
            logger.warn({ err, timeZone: env.appTimeZone }, 'failed to set PostgreSQL session timezone');
        });
    });
    // Prevent idle connection drops from crashing the process.
    // pg-pool emits 'error' on idle clients when the server closes the connection.
    sharedPool.on('error', (err) => {
        logger.warn({ err }, 'pg pool idle client error — connection will be re-established on next query');
    });
    return sharedPool;
}
export function getRequiredPgPool() {
    const pool = getOptionalPgPool();
    if (!pool) {
        getRequiredDatabaseUrl();
    }
    return pool;
}
export async function withPgPoolRetry(work) {
    let attempt = 0;
    while (attempt < 2) {
        const pool = getRequiredPgPool();
        try {
            return await work(pool);
        }
        catch (error) {
            attempt += 1;
            if (attempt >= 2 || !isRetryableConnectionError(error)) {
                throw error;
            }
            logger.warn({ err: error, attempt }, 'Retrying PostgreSQL operation after resetting shared pool');
            await closeSharedPgPool();
        }
    }
    throw new Error('PostgreSQL retry loop exited unexpectedly');
}
export async function closeSharedPgPool() {
    if (!sharedPool)
        return;
    await sharedPool.end();
    sharedPool = undefined;
}
//# sourceMappingURL=db.js.map