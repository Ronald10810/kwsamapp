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

function parseFloatNumber(value: string | undefined, fallback: number): number {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number.parseFloat(normalized);
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
  const port = parsed.port.trim() || '5432';
  if (dbName !== 'kwsa_uat') {
    throw new Error(`Local dev database safety check failed: expected database "kwsa_uat", got "${dbName || '(empty)'}".`);
  }

  const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLoopbackHost && port !== '9470') {
    throw new Error('Local dev database safety check failed: localhost is only allowed via Cloud SQL proxy on port 9470.');
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
const communicationsGoogleClientId = normalizeString(process.env.COMMUNICATIONS_GOOGLE_CLIENT_ID)
  ?? normalizeString(process.env.GOOGLE_CLIENT_ID)
  ?? localGoogleClientIdFallback;
const communicationsFrontendBaseUrl = normalizeString(process.env.COMMUNICATIONS_FRONTEND_BASE_URL);
const trainingHubEnabled = parseBoolean(process.env.TRAINING_HUB_ENABLED, nodeEnv === 'development');

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
  listingValidationEnforced: parseBoolean(process.env.LISTING_VALIDATION_ENFORCED, true),
  listingDevelopmentValidationEnabled: parseBoolean(process.env.LISTING_DEVELOPMENT_VALIDATION_ENABLED, false),
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
    model: normalizeString(process.env.OPENAI_MODEL) ?? 'gpt-5',
    socialCopy: {
      apiKey: normalizeString(process.env.OPENAI_SOCIAL_COPY_API_KEY) ?? normalizeString(process.env.OPENAI_API_KEY),
      model: normalizeString(process.env.OPENAI_SOCIAL_COPY_MODEL) ?? 'gpt-5-mini',
      maxOutputTokens: parseInteger(process.env.OPENAI_SOCIAL_COPY_MAX_OUTPUT_TOKENS, 700),
      temperature: parseFloatNumber(process.env.OPENAI_SOCIAL_COPY_TEMPERATURE, 0.7),
    },
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
  communications: {
    enabled: parseBoolean(process.env.COMMUNICATIONS_CONSOLE_ENABLED, false),
    googleClientId: communicationsGoogleClientId,
    googleClientSecret: normalizeString(process.env.COMMUNICATIONS_GOOGLE_CLIENT_SECRET),
    googleRedirectUri: normalizeString(process.env.COMMUNICATIONS_GOOGLE_REDIRECT_URI),
    frontendBaseUrl: communicationsFrontendBaseUrl,
    tokenEncryptionKey: normalizeString(process.env.COMMUNICATIONS_TOKEN_ENCRYPTION_KEY) ?? 'kwsa-communications-dev-key',
  },
  support: {
    enabled: parseBoolean(process.env.SUPPORT_EMAIL_ENABLED, false),
    smtpHost: normalizeString(process.env.SUPPORT_SMTP_HOST) ?? 'smtp.gmail.com',
    smtpPort: parseInteger(process.env.SUPPORT_SMTP_PORT, 465),
    smtpSecure: parseBoolean(process.env.SUPPORT_SMTP_SECURE, true),
    smtpUser: normalizeString(process.env.SUPPORT_SMTP_USER),
    smtpPass: normalizeString(process.env.SUPPORT_SMTP_PASS),
    fromEmail: normalizeString(process.env.SUPPORT_FROM_EMAIL),
    fromName: normalizeString(process.env.SUPPORT_FROM_NAME) ?? 'MAPP Support',
    replyTo: normalizeString(process.env.SUPPORT_REPLY_TO),
    logoUrl: normalizeString(process.env.SUPPORT_EMAIL_LOGO_URL),
    logoPath: normalizeString(process.env.SUPPORT_EMAIL_LOGO_PATH),
  },
  portalRecovery: {
    enabled: parseBoolean(process.env.PORTAL_RECOVERY_ENABLED, nodeEnv === 'development'),
  },
  capRefresh: {
    enabled: parseBoolean(process.env.CAP_REFRESH_ENABLED, false),
  },
  reporting: {
    monthEndUnified: {
      enabled: parseBoolean(process.env.MONTH_END_UNIFIED_ENABLED, nodeEnv === 'development'),
      shadowCompareEnabled: parseBoolean(process.env.MONTH_END_UNIFIED_SHADOW_COMPARE_ENABLED, false),
      transitionExceptionsEnabled: parseBoolean(process.env.MONTH_END_TRANSITION_EXCEPTIONS_ENABLED, true),
      historicalEnabled: parseBoolean(process.env.MONTH_END_HISTORICAL_ENABLED, true),
      liveEnabled: parseBoolean(process.env.MONTH_END_LIVE_ENABLED, true),
    },
    liveEvents: {
      enabled: parseBoolean(process.env.LIVE_REPORTING_EVENTS_ENABLED, false),
      shadowCompareEnabled: parseBoolean(process.env.LIVE_REPORTING_EVENTS_SHADOW_COMPARE_ENABLED, false),
      backfillEnabled: parseBoolean(process.env.LIVE_REPORTING_EVENTS_BACKFILL_ENABLED, false),
    },
  },
  trainingHub: {
    enabled: trainingHubEnabled,
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
