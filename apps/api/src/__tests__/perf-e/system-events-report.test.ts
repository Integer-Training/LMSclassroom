import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase E (system-events-report) — totals describe EVERY event matching the filter (grouped COUNT with the
// page's WHERE, no limit), and the 24h KPI tiles are count-only scans — no 2000-row fetch + JS filtering.

vi.mock('@cio/db/queries', () => ({
  getSystemEvents: vi.fn(async () => [{ id: 'e1', severity: 'error', eventType: 'api.error' }]),
  getSystemEventTotals: vi.fn(async () => ({ total: 1234, bySeverity: { error: 34, info: 1200 } })),
  countSystemEventsSince: vi.fn(async () => ({ errors: 7, failedLogins: 3 }))
}));

import { countSystemEventsSince, getSystemEvents, getSystemEventTotals } from '@cio/db/queries';
import { getSystemEventsReport } from '@api/services/dash/system-events';

const A = (role: string): Actor => ({ authenticated: true, userId: 'u', role, status: 'ACTIVE', orgId: 'o1' }) as Actor;

beforeEach(() => vi.clearAllMocks());

describe('getSystemEventsReport', () => {
  it('totals come from the grouped count (whole filtered set), not from the page rows', async () => {
    const filters = { severity: 'error', limit: 1 };
    const r = await getSystemEventsReport(A('ADMIN'), filters);

    expect(r.rows).toHaveLength(1);
    expect(r.totals.total).toBe(1234);
    expect(r.totals.bySeverity).toEqual({ error: 34, info: 1200 });
    expect(getSystemEventTotals).toHaveBeenCalledWith('o1', filters);
  });

  it('the 24h tiles use the COUNT-only query; the 2000-row event fetch is gone', async () => {
    const r = await getSystemEventsReport(A('ADMIN'));

    expect(r.totals.errorsLast24h).toBe(7);
    expect(r.totals.failedLoginsLast24h).toBe(3);
    expect(countSystemEventsSince).toHaveBeenCalledTimes(1);
    // Only the one page fetch — never a second getSystemEvents({ limit: 2000 }).
    expect(getSystemEvents).toHaveBeenCalledTimes(1);
    const sinceIso = vi.mocked(countSystemEventsSince).mock.calls[0]?.[1] as string;
    const ageMs = Date.now() - new Date(sinceIso).getTime();
    expect(ageMs).toBeGreaterThan(23.9 * 3600_000);
    expect(ageMs).toBeLessThan(24.1 * 3600_000);
  });

  it('stays admin-only (manager / tutor / anon rejected, nothing queried)', async () => {
    await expect(getSystemEventsReport(A('MANAGER'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getSystemEventsReport(A('TUTOR'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getSystemEventsReport({ authenticated: false } as Actor)).rejects.toMatchObject({ statusCode: 401 });
    expect(getSystemEvents).not.toHaveBeenCalled();
  });
});
