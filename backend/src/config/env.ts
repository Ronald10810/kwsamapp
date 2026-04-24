import path from 'node:path';

export type DatabaseClient = 'postgres' | 'sqlserver';
export type StorageBackend = 'local' | 'gcs';

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseInteger(value: string | undefined, fallback: number): number {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  return normalized
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDatabaseClient(value: string | undefined): DatabaseClient {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === 'sqlserver' ? 'sqlserver' : 'postgres';
}

function parseStorageBackend(value: string | undefined): StorageBackend {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === 'gcs' ? 'gcs' : 'local';
}

function buildPostgresUrlFromParts(): string | null {
  const host = normalizeString(process.env.DB_HOST);
  const database = normalizeString(process.env.DB_NAME);
  const user = normalizeString(process.env.DB_USER) ?? normalizeString(process.env.DB_USERNAME);
  const password = normalizeString(process.env.DB_PASSWORD);
  const port = parseInteger(process.env.DB_PORT, 5432);

  if (!host || !database || !user || !password) {
    return null;
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const nodeEnv = normalizeString(process.env.NODE_ENV) ?? 'development';
const databaseClient = parseDatabaseClient(process.env.DB_CLIENT);
const storageBackend = parseStorageBackend(process.env.STORAGE_BACKEND);
const uploadsDir = path.resolve(process.cwd(), normalizeString(process.env.UPLOADS_DIR) ?? 'uploads');

const databaseUrl = normalizeString(process.env.DATABASE_URL)
  ?? (databaseClient === 'postgres' ? buildPostgresUrlFromParts() : null);

export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  port: parseInteger(process.env.PORT, 3000),
  logLevel: normalizeString(process.env.LOG_LEVEL) ?? 'info',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, nodeEnv === 'production'),
  corsOrigins: parseList(process.env.CORS_ORIGIN, ['http://localhost:5173']),
  preserveCoreEdits: parseBoolean(process.env.PRESERVE_CORE_EDITS, false),
  googleClientId: normalizeString(process.env.GOOGLE_CLIENT_ID),
  jwtSecret: normalizeString(process.env.JWT_SECRET) ?? 'dev-jwt-secret-change-in-production',
  database: {
    client: databaseClient,
    url: databaseUrl,
  },
  storage: {
    backend: storageBackend,
    localUploadsEnabled: storageBackend === 'local',
    uploadsDir,
  },
  gcp: {
    projectId: normalizeString(process.env.GOOGLE_CLOUD_PROJECT),
    uploadsBucket: normalizeString(process.env.GCS_BUCKET_NAME),
  },
} as const;

export function getRequiredDatabaseUrl(): string {
  if (!env.database.url) {
    throw new Error(
      'Database configuration is missing. Set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.'
    );
  }

  if (env.database.client !== 'postgres') {
    throw new Error(
      `DB_CLIENT=${env.database.client} is not supported by the current backend runtime. The current implementation requires PostgreSQL-compatible drivers and SQL.`
    );
  }

  return env.database.url;
}
