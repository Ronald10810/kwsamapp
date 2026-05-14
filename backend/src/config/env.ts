import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: envFilePath });

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

function normalizeLogLevel(value: string | undefined, fallback: string): string {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === 'warning') {
    return 'warn';
  }

  return normalized;
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

function assertLocalUatDbTarget(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL. Local dev requires a valid Postgres URL targeting kwsa_uat.');
  }

  const dbName = parsed.pathname.replace(/^\//, '').trim().toLowerCase();
  const host = parsed.hostname.trim().toLowerCase();
  if (dbName !== 'kwsa_uat') {
    throw new Error(`Local dev database safety check failed: expected database "kwsa_uat", got "${dbName || '(empty)'}".`);
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error('Local dev database safety check failed: localhost targets are blocked. Expected remote kwsa_uat host.');
  }
}

const nodeEnv = normalizeString(process.env.NODE_ENV) ?? 'development';
const databaseClient = parseDatabaseClient(process.env.DB_CLIENT);
const storageBackend = parseStorageBackend(process.env.STORAGE_BACKEND);
const uploadsDir = path.resolve(process.cwd(), normalizeString(process.env.UPLOADS_DIR) ?? 'uploads');

const localGoogleClientIdFallback =
  nodeEnv === 'development'
    ? '768625368107-oficd2i4fn505g3lf7dt6sjmlv77b109.apps.googleusercontent.com'
    : null;

const databaseUrl = normalizeString(process.env.DATABASE_URL)
  ?? (databaseClient === 'postgres' ? buildPostgresUrlFromParts() : null);

const enforceLocalUatDb = parseBoolean(process.env.ENFORCE_LOCAL_UAT_DB, nodeEnv === 'development');
if (nodeEnv === 'development' && enforceLocalUatDb) {
  if (!databaseUrl) {
    throw new Error('Local dev database safety check failed: DATABASE_URL is required when ENFORCE_LOCAL_UAT_DB=true.');
  }
  assertLocalUatDbTarget(databaseUrl);
}

export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  port: parseInteger(process.env.PORT, 3000),
  uploadsPublicBaseUrl: normalizeString(process.env.UPLOADS_PUBLIC_BASE_URL),
  logLevel: normalizeLogLevel(process.env.LOG_LEVEL, 'info'),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, nodeEnv === 'production'),
  appTimeZone: normalizeString(process.env.APP_TIME_ZONE) ?? 'Africa/Johannesburg',
  enforceLocalUatDb,
  corsOrigins: parseList(process.env.CORS_ORIGIN, ['http://localhost:5173']),
  preserveCoreEdits: parseBoolean(process.env.PRESERVE_CORE_EDITS, false),
  allowDevLogin: parseBoolean(process.env.ALLOW_DEV_LOGIN, nodeEnv === 'development'),
  googleClientId: normalizeString(process.env.GOOGLE_CLIENT_ID) ?? localGoogleClientIdFallback,
  jwtSecret: normalizeString(process.env.JWT_SECRET) ?? 'dev-jwt-secret-change-in-production',
  database: {
    client: databaseClient,
    url: databaseUrl,
  },
  publicDatabase: {
    url: normalizeString(process.env.PUBLIC_DATABASE_URL),
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
  property24: {
    baseUrl: normalizeString(process.env.PROPERTY24_BASE_URL),
    apiKey: normalizeString(process.env.PROPERTY24_API_KEY),
    listingsEndpoint: normalizeString(process.env.PROPERTY24_LISTINGS_ENDPOINT) ?? 'listings',
    userGroupId: normalizeString(process.env.PROPERTY24_USER_GROUP_ID),
    defaultAgencyId: normalizeString(process.env.PROPERTY24_DEFAULT_AGENCY_ID),
  },
  privateProperty: {
    baseUrl: normalizeString(process.env.PRIVATE_PROPERTY_BASE_URL),
    username: normalizeString(process.env.PRIVATE_PROPERTY_USERNAME),
    password: normalizeString(process.env.PRIVATE_PROPERTY_PASSWORD),
    passwordAlt: normalizeString(process.env.PRIVATE_PROPERTY_PASSWORD_ALT),
    branchGuid: normalizeString(process.env.PRIVATE_PROPERTY_BRANCH_GUID),
  },
  kww: {
    baseUrl: normalizeString(process.env.KWW_BASE_URL),
    apiKey: normalizeString(process.env.KWW_API_KEY),
    apiSecret: normalizeString(process.env.KWW_API_SECRET),
  },
  openai: {
    apiKey: normalizeString(process.env.OPENAI_API_KEY),
    model: normalizeString(process.env.OPENAI_MODEL) ?? 'gpt-4o',
  },
  entegral: {
    baseUrl: normalizeString(process.env.ENTEGRAL_BASE_URL),
    globalAuth: normalizeString(process.env.ENTEGRAL_GLOBAL_AUTH),
    sourceId: normalizeString(process.env.ENTEGRAL_SOURCE_ID) ?? '6',
  },
  frontdoor: {
    enabled: parseBoolean(process.env.FRONTDOOR_ENABLED, false),
    baseUrl: normalizeString(process.env.FRONTDOOR_BASE_URL) ?? '',
    email: normalizeString(process.env.FRONTDOOR_EMAIL) ?? '',
    password: normalizeString(process.env.FRONTDOOR_PASSWORD) ?? '',
  },
  loom: {
    idpUrl: normalizeString(process.env.LOOM_IDP_URL) ?? 'https://id.loom.co.za',
    apiBaseUrl: normalizeString(process.env.LOOM_API_BASE_URL) ?? 'https://api.loom.co.za/api/services/app',
    clientId: normalizeString(process.env.LOOM_CLIENT_ID) ?? '',
    clientSecret: normalizeString(process.env.LOOM_CLIENT_SECRET) ?? '',
    callbackUrl: normalizeString(process.env.LOOM_CALLBACK_URL) ?? '',
    integrationEmail: normalizeString(process.env.LOOM_INTEGRATION_EMAIL) ?? '',
    clientIdentifier: normalizeString(process.env.LOOM_CLIENT_IDENTIFIER) ?? '', // loaded from .env at startup
    tokenEncryptionKey: normalizeString(process.env.LOOM_TOKEN_ENCRYPTION_KEY) ?? 'kwsa-loom-dev-key',
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
