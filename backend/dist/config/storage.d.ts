export declare const storageConfig: {
    readonly backend: import("./env.js").StorageBackend;
    readonly localUploadsEnabled: boolean;
    readonly uploadsDir: string;
};
export declare function assertLocalUploadStorageEnabled(): void;
export declare function resolveLocalUploadDir(subdir?: string): string;
export declare function ensureLocalUploadDirs(...subdirs: string[]): Promise<void>;
//# sourceMappingURL=storage.d.ts.map