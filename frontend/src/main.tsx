import React, { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GlobalErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ fontFamily: 'monospace', padding: '2rem', background: '#fff1f2', minHeight: '100vh' }}>
          <h2 style={{ color: '#be123c', marginBottom: '1rem' }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#1e293b', fontSize: '0.85rem' }}>
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
          <button
            style={{ marginTop: '1.5rem', padding: '0.5rem 1rem', background: '#be123c', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import App from './App';
import './styles/index.css';
import { AuthProvider } from './contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '';
const RESOLVED_API_BASE_URL = API_BASE_URL;
const TOKEN_STORAGE_KEY = 'kwsa_auth_token';

const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const isApi = url.startsWith('/api/') || url === '/api';
  const isUploads = url.startsWith('/uploads/') || url === '/uploads';

  if (isApi || isUploads) {
    // Rewrite to absolute URL when a remote API base is configured (production)
    const resolvedUrl = RESOLVED_API_BASE_URL ? `${RESOLVED_API_BASE_URL}${url}` : url;

    // Inject auth token for API calls
    let resolvedInit = init;
    if (isApi) {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      const activeContextId = localStorage.getItem('kwsa_active_context_id') ?? '';
      // Don't overwrite an Authorization header the caller already set
      const existingAuth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
        ?? (init?.headers as Record<string, string> | undefined)?.['authorization'];
      if (token && !existingAuth) {
        resolvedInit = {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${token}`,
            'X-Active-Context': activeContextId,
          },
        };
      }
    }

    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(resolvedUrl, resolvedInit);
    }
    return originalFetch(new Request(resolvedUrl, input), resolvedInit);
  }

  return originalFetch(input, init);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>,
);
