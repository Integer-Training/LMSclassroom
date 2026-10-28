import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS scalability Phase D — the per-org single-flight caches behind the polled presence reads
// (getOrgSummary = header pill, getOnlineNow = admin panel). DB reads mocked. Proves: concurrent polls share ONE
// query, a poll inside the TTL is served from memory, orgs never cross, the kill switches work, and — the access
// rule — the role guard is evaluated fresh on EVERY call even when the data is cached.

vi.mock('@cio/db/queries/dash', () => ({
  getOnlineOrgMembers: vi.fn(),
  getMemberRoleStatusCounts: vi.fn(),
  getCourseCounts: vi.fn()
}));
vi.mock('@cio/db/queries/organization', () => ({}));
vi.mock('@cio/db/queries/allocation', () => ({}));
vi.mock('@cio/db/queries/caseload', () => ({}));
vi.mock('@cio/db/queries/analytics', () => ({}));
vi.mock('@cio/db/queries/onboarding', () => ({}));
vi.mock('@cio/db/queries/course', () => ({}));
vi.mock('@cio/db/queries/auth', () => ({}));
vi.mock('@api/services/course/compliance', () => ({}));
vi.mock('@api/services/organization/users', () => ({}));
vi.mock('@api/services/organization/allocation', () => ({}));
vi.mock('@cio/db/queries/comms', () => ({}));
vi.mock('@cio/db/queries/coursework', () => ({}));
vi.mock('@cio/db/queries/reports', () => ({}));
vi.mock('@api/services/caseload/caseload', () => ({}));

import { getCourseCounts, getMemberRoleStatusCounts, getOnlineOrgMembers } from '@cio/db/queries/dash';
import { clearPresenceCaches } from '@api/services/dash/online-presence';
import { getOrgSummary } from '@api/services/organization/management';
import { getOnlineNow } from '@api/services/dash/admin-overview';

const mOnline = vi.mocked(getOnlineOrgMembers);
const mRoles = vi.mocked(getMemberRoleStatusCounts);
const mCourses = vi.mocked(getCourseCounts);

const A = (role: string, orgId = 'o1'): Actor =>
  ({ authenticated: true, userId: 'u', role, status: 'ACTIVE', orgId }) as Actor;

const onlineRows = [
  { userId: 'a', name: 'A', email: 'a@t.test', roleId: 3, lastActive: '2026-10-28T10:00:00Z' },
  { userId: 'b', name: 'B', email: 'b@t.test', roleId: 2, lastActive: '2026-10-28T10:01:00Z' }
];

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  clearPresenceCaches();
  delete process.env.PRESENCE_CACHE_TTL_MS;
  delete process.env.ORG_CACHE_TTL_MS;
  mOnline.mockResolvedValue(onlineRows as never);
  mRoles.mockResolvedValue([
    { roleId: 3, status: 'ACTIVE', count: 5 },
    { roleId: 3, status: 'DEACTIVATED', count: 2 },
    { roleId: 2, status: 'ACTIVE', count: 1 }
  ] as never);
  mCourses.mockResolvedValue({ published: 4, draft: 1 } as never);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

describe('getOrgSummary caching', () => {
  it('returns the same numbers as before the cache', async () => {
    const summary = await getOrgSummary(A('ADMIN'));
    expect(summary).toEqual({
      learners: { total: 7, suspended: 2 },
      tutors: { total: 1, suspended: 0 },
      admins: { total: 0, suspended: 0 },
      managers: { total: 0 },
      courses: { published: 4, draft: 1 },
      online: 2
    });
    expect(mOnline).toHaveBeenCalledWith('o1', 5); // the 5-minute "Online now" window
  });

  it('concurrent polls share ONE set of queries; a later poll inside the TTL hits memory', async () => {
    await Promise.all([getOrgSummary(A('ADMIN')), getOrgSummary(A('ADMIN')), getOrgSummary(A('ADMIN'))]);
    await getOrgSummary(A('ADMIN'));

    expect(mOnline).toHaveBeenCalledTimes(1);
    expect(mRoles).toHaveBeenCalledTimes(1);
    expect(mCourses).toHaveBeenCalledTimes(1);
  });

  it('reads again once the TTL has expired', async () => {
    vi.useFakeTimers();
    await getOrgSummary(A('ADMIN'));
    vi.advanceTimersByTime(14_000);
    await getOrgSummary(A('ADMIN'));
    expect(mOnline).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000); // 16s > 15s default TTL
    await getOrgSummary(A('ADMIN'));
    expect(mOnline).toHaveBeenCalledTimes(2);
  });

  it('keys by organisation: another org never sees this org data', async () => {
    mOnline.mockImplementation((async (orgId: string) => (orgId === 'o1' ? onlineRows : [])) as never);
    const one = await getOrgSummary(A('ADMIN', 'o1'));
    const two = await getOrgSummary(A('ADMIN', 'o2'));

    expect(one.online).toBe(2);
    expect(two.online).toBe(0);
    expect(mOnline).toHaveBeenCalledTimes(2);
  });

  it('the admin guard is evaluated on EVERY call, even when the data is cached', async () => {
    await getOrgSummary(A('ADMIN')); // populates the cache for o1

    await expect(getOrgSummary(A('MANAGER'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOrgSummary(A('TUTOR'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOrgSummary(A('LEARNER'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOrgSummary({ authenticated: false } as Actor)).rejects.toMatchObject({ statusCode: 401 });
    expect(mOnline).toHaveBeenCalledTimes(1);
  });

  it('a failed read is not cached: the next poll retries', async () => {
    mOnline.mockRejectedValueOnce(new Error('db blip'));
    await expect(getOrgSummary(A('ADMIN'))).rejects.toThrow('db blip');
    await expect(getOrgSummary(A('ADMIN'))).resolves.toMatchObject({ online: 2 });
    expect(mOnline).toHaveBeenCalledTimes(2);
  });

  it('PRESENCE_CACHE_TTL_MS=0 and ORG_CACHE_TTL_MS=0 disable the memory cache (single-flight remains)', async () => {
    process.env.PRESENCE_CACHE_TTL_MS = '0';
    await getOrgSummary(A('ADMIN'));
    await getOrgSummary(A('ADMIN'));
    expect(mOnline).toHaveBeenCalledTimes(2);

    delete process.env.PRESENCE_CACHE_TTL_MS;
    process.env.ORG_CACHE_TTL_MS = '0';
    mOnline.mockClear();
    await getOrgSummary(A('ADMIN'));
    await getOrgSummary(A('ADMIN'));
    expect(mOnline).toHaveBeenCalledTimes(2);
  });
});

describe('getOnlineNow caching', () => {
  it('shares the online-members read with the summary and keeps the same shape', async () => {
    const summary = await getOrgSummary(A('ADMIN'));
    const online = await getOnlineNow(A('MANAGER'));

    expect(summary.online).toBe(2);
    expect(online.count).toBe(2);
    expect(online.byRole).toEqual({ learners: 1, tutors: 1, managers: 0, admins: 0 });
    expect(online.users.map((u) => [u.userId, u.role])).toEqual([
      ['a', 'Learner'],
      ['b', 'Tutor']
    ]);
    expect(mOnline).toHaveBeenCalledTimes(1);
  });

  it('manager/admin guard stays fresh per call (tutor and learner refused even when cached)', async () => {
    await getOnlineNow(A('ADMIN'));

    await expect(getOnlineNow(A('TUTOR'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOnlineNow(A('LEARNER'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOnlineNow({ authenticated: false } as Actor)).rejects.toMatchObject({ statusCode: 401 });
  });
});
