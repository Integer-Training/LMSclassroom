import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isRole } from '@cio/utils/auth';
import {
  countSystemEventsSince,
  getSystemEvents,
  getSystemEventTotals,
  type SystemEventFilters,
  type SystemEventRow
} from '@cio/db/queries';

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
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Page + filtered totals + last-24h KPI counts are independent reads. The totals use the page's WHERE but not
  // its limit, so they describe every matching event; the 24h tiles are COUNT-only scans (no 2000-row fetch).
  const [rows, { total, bySeverity }, recent] = await Promise.all([
    getSystemEvents(actor.orgId, filters),
    getSystemEventTotals(actor.orgId, filters),
    countSystemEventsSince(actor.orgId, since)
  ]);

  return {
    rows,
    totals: { total, bySeverity, errorsLast24h: recent.errors, failedLoginsLast24h: recent.failedLogins }
  };
}
