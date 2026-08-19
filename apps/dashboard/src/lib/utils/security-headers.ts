/**
 * PearlLMS Phase-10 HP/SA-1 — baseline security response headers applied by the dashboard SvelteKit server.
 *
 * These are ALSO set at the Caddy reverse proxy in production (docker/Caddyfile); applying them here too is
 * deliberate defense-in-depth — it covers local/dev, any deploy that doesn't front the app with that Caddy
 * config, and requests the proxy might pass through unchanged. Each header is only SET when absent so an
 * upstream (Caddy) value always wins and we never double-write.
 *
 * HSTS is only emitted for secure requests — never assert it over plain http (a dev/localhost origin), where a
 * cached HSTS entry would wrongly force https for the whole host.
 */
const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'geolocation=(), microphone=(), payment=(), usb=()']
];

const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export function applySecurityHeaders(response: Response, isSecure: boolean): Response {
  for (const [name, value] of STATIC_SECURITY_HEADERS) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }

  if (isSecure && !response.headers.has('Strict-Transport-Security')) {
    response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }

  return response;
}
