import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/apiUtils.js';

export interface AuthUser {
  userId: number;
  email: string;
  name: string;
  picture: string | null;
  role: string;
}

export interface UserContext {
  id: string;
  label: string;
  role: string;
  marketCenter: string | null;
  /** The source_market_center_id for MARKET_CENTRE-scoped contexts. Null for Regional Admin. */
  marketCenterId: string | null;
  /** The associate UUID for the logged-in user. */
  associateId?: string | null;
}

export interface AccessControlState {
  featureEnabled: boolean;
  isTemporarilySuspended: boolean;
  suspendedReason: string | null;
  suspendedByEmail: string | null;
  suspendedAt: string | null;
  updatedAt: string | null;
}

const DEFAULT_ACCESS_CONTROL: AccessControlState = {
  featureEnabled: false,
  isTemporarilySuspended: false,
  suspendedReason: null,
  suspendedByEmail: null,
  suspendedAt: null,
  updatedAt: null,
};

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  contexts: UserContext[];
  activeContext: UserContext | null;
  accessControl: AccessControlState;
  setActiveContext: (ctx: UserContext) => void;
  login: (googleCredential: string) => Promise<void>;
  loginAsDev: (input?: { email?: string; name?: string; role?: string }) => Promise<void>;
  logout: () => void;
  /** True if the active context is Regional Admin. */
  isRegionalAdmin: boolean;
  /** True if the active context is Office Admin or MC Admin. */
  isOfficeAdmin: boolean;
  /** True if the active context is Agent. */
  isAgent: boolean;
  /** True if the user may create new listings (Regional Admin or Office Admin). */
  canCreateListing: boolean;
  /** True if the user may create new associates (Regional Admin or Office Admin). */
  canCreateAssociate: boolean;
  /** True if the user may create new market centres (Regional Admin only). */
  canCreateMarketCenter: boolean;
  /** Returns true if the user may edit the given listing. Pass the listing's source_market_center_id and optionally the primary agent email. */
  canEditListing: (listingMcId: string | null, primaryAgentEmail?: string | null) => boolean;
  /** Returns true if the user may edit the given associate. Pass source_market_center_id, optionally email, and optionally market centre name. */
  canEditAssociate: (assocMcId: string | null, assocEmail?: string | null, assocMcName?: string | null) => boolean;
  /** Returns true if the user may edit the given market centre. Pass its source_market_center_id. */
  canEditMarketCenter: (mcSourceId: string | null) => boolean;
}

const TOKEN_STORAGE_KEY = 'kwsa_auth_token';
const ACTIVE_CONTEXT_KEY = 'kwsa_active_context_id';
const AUTH_EXPIRED_EVENT = 'kwsa-auth-expired';
const ACCESS_CONTROL_UPDATED_EVENT = 'kwsa-access-control-updated';
const ACCESS_CONTROL_SYNC_KEY = 'kwsa-access-control-sync';
const AUTH_FETCH_TIMEOUT_MS = 8000;

function applyAccessControlUpdate(previous: AccessControlState, detail: Partial<AccessControlState>): AccessControlState {
  return {
    ...previous,
    featureEnabled: detail.featureEnabled ?? previous.featureEnabled,
    isTemporarilySuspended: detail.isTemporarilySuspended ?? previous.isTemporarilySuspended,
    suspendedReason: Object.prototype.hasOwnProperty.call(detail, 'suspendedReason') ? detail.suspendedReason ?? null : previous.suspendedReason,
    suspendedByEmail: Object.prototype.hasOwnProperty.call(detail, 'suspendedByEmail') ? detail.suspendedByEmail ?? null : previous.suspendedByEmail,
    suspendedAt: Object.prototype.hasOwnProperty.call(detail, 'suspendedAt') ? detail.suspendedAt ?? null : previous.suspendedAt,
    updatedAt: Object.prototype.hasOwnProperty.call(detail, 'updatedAt') ? detail.updatedAt ?? null : previous.updatedAt,
  };
}

