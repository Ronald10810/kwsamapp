/**
 * Get the API base URL from environment or default to current origin
 */
export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envUrl) {
    // Ensure it doesn't have a trailing slash
    return envUrl.replace(/\/$/, '');
  }
  // Default to current origin (works in dev and when frontend proxies to backend)
  return window.location.origin;
}

/**
 * Fetch from the API with proper base URL handling
 */
export async function apiFetch(
  endpoint: string,
  options?: RequestInit
): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
}
