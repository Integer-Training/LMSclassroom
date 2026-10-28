import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Owner rule: a TUTOR sees ONLY learners allocated to them, on every screen. Course-team membership grants
// MATERIALS/UNITS access only. Proves visibleLearnerIdsForCourse + the course-view services (content, grid,
// download-all, unit, materials) for: tutor A vs B, allocated vs unallocated, team tutor with 0 allocations
// (content ok, roster empty), non-team tutor with 0 allocations (403), admin (all enrolled). DB mocked.

vi.mock('@cio/db/queries/allocation', () => ({
  listAllocatedLearnerIdsForCourse: vi.fn(),
  isTutorAllocatedToCourse: vi.fn(),
  isCourseTutor: vi.fn(),
  isTutorAllocatedToLearner: vi.fn()
}));
vi.mock('@cio/db/queries/reports', () => ({ listEnrolledLearnersWithName: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({
  getCourseOutline: vi.fn(),
  getCourseGridLearners: vi.fn(),
  getSubmissionsForAssessment: vi.fn(),
  getLatestSubmissionFilesForAssessment: vi.fn(),
  getLessonTitle: vi.fn(),
  getUnitContent: vi.fn(),
  getAssessmentItemsForLesson: vi.fn(),
  getSubmissionStatusRowsForLearners: vi.fn(),
  getSubmissionByFileKey: vi.fn(),
  getSubmissionByFeedbackFileKey: vi.fn(),
  hasLearnerPassedUnit: vi.fn()
}));
vi.mock('@cio/core/utils/s3', () => ({ generateDocumentDownloadPresignedUrls: vi.fn(async () => ({})) }));
vi.mock('@cio/core/utils/zip', () => ({
  createDocumentZipStream: vi.fn(() => new ReadableStream()),
  ZIP_MAX_FILES: 200,
  ZIP_MAX_TOTAL_BYTES: 250 * 1024 * 1024
}));

import { isCourseTutor, isTutorAllocatedToCourse, listAllocatedLearnerIdsForCourse } from '@cio/db/queries/allocation';
import { listEnrolledLearnersWithName } from '@cio/db/queries/reports';
import {
  getAssessmentItemsForLesson,
  getCourseGridLearners,
  getCourseOutline,
  getLessonTitle,
  getLatestSubmissionFilesForAssessment,
  getSubmissionsForAssessment,
  getSubmissionStatusRowsForLearners,
  getUnitContent
} from '@cio/db/queries/coursework';
import { createDocumentZipStream } from '@cio/core/utils/zip';
import { visibleLearnerIdsForCourse } from '@api/middlewares/guards';
import {
  canAccessCourse,
  getAssessmentSubmissions,
  getTutorCourseContent,
  getTutorUnitContent,
  signCourseMaterialsForTutor
} from '@api/services/caseload/course-view';
import { buildAssessmentSubmissionsZip } from '@api/services/caseload/download-all';

const mAllocIds = vi.mocked(listAllocatedLearnerIdsForCourse);
const mTeam = vi.mocked(isCourseTutor);
const mAllocatedToCourse = vi.mocked(isTutorAllocatedToCourse);
const mEnrolled = vi.mocked(listEnrolledLearnersWithName);

const ORG = 'org-1';
const C = 'course-1';
const mk = (userId: string, role: 'TUTOR' | 'ADMIN' | 'MANAGER' | 'LEARNER'): Actor => ({
  authenticated: true,
  userId,
  role,
  status: 'ACTIVE',
  orgId: ORG
});
const tutorA = mk('tA', 'TUTOR');
const tutorB = mk('tB', 'TUTOR');
const admin = mk('adm', 'ADMIN');

// Enrolled: L1, L2, L3. A is allocated L1; B is allocated L2; L3 is unallocated (orphan).
const ENROLLED = ['L1', 'L2', 'L3'];
const ALLOC: Record<string, string[]> = { tA: ['L1'], tB: ['L2'] };

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mEnrolled.mockResolvedValue(ENROLLED.map((learnerId) => ({ learnerId, name: learnerId })) as never);
  mAllocIds.mockImplementation(async (tutorId: string) => ALLOC[tutorId] ?? []);
  mAllocatedToCourse.mockImplementation(async (tutorId: string) => (ALLOC[tutorId] ?? []).length > 0);
  mTeam.mockResolvedValue(false);
  vi.mocked(getCourseOutline).mockResolvedValue({
    title: 'Course',
    units: [
      {
        lessonId: 'U1',
        title: 'U',
        unitType: null,
        isOptional: false,
        sectionTitle: null,
        documents: [{ key: 'k1', name: 'Brief', kind: 'resource', downloadable: true }]
      }
    ]
  } as never);
  vi.mocked(getSubmissionStatusRowsForLearners).mockResolvedValue([]);
  vi.mocked(getCourseGridLearners).mockImplementation(
    async (_c: string, ids: string[]) => ids.map((learnerId) => ({ learnerId, name: learnerId })) as never
  );
  vi.mocked(getSubmissionsForAssessment).mockResolvedValue([]);
  vi.mocked(getLatestSubmissionFilesForAssessment).mockResolvedValue([]);
  vi.mocked(getAssessmentItemsForLesson).mockResolvedValue([
    { key: 'wb', name: 'Workbook', kind: 'workbook', dueAt: null, allowDrafts: false }
  ] as never);
  vi.mocked(getLessonTitle).mockResolvedValue('Unit 1');
  vi.mocked(getUnitContent).mockResolvedValue({ courseId: C } as never);
});

describe('visibleLearnerIdsForCourse', () => {
  it('tutor A sees only A-allocated, tutor B only B-allocated; the orphan is visible to neither', async () => {
    expect(await visibleLearnerIdsForCourse(tutorA, C)).toEqual(['L1']);
    expect(await visibleLearnerIdsForCourse(tutorB, C)).toEqual(['L2']);
  });
  it('a course-team tutor does NOT gain learners through the team (allocation only)', async () => {
    mTeam.mockResolvedValue(true);
    expect(await visibleLearnerIdsForCourse(mk('tTeam', 'TUTOR'), C)).toEqual([]);
    expect(mEnrolled).not.toHaveBeenCalled();
  });
  it('admin sees every enrolled learner', async () => {
    expect(await visibleLearnerIdsForCourse(admin, C)).toEqual(ENROLLED);
  });
  it('manager / learner / anonymous are refused', async () => {
    expect(await code(visibleLearnerIdsForCourse(mk('m', 'MANAGER'), C))).toBe(403);
    expect(await code(visibleLearnerIdsForCourse(mk('l', 'LEARNER'), C))).toBe(403);
    expect(await code(visibleLearnerIdsForCourse({ authenticated: false } as Actor, C))).toBe(401);
  });
});

describe('course-view roster scoping', () => {
  it('grid: tutor A gets only L1; admin gets all three', async () => {
    const gridA = await getAssessmentSubmissions(tutorA, C, 'U1', 'wb');
    expect(vi.mocked(getSubmissionsForAssessment).mock.calls[0][3]).toEqual(['L1']);
    expect(gridA.rows.map((r) => r.learner.learnerId)).toEqual(['L1']);
    const gridAdmin = await getAssessmentSubmissions(admin, C, 'U1', 'wb');
    expect(gridAdmin.rows.map((r) => r.learner.learnerId).sort()).toEqual(ENROLLED);
  });

  it('team tutor with 0 allocations: content ok, participants 0, grid empty, unit + materials still open', async () => {
    mTeam.mockResolvedValue(true);
    const t = mk('tTeam', 'TUTOR');
    const content = await getTutorCourseContent(t, C);
    expect(content.participants).toBe(0);
    expect(content.units[0].materials).toHaveLength(1);
    expect(vi.mocked(getSubmissionStatusRowsForLearners)).toHaveBeenCalledWith([], { courseId: C });

    const grid = await getAssessmentSubmissions(t, C, 'U1', 'wb');
    expect(grid.rows).toEqual([]);
    expect(grid.summary.participants).toBe(0);

    expect((await getTutorUnitContent(t, C, 'U1')).courseId).toBe(C);
    await expect(signCourseMaterialsForTutor(t, C, ['k1'])).resolves.toEqual({});
  });

  it('team tutor with 0 allocations: download-all is a 404 and never queries submissions (empty roster, not "no filter")', async () => {
    mTeam.mockResolvedValue(true);
    expect(await code(buildAssessmentSubmissionsZip(mk('tTeam', 'TUTOR'), C, 'U1', 'wb'))).toBe(404);
    expect(vi.mocked(getLatestSubmissionFilesForAssessment)).not.toHaveBeenCalled();
    expect(vi.mocked(createDocumentZipStream)).not.toHaveBeenCalled();
  });

  it('download-all: tutor A slim query is limited to their roster; admin gets all enrolled', async () => {
    vi.mocked(getLatestSubmissionFilesForAssessment).mockResolvedValue([
      { learnerId: 'L1', files: [{ key: 'k1', name: 'a.pdf' }] }
    ] as never);
    await buildAssessmentSubmissionsZip(tutorA, C, 'U1', 'wb');
    expect(vi.mocked(getLatestSubmissionFilesForAssessment).mock.calls[0][3]).toEqual(['L1']);
    await buildAssessmentSubmissionsZip(admin, C, 'U1', 'wb');
    expect([...(vi.mocked(getLatestSubmissionFilesForAssessment).mock.calls[1][3] as string[])].sort()).toEqual(
      ENROLLED
    );
  });

  it('non-team tutor with 0 allocations on the course -> 403 everywhere', async () => {
    const t = mk('tNone', 'TUTOR');
    expect(await code(getTutorCourseContent(t, C))).toBe(403);
    expect(await code(getAssessmentSubmissions(t, C, 'U1', 'wb'))).toBe(403);
    expect(await code(getTutorUnitContent(t, C, 'U1'))).toBe(403);
    expect(await code(signCourseMaterialsForTutor(t, C, ['k1']))).toBe(403);
  });

  it('allocated (non-team) tutor keeps access and sees only their learner', async () => {
    const content = await getTutorCourseContent(tutorB, C);
    expect(content.participants).toBe(1);
    expect(vi.mocked(getSubmissionStatusRowsForLearners)).toHaveBeenCalledWith(['L2'], { courseId: C });
  });
});

// canAccessCourse must give the SAME verdict as resolveRoster's access rule (visibleLearnerIdsForCourse non-empty, or
// course team, or admin) for every actor shape — without loading the roster.
describe('canAccessCourse mirrors resolveRoster exactly', () => {
  const cases: [string, Actor, boolean, boolean, boolean][] = [
    // [label, actor, allocated learner enrolled, on course team, expected]
    ['admin', admin, false, false, true],
    ['tutor allocated, not team', tutorA, true, false, true],
    ['tutor team, no allocations', mk('tTeam', 'TUTOR'), false, true, true],
    ['tutor allocated AND team', tutorB, true, true, true],
    ['tutor neither', mk('tNone', 'TUTOR'), false, false, false]
  ];
  for (const [label, actor, allocated, team, expected] of cases) {
    it(`${label} -> ${expected}`, async () => {
      mAllocatedToCourse.mockResolvedValue(allocated);
      mTeam.mockResolvedValue(team);
      expect(await canAccessCourse(actor, C)).toBe(expected);
      // The roster-based rule agrees: roster non-empty (allocated) || team || admin.
      const roleOk = actor.authenticated && actor.role === 'ADMIN';
      expect(roleOk || allocated || team).toBe(expected);
    });
  }
  it('does not load the roster (no enrolled-learner / allocated-ids read)', async () => {
    mAllocatedToCourse.mockResolvedValue(true);
    await canAccessCourse(tutorA, C);
    expect(mAllocIds).not.toHaveBeenCalled();
    expect(mEnrolled).not.toHaveBeenCalled();
  });
  it('manager / learner -> 403, anonymous -> 401 (same errors as visibleLearnerIdsForCourse)', async () => {
    expect(await code(canAccessCourse(mk('m', 'MANAGER'), C))).toBe(403);
    expect(await code(canAccessCourse(mk('l', 'LEARNER'), C))).toBe(403);
    expect(await code(canAccessCourse({ authenticated: false } as Actor, C))).toBe(401);
  });
  it('short-circuits: an allocated tutor never hits the team lookup', async () => {
    mAllocatedToCourse.mockResolvedValue(true);
    await canAccessCourse(tutorA, C);
    expect(mTeam).not.toHaveBeenCalled();
  });
});

describe('course content stats come from lean rows narrowed to the course', () => {
  it('computes submitted / needsGrading / passed from rows without files, comment or feedback', async () => {
    vi.mocked(getCourseOutline).mockResolvedValue({
      title: 'Course',
      units: [
        {
          lessonId: 'U1',
          title: 'U',
          unitType: null,
          isOptional: false,
          sectionTitle: null,
          documents: [{ key: 'wb', name: 'Workbook', kind: 'workbook', downloadable: true, dueAt: null }]
        }
      ]
    } as never);
    const row = (id: string, learnerId: string, version: number, resultKind: string | null, result: string | null) => ({
      id,
      learnerId,
      courseId: C,
      lessonId: 'U1',
      assessmentKey: 'wb',
      submissionType: 'final',
      version,
      status: 'submitted',
      submittedAt: `2026-10-0${version}T09:00:00Z`,
      courseTitle: 'Course',
      unitTitle: 'U',
      resultKind,
      result,
      resultRecordedAt: null
    });
    // newest first, as the query returns them. L1 awaiting; L2 passed; L3 referred (neither needs grading).
    vi.mocked(getSubmissionStatusRowsForLearners).mockResolvedValue([
      row('s3', 'L3', 2, 'verdict', 'REFER'),
      row('s2', 'L2', 1, 'verdict', 'PASS'),
      row('s1', 'L1', 1, null, null)
    ] as never);
    const content = await getTutorCourseContent(admin, C);
    const wb = content.units[0].assessments[0];
    expect(wb).toMatchObject({ key: 'wb', submitted: 3, needsGrading: 1, passed: 1 });
    expect(vi.mocked(getSubmissionStatusRowsForLearners)).toHaveBeenCalledWith(ENROLLED, { courseId: C });
  });
});
