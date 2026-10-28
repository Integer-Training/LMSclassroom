import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase 5 — the admin overview surfaces enrolled learners with NO tutor allocation (orphans no tutor can
// see). DB reads mocked; only the service wiring runs.

vi.mock('@cio/db/queries/dash', () => ({
  getActiveBroadcastCount: vi.fn(async () => 0),
  getCourseEnrolledLearnerIds: vi.fn(async () => []),
  getEnrollmentTrend: vi.fn(async () => []),
  getCertificateStats: vi.fn(async () => ({ total: 0 })),
  getCompletionStats: vi.fn(async () => ({ thisMonth: 0 })),
  getIdVerificationBreakdown: vi.fn(async () => []),
  getLessonCoursePairs: vi.fn(async () => []),
  getMemberRoleStatusCounts: vi.fn(async () => []),
  getOnlineOrgMembers: vi.fn(async () => []),
  getOrgCoursesWithEnrolment: vi.fn(async () => []),
  getOrgMessagingStats: vi.fn(async () => ({ activeThreads: 0, messagesLast7d: 0 })),
  getOrgStudyHoursMonthly: vi.fn(async () => []),
  getPublishedCourseCount: vi.fn(async () => 0),
  getRegistrationFunnel: vi.fn(async () => []),
  getSubmissionsOverTime: vi.fn(async () => []),
  listOrgLearners: vi.fn(async () => []),
  listUnallocatedEnrolledLearners: vi.fn()
}));
vi.mock('@cio/db/queries/allocation', () => ({ listLearnersForTutor: vi.fn(async () => []) }));
vi.mock('@cio/db/queries/comms', () => ({ listOrgTutors: vi.fn(async () => []) }));
vi.mock('@cio/db/queries/analytics', () => ({ getLastSeenForUserIds: vi.fn(async () => new Map()) }));
vi.mock('@cio/db/queries/coursework', () => ({ getAssessmentItemsByLesson: vi.fn(async () => new Map()) }));
vi.mock('@cio/db/queries/reports', () => ({ getCourseProgressReport: vi.fn(async () => ({ rows: [] })) }));
vi.mock('@api/services/caseload/caseload', () => ({
  computePipelineForRoster: vi.fn(async () => ({
    stats: {
      learners: 0,
      activeLearners: 0,
      inactiveLearners: 0,
      suspendedLearners: 0,
      neverLoggedIn: 0,
      learnersWithPendingWork: 0,
      awaitingMarking: 0,
      overdue: 0,
      dueSoon: 0,
      awaitingDraftFeedback: 0,
      resubmissions: 0,
      totalGraded: 0,
      passCount: 0,
      referCount: 0,
      avgTurnaroundDays: null
    }
  }))
}));

import { listUnallocatedEnrolledLearners } from '@cio/db/queries/dash';
import { getAdminOverview } from '@api/services/dash/admin-overview';

const admin: Actor = { authenticated: true, userId: 'adm', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-1' };
const tutor: Actor = { authenticated: true, userId: 't', role: 'TUTOR', status: 'ACTIVE', orgId: 'org-1' };

beforeEach(() => vi.clearAllMocks());

describe('admin overview — unallocated learners', () => {
  it('reports the count and list of enrolled learners with no allocation', async () => {
    vi.mocked(listUnallocatedEnrolledLearners).mockResolvedValue({
      total: 2,
      learners: [
        { learnerId: 'L3', name: 'Lea Three', email: 'l3@x' },
        { learnerId: 'L9', name: null, email: 'l9@x' }
      ]
    });
    const o = await getAdminOverview(admin);
    expect(listUnallocatedEnrolledLearners).toHaveBeenCalledWith('org-1');
    expect(o.unallocatedLearners.count).toBe(2);
    expect(o.unallocatedLearners.learners.map((l) => l.learnerId)).toEqual(['L3', 'L9']);
  });

  it('count 0 when everyone enrolled is allocated', async () => {
    vi.mocked(listUnallocatedEnrolledLearners).mockResolvedValue({ total: 0, learners: [] });
    expect((await getAdminOverview(admin)).unallocatedLearners).toEqual({ count: 0, learners: [] });
  });

  it('count is the exact total even when the returned list is capped', async () => {
    const learners = Array.from({ length: 25 }, (_, i) => ({ learnerId: `L${i}`, name: `N${i}`, email: null }));
    vi.mocked(listUnallocatedEnrolledLearners).mockResolvedValue({ total: 140, learners });
    const o = await getAdminOverview(admin);
    expect(o.unallocatedLearners.count).toBe(140);
    expect(o.unallocatedLearners.learners).toHaveLength(25);
  });

  it('the query is scoped to the actor org (allocations of another org never hide a learner)', async () => {
    vi.mocked(listUnallocatedEnrolledLearners).mockResolvedValue({ total: 0, learners: [] });
    await getAdminOverview({ ...admin, orgId: 'org-2' });
    expect(listUnallocatedEnrolledLearners).toHaveBeenCalledWith('org-2');
  });

  it('a tutor cannot load the overview (403)', async () => {
    await expect(getAdminOverview(tutor)).rejects.toMatchObject({ statusCode: 403 });
  });
});
