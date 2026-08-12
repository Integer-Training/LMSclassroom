import { Context, Next } from 'hono';

// Explicit "this endpoint is intentionally reachable without a role/ownership guard" marker.
//
// It is a no-op passthrough — it changes nothing at runtime. Its job is to make the ABSENCE of a
// guard a deliberate, documented decision rather than an oversight: the coverage sweep treats an
// endpoint as covered iff it has a role/ownership guard OR this marker. The `reason` string is the
// justification (e.g. 'anonymous landing page', 'apiKey machine route', 'self-guarded in handler').
//
// Use it for genuinely-public endpoints (auth flows, org-site, widget payloads, katex) and for
// routes whose credential is checked another way (apiKey / automationKey machine routes,
// self-authorizing HMAC-cookie streaming). Do NOT use it to wave past a route that should have a
// role guard.
export function publicRoute(reason: string) {
  return async (_c: Context, next: Next) => {
    void reason;
    return next();
  };
}
