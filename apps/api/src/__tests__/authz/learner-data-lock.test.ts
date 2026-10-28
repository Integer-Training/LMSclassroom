import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// PearlLMS Phase 3+4 — learner-data lockdown. OWNER RULE: a TUTOR sees ONLY learners allocated to them;
// course-team tutors get course materials only. Learners must not see classmates. Proofs:
//  (1) behavioral: real compliance / invites / attendance routers driven with fixture Actors (services mocked
//      so a non-2xx can only come from the guard chain);
//  (2) static: the other locked routes are wired to requireAdmin / orgAdminMiddleware (their routers transitively
//      import 3-level @cio subpaths the vite resolver can't load — same quirk authoring-admin-only documents);
//  (3) roster filtering.

vi.mock('@api/middlewares/auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
vi.mock('@api/services/course/compliance', () => ({
  getCourseComplianceOverview: vi.fn(async () => ({})),
  getLearnerComplianceHistory: vi.fn(async () => ({ history: [] })),
  resetCourseCompliance: vi.fn(async () => ({})),
  extendCourseCompliance: vi.fn(async () => ({})),
  waiveCourseCompliance: vi.fn(async () => ({}))
}));
vi.mock('@api/services/course/invite', () => ({
  createStudentInvite: vi.fn(async () => ({})),
  getStudentInviteAuditTrail: vi.fn(async () => []),
  listStudentInvites: vi.fn(async () => []),
  revokeStudentInvite: vi.fn(async () => ({}))
}));
// Unresolvable 3-level @cio/utils subpaths (see header) — validators stubbed to accept anything.
vi.mock('@cio/utils/validation/course/compliance', async () => {
  const { z } = await import('zod');
  const any = z.any();
  return {
    ZCourseComplianceParam: any,
    ZCourseComplianceLearnerParam: any,
    ZCourseComplianceReset: any,
    ZCourseComplianceExtend: any,
    ZCourseComplianceWaive: any
  };
});
vi.mock('@cio/utils/validation/course/invite', async () => {
  const { z } = await import('zod');
  const any = z.any();
  return {
    ZCourseInviteAuditParam: any,
    ZCourseInviteParam: any,
    ZCourseInviteRevokeParam: any,
    ZCreateCourseInvite: any
  };
});
vi.mock('@api/services/attendance', () => ({ upsertAttendanceService: vi.fn(async (d: unknown) => d) }));
vi.mock('@api/middlewares/course-member', () => ({
  courseMemberMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
vi.mock('@cio/db/queries/reports', () => ({ getCourseOrgId: vi.fn(), listEnrolledLearnersWithName: vi.fn() }));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonById: vi.fn() }));
vi.mock('@cio/db/queries/group', () => ({ getGroupMemberIdByCourseAndProfile: vi.fn(), isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course/people', () => ({ getProfileByGroupMemberId: vi.fn() }));
vi.mock('@cio/db/queries/allocation', () => ({
  isTutorAllocatedToLearner: vi.fn(),
  listAllocatedLearnerIdsForCourse: vi.fn(),
  listTutorsForLearner: vi.fn(),
  listLearnersForTutor: vi.fn()
}));

import { complianceRouter } from '@api/routes/course/compliance';
import { invitesRouter } from '@api/routes/course/invite';
import { attendanceRouter } from '@api/routes/course/attendance';
import {
  filterCohortMembersForViewer,
  filterCourseMembersForViewer,
  withVisibleCourseMembers
} from '@api/services/course/member-visibility';
import { getCourseOrgId } from '@cio/db/queries/reports';
import { getLessonById } from '@cio/db/queries/lesson';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import { getProfileByGroupMemberId } from '@cio/db/queries/course/people';
import {
  isTutorAllocatedToLearner,
  listAllocatedLearnerIdsForCourse,
  listLearnersForTutor
} from '@cio/db/queries/allocation';

const ORG = 'org-1';
const ACTORS: Record<string, Actor> = {
  anon: { authenticated: false, reason: 'anonymous' },
  learner: { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG },
  tutor: { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG },
  admin: { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG }
};

const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', ACTORS[c.req.header('x-test-actor') ?? 'anon'] ?? ACTORS.anon);
    c.set('user', { id: 'u-x' } as never);
    await next();
  })
  .route('/course/:courseId/compliance', complianceRouter as unknown as Hono)
  .route('/course/:courseId/invites', invitesRouter as unknown as Hono)
  .route('/course/:courseId/attendance', attendanceRouter as unknown as Hono);

const call = (method: string, path: string, actor: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'x-test-actor': actor, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

beforeEach(() => {
  vi.mocked(getCourseOrgId).mockResolvedValue(ORG as never);
  vi.mocked(getLessonById).mockResolvedValue({ id: 'l-1', courseId: 'c-1' } as never);
});

const LOCKED: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/course/c-1/compliance' },
  { method: 'POST', path: '/course/c-1/compliance/reset' },
  { method: 'POST', path: '/course/c-1/compliance/extend' },
  { method: 'POST', path: '/course/c-1/compliance/waive' },
  { method: 'GET', path: '/course/c-1/invites' },
  { method: 'POST', path: '/course/c-1/invites' },
  { method: 'POST', path: '/course/c-1/invites/i-1/revoke' },
  { method: 'GET', path: '/course/c-1/invites/i-1/audit' }
];

describe('compliance + invites — ADMIN only at the API', () => {
  for (const { method, path } of LOCKED) {
    it(`${method} ${path}: learner/tutor → 403, anon → 401`, async () => {
      expect((await call(method, path, 'learner')).status).toBe(403);
      expect((await call(method, path, 'tutor')).status).toBe(403);
      expect((await call(method, path, 'anon')).status).toBe(401);
    });
  }

  it('ADMIN passes the guard: GET compliance → 200, GET invites → 200, GET audit → 200', async () => {
    expect((await call('GET', '/course/c-1/compliance', 'admin')).status).toBe(200);
    expect((await call('GET', '/course/c-1/invites', 'admin')).status).toBe(200);
    expect((await call('GET', '/course/c-1/invites/i-1/audit', 'admin')).status).toBe(200);
  });
});

describe('cross-org binding — an admin of another org cannot act on this course', () => {
  it('admin → 404 when the course belongs to a different org', async () => {
    vi.mocked(getCourseOrgId).mockResolvedValue('org-B' as never);
    for (const { method, path } of LOCKED) {
      expect((await call(method, path, 'admin')).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('GET compliance/learners/:profileId — self, admin or allocated tutor (service-level), any course member reaches the route', () => {
  it('learner / tutor / admin all pass the route guard (the service decides)', async () => {
    for (const actor of ['learner', 'tutor', 'admin']) {
      expect((await call('GET', '/course/c-1/compliance/learners/p-1', actor)).status).toBe(200);
    }
    expect((await call('GET', '/course/c-1/compliance/learners/p-1', 'anon')).status).toBe(401);
  });
});

describe('attendance POST — admin, or tutor for an ALLOCATED learner in the path course', () => {
  const body = { courseId: 'c-1', lessonId: 'l-1', studentId: 'gm-1', isPresent: true };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProfileByGroupMemberId).mockResolvedValue({ id: 'p-learner' } as never);
    vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue('gm-1' as never);
    vi.mocked(isTutorAllocatedToLearner).mockResolvedValue(true as never);
  });

  it('learner → 403, anon → 401', async () => {
    expect((await call('POST', '/course/c-1/attendance', 'learner', body)).status).toBe(403);
    expect((await call('POST', '/course/c-1/attendance', 'anon', body)).status).toBe(401);
  });

  it('admin → 201', async () => {
    expect((await call('POST', '/course/c-1/attendance', 'admin', body)).status).toBe(201);
  });

  it('allocated tutor → 201', async () => {
    expect((await call('POST', '/course/c-1/attendance', 'tutor', body)).status).toBe(201);
    expect(isTutorAllocatedToLearner).toHaveBeenCalledWith('u-tutor', 'p-learner');
  });

  it('unallocated tutor → 403', async () => {
    vi.mocked(isTutorAllocatedToLearner).mockResolvedValue(false as never);
    expect((await call('POST', '/course/c-1/attendance', 'tutor', body)).status).toBe(403);
  });

  it('tutor with a body courseId that differs from the path → 403', async () => {
    expect((await call('POST', '/course/c-1/attendance', 'tutor', { ...body, courseId: 'c-2' })).status).toBe(403);
  });

  it('ADMIN whose studentId is not a member of the path course → 403', async () => {
    vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue('gm-other' as never);
    expect((await call('POST', '/course/c-1/attendance', 'admin', body)).status).toBe(403);
  });

  it('lesson from a different course → 403 (admin and tutor)', async () => {
    vi.mocked(getLessonById).mockResolvedValue({ id: 'l-1', courseId: 'c-2' } as never);
    expect((await call('POST', '/course/c-1/attendance', 'admin', body)).status).toBe(403);
    expect((await call('POST', '/course/c-1/attendance', 'tutor', body)).status).toBe(403);
  });

  it('tutor whose studentId is not enrolled in the path course → 403', async () => {
    vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue(null as never);
    expect((await call('POST', '/course/c-1/attendance', 'tutor', body)).status).toBe(403);
  });
});

describe('static wiring — other locked routes', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
  const chain = (file: string, route: string) => {
    const s = src(file);
    const i = s.indexOf(route);
    expect(i, `${route} in ${file}`).toBeGreaterThan(-1);
    return s.slice(i, i + 520);
  };

  it('course analytics, exercise notify (post + poll), lesson notify-session-update → requireAdmin', () => {
    expect(chain('routes/course/course.ts', "'/:courseId/analytics'")).toContain('requireAdmin');
    expect(chain('routes/course/exercise.ts', "'/:exerciseId/notify'")).toContain('requireAdmin');
    expect(chain('routes/course/exercise.ts', "'/:exerciseId/notify/:jobId'")).toContain('requireAdmin');
    expect(chain('routes/course/lesson.ts', "'/:lessonId/notify-session-update'")).toContain('requireAdmin');
  });

  it('agent leaderboards + tutor-usage summary → orgAdminMiddleware', () => {
    expect(chain('routes/agent/agent.ts', "'/usage/leaderboard'")).toContain('orgAdminMiddleware');
    expect(chain('routes/agent/agent.ts', "'/tutor-usage/leaderboard'")).toContain('orgAdminMiddleware');
    expect(chain('routes/agent/agent.ts', "'/tutor-usage/summary'")).toContain('orgAdminMiddleware');
  });

  it('cohort goals → requireAdmin + cohort/org binding; members list stays member-gated but filtered', () => {
    const s = src('routes/cohort/cohort.ts');
    for (const route of ["'/:cohortId/goals'"]) {
      const head = s.slice(s.indexOf(route), s.indexOf(route) + 200);
      expect(head).toContain('requireAdmin');
      expect(head).toContain('requireCohortInOrg');
    }
    expect(chain('routes/cohort/cohort.ts', "'/goals/overview'")).toContain('requireSameOrg');
    const members = chain('routes/cohort/cohort.ts', "'/:cohortId/members'");
    expect(members).toContain('cohortMemberMiddleware');
    expect(members).toContain('filterCohortMembersForViewer');
    expect(chain('routes/cohort/cohort.ts', "'/my/goals'")).not.toContain('requireAdmin');
  });

  it('GET /course/:courseId rejects a ?slug= that resolves to a different course (404)', () => {
    const s = src('routes/course/course.ts');
    const i = s.indexOf('const found = await getCourse(');
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 450)).toContain('found.id !== courseId');
  });

  it('exercise submissions overview + video playback no longer use the team-wide predicate', () => {
    expect(src('services/submission/submission.ts')).not.toContain('isCourseTeamMemberOrOrgAdmin');
    expect(src('services/exercise/video-recording.ts')).not.toContain('isCourseTeamMemberOrOrgAdmin');
  });

  it('quiz submission email recipients = course ADMINs + allocated tutors (not getCourseTeachers alone)', () => {
    const s = src('services/submission/submission.ts');
    const i = s.indexOf('async function sendExerciseSubmissionUpdateEmail');
    const body = s.slice(i, i + 3500);
    expect(body).toContain('listTutorsForLearner(student.id)');
    expect(body).toContain('getCourseAdminTeachers(courseId)');
    expect(body).toContain('/caseload/courses/');
    expect(body).not.toContain('resolveActor');
  });
});

describe('cohort roster + course attendance — same rule', () => {
  const actor = (userId: string, role: string) => ({ authenticated: true, userId, role }) as Actor;

  it('cohort members: learner sees staff + self; tutor staff + allocated', async () => {
    const members = [
      { id: 'a', profileId: 'p-admin', roleId: 1 },
      { id: 'b', profileId: 'p-1', roleId: 3 },
      { id: 'c', profileId: 'p-2', roleId: 3 }
    ];
    expect((await filterCohortMembersForViewer(members, actor('p-1', 'LEARNER'))).map((m) => m.id)).toEqual(['a', 'b']);
    vi.mocked(listLearnersForTutor).mockResolvedValue([{ learnerId: 'p-2' }] as never);
    expect((await filterCohortMembersForViewer(members, actor('p-t', 'TUTOR'))).map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('course attendance follows the visible members; anonymous gets none', async () => {
    vi.mocked(listAllocatedLearnerIdsForCourse).mockResolvedValue(['p-a'] as never);
    vi.mocked(getCourseOrgId).mockResolvedValue(ORG as never);
    const course = {
      id: 'c-1',
      group: {
        members: [
          { id: 'm-t', profileId: 'p-tutor', roleId: 2 },
          { id: 'm-a', profileId: 'p-a', roleId: 3 },
          { id: 'm-b', profileId: 'p-b', roleId: 3 }
        ]
      },
      attendance: [{ studentId: 'm-a' }, { studentId: 'm-b' }]
    };
    const forTutor = await withVisibleCourseMembers(course, actor('p-tutor', 'TUTOR'));
    expect(forTutor.attendance).toEqual([{ studentId: 'm-a' }]);
    expect((await withVisibleCourseMembers(course, actor('x', 'ADMIN'))).attendance).toHaveLength(2);
    expect((await withVisibleCourseMembers(course, undefined)).attendance).toEqual([]);
  });
});

describe('GET /course/:courseId roster — filtered per viewer', () => {
  const members = [
    { id: 'm-admin', profileId: 'p-admin', roleId: 1 },
    { id: 'm-tutor', profileId: 'p-tutor', roleId: 2 },
    { id: 'm-a', profileId: 'p-a', roleId: 3 },
    { id: 'm-b', profileId: 'p-b', roleId: 3 },
    { id: 'm-c', profileId: 'p-c', roleId: 3 }
  ];
  const actor = (userId: string, role: string) => ({ authenticated: true, userId, role }) as Actor;
  const ids = (list: Array<{ id: string }>) => list.map((m) => m.id);

  beforeEach(() => {
    vi.mocked(listAllocatedLearnerIdsForCourse).mockResolvedValue(['p-a'] as never);
  });

  it('ADMIN sees everyone', async () => {
    expect(ids(await filterCourseMembersForViewer(members, 'c-1', actor('p-admin', 'ADMIN')))).toEqual(ids(members));
  });

  it('TUTOR sees staff + allocated learners only', async () => {
    expect(ids(await filterCourseMembersForViewer(members, 'c-1', actor('p-tutor', 'TUTOR')))).toEqual([
      'm-admin',
      'm-tutor',
      'm-a'
    ]);
  });

  it('a course-team tutor with no allocations sees no learners', async () => {
    vi.mocked(listAllocatedLearnerIdsForCourse).mockResolvedValue([] as never);
    expect(ids(await filterCourseMembersForViewer(members, 'c-1', actor('p-tutor', 'TUTOR')))).toEqual([
      'm-admin',
      'm-tutor'
    ]);
  });

  it('LEARNER sees staff + self, never classmates', async () => {
    expect(ids(await filterCourseMembersForViewer(members, 'c-1', actor('p-b', 'LEARNER')))).toEqual([
      'm-admin',
      'm-tutor',
      'm-b'
    ]);
  });

  it('anonymous (public slug route) sees staff only', async () => {
    expect(ids(await filterCourseMembersForViewer(members, 'c-1', undefined))).toEqual(['m-admin', 'm-tutor']);
  });
});