export function broadcastAccessControlUpdate(detail: Partial<AccessControlState>): void {
  window.dispatchEvent(new CustomEvent(ACCESS_CONTROL_UPDATED_EVENT, { detail }));

  try {
    localStorage.setItem(ACCESS_CONTROL_SYNC_KEY, JSON.stringify({ detail, updatedAt: Date.now() }));
  } catch {
    // Ignore storage failures; same-tab updates still work via the custom event.
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJsonSafely<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [contexts, setContexts] = useState<UserContext[]>([]);
  const [activeContext, setActiveContextState] = useState<UserContext | null>(null);
  const [accessControl, setAccessControl] = useState<AccessControlState>(DEFAULT_ACCESS_CONTROL);

  const loadAccessControl = useCallback(async (authToken: string) => {
    try {
      const res = await apiFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;

      const data = await res.json() as {
        access_control?: {
          feature_enabled?: boolean;
          is_temporarily_suspended?: boolean;
          suspended_reason?: string | null;
          suspended_by_email?: string | null;
          suspended_at?: string | null;
          updated_at?: string | null;
        };
      };

      const control = data.access_control;
      setAccessControl({
        featureEnabled: Boolean(control?.feature_enabled),
        isTemporarilySuspended: Boolean(control?.is_temporarily_suspended),
        suspendedReason: control?.suspended_reason ?? null,
        suspendedByEmail: control?.suspended_by_email ?? null,
        suspendedAt: control?.suspended_at ?? null,
        updatedAt: control?.updated_at ?? null,
      });
    } catch {
      // Keep default access-control state when unavailable.
    }
  }, []);

  const loadContexts = useCallback(async (authToken: string) => {
    try {
      let data: { contexts: UserContext[] } | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await apiFetch('/api/auth/contexts', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (res.ok) {
          data = await res.json() as { contexts: UserContext[] };
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }

      if (!data) return;
      const list = data.contexts ?? [];
      setContexts(list);

      // Restore last-used context or default to first (highest priority)
      const savedId = localStorage.getItem(ACTIVE_CONTEXT_KEY);
      const restored = savedId ? list.find((c) => c.id === savedId) : null;
      setActiveContextState(restored ?? list[0] ?? null);
    } catch {
      // non-fatal — contexts just won't be shown
    }
  }, []);

  const setActiveContext = useCallback((ctx: UserContext) => {
    setActiveContextState(ctx);
    localStorage.setItem(ACTIVE_CONTEXT_KEY, ctx.id);
  }, []);

  useEffect(() => {
    const onAuthExpired = () => {
      setToken(null);
      setUser(null);
      setContexts([]);
      setActiveContextState(null);
      setAccessControl(DEFAULT_ACCESS_CONTROL);
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  }, []);

  useEffect(() => {
    const onAccessControlUpdated = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AccessControlState>>).detail;
      setAccessControl((previous) => applyAccessControlUpdate(previous, detail));
    };

    const onAccessControlStorage = (event: StorageEvent) => {
      if (event.key !== ACCESS_CONTROL_SYNC_KEY || !event.newValue) return;

      try {
        const parsed = JSON.parse(event.newValue) as { detail?: Partial<AccessControlState> };
        if (!parsed.detail) return;
        setAccessControl((previous) => applyAccessControlUpdate(previous, parsed.detail ?? {}));
      } catch {
        // Ignore malformed payloads.
      }
    };

    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, onAccessControlUpdated as EventListener);
    window.addEventListener('storage', onAccessControlStorage);
    return () => {
      window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, onAccessControlUpdated as EventListener);
      window.removeEventListener('storage', onAccessControlStorage);
    };
  }, []);

  // On mount, verify a stored token is still valid
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    fetchWithTimeout('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Token invalid');
        return res.json() as Promise<{
          user: AuthUser;
          access_control?: {
            feature_enabled?: boolean;
            is_temporarily_suspended?: boolean;
            suspended_reason?: string | null;
            suspended_by_email?: string | null;
            suspended_at?: string | null;
            updated_at?: string | null;
          };
        }>;
      })
      .then(({ user: u, access_control: control }) => {
        setUser(u);
        setAccessControl({
          featureEnabled: Boolean(control?.feature_enabled),
          isTemporarilySuspended: Boolean(control?.is_temporarily_suspended),
          suspendedReason: control?.suspended_reason ?? null,
          suspendedByEmail: control?.suspended_by_email ?? null,
          suspendedAt: control?.suspended_at ?? null,
          updatedAt: control?.updated_at ?? null,
        });
        return loadContexts(token);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
        setAccessControl(DEFAULT_ACCESS_CONTROL);
      })
      .finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (googleCredential: string) => {
    const res = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: googleCredential }),
    });

    if (!res.ok) {
      const body = await readJsonSafely<{ error?: string }>(res);
      throw new Error(body?.error ?? `Login failed (${res.status})`);
    }

    const body = await readJsonSafely<{ token?: string; user?: AuthUser }>(res);
    if (!body?.token || !body.user) {
      throw new Error('Login response was missing required fields');
    }

    const { token: newToken, user: newUser } = body;
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    await loadAccessControl(newToken);
    await loadContexts(newToken);
  }, [loadAccessControl, loadContexts]);

  const loginAsDev = useCallback(async (input?: { email?: string; name?: string; role?: string }) => {
    const res = await apiFetch('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    });

    if (!res.ok) {
      const body = await readJsonSafely<{ error?: string }>(res);
      throw new Error(body?.error ?? `Dev login failed (${res.status})`);
    }

    const body = await readJsonSafely<{ token?: string; user?: AuthUser }>(res);
    if (!body?.token || !body.user) {
      throw new Error('Dev login response was missing required fields');
    }

    const { token: newToken, user: newUser } = body;
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    await loadAccessControl(newToken);
    await loadContexts(newToken);
  }, [loadAccessControl, loadContexts]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_CONTEXT_KEY);
    setToken(null);
    setUser(null);
    setContexts([]);
    setActiveContextState(null);
    setAccessControl(DEFAULT_ACCESS_CONTROL);
    // Tell Google not to auto-select on next visit
    window.google?.accounts.id.disableAutoSelect();
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {/* best effort */});
  }, []);

  // ─── Permission helpers ───────────────────────────────────────────────────
  // Derived from the active context. The backend enforces these same rules;
  // these helpers drive the frontend UI (showing/hiding edit buttons).

  const normalizedActiveRole = (activeContext?.role ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
  const isRegionalAdmin = normalizedActiveRole === 'regional admin';
  const isOfficeAdmin = normalizedActiveRole === 'office admin' || normalizedActiveRole === 'admin';
  const isAgent = ['agent', 'lead agent', 'team admin', 'team agent'].includes(normalizedActiveRole);

  const canCreateListing = isRegionalAdmin || isOfficeAdmin || isAgent;
  const canCreateAssociate = isRegionalAdmin || isOfficeAdmin;
  const canCreateMarketCenter = isRegionalAdmin;

  const canEditListing = useCallback((listingMcId: string | null, primaryAgentEmail?: string | null): boolean => {
    if (!activeContext) return false;
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) {
      const listingMcNorm = String(listingMcId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      const activeMcNorm = String(activeContext.marketCenterId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      return !!listingMcNorm && !!activeMcNorm && listingMcNorm === activeMcNorm;
    }
    // Agent: can edit listings where they are listed as an agent
    if (isAgent && user && primaryAgentEmail) {
      return primaryAgentEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
    }
    return false;
  }, [activeContext, user, isRegionalAdmin, isOfficeAdmin, isAgent]);

  const canEditAssociate = useCallback((assocMcId: string | null, assocEmail?: string | null, assocMcName?: string | null): boolean => {
    if (!activeContext || !user) return false;
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) {
      const normalizeId = (value: string | null | undefined): string =>
        String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      const normalizeText = (value: string | null | undefined): string =>
        String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

      const assocMcNorm = normalizeId(assocMcId);
      const activeMcNorm = normalizeId(activeContext.marketCenterId);
      if (assocMcNorm && activeMcNorm && assocMcNorm === activeMcNorm) return true;

      // Fallback for datasets where associate rows only carry reliable MC names.
      const assocMcNameNorm = normalizeText(assocMcName);
      const activeMcNameNorm = normalizeText(activeContext.marketCenter);
      return !!assocMcNameNorm && !!activeMcNameNorm && assocMcNameNorm === activeMcNameNorm;
    }
    // Agent: can only edit their own profile
    if (assocEmail) return assocEmail.toLowerCase() === user.email.toLowerCase();
    return false;
  }, [activeContext, user, isRegionalAdmin, isOfficeAdmin]);

  const canEditMarketCenter = useCallback((mcSourceId: string | null): boolean => {
    if (!activeContext) return false;
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) return mcSourceId !== null && mcSourceId === activeContext.marketCenterId;
    return false;
  }, [activeContext, isRegionalAdmin, isOfficeAdmin]);

  const value = useMemo(
    () => ({
      user, token, isLoading, contexts, activeContext, accessControl, setActiveContext, login, loginAsDev, logout,
      isRegionalAdmin, isOfficeAdmin, isAgent,
      canCreateListing, canCreateAssociate, canCreateMarketCenter,
      canEditListing, canEditAssociate, canEditMarketCenter,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, token, isLoading, contexts, activeContext, accessControl, setActiveContext, login, loginAsDev, logout,
     canCreateListing, canCreateAssociate, canCreateMarketCenter,
     canEditListing, canEditAssociate, canEditMarketCenter,
     isRegionalAdmin, isOfficeAdmin, isAgent]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
