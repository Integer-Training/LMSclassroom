import { recordSystemEvent } from '../../system-events';

/**
 * PearlLMS Phase 10 (HARDENING-PLAN LOG-1) — best-effort auth capture into system_event_log.
 * Every function here swallows its own errors: logging must never throw into, or block, an auth request.
 * Raw IP / email are passed through; recordSystemEvent masks the IP and caps message/stack.
 */

const firstHop = (value: string | null | undefined) => (value ? value.split(',')[0].trim() || null : null);

export const getClientIp = (headers?: Headers | null): string | null => {
  try {
    return firstHop(headers?.get('x-forwarded-for')) ?? firstHop(headers?.get('x-real-ip'));
  } catch {
    return null;
  }
};

const safeEmail = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase().slice(0, 320) : null;

export const emailFromBody = (body: unknown): string | null =>
  body && typeof body === 'object' ? safeEmail((body as { email?: unknown }).email) : null;

export const logAuthEvent = (input: Parameters<typeof recordSystemEvent>[0]): void => {
  try {
    // Fire-and-forget: never await in the auth path.
    void recordSystemEvent(input).catch(() => {});
  } catch {
    /* ignore */
  }
};

export const recordLoginSuccess = (session: { userId: string; ipAddress?: string | null }, userEmail?: string | null) =>
  logAuthEvent({
    eventType: 'auth.login.success',
    severity: 'info',
    userId: session.userId,
    userEmail: safeEmail(userEmail),
    ip: session.ipAddress ?? null
  });

export const recordLoginFailure = (
  reason: 'bad_credentials' | 'rate_limited' | 'deactivated',
  opts: {
    userId?: string | null;
    userEmail?: string | null;
    ip?: string | null;
    httpStatus?: number;
    message?: string;
  }
) =>
  logAuthEvent({
    eventType: 'auth.login.failure',
    severity: 'warn',
    userId: opts.userId ?? null,
    userEmail: safeEmail(opts.userEmail),
    ip: opts.ip ?? null,
    path: '/sign-in/email',
    method: 'POST',
    httpStatus: opts.httpStatus ?? null,
    message: opts.message ?? null,
    metadata: { reason }
  });

export const recordLogout = (opts: { userId?: string | null; userEmail?: string | null; ip?: string | null }) =>
  logAuthEvent({
    eventType: 'auth.logout',
    severity: 'info',
    userId: opts.userId ?? null,
    userEmail: safeEmail(opts.userEmail),
    ip: opts.ip ?? null,
    path: '/sign-out',
    method: 'POST'
  });
