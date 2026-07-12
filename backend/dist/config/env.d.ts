export type DatabaseClient = 'postgres' | 'sqlserver';
export type StorageBackend = 'local' | 'gcs';
export declare const env: {
    readonly nodeEnv: string;
    readonly isDevelopment: boolean;
    readonly isProduction: boolean;
    readonly port: number;
    readonly uploadsPublicBaseUrl: string | null;
    readonly logLevel: string;
    readonly trustProxy: boolean;
    readonly appTimeZone: string;
    readonly enforceLocalUatDb: boolean;
    readonly corsOrigins: string[];
    readonly preserveCoreEdits: boolean;
    readonly listingValidationEnforced: boolean;
    readonly listingDevelopmentValidationEnabled: boolean;
    readonly allowDevLogin: boolean;
    readonly googleClientId: string | null;
    readonly jwtSecret: string;
    readonly database: {
        readonly client: DatabaseClient;
        readonly url: string | null;
    };
    readonly publicDatabase: {
        readonly url: string | null;
    };
    readonly storage: {
        readonly backend: StorageBackend;
        readonly localUploadsEnabled: boolean;
        readonly uploadsDir: string;
    };
    readonly gcp: {
        readonly projectId: string | null;
        readonly uploadsBucket: string | null;
    };
    readonly property24: {
        readonly baseUrl: string | null;
        readonly apiKey: string | null;
        readonly listingsEndpoint: string;
        readonly userGroupId: string | null;
        readonly defaultAgencyId: string | null;
    };
    readonly privateProperty: {
        readonly baseUrl: string | null;
        readonly username: string | null;
        readonly password: string | null;
        readonly passwordAlt: string | null;
        readonly branchGuid: string | null;
    };
    readonly kww: {
        readonly baseUrl: string | null;
        readonly apiKey: string | null;
        readonly apiSecret: string | null;
    };
    readonly openai: {
        readonly apiKey: string | null;
        readonly model: string;
        readonly socialCopy: {
            readonly apiKey: string | null;
            readonly model: string;
            readonly maxOutputTokens: number;
            readonly temperature: number;
        };
    };
    readonly entegral: {
        readonly baseUrl: string | null;
        readonly globalAuth: string | null;
        readonly sourceId: string;
    };
    readonly frontdoor: {
        readonly enabled: boolean;
        readonly baseUrl: string;
        readonly email: string;
        readonly password: string;
    };
    readonly loom: {
        readonly idpUrl: string;
        readonly apiBaseUrl: string;
        readonly clientId: string;
        readonly clientSecret: string;
        readonly callbackUrl: string;
        readonly integrationEmail: string;
        readonly clientIdentifier: string;
        readonly tokenEncryptionKey: string;
    };
    readonly communications: {
        readonly enabled: boolean;
        readonly googleClientId: string | null;
        readonly googleClientSecret: string | null;
        readonly googleRedirectUri: string | null;
        readonly frontendBaseUrl: string | null;
        readonly tokenEncryptionKey: string;
    };
    readonly support: {
        readonly enabled: boolean;
        readonly smtpHost: string | null;
        readonly smtpPort: number;
        readonly smtpSecure: boolean;
        readonly smtpUser: string | null;
        readonly smtpPass: string | null;
        readonly fromEmail: string | null;
        readonly fromName: string;
        readonly replyTo: string | null;
        readonly logoUrl: string | null;
        readonly logoPath: string | null;
    };
    readonly portalRecovery: {
        readonly enabled: boolean;
    };
    readonly capRefresh: {
        readonly enabled: boolean;
    };
    readonly trainingHub: {
        readonly enabled: boolean;
    };
};
export declare function getRequiredDatabaseUrl(): string;
//# sourceMappingURL=env.d.ts.map