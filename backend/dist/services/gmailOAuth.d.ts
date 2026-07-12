export declare function isGmailOAuthConfigured(): boolean;
export declare function buildGmailAuthUrl(state: string): string;
export declare function exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiryDate: number | null;
    scope: string | null;
}>;
export declare function fetchGoogleUserInfo(accessToken: string): Promise<{
    sub: string;
    email: string;
}>;
export declare function saveGmailToken(input: {
    userEmail: string;
    googleSubject: string;
    connectedEmail: string;
    accessToken: string;
    refreshToken: string | null;
    expiryDate: number | null;
    scope: string | null;
}): Promise<void>;
export declare function loadGmailToken(userEmail: string): Promise<null | {
    connectedEmail: string | null;
    googleSubject: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    scope: string | null;
    updatedAt: string;
}>;
export declare function removeGmailToken(userEmail: string): Promise<void>;
export declare function sendGmailHtmlEmail(input: {
    userEmail: string;
    to: string;
    subject: string;
    html: string;
}): Promise<{
    connectedEmail: string | null;
}>;
//# sourceMappingURL=gmailOAuth.d.ts.map