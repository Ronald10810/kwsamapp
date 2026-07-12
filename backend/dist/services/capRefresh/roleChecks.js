const APPLY_ROLE_NAMES = new Set([
    'ADMIN',
    'REGIONAL_ADMIN',
    'APPROVED_FINANCE',
    'FINANCE',
    'FINANCE_ADMIN',
]);
export function normalizeRoleName(roleName) {
    return (roleName ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}
export async function loadCapRefreshRoleNames(db, associateDbId) {
    if (!associateDbId)
        return [];
    const result = await db.query(`SELECT role_name FROM migration.associate_roles WHERE associate_id = $1 ORDER BY id ASC`, [associateDbId]);
    return result.rows.map((row) => normalizeRoleName(row.role_name)).filter((value) => value.length > 0);
}
export function canApplyCapRefresh(perms, roleNames) {
    if (perms.isRegionalAdmin)
        return true;
    return roleNames.some((roleName) => APPLY_ROLE_NAMES.has(normalizeRoleName(roleName)));
}
export async function resolveCanApplyCapRefreshForAssociate(db, options) {
    const roleNames = await loadCapRefreshRoleNames(db, options.associateDbId);
    return canApplyCapRefresh({
        scope: options.isRegionalAdmin ? 'GLOBAL' : 'OWN',
        associateDbId: options.associateDbId,
        marketCenterId: null,
        homeMcId: null,
        isRegionalAdmin: options.isRegionalAdmin,
        isOfficeAdmin: false,
    }, roleNames);
}
//# sourceMappingURL=roleChecks.js.map