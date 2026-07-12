const CAP_CONSUMING_STATUSES = new Set(['registered']);
const PROJECTED_CAP_STATUSES = new Set(['start', 'working', 'submitted', 'pending', 'accepted']);
const NO_CAP_IMPACT_STATUSES = new Set(['rejected', 'withdrawn']);
export function normalizeTransactionStatus(status) {
    return (status ?? '').trim().toLowerCase();
}
export function isCapConsumingStatus(status) {
    return CAP_CONSUMING_STATUSES.has(normalizeTransactionStatus(status));
}
export function isProjectedCapStatus(status) {
    return PROJECTED_CAP_STATUSES.has(normalizeTransactionStatus(status));
}
export function isNoCapImpactStatus(status) {
    return NO_CAP_IMPACT_STATUSES.has(normalizeTransactionStatus(status));
}
//# sourceMappingURL=statusRules.js.map