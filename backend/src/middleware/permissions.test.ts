/**
 * Unit tests for the KWSA Cloud Console permission system.
 *
 * Covers:
 *  1. resolvePermissions scope derivation logic (pure logic extracted for testing)
 *  2. Frontend AuthContext permission helper functions
 */

import { describe, it, expect } from 'vitest';

// --------------------------------------------------------------------------
// Mirror of the scope-resolution logic from permissions.ts (pure, no DB)
// --------------------------------------------------------------------------

type PermissionScope = 'GLOBAL' | 'MARKET_CENTRE' | 'OWN';

interface ResolveInput {
  isRegionalAdmin: boolean;
  isOfficeAdmin: boolean;
  roles: string[];
  adminMcIds: string[];
  homeMcId: string | null;
  activeContextId: string;
}

interface ResolveOutput {
  scope: PermissionScope;
  marketCenterId: string | null;
}

function resolveScopeLogic(input: ResolveInput): ResolveOutput | { error: string } {
  const { isRegionalAdmin, roles, adminMcIds, homeMcId, activeContextId } = input;

  if (isRegionalAdmin && (activeContextId === 'regional_admin' || !activeContextId)) {
    return { scope: 'GLOBAL', marketCenterId: null };
  }

  if (activeContextId.startsWith('admin_')) {
    const claimedMcId = activeContextId.slice('admin_'.length);
    if (!adminMcIds.includes(claimedMcId)) {
      return { error: 'Permission denied: you are not an admin for this market centre' };
    }
    return { scope: 'MARKET_CENTRE', marketCenterId: claimedMcId };
  }

  if (activeContextId.startsWith('office_admin_')) {
    const claimedMcId = activeContextId.slice('office_admin_'.length);
    const validOfficeAdmin = roles.includes('OFFICE_ADMIN') && claimedMcId === homeMcId;
    if (!validOfficeAdmin) {
      return { error: 'Permission denied: not an office admin for this market centre' };
    }
    return { scope: 'MARKET_CENTRE', marketCenterId: claimedMcId };
  }

  return { scope: 'OWN', marketCenterId: null };
}

// --------------------------------------------------------------------------
// Mirror of the AuthContext permission helper logic
// --------------------------------------------------------------------------

interface UserContext {
  id: string;
  label: string;
  role: string;
  marketCenter: string | null;
  marketCenterId: string | null;
}

interface PermissionHelpers {
  canCreateListing: boolean;
  canCreateAssociate: boolean;
  canCreateMarketCenter: boolean;
  canEditListing: (listingMcId: string | null, primaryAgentEmail?: string | null) => boolean;
  canEditAssociate: (assocMcId: string | null, assocEmail?: string | null) => boolean;
  canEditMarketCenter: (mcSourceId: string | null) => boolean;
}

function buildPermissionHelpers(
  activeContext: UserContext | null,
  userEmail: string | null
): PermissionHelpers {
  const role = activeContext?.role ?? '';
  const isRegionalAdmin = role === 'REGIONAL_ADMIN';
  const isOfficeAdmin = role === 'OFFICE_ADMIN' || role === 'ADMIN';
  const activeMcId = activeContext?.marketCenterId ?? null;

  const canCreateListing = isRegionalAdmin || isOfficeAdmin;
  const canCreateAssociate = isRegionalAdmin || isOfficeAdmin;
  const canCreateMarketCenter = isRegionalAdmin;

  const canEditListing = (listingMcId: string | null, primaryAgentEmail?: string | null): boolean => {
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) return listingMcId !== null && listingMcId === activeMcId;
    // Agent: can edit listings where they are listed as an agent
    if (!isRegionalAdmin && !isOfficeAdmin && userEmail && primaryAgentEmail)
      return primaryAgentEmail.toLowerCase() === userEmail.toLowerCase();
    return false;
  };

  const canEditAssociate = (assocMcId: string | null, assocEmail?: string | null): boolean => {
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) return assocMcId !== null && assocMcId === activeMcId;
    // Agent: can only edit own record
    return !!(userEmail && assocEmail && userEmail.toLowerCase() === assocEmail.toLowerCase());
  };

  const canEditMarketCenter = (mcSourceId: string | null): boolean => {
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) return mcSourceId !== null && mcSourceId === activeMcId;
    return false;
  };

  return {
    canCreateListing,
    canCreateAssociate,
    canCreateMarketCenter,
    canEditListing,
    canEditAssociate,
    canEditMarketCenter,
  };
}

