import type { CalculatedRowMeta } from '../transactionCalculations.js';
export type CapEnvelopeType = 'associate' | 'team';
export type CapRefreshPreviewMode = 'actual' | 'projected';
export type CapRefreshActor = {
    associateDbId: string | null;
    email: string | null;
    roleNames: string[];
    isRegionalAdmin: boolean;
    isOfficeAdmin: boolean;
};
export type CapEnvelopeDescriptor = {
    envelopeKey: string;
    capProgressKey: string;
    envelopeType: CapEnvelopeType;
    entityId: string | null;
    cycleStartDate: string;
    cycleEndDate: string;
    transactionAgentIds: number[];
    transactionIds: number[];
};
export type ResolvedCapRefreshContext = {
    transactionId: number;
    transactionNumber: string | null;
    baseEntries: CalculatedRowMeta[];
    targetEntries: CalculatedRowMeta[];
    envelopeEntries: CalculatedRowMeta[];
    impactedEnvelopes: CapEnvelopeDescriptor[];
};
export type CapRefreshValueSet = {
    market_center_dollar: string;
    team_dollar: string;
    associate_dollar: string;
    cap_contribution: string;
    cap_remaining: string;
};
export type CapRefreshDiffRow = {
    transactionAgentId: number;
    transactionId: number;
    transactionNumber: string | null;
    transactionStatus: string | null;
    capProgressKey: string;
    envelopeKey: string;
    current: CapRefreshValueSet;
    proposed: CapRefreshValueSet;
    delta: CapRefreshValueSet;
    projected: boolean;
};
export type ProtectedFieldViolation = {
    transactionAgentId: number;
    field: string;
    current: string;
    proposed: string;
};
export type ProtectedFieldCheckResult = {
    ok: boolean;
    violations: ProtectedFieldViolation[];
    protectedNonTacWritesBlocked: true;
};
export type CurrentTacEnvelopeRow = {
    transaction_agent_id: number;
    market_center_dollar: string | null;
    team_dollar: string | null;
    associate_dollar: string | null;
    cap_contribution: string | null;
    cap_remaining: string | null;
    transaction_gci_before_fees: string | null;
    gci_after_fees_excl_vat: string | null;
    production_royalties: string | null;
    growth_share: string | null;
    total_pr_and_gs: string | null;
};
export type CapRefreshDryRunResult = {
    transactionId: number;
    transactionNumber: string | null;
    previewMode: CapRefreshPreviewMode;
    stale: boolean;
    impactedEnvelopes: CapEnvelopeDescriptor[];
    rowsScanned: number;
    rowsChanged: number;
    actualRowsChanged: number;
    protectedFieldCheck: ProtectedFieldCheckResult;
    items: CapRefreshDiffRow[];
};
export type CapRefreshApplyResult = {
    transactionId: number;
    transactionNumber: string | null;
    impactedEnvelopes: CapEnvelopeDescriptor[];
    rowsScanned: number;
    rowsUpdated: number;
    protectedFieldCheck: ProtectedFieldCheckResult;
    items: CapRefreshDiffRow[];
    auditIds: string[];
};
//# sourceMappingURL=envelopeTypes.d.ts.map