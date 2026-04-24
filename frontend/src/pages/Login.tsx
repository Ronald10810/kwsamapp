import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const CONSOLE_LOGO_URL = 'https://static.wixstatic.com/media/cd2dff_661d95737ba4452d9c15f33d43643f72~mv2.png';

const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_URL}"]`);
    if (existingScript) {
      const onLoad = () => resolve();
      const onError = () => reject(new Error('Failed to load Google Identity Services'));
      existingScript.addEventListener('load', onLoad, { once: true });
      existingScript.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GSI_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  // Load the GSI script once
  useEffect(() => {
    loadGsiScript()
      .then(() => setScriptReady(true))
      .catch(() => setError('Could not load Google Sign-In. Please refresh and try again.'));
  }, []);

  // Initialise the Google button once the script is ready
  useEffect(() => {
    if (!scriptReady || !buttonRef.current) return;
    if (!GOOGLE_CLIENT_ID) {
      setError('Google Sign-In is not configured. Contact the administrator.');
      return;
    }

    if (!window.google?.accounts?.id) {
      setError('Google Sign-In did not load correctly. Please refresh and try again.');
      return;
    }

    buttonRef.current.innerHTML = '';

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        setError(null);
        try {
          await login(response.credential);
          navigate('/', { replace: true });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Login failed');
        }
      },
    });

    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 280,
    });
  }, [scriptReady, login, navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#15080d]">
      <div className="absolute inset-0 bg-[radial-gradient(1300px_900px_at_10%_6%,rgba(218,30,57,0.5),transparent_56%),radial-gradient(1200px_900px_at_92%_94%,rgba(138,14,37,0.54),transparent_66%),linear-gradient(140deg,#11050b_0%,#170813_34%,#0a0a14_100%)]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(128deg,rgba(255,255,255,0.028)_0px,rgba(255,255,255,0.028)_1px,transparent_1px,transparent_52px)] opacity-45" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(48%_38%_at_50%_52%,rgba(78,171,255,0.2),transparent_74%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(58%_44%_at_50%_50%,rgba(255,255,255,0.09),transparent_76%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(7,10,20,0.56),transparent_32%,transparent_68%,rgba(15,5,10,0.45))]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[530px] rounded-[28px] border border-white/24 bg-[linear-gradient(145deg,rgba(13,9,12,0.84),rgba(31,18,23,0.80))] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.50)] backdrop-blur-md sm:p-10">
          <p className="mb-5 text-center text-sm font-semibold uppercase tracking-[0.2em] text-[#e2b9be]">Mega Agent Productivity Platform</p>

          <div className="mb-7 text-center">
            <img
              src={CONSOLE_LOGO_URL}
              alt="KWSA MAPP logo"
              className="mx-auto h-56 w-auto object-contain"
              loading="eager"
            />

            <div className="mt-2">
              <h1 className="font-['Space_Grotesk'] text-[38px] font-semibold leading-[1.02] tracking-[-0.02em] text-white">
                KWSA MAPP
              </h1>
              <p className="mt-2 text-sm text-[#dbc7ca]">Sign in with your Google account to continue.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/18 bg-white/95 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div ref={buttonRef} className="flex justify-center" />
            {!scriptReady && !error && <p className="mt-3 text-center text-sm text-[#8a6a6d] animate-pulse">Loading sign-in...</p>}
            {error && <p className="mt-3 text-center text-sm font-medium text-[#b91c1c]">{error}</p>}
          </div>

          <p className="mt-6 text-xs text-[#d0b9bc]">
            Access is restricted to approved KWSA users. Contact your administrator if your account is blocked.
          </p>
        </div>
      </div>
    </div>
  );
}
