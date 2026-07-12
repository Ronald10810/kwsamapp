export interface AssociateEmailLookupClient {
    query<T>(text: string, values?: unknown[]): Promise<{
        rowCount: number | null;
        rows: T[];
    }>;
}
export interface ResolvedAssociateMatch {
    id: string;
}
export interface AssociateAccessState {
    isRegistered: boolean;
    associateId: string | null;
    isSuspended: boolean;
    suspendedReason: string | null;
}
export declare function normalizeAuthEmail(email: string): string;
export declare function normalizeAuthName(name: string): string;
export declare function resolveAssociateIdForAuth(client: AssociateEmailLookupClient, email: string, displayName?: string | null): Promise<string | null>;
export declare function isRegisteredAssociateEmail(client: AssociateEmailLookupClient, email: string, displayName?: string | null): Promise<boolean>;
export declare function getAssociateAccessState(client: AssociateEmailLookupClient, email: string, displayName?: string | null): Promise<AssociateAccessState>;
//# sourceMappingURL=associateAuth.d.ts.map