// --------------------------------------------------------------------------
// Tests: scope resolution (backend logic)
// --------------------------------------------------------------------------

describe('resolvePermissions — scope resolution', () => {
  const regionalAdminInput: ResolveInput = {
    isRegionalAdmin: true,
    isOfficeAdmin: false,
    roles: ['REGIONAL_ADMIN'],
    adminMcIds: [],
    homeMcId: 'MC001',
    activeContextId: 'regional_admin',
  };

  it('Regional Admin with regional_admin context gets GLOBAL scope', () => {
    const result = resolveScopeLogic(regionalAdminInput);
    expect(result).toEqual({ scope: 'GLOBAL', marketCenterId: null });
  });

  it('Regional Admin with no context defaults to GLOBAL scope', () => {
    const result = resolveScopeLogic({ ...regionalAdminInput, activeContextId: '' });
    expect(result).toEqual({ scope: 'GLOBAL', marketCenterId: null });
  });

  it('Admin MC context grants MARKET_CENTRE scope for assigned MC', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: true,
      roles: [],
      adminMcIds: ['MC001', 'MC002'],
      homeMcId: 'MC001',
      activeContextId: 'admin_MC001',
    });
    expect(result).toEqual({ scope: 'MARKET_CENTRE', marketCenterId: 'MC001' });
  });

  it('Admin MC context blocks access to un-assigned MC', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: false,
      roles: [],
      adminMcIds: ['MC001'],
      homeMcId: 'MC001',
      activeContextId: 'admin_MC999',
    });
    expect(result).toHaveProperty('error');
  });

  it('Office Admin context grants MARKET_CENTRE scope for home MC', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: true,
      roles: ['OFFICE_ADMIN'],
      adminMcIds: [],
      homeMcId: 'MC001',
      activeContextId: 'office_admin_MC001',
    });
    expect(result).toEqual({ scope: 'MARKET_CENTRE', marketCenterId: 'MC001' });
  });

  it('Office Admin context blocks claiming a different MC', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: true,
      roles: ['OFFICE_ADMIN'],
      adminMcIds: [],
      homeMcId: 'MC001',
      activeContextId: 'office_admin_MC002',
    });
    expect(result).toHaveProperty('error');
  });

  it('Agent context (agent_MC001) yields OWN scope', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: false,
      roles: ['AGENT'],
      adminMcIds: [],
      homeMcId: 'MC001',
      activeContextId: 'agent_MC001',
    });
    expect(result).toEqual({ scope: 'OWN', marketCenterId: null });
  });

  it('Non-admin trying to claim regional_admin context falls back to OWN scope', () => {
    const result = resolveScopeLogic({
      isRegionalAdmin: false,
      isOfficeAdmin: false,
      roles: ['AGENT'],
      adminMcIds: [],
      homeMcId: 'MC001',
      activeContextId: 'regional_admin',
    });
    // isRegionalAdmin is false → falls through to OWN
    expect(result).toEqual({ scope: 'OWN', marketCenterId: null });
  });
});

// --------------------------------------------------------------------------
// Tests: AuthContext permission helpers (frontend logic)
// --------------------------------------------------------------------------

describe('AuthContext — permission helpers', () => {
  const regionalAdminCtx: UserContext = {
    id: 'regional_admin',
    label: 'Regional Admin',
    role: 'REGIONAL_ADMIN',
    marketCenter: null,
    marketCenterId: null,
  };

  const officeAdminCtx: UserContext = {
    id: 'office_admin_MC001',
    label: 'Office Admin — MC001',
    role: 'OFFICE_ADMIN',
    marketCenter: 'Market Centre 001',
    marketCenterId: 'MC001',
  };

  const adminMcCtx: UserContext = {
    id: 'admin_MC002',
    label: 'Admin — MC002',
    role: 'ADMIN',
    marketCenter: 'Market Centre 002',
    marketCenterId: 'MC002',
  };

  const agentCtx: UserContext = {
    id: 'agent_MC001',
    label: 'Agent — MC001',
    role: 'AGENT',
    marketCenter: 'Market Centre 001',
    marketCenterId: 'MC001',
  };

  describe('Regional Admin', () => {
    const h = buildPermissionHelpers(regionalAdminCtx, 'admin@kwsa.co.za');

    it('can create listings', () => expect(h.canCreateListing).toBe(true));
    it('can create associates', () => expect(h.canCreateAssociate).toBe(true));
    it('can create market centres', () => expect(h.canCreateMarketCenter).toBe(true));
    it('can edit any listing', () => expect(h.canEditListing('MC999', 'other@kwsa.co.za')).toBe(true));
    it('can edit any associate', () => expect(h.canEditAssociate('MC999', 'other@kwsa.co.za')).toBe(true));
    it('can edit any market centre', () => expect(h.canEditMarketCenter('MC999')).toBe(true));
  });

  describe('Office Admin (home MC = MC001)', () => {
    const h = buildPermissionHelpers(officeAdminCtx, 'oa@kwsa.co.za');

    it('can create listings', () => expect(h.canCreateListing).toBe(true));
    it('can create associates', () => expect(h.canCreateAssociate).toBe(true));
    it('cannot create market centres', () => expect(h.canCreateMarketCenter).toBe(false));
    it('can edit listing within same MC', () => expect(h.canEditListing('MC001', 'other@kwsa.co.za')).toBe(true));
    it('cannot edit listing in a different MC', () => expect(h.canEditListing('MC002', 'other@kwsa.co.za')).toBe(false));
    it('can edit associate within same MC', () => expect(h.canEditAssociate('MC001', 'other@kwsa.co.za')).toBe(true));
    it('cannot edit associate in a different MC', () => expect(h.canEditAssociate('MC002', 'other@kwsa.co.za')).toBe(false));
    it('can edit own MC', () => expect(h.canEditMarketCenter('MC001')).toBe(true));
    it('cannot edit a different MC', () => expect(h.canEditMarketCenter('MC002')).toBe(false));
  });

  describe('Admin MC context (admin for MC002)', () => {
    const h = buildPermissionHelpers(adminMcCtx, 'mc2admin@kwsa.co.za');

    it('can create listings', () => expect(h.canCreateListing).toBe(true));
    it('cannot create market centres', () => expect(h.canCreateMarketCenter).toBe(false));
    it('can edit listing in MC002', () => expect(h.canEditListing('MC002', 'other@kwsa.co.za')).toBe(true));
    it('cannot edit listing in MC001', () => expect(h.canEditListing('MC001', 'other@kwsa.co.za')).toBe(false));
    it('can edit associate in MC002', () => expect(h.canEditAssociate('MC002')).toBe(true));
    it('cannot edit associate in MC001', () => expect(h.canEditAssociate('MC001')).toBe(false));
  });

  describe('Agent', () => {
    const h = buildPermissionHelpers(agentCtx, 'agent@kwsa.co.za');

    it('cannot create listings', () => expect(h.canCreateListing).toBe(false));
    it('cannot create associates', () => expect(h.canCreateAssociate).toBe(false));
    it('cannot create market centres', () => expect(h.canCreateMarketCenter).toBe(false));
    it('cannot edit any listing', () => expect(h.canEditListing('MC001', 'other@kwsa.co.za')).toBe(false));
    it('can edit listing where they are the primary agent', () => expect(h.canEditListing('MC001', 'agent@kwsa.co.za')).toBe(true));
    it('primary agent check is case-insensitive', () => expect(h.canEditListing('MC001', 'Agent@KWSA.co.za')).toBe(true));
    it('cannot edit listing where they are not the agent', () => expect(h.canEditListing('MC001', 'other@kwsa.co.za')).toBe(false));
    it('can edit own associate record', () => expect(h.canEditAssociate('MC001', 'agent@kwsa.co.za')).toBe(true));
    it('cannot edit another associate record', () => expect(h.canEditAssociate('MC001', 'other@kwsa.co.za')).toBe(false));
    it('email comparison is case-insensitive', () => expect(h.canEditAssociate('MC001', 'Agent@KWSA.co.za')).toBe(true));
    it('cannot edit any market centre', () => expect(h.canEditMarketCenter('MC001')).toBe(false));
  });

  describe('No active context (null)', () => {
    const h = buildPermissionHelpers(null, 'user@kwsa.co.za');

    it('cannot create anything', () => {
      expect(h.canCreateListing).toBe(false);
      expect(h.canCreateAssociate).toBe(false);
      expect(h.canCreateMarketCenter).toBe(false);
    });
    it('cannot edit anything', () => {
      expect(h.canEditListing('MC001', null)).toBe(false);
      expect(h.canEditAssociate('MC001')).toBe(false);
      expect(h.canEditMarketCenter('MC001')).toBe(false);
    });
  });
});
