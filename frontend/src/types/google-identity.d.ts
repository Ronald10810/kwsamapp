// Minimal type declarations for Google Identity Services (GIS)
// https://developers.google.com/identity/gsi/web/reference/js-reference

interface CredentialResponse {
  credential: string;
  select_by: string;
  client_id: string;
}

interface IdConfiguration {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GsiButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
}

interface GoogleAccountsId {
  initialize(config: IdConfiguration): void;
  renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
  prompt(): void;
  disableAutoSelect(): void;
  revoke(hint: string, callback: () => void): void;
}

interface Google {
  accounts: {
    id: GoogleAccountsId;
  };
}

declare global {
  interface Window {
    google?: Google;
    onGoogleScriptLoad?: () => void;
  }
}

export {};
