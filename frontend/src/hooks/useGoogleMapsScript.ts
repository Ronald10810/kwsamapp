import { useEffect, useState } from 'react';

const SCRIPT_ID = 'google-maps-places-script';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type GoogleMapsScriptState = {
  ready: boolean;
  loading: boolean;
  error: boolean;
};

let globalState: LoadState = 'idle';
const listeners = new Set<(state: LoadState) => void>();

function notify(state: LoadState) {
  globalState = state;
  listeners.forEach((fn) => fn(state));
}

/**
 * Loads the Google Maps JavaScript API (with the Places library) once per page.
 */
export function useGoogleMapsScript(): GoogleMapsScriptState {
  const [state, setState] = useState<LoadState>(globalState);

  useEffect(() => {
    const handler = (s: LoadState) => setState(s);
    listeners.add(handler);

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    // If script is already loaded, mark ready immediately.
    if (typeof window.google?.maps?.places !== 'undefined') {
      notify('ready');
      return () => { listeners.delete(handler); };
    }

    // Load on first attempt, or retry after an earlier error (e.g. key was empty before).
    if (globalState === 'idle' || (globalState === 'error' && !existingScript)) {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
      if (!apiKey) {
        notify('error');
        return () => { listeners.delete(handler); };
      }

      if (existingScript) {
        notify('loading');
        existingScript.addEventListener('load', () => notify('ready'), { once: true });
        existingScript.addEventListener('error', () => notify('error'), { once: true });
        return () => { listeners.delete(handler); };
      }

      notify('loading');
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => notify('ready');
      script.onerror = () => notify('error');
      document.head.appendChild(script);
    }

    return () => { listeners.delete(handler); };
  }, []);

  return {
    ready: state === 'ready',
    loading: state === 'idle' || state === 'loading',
    error: state === 'error',
  };
}
