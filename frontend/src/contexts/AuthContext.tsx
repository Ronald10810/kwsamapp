import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  contexts: UserContext[];
  activeContext: UserContext | null;
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
  /** Returns true if the user may edit the given associate. Pass their source_market_center_id and optionally their email. */
  canEditAssociate: (assocMcId: string | null, assocEmail?: string | null) => boolean;
  /** Returns true if the user may edit the given market centre. Pass its source_market_center_id. */
  canEditMarketCenter: (mcSourceId: string | null) => boolean;
}

const TOKEN_STORAGE_KEY = 'kwsa_auth_token';
const ACTIVE_CONTEXT_KEY = 'kwsa_active_context_id';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [contexts, setContexts] = useState<UserContext[]>([]);
  const [activeContext, setActiveContextState] = useState<UserContext | null>(null);

  const loadContexts = useCallback(async (authToken: string) => {
    try {
      const res = await fetch('/api/auth/contexts', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { contexts: UserContext[] };
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

  // On mount, verify a stored token is still valid
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Token invalid');
        return res.json() as Promise<{ user: AuthUser }>;
      })
      .then(({ user: u }) => {
        setUser(u);
        return loadContexts(token);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (googleCredential: string) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    await loadContexts(newToken);
  }, [loadContexts]);

  const loginAsDev = useCallback(async (input?: { email?: string; name?: string; role?: string }) => {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    await loadContexts(newToken);
  }, [loadContexts]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_CONTEXT_KEY);
    setToken(null);
    setUser(null);
    setContexts([]);
    setActiveContextState(null);
    // Tell Google not to auto-select on next visit
    window.google?.accounts.id.disableAutoSelect();
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {/* best effort */});
  }, []);

  // ─── Permission helpers ───────────────────────────────────────────────────
  // Derived from the active context. The backend enforces these same rules;
  // these helpers drive the frontend UI (showing/hiding edit buttons).

  const isRegionalAdmin = activeContext?.role === 'Regional Admin';
  const isOfficeAdmin = activeContext?.role === 'Office Admin';
  const isAgent = activeContext?.role === 'Agent';

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

  const canEditAssociate = useCallback((assocMcId: string | null, assocEmail?: string | null): boolean => {
    if (!activeContext || !user) return false;
    if (isRegionalAdmin) return true;
    if (isOfficeAdmin) return assocMcId !== null && assocMcId === activeContext.marketCenterId;
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
      user, token, isLoading, contexts, activeContext, setActiveContext, login, loginAsDev, logout,
      isRegionalAdmin, isOfficeAdmin, isAgent,
      canCreateListing, canCreateAssociate, canCreateMarketCenter,
      canEditListing, canEditAssociate, canEditMarketCenter,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, token, isLoading, contexts, activeContext, setActiveContext, login, loginAsDev, logout,
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
