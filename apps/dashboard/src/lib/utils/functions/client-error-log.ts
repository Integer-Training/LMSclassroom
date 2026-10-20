import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

// PearlLMS Phase 10 — best-effort browser error capture -> API POST /log/client (system_event_log).
// Never throws, never blocks, lightly throttled + de-duplicated client-side. The API masks the IP and caps fields.

const MAX_PER_MINUTE = 5;
const WINDOW_MS = 60_000;
const sent: number[] = [];
const seen = new Set<string>();
let inFlight = false;

function endpoint(): string {
  // Mirrors getRequestBaseUrl(): dev hits the API directly, prod is same-origin via the /proxy prefix.
  const base = dev ? (env.PUBLIC_SERVER_URL ?? '') : `${window.location.origin}/proxy`;
  return `${base}/log/client`;
}

export function reportClientError(err: unknown, extra?: { message?: string }): void {
  try {
    if (typeof window === 'undefined' || inFlight) return;

    const e = err as { message?: string; stack?: string } | null | undefined;
    const message = String(extra?.message ?? e?.message ?? (typeof err === 'string' ? err : 'Unknown client error'));
    const stack = typeof e?.stack === 'string' ? e.stack : undefined;

    const key = `${message}|${(stack ?? '').slice(0, 200)}`;
    if (seen.has(key)) return;

    const now = Date.now();
    while (sent.length && now - sent[0] > WINDOW_MS) sent.shift();
    if (sent.length >= MAX_PER_MINUTE) return;
    sent.push(now);
    if (seen.size > 50) seen.clear();
    seen.add(key);

    inFlight = true;
    void fetch(endpoint(), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'client.error',
        severity: 'error',
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 4000),
        path: window.location.pathname
      })
    })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  } catch {
    inFlight = false;
  }
}

let installed = false;

export function installGlobalClientErrorListeners(): void {
  try {
    if (typeof window === 'undefined' || installed) return;
    installed = true;
    window.addEventListener('error', (ev) => reportClientError(ev.error ?? ev.message));
    window.addEventListener('unhandledrejection', (ev) => reportClientError(ev.reason));
  } catch {
    // ignore
  }
}
