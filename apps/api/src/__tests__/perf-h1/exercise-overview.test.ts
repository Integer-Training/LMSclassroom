import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase H1 — the exercise submissions overview (tutor view). The visible learner set (allocated ∩ enrolled) is
// resolved FIRST; a TUTOR with an empty set gets [] without ever querying submissions (and never an empty IN list);
// otherwise the allow-list is pushed into SQL. The file-answer URL signing is ONE batched pass for the whole page,
// not one call per submission. Admin keeps the unfiltered list; a learner only ever gets their own. DB mocked.

vi.mock('@cio/db/queries/submission', () => ({
  getSubmissionsByCourseIdWithDetails: vi.fn(),
  getQuestionAnswersBySubmissionId: vi.fn(),
  getSubmissionById: vi.fn(),
  createSubmission: vi.fn(),
  deleteSubmission: vi.fn(),
  getSubmissionsForGrading: vi.fn(),
  hasSubmission: vi.fn(),
  insertQuestionAnswersBatch: vi.fn(),
  updateQuestionAnswer: vi.fn(),
  updateSubmission: vi.fn(),
  updateSubmissionGrades: vi.fn()
}));
vi.mock('@cio/db/queries/group', () => ({ getGroupMemberIdByCourseAndProfile: vi.fn() }));
vi.mock('@api/middlewares/guards', () => ({ visibleLearnerIdsForCourse: vi.fn() }));
vi.mock('@cio/core/utils/s3', () => ({
  generateDocumentDownloadPresignedUrls: vi.fn(async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, `https://signed/${k}`]))
  ),
  generateVideoDownloadPresignedUrls: vi.fn(async () => ({}))
}));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn() }));
vi.mock('@cio/db/queries/assets', () => ({ createAssetUsage: vi.fn(), getAssetById: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn(), getCourseWithOrgData: vi.fn() }));
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseAdminTeachers: vi.fn(),
  getProfileByGroupMemberId: vi.fn()
}));
vi.mock('@cio/db/queries/exercise', () => ({ getExerciseById: vi.fn(), getExerciseWithRelationsOptimized: vi.fn() }));
vi.mock('@cio/db/queries/course/progression', () => ({ isExerciseCompletedForMember: vi.fn() }));
vi.mock('@cio/db/queries/allocation', () => ({ listTutorsForLearner: vi.fn() }));
vi.mock('@api/services/course/compliance', () => ({ syncComplianceProgressFromSubmission: vi.fn() }));
vi.mock('@api/services/course/completion', () => ({ evaluateCourseCertification: vi.fn() }));

import { getSubmissionsByCourseIdWithDetails } from '@cio/db/queries/submission';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import { visibleLearnerIdsForCourse } from '@api/middlewares/guards';
import { generateDocumentDownloadPresignedUrls } from '@cio/core/utils/s3';
import { listExerciseSubmissionsOverview } from '@api/services/submission/submission';

const mk = (userId: string, role: 'ADMIN' | 'TUTOR' | 'LEARNER'): Actor => ({
  authenticated: true,
  userId,
  role,
  status: 'ACTIVE',
  orgId: 'o1'
});
const tutor = mk('t1', 'TUTOR');
const admin = mk('adm', 'ADMIN');
const learner = mk('l1', 'LEARNER');

const fileAnswer = (key: string) => ({ answerData: { type: 'FILE_UPLOAD', fileKey: key } });
const sub = (id: string, profileId: string, createdAt: string, keys: string[] = []) => ({
  id,
  createdAt,
  groupmember: { profileId },
  answers: keys.map(fileAnswer)
});

const mQuery = vi.mocked(getSubmissionsByCourseIdWithDetails);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue(null as never);
});

