export declare function encryptToken(plain: string): string;
export declare function decryptToken(data: string): string;
export interface LoomToken {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    loomEmail: string | null;
    consentAccepted?: boolean;
}
export declare function saveToken(userEmail: string, t: LoomToken): Promise<void>;
export declare function loadToken(userEmail: string): Promise<LoomToken | null>;
export declare function setConsentAccepted(userEmail: string): Promise<void>;
export declare function removeToken(userEmail: string): Promise<void>;
interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}
export declare function buildLoomAuthUrl(state: string): string;
export declare function exchangeCode(code: string): Promise<TokenResponse>;
/**
 * Acquire a token using Resource Owner Password Credentials (ROPC) grant.
 * Used for service accounts where no browser redirect is needed.
 */
export declare function acquireTokenRopc(): Promise<TokenResponse>;
export declare function loomGet(userEmail: string, path: string, params?: Record<string, string | undefined>): Promise<unknown>;
export declare function loomPost(userEmail: string, path: string, body?: unknown): Promise<unknown>;
export declare function loomDelete(userEmail: string, path: string): Promise<unknown>;
export declare function loomGetBinary(userEmail: string, path: string, params?: Record<string, string | undefined>): Promise<{
    buffer: Buffer;
    contentType: string;
    fileName: string;
}>;
export {};
//# sourceMappingURL=loom-client.d.ts.map