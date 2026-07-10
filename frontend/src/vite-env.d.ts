/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_COMMUNICATIONS_CONSOLE_ENABLED?: string;
  readonly VITE_ENVIRONMENT?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_TRAINING_HUB_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