describe('listExerciseSubmissionsOverview — tutor scope pushed into SQL', () => {
  it('a TUTOR with no visible learners gets [] and the submissions query never runs', async () => {
    vi.mocked(visibleLearnerIdsForCourse).mockResolvedValue([]);
    const out = await listExerciseSubmissionsOverview('c1', 'e1', 't1', tutor);
    expect(out.allSubmissions).toEqual([]);
    expect(mQuery).not.toHaveBeenCalled();
  });

  it('passes exactly the allocated ∩ enrolled learner ids to the query (allow-list in SQL, no post-filter)', async () => {
    vi.mocked(visibleLearnerIdsForCourse).mockResolvedValue(['A', 'B']);
    mQuery.mockResolvedValue([sub('s1', 'A', '2026-10-02'), sub('s2', 'B', '2026-10-01')] as never);
    const out = await listExerciseSubmissionsOverview('c1', 'e1', 't1', tutor);
    expect(mQuery).toHaveBeenCalledWith('c1', 'e1', undefined, ['A', 'B']);
    expect(out.allSubmissions.map((s) => s.id)).toEqual(['s2', 's1']); // oldest first, as before
  });

  it('visibility is resolved BEFORE any submission read (resolve -> query ordering)', async () => {
    const order: string[] = [];
    vi.mocked(visibleLearnerIdsForCourse).mockImplementation(async () => {
      order.push('visible');
      return ['A'];
    });
    mQuery.mockImplementation((async () => {
      order.push('query');
      return [];
    }) as never);
    await listExerciseSubmissionsOverview('c1', 'e1', 't1', tutor);
    expect(order).toEqual(['visible', 'query']);
  });

  it('ADMIN reads the unfiltered list and never resolves a roster', async () => {
    mQuery.mockResolvedValue([sub('s1', 'A', '2026-10-01')] as never);
    await listExerciseSubmissionsOverview('c1', 'e1', 'adm', admin);
    expect(mQuery).toHaveBeenCalledWith('c1', 'e1', undefined, undefined);
    expect(visibleLearnerIdsForCourse).not.toHaveBeenCalled();
  });

  it('a LEARNER never gets allSubmissions (only their own, by group-member id)', async () => {
    vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue('gm-1' as never);
    mQuery.mockResolvedValue([sub('mine', 'l1', '2026-10-01')] as never);
    const out = await listExerciseSubmissionsOverview('c1', 'e1', 'l1', learner);
    expect(out.allSubmissions).toEqual([]);
    expect(out.mySubmission.map((s) => s.id)).toEqual(['mine']);
    expect(mQuery).toHaveBeenCalledWith('c1', 'e1', 'gm-1', undefined);
    expect(visibleLearnerIdsForCourse).not.toHaveBeenCalled();
  });
});

describe('listExerciseSubmissionsOverview — one batched signing pass', () => {
  it('signs every file answer of the page in ONE call and re-slices them back onto the right submissions', async () => {
    vi.mocked(visibleLearnerIdsForCourse).mockResolvedValue(['A', 'B', 'C']);
    mQuery.mockResolvedValue([
      sub('s1', 'A', '2026-10-01', ['k1', 'k2']),
      sub('s2', 'B', '2026-10-02', []),
      sub('s3', 'C', '2026-10-03', ['k3'])
    ] as never);
    const out = await listExerciseSubmissionsOverview('c1', 'e1', 't1', tutor);
    expect(generateDocumentDownloadPresignedUrls).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateDocumentDownloadPresignedUrls).mock.calls[0][0].sort()).toEqual(['k1', 'k2', 'k3']);
    const byId = Object.fromEntries(out.allSubmissions.map((s) => [s.id, s]));
    const urls = (id: string) =>
      (byId[id].answers as { answerData: { fileUrl?: string } }[]).map((a) => a.answerData.fileUrl);
    expect(urls('s1')).toEqual(['https://signed/k1', 'https://signed/k2']);
    expect(urls('s2')).toEqual([]);
    expect(urls('s3')).toEqual(['https://signed/k3']);
  });
});
