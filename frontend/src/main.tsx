import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import App from './App';
import './styles/index.css';
import { AuthProvider } from './contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '';
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
    const resolvedUrl = API_BASE_URL ? `${API_BASE_URL}${url}` : url;

    // Inject auth token for API calls
    let resolvedInit = init;
    if (isApi) {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      // Don't overwrite an Authorization header the caller already set
      const existingAuth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
        ?? (init?.headers as Record<string, string> | undefined)?.['authorization'];
      if (token && !existingAuth) {
        resolvedInit = {
          ...init,
          headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
