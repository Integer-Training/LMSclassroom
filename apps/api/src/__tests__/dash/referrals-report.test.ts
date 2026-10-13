import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS — the admin-only Referrals/failing report. Proves (a) ADMIN-only authz (Manager/Tutor/Learner
// denied, anon unauthorized); (b) the merge/aggregation: grader-attributed per-tutor with a refer-rate and
// the pass-only graders filtered out, per-learner merged with open-refer + last-referred-by, correct totals
// and sort order. The DB query layer is mocked so only the service logic is exercised (no database).

vi.mock('@cio/db/queries/dash', () => ({
  getReferralTutorBreakdown: vi.fn(),
  getReferralLearnerBreakdown: vi.fn(),
  getLearnerOpenReferCounts: vi.fn(),
  getLearnerLastReferral: vi.fn(),
  // other dash queries imported by the service module but not used by getReferralsReport
  getCertificateStats: vi.fn(),
  getCompletionsTrend: vi.fn(),
  getCompletionStats: vi.fn(),
  getOrgCoursesWithEnrolment: vi.fn(),
  getTimeToCompleteStats: vi.fn()
}));

import {
  getLearnerLastReferral,
  getLearnerOpenReferCounts,
  getReferralLearnerBreakdown,
  getReferralTutorBreakdown
} from '@cio/db/queries/dash';
import { getReferralsReport } from '@api/services/dash/reports';

const ORG = 'org-1';
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: ORG }) as Actor;

function primeHappyPath() {
  vi.mocked(getReferralTutorBreakdown).mockResolvedValue([
    { tutorId: 't1', name: 'Strict Sam', learnersReferred: 3, totalRefers: 10, totalGraded: 20 },
    { tutorId: 't2', name: 'Lenient Lee', learnersReferred: 1, totalRefers: 2, totalGraded: 40 },
    { tutorId: 't3', name: 'Passer Pat', learnersReferred: 0, totalRefers: 0, totalGraded: 15 }, // filtered out
    { tutorId: null, name: null, learnersReferred: 1, totalRefers: 1, totalGraded: 1 } // removed grader
  ]);
  vi.mocked(getReferralLearnerBreakdown).mockResolvedValue([
    { learnerId: 'l1', name: 'Anna', timesReferred: 6, unitsReferred: 3 },
    { learnerId: 'l2', name: null, timesReferred: 2, unitsReferred: 2 },
    { learnerId: 'l3', name: 'Cara', timesReferred: 1, unitsReferred: 1 }
  ]);
  vi.mocked(getLearnerOpenReferCounts).mockResolvedValue([
    { learnerId: 'l1', openRefers: 2 },
    { learnerId: 'l3', openRefers: 1 }
  ]);
  vi.mocked(getLearnerLastReferral).mockResolvedValue([
    {
      learnerId: 'l1',
      lastReferredAt: '2026-10-10T09:00:00Z',
      lastReferredById: 't1',
      lastReferredByName: 'Strict Sam'
    },
    { learnerId: 'l2', lastReferredAt: '2026-10-05T09:00:00Z', lastReferredById: null, lastReferredByName: null },
    {
      learnerId: 'l3',
      lastReferredAt: '2026-10-01T09:00:00Z',
      lastReferredById: 't2',
      lastReferredByName: 'Lenient Lee'
    }
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe('getReferralsReport — ADMIN only', () => {
  beforeEach(primeHappyPath);

  it('Admin is allowed', async () => {
    await expect(getReferralsReport(A('u-admin', 'ADMIN'))).resolves.toBeTruthy();
  });

  it('Manager is denied (403)', async () => {
    await expect(getReferralsReport(A('u-mgr', 'MANAGER'))).rejects.toThrowError('Admins only');
  });

  it('Tutor is denied (403)', async () => {
    await expect(getReferralsReport(A('u-tutor', 'TUTOR'))).rejects.toThrowError('Admins only');
  });

  it('Learner is denied (403)', async () => {
    await expect(getReferralsReport(A('u-learner', 'LEARNER'))).rejects.toThrowError('Admins only');
  });

  it('Anonymous is unauthorized (401)', async () => {
    await expect(getReferralsReport({ authenticated: false } as Actor)).rejects.toThrowError('Unauthorized');
  });
});

describe('getReferralsReport — aggregation', () => {
  beforeEach(primeHappyPath);

  it('per-tutor: refer-rate computed, pass-only graders filtered, sorted by total refers desc', async () => {
    const r = await getReferralsReport(A('u-admin', 'ADMIN'));
    expect(r.perTutor.map((t) => t.name)).toEqual(['Strict Sam', 'Lenient Lee', 'Removed grader']);
    expect(r.perTutor[0]).toMatchObject({ totalRefers: 10, totalGraded: 20, referRate: 50 });
    expect(r.perTutor[1]).toMatchObject({ totalRefers: 2, totalGraded: 40, referRate: 5 });
    expect(r.perTutor[2]).toMatchObject({ tutorId: null, name: 'Removed grader', referRate: 100 });
    // 'Passer Pat' (0 refers) must not appear
    expect(r.perTutor.find((t) => t.name === 'Passer Pat')).toBeUndefined();
  });

  it('per-learner: merged open-refers + last-referred-by, name fallbacks, sorted by times referred desc', async () => {
    const r = await getReferralsReport(A('u-admin', 'ADMIN'));
    expect(r.perLearner.map((l) => l.learnerId)).toEqual(['l1', 'l2', 'l3']);
    expect(r.perLearner[0]).toMatchObject({
      name: 'Anna',
      timesReferred: 6,
      openRefers: 2,
      lastReferredBy: 'Strict Sam'
    });
    expect(r.perLearner[1]).toMatchObject({ name: 'Unknown learner', openRefers: 0, lastReferredBy: 'Removed grader' });
    expect(r.perLearner[2]).toMatchObject({ name: 'Cara', openRefers: 1, lastReferredBy: 'Lenient Lee' });
  });

  it('totals: refers summed, distinct learners, currently-referred from open set, tutors who referred', async () => {
    const r = await getReferralsReport(A('u-admin', 'ADMIN'));
    expect(r.totals).toEqual({
      totalRefers: 9,
      learnersReferred: 3,
      learnersCurrentlyReferred: 2,
      tutorsReferring: 3
    });
  });

  it('empty org: zeros everywhere, no crash', async () => {
    vi.mocked(getReferralTutorBreakdown).mockResolvedValue([]);
    vi.mocked(getReferralLearnerBreakdown).mockResolvedValue([]);
    vi.mocked(getLearnerOpenReferCounts).mockResolvedValue([]);
    vi.mocked(getLearnerLastReferral).mockResolvedValue([]);
    const r = await getReferralsReport(A('u-admin', 'ADMIN'));
    expect(r.totals).toEqual({ totalRefers: 0, learnersReferred: 0, learnersCurrentlyReferred: 0, tutorsReferring: 0 });
    expect(r.perTutor).toEqual([]);
    expect(r.perLearner).toEqual([]);
  });
});
