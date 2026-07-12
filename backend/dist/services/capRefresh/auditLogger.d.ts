import type { Queryable } from '../transactionCalculations.js';
import type { CapEnvelopeDescriptor, CapRefreshActor, ProtectedFieldCheckResult } from './envelopeTypes.js';
type AuditStartInput = {
    actor: CapRefreshActor;
    transactionId: number;
    transactionNumber: string | null;
    envelope: CapEnvelopeDescriptor;
    rowsScanned: number;
    rowsAffected: number;
    beforeSnapshot: unknown[];
    afterSnapshot: unknown[];
    protectedFieldCheck: ProtectedFieldCheckResult;
    startedAt: Date;
};
export declare function startCapRefreshAudit(db: Queryable, input: AuditStartInput): Promise<string>;
export declare function completeCapRefreshAudit(db: Queryable, auditId: string, completedAt: Date, durationMs: number): Promise<void>;
export declare function failCapRefreshAudit(db: Queryable, auditId: string, completedAt: Date, durationMs: number, errorMessage: string): Promise<void>;
export {};
//# sourceMappingURL=auditLogger.d.ts.map