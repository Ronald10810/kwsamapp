declare const router: import("express-serve-static-core").Router;
export declare function buildStatusChangeDateUpdateClause(opts: {
    isRegionalAdmin: boolean;
    statusChangeDateInput: string | null | undefined;
    transactionStatus: string | null | undefined;
}): {
    statusChangeDateValue: string | null;
    statusChangeUpdateSql: string;
};
export default router;
//# sourceMappingURL=transactions.d.ts.map