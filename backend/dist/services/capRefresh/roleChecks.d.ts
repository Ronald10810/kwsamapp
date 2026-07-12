import type { UserPermissions } from '../../middleware/permissions.js';
import type { Queryable } from '../transactionCalculations.js';
export declare function normalizeRoleName(roleName: string | null | undefined): string;
export declare function loadCapRefreshRoleNames(db: Queryable, associateDbId: string | null): Promise<string[]>;
export declare function canApplyCapRefresh(perms: UserPermissions, roleNames: string[]): boolean;
export declare function resolveCanApplyCapRefreshForAssociate(db: Queryable, options: {
    associateDbId: string | null;
    isRegionalAdmin: boolean;
}): Promise<boolean>;
//# sourceMappingURL=roleChecks.d.ts.map