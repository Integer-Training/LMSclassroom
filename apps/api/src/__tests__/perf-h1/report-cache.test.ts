import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// Phase H1 — single-flight + stale-while-revalidate on the Admin/Manager report endpoints. Proves: concurrent
// requests share one load; a repeat inside the TTL is served from memory; a stale entry is served at once while ONE
// background refresh runs; errors are never cached; keys are per org + report; and — the security property — the
// role guard runs BEFORE the cache read, so a warm cache never serves a Tutor/Learner (or a Manager on an
// admin-only report). Services are mocked; no database is contacted.

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

vi.mock('@api/services/dash', () => ({
  getCurrentUserLoginStreak: vi.fn(),
  getOrganisationAnalytics: vi.fn(async () => ({ totalCertificates: 1 })),
  getStudentLoginActivity: vi.fn()
}));
vi.mock('@api/services/dash/admin-overview', () => ({
  getAdminOverview: vi.fn(async () => ({ headline: { totalLearners: 5 } })),
  getOnlineNow: vi.fn()
}));
vi.mock('@api/services/dash/reports', () => ({
  getCompletionsReport: vi.fn(async () => ({ totalCompletions: 3 })),
  getLearnersReport: vi.fn(async () => ({ total: 9 })),
  getReferralsReport: vi.fn(async () => ({ totals: { totalRefers: 2 } })),
  getTutorFeedbackReport: vi.fn(async () => ({ totals: { totalFeedback: 4 } }))
}));
vi.mock('@api/services/dash/system-events', () => ({ getSystemEventsReport: vi.fn() }));
vi.mock('@api/services/course/compliance', () => ({ getOrgComplianceOverview: vi.fn(async () => ({ overdue: 0 })) }));
vi.mock('@api/services/analytics', () => ({
  getCountryBreakdown: vi.fn(),
  getCourseFunnel: vi.fn(),
  getLandingStats: vi.fn(),
  getPopularTypes: vi.fn(),
  ingestEventBatch: vi.fn()
}));

import { getOrganisationAnalytics } from '@api/services/dash';
import { getAdminOverview } from '@api/services/dash/admin-overview';
import {
  getCompletionsReport,
  getLearnersReport,
  getReferralsReport,
  getTutorFeedbackReport
} from '@api/services/dash/reports';
import { getOrgComplianceOverview } from '@api/services/course/compliance';
import { dashAnalyticsRouter } from '@api/routes/dash/stats';
import { SwrCache, cachedOrgReport, clearDashReportCache } from '@api/utils/swr-cache';

const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const mk = (role: 'ADMIN' | 'MANAGER' | 'TUTOR' | 'LEARNER', orgId = ORG1): Actor => ({
  authenticated: true,
  userId: `u-${role}-${orgId}`,
  role,
  status: 'ACTIVE',
  orgId
});

let current: Actor = mk('ADMIN');
const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('user', { id: current.authenticated ? current.userId : 'x' } as never);
    c.set('session', { id: 's' } as never);
    c.set('actor', current);
    await next();
  })
  .route('/dash', dashAnalyticsRouter as unknown as Hono);

const as = (actor: Actor) => {
  current = actor;
};

beforeEach(() => {
  vi.clearAllMocks();
  clearDashReportCache();
  delete process.env.DASH_CACHE_TTL_MS;
  delete process.env.DASH_CACHE_STALE_MS;
  as(mk('ADMIN'));
});
afterEach(() => vi.useRealTimers());

describe('route caching — single-flight + TTL', () => {
  it('a repeat inside the TTL is served from memory (one load)', async () => {
    expect((await app.request(`/dash/admin-overview?orgId=${ORG1}`)).status).toBe(200);
    expect((await app.request(`/dash/admin-overview?orgId=${ORG1}`)).status).toBe(200);
    expect(getAdminOverview).toHaveBeenCalledTimes(1);
  });

  it('concurrent requests share ONE in-flight load', async () => {
    let release!: () => void;
    vi.mocked(getLearnersReport).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ total: 42 } as never)))
    );
    const reqs = [1, 2, 3, 4].map(() => app.request('/dash/reports/learners'));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const bodies = await Promise.all((await Promise.all(reqs)).map((r) => r.json()));
    expect(getLearnersReport).toHaveBeenCalledTimes(1);
    for (const b of bodies) expect(b).toEqual({ success: true, data: { total: 42 } });
  });

  it('every cached endpoint loads once per org', async () => {
    for (const path of [
      '/dash/reports/learners',
      '/dash/reports/completions',
      '/dash/reports/referrals',
      '/dash/reports/tutor-feedback',
      `/dash/compliance-overview?orgId=${ORG1}`,
      `/dash/stats?orgId=${ORG1}`,
      `/dash/admin-overview?orgId=${ORG1}`
    ]) {
      expect((await app.request(path)).status).toBe(200);
      expect((await app.request(path)).status).toBe(200);
    }
    for (const fn of [
      getLearnersReport,
      getCompletionsReport,
      getReferralsReport,
      getTutorFeedbackReport,
      getOrgComplianceOverview,
      getOrganisationAnalytics,
      getAdminOverview
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("keys are per org: another org never receives this org's report", async () => {
    vi.mocked(getLearnersReport).mockResolvedValueOnce({ total: 1 } as never);
    vi.mocked(getLearnersReport).mockResolvedValueOnce({ total: 2 } as never);
    as(mk('ADMIN', ORG1));
    expect(await (await app.request('/dash/reports/learners')).json()).toEqual({ success: true, data: { total: 1 } });
    as(mk('ADMIN', ORG2));
    expect(await (await app.request('/dash/reports/learners')).json()).toEqual({ success: true, data: { total: 2 } });
    expect(getLearnersReport).toHaveBeenCalledTimes(2);
  });

  it('a failed load is not cached; the next request retries', async () => {
    vi.mocked(getCompletionsReport).mockRejectedValueOnce(new Error('db down'));
    expect((await app.request('/dash/reports/completions')).status).toBeGreaterThanOrEqual(500);
    expect((await app.request('/dash/reports/completions')).status).toBe(200);
    expect(getCompletionsReport).toHaveBeenCalledTimes(2);
  });

  it('DASH_CACHE_TTL_MS=0 disables caching (every request loads)', async () => {
    process.env.DASH_CACHE_TTL_MS = '0';
    await app.request('/dash/reports/learners');
    await app.request('/dash/reports/learners');
    expect(getLearnersReport).toHaveBeenCalledTimes(2);
  });
});

describe('role guard runs BEFORE the cache read (a warm cache never widens access)', () => {
  it('after an admin warms every report, tutor / learner get 403 and the cache is never consulted for them', async () => {
    const paths = [
      '/dash/reports/learners',
      '/dash/reports/completions',
      '/dash/reports/referrals',
      '/dash/reports/tutor-feedback',
      `/dash/compliance-overview?orgId=${ORG1}`,
      `/dash/stats?orgId=${ORG1}`,
      `/dash/admin-overview?orgId=${ORG1}`
    ];
    as(mk('ADMIN'));
    for (const p of paths) expect((await app.request(p)).status).toBe(200);
    vi.clearAllMocks();
    for (const role of ['TUTOR', 'LEARNER'] as const) {
      as(mk(role));
      for (const p of paths) expect((await app.request(p)).status).toBe(403);
    }
    expect(getLearnersReport).not.toHaveBeenCalled();
    expect(getAdminOverview).not.toHaveBeenCalled();
  });

  it('a Manager reads the manager-level reports but is refused the admin-only ones even when warm', async () => {
    as(mk('ADMIN'));
    await app.request('/dash/reports/referrals');
    await app.request('/dash/reports/tutor-feedback');
    await app.request('/dash/reports/learners');
    as(mk('MANAGER'));
    expect((await app.request('/dash/reports/referrals')).status).toBe(403);
    expect((await app.request('/dash/reports/tutor-feedback')).status).toBe(403);
    expect((await app.request('/dash/reports/learners')).status).toBe(200);
    expect(getLearnersReport).toHaveBeenCalledTimes(1); // served from the admin's warm entry: same org-wide data
  });

  it("a manager cannot pull another org's cached overview via ?orgId (same-org guard precedes the cache)", async () => {
    as(mk('ADMIN', ORG2));
    await app.request(`/dash/admin-overview?orgId=${ORG2}`);
    vi.clearAllMocks();
    as(mk('MANAGER', ORG1));
    const res = await app.request(`/dash/admin-overview?orgId=${ORG2}`);
    expect(res.status).toBe(403);
    expect(getAdminOverview).not.toHaveBeenCalled();
  });
});

describe('SwrCache — stale-while-revalidate', () => {
  it('serves the stale value immediately while ONE background refresh runs, then the refreshed value', async () => {
    let now = 0;
    const cache = new SwrCache<number>({ now: () => now });
    const loader = vi.fn(async () => ++calls);
    let calls = 0;
    expect(await cache.get('k', loader, 100, 500)).toBe(1); // cold: waits
    now = 50;
    expect(await cache.get('k', loader, 100, 500)).toBe(1); // fresh
    now = 200; // past ttl, inside the stale window
    const [a, b] = await Promise.all([cache.get('k', loader, 100, 500), cache.get('k', loader, 100, 500)]);
    expect(a).toBe(1); // stale answered immediately
    expect(b).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(loader).toHaveBeenCalledTimes(2); // exactly one refresh for the two stale readers
    now = 210;
    expect(await cache.get('k', loader, 100, 500)).toBe(2); // refreshed value now fresh
  });

  it('past ttl + stale the caller waits on a fresh load', async () => {
    let now = 0;
    const cache = new SwrCache<number>({ now: () => now });
    let n = 0;
    await cache.get('k', async () => ++n, 100, 200);
    now = 1000;
    expect(await cache.get('k', async () => ++n, 100, 200)).toBe(2);
  });

  it('a failing background refresh keeps serving the stale value and the next read retries', async () => {
    let now = 0;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cache = new SwrCache<string>({ now: () => now });
    await cache.get('k', async () => 'v1', 100, 500);
    now = 150;
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await cache.get('k', failing, 100, 500)).toBe('v1');
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get('k', async () => 'v2', 100, 500)).toBe('v1'); // still stale-served, retry in background
    await new Promise((r) => setTimeout(r, 5));
    now = 160;
    expect(await cache.get('k', async () => 'v3', 100, 500)).toBe('v2');
    err.mockRestore();
  });

  it('is bounded (oldest entry evicted)', async () => {
    const cache = new SwrCache<number>({ maxEntries: 2 });
    for (const k of ['a', 'b', 'c']) await cache.get(k, async () => 1, 1000, 0);
    expect(cache.size).toBe(2);
  });

  it('cachedOrgReport keys by report + org', async () => {
    const l1 = vi.fn(async () => 'A');
    const l2 = vi.fn(async () => 'B');
    expect(await cachedOrgReport('r', 'o1', l1)).toBe('A');
    expect(await cachedOrgReport('r', 'o1', l2)).toBe('A');
    expect(await cachedOrgReport('r', 'o2', l2)).toBe('B');
    expect(await cachedOrgReport('r2', 'o1', l2)).toBe('B');
  });
});
