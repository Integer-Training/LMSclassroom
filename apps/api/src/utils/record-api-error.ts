import type { Context } from 'hono';

import { extractClientIp } from '@api/utils/redis/key-generators';

/** Statuses that are routine client noise (expired session, wrong URL, no access) and never worth a row. */
const UNRECORDED_STATUSES = new Set([401, 403, 404]);

/** The socket address lookup can throw outside a real node server; losing the IP must not lose the event. */
function safeClientIp(c: Context): string | undefined {
  try {
    return extractClientIp(c);
  } catch {
    return undefined;
  }
}

// PearlLMS Phase 10 — best-effort 'api.error' capture for the system event log. Fire-and-forget; must never
// throw or alter the error response. recordSystemEvent masks the IP, caps message/stack and throttles repeats.
// Skipped under vitest so a unit test that exercises an error path can never write a row to whatever database
// DATABASE_URL happens to point at (tests that cover this stub VITEST out). `@cio/db` is imported lazily so the
// error helpers (imported nearly everywhere) do not pull the whole data layer in at module load.
export function recordApiError(c: Context, err: unknown, httpStatus: number, severity: 'warn' | 'error'): void {
  try {
    if (process.env.VITEST || UNRECORDED_STATUSES.has(httpStatus)) {
      return;
    }

    const user = c.get('user');
    const actor = c.get('actor');
    const e = err as { message?: string; stack?: string } | undefined;
    const input = {
      eventType: 'api.error',
      severity,
      httpStatus,
      path: c.req.path,
      method: c.req.method,
      message: e?.message ?? String(err),
      stack: e?.stack,
      correlationId: (c.get('correlationId') as string | undefined) ?? undefined,
      userId: user?.id ?? undefined,
      userEmail: user?.email ?? undefined,
      organizationId: actor?.orgId ?? undefined,
      ip: safeClientIp(c)
    };

    void import('@cio/db').then(({ recordSystemEvent }) => recordSystemEvent(input)).catch(() => {});
  } catch {
    // never throw from error handling
  }
}
