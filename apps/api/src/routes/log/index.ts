import { Hono } from '@api/utils/hono';
import { recordSystemEvent } from '@cio/db';
import { createRateLimiter, isTrustedServerApiKeyRequest } from '@api/middlewares/rate-limiter';
import { extractClientIp } from '@api/utils/redis/key-generators';

// PearlLMS Phase 10 — error capture. POST /log/client records browser errors (and dashboard-SSR events, sent
// server-to-server with PRIVATE_SERVER_KEY) into system_event_log. Best-effort: ALWAYS answers 204 and never
// throws. The writer masks the IP and caps message/stack; here we only bound the request itself.

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;
const MAX_PATH = 500;

const BROWSER_EVENT_TYPES = new Set(['client.error']);
// Trusted (dashboard SSR) callers may also emit these.
const SERVER_EVENT_TYPES = new Set(['client.error', 'api.error', 'auth.session_invalid_bounce']);
const SEVERITIES = new Set(['info', 'warn', 'error']);

// Hard per-IP throttle for untrusted browser callers (~30/min). Trusted SSR calls are skipped.
const clientLogRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Too many log events.',
  keyGenerator: (c) => `log-client:ip:${extractClientIp(c)}`,
  skip: (c) => isTrustedServerApiKeyRequest(c)
});

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

export const logRouter = new Hono().post('/client', clientLogRateLimit, async (c) => {
  try {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) return c.body(null, 204);

    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return c.body(null, 204);

    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== 'object') return c.body(null, 204);

    const trusted = isTrustedServerApiKeyRequest(c);
    const allowed = trusted ? SERVER_EVENT_TYPES : BROWSER_EVENT_TYPES;
    const eventType =
      typeof body.eventType === 'string' && allowed.has(body.eventType) ? body.eventType : 'client.error';
    const severity = (typeof body.severity === 'string' && SEVERITIES.has(body.severity) ? body.severity : 'error') as
      | 'info'
      | 'warn'
      | 'error';

    const user = c.get('user');
    const actor = c.get('actor');
    const input = {
      eventType,
      severity,
      message: str(body.message, MAX_MESSAGE),
      stack: str(body.stack, MAX_STACK),
      path: str(body.path, MAX_PATH),
      method: trusted ? str(body.method, 10) : null,
      httpStatus: trusted && typeof body.httpStatus === 'number' ? body.httpStatus : null,
      correlationId: trusted ? str(body.correlationId, 100) : null,
      // Trusted SSR callers have no browser session of their own, so they forward the end user's details + IP.
      ip: trusted ? (str(body.ip, 100) ?? extractClientIp(c)) : extractClientIp(c),
      userId: user?.id ?? (trusted ? str(body.userId, 100) : null),
      userEmail: user?.email ?? (trusted ? str(body.userEmail, 320) : null),
      organizationId: actor && actor.authenticated ? actor.orgId : null,
      metadata: { source: trusted ? 'dashboard-ssr' : 'browser' }
    };

    await recordSystemEvent(input);
  } catch {
    // best-effort
  }

  return c.body(null, 204);
});
