import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isRole } from '@cio/utils/auth';
import { getSystemEvents, type SystemEventFilters, type SystemEventRow } from '@cio/db/queries';

// PearlLMS admin ACTIVITY LOG — the system_event_log viewer (logins, logouts, API/client errors). ADMIN ONLY,
// org-scoped. Rows carry only the masked IP (the writer masks it); nothing here re-exposes a raw IP.

function assertAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN')) throw new AppError('Admins only', ErrorCodes.FORBIDDEN, 403);
}

export interface SystemEventsReport {
  rows: SystemEventRow[];
  totals: {
    total: number;
    bySeverity: Record<string, number>;
    /** Unfiltered (org-wide) counts for the last 24h, for the KPI tiles. */
    errorsLast24h: number;
    failedLoginsLast24h: number;
  };
}

/** Admin-only activity log: filtered newest-first events for the actor's org + severity totals. */
export async function getSystemEventsReport(
  actor: Actor,
  filters: SystemEventFilters = {}
): Promise<SystemEventsReport> {
  assertAdmin(actor);
  const rows = await getSystemEvents(actor.orgId, filters);

  const bySeverity: Record<string, number> = {};
  for (const r of rows) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await getSystemEvents(actor.orgId, { from: since, limit: 2000 });
  const errorsLast24h = recent.filter((r) => r.severity === 'error').length;
  const failedLoginsLast24h = recent.filter((r) => r.eventType === 'auth.login.failure').length;

  return { rows, totals: { total: rows.length, bySeverity, errorsLast24h, failedLoginsLast24h } };
}
