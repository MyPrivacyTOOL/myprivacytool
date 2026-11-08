// MPC-8368: Cloudflare Turnstile for the post-scan email form. Privacy-preserving, cookieless, no puzzle for real visitors
import { recipientScript } from '@/lib/recipientClient';
// (appearance "interaction-only" only shows UI if Cloudflare cannot decide silently). The site key is public by design;
// the secret lives on the mpt-leads Worker (TURNSTILE_SECRET_KEY), which verifies the token.
export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '0x4AAAAAAFdzq221ll_j9riV';

// MPC-8430: the /scan page has its own widget (and secret, on the mpt-scan-report Worker), separate from the one above.
export const SCAN_TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_SCAN_TURNSTILE_SITE_KEY as string | undefined) || '0x4AAAAAAFiCB-c5gCsrkmEZ';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

const api = (): TurnstileApi | undefined => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<TurnstileApi | undefined> | null = null;

/** Loads the Turnstile script once. Resolves undefined (never rejects) if it is blocked or offline, so the form still works. */
export function loadTurnstile(): Promise<TurnstileApi | undefined> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  if (!loading) {
    // MPC-9886: through the registry ("cloudflare-turnstile", the named pre-click exception). Timing is unchanged here; running it only at the Scan me click is MPC-9888.
    loading = recipientScript('cloudflare-turnstile', SCRIPT_SRC, { defer: '' }).then(
      () => api(),
      () => { loading = null; return undefined; },
    );
  }
  return loading;
}
