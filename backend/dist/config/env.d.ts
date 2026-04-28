export type DatabaseClient = 'postgres' | 'sqlserver';
export type StorageBackend = 'local' | 'gcs';
export declare const env: {
    readonly nodeEnv: string;
    readonly isDevelopment: boolean;
    readonly isProduction: boolean;
    readonly port: number;
    readonly logLevel: string;
    readonly trustProxy: boolean;
    readonly corsOrigins: string[];
    readonly preserveCoreEdits: boolean;
    readonly allowDevLogin: boolean;
    readonly googleClientId: string | null;
    readonly jwtSecret: string;
    readonly database: {
        readonly client: DatabaseClient;
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
};
export declare function getRequiredDatabaseUrl(): string;
//# sourceMappingURL=env.d.ts.map