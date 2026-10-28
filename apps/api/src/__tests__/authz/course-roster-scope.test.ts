import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Owner rule: a TUTOR sees ONLY learners allocated to them, on every screen. Course-team membership grants
// MATERIALS/UNITS access only. Proves visibleLearnerIdsForCourse + the course-view services (content, grid,
// download-all, unit, materials) for: tutor A vs B, allocated vs unallocated, team tutor with 0 allocations
// (content ok, roster empty), non-team tutor with 0 allocations (403), admin (all enrolled). DB mocked.

vi.mock('@cio/db/queries/allocation', () => ({
  listAllocatedLearnerIdsForCourse: vi.fn(),
  isCourseTutor: vi.fn(),
  isTutorAllocatedToLearner: vi.fn()
}));
vi.mock('@cio/db/queries/reports', () => ({ listEnrolledLearnersWithName: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({
  getCourseOutline: vi.fn(),
  getCourseGridLearners: vi.fn(),
  getSubmissionsForAssessment: vi.fn(),
  getLessonTitle: vi.fn(),
  getUnitContent: vi.fn(),
  getAssessmentItemsForLesson: vi.fn(),
  getSubmissionsWithContextForLearners: vi.fn(),
  getSubmissionByFileKey: vi.fn(),
  getSubmissionByFeedbackFileKey: vi.fn(),
  hasLearnerPassedUnit: vi.fn()
}));
vi.mock('@cio/core/utils/s3', () => ({ generateDocumentDownloadPresignedUrls: vi.fn(async () => ({})) }));
vi.mock('@cio/core/utils/zip', () => ({ zipDocumentObjects: vi.fn() }));

import { isCourseTutor, listAllocatedLearnerIdsForCourse } from '@cio/db/queries/allocation';
import { listEnrolledLearnersWithName } from '@cio/db/queries/reports';
import {
  getAssessmentItemsForLesson,
  getCourseGridLearners,
  getCourseOutline,
  getLessonTitle,
  getSubmissionsForAssessment,
  getSubmissionsWithContextForLearners,
  getUnitContent
} from '@cio/db/queries/coursework';
import { zipDocumentObjects } from '@cio/core/utils/zip';
import { visibleLearnerIdsForCourse } from '@api/middlewares/guards';
import {
  getAssessmentSubmissions,
  getTutorCourseContent,
  getTutorUnitContent,
  signCourseMaterialsForTutor
} from '@api/services/caseload/course-view';
import { buildAssessmentSubmissionsZip } from '@api/services/caseload/download-all';

const mAllocIds = vi.mocked(listAllocatedLearnerIdsForCourse);
const mTeam = vi.mocked(isCourseTutor);
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
  vi.mocked(getSubmissionsWithContextForLearners).mockResolvedValue([]);
  vi.mocked(getCourseGridLearners).mockImplementation(
    async (_c: string, ids: string[]) => ids.map((learnerId) => ({ learnerId, name: learnerId })) as never
  );
  vi.mocked(getSubmissionsForAssessment).mockResolvedValue([]);
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
    expect(vi.mocked(getSubmissionsWithContextForLearners)).toHaveBeenCalledWith([]);

    const grid = await getAssessmentSubmissions(t, C, 'U1', 'wb');
    expect(grid.rows).toEqual([]);
    expect(grid.summary.participants).toBe(0);

    expect((await getTutorUnitContent(t, C, 'U1')).courseId).toBe(C);
    await expect(signCourseMaterialsForTutor(t, C, ['k1'])).resolves.toEqual({});
  });

  it('team tutor with 0 allocations: download-all zips no learner files (404, nothing added)', async () => {
    mTeam.mockResolvedValue(true);
    vi.mocked(zipDocumentObjects).mockResolvedValue({ buffer: Buffer.alloc(0), added: 0 } as never);
    expect(await code(buildAssessmentSubmissionsZip(mk('tTeam', 'TUTOR'), C, 'U1', 'wb'))).toBe(404);
    expect(vi.mocked(zipDocumentObjects)).toHaveBeenCalledWith([]);
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
    expect(vi.mocked(getSubmissionsWithContextForLearners)).toHaveBeenCalledWith(['L2']);
  });
});
