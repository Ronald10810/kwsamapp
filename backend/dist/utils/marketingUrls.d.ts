export declare function normalizeMarketingUrlType(value: unknown): string;
export declare function normalizeMarketingUrl(value: unknown, urlType?: unknown): string;
export declare function normalizeMarketingUrlRecord<T extends {
    url?: unknown;
    url_type?: unknown;
}>(row: T): T & {
    url: string;
    url_type: string;
};
//# sourceMappingURL=marketingUrls.d.ts.map