import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase-10 Step-3 fix wave — regression tests for the access findings.
// HP/SW-1: `canReadLearnerProgress` closes the stock GET /course/:courseId/progress?profileId IDOR (any
// enrolled learner could read a classmate's per-unit grades). Self / Admin / Manager / allocated-Tutor only.
// The tutor-allocation query is mocked so the predicate is deterministic.

vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));
// HP/SW-7: assertCourseMaterialDownloadAccess must DEFAULT-DENY non-`materials/` keys for a non-staff learner —
// so it can never be used to sign a classmate's `coursework/…` key. canReadCourseContent's two data deps are
// mocked so an enrolled learner of a published course passes the read gate and we reach the key-shape check.
vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));

import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { canReadLearnerProgress, assertCourseMaterialDownloadAccess } from '@api/middlewares/guards/ownership';

const mAlloc = vi.mocked(isTutorAllocatedToLearner);
const mMember = vi.mocked(isCourseGroupMember);
const mCourse = vi.mocked(getCourseById);
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const LEARNER = 'learner-A';

beforeEach(() => {
  vi.clearAllMocks();
  mAlloc.mockResolvedValue(false as never);
});

describe('canReadLearnerProgress (HP/SW-1) — progress IDOR guard', () => {
  it('the learner may read their OWN progress', async () => {
    expect(await canReadLearnerProgress(A(LEARNER, 'LEARNER'), LEARNER)).toBe(true);
  });

  it('a DIFFERENT learner may NOT read it (the IDOR that was open)', async () => {
    expect(await canReadLearnerProgress(A('learner-B', 'LEARNER'), LEARNER)).toBe(false);
  });

  it('Admin and Manager may read any learner in scope', async () => {
    expect(await canReadLearnerProgress(A('u', 'ADMIN'), LEARNER)).toBe(true);
    expect(await canReadLearnerProgress(A('u', 'MANAGER'), LEARNER)).toBe(true);
  });

  it('an ALLOCATED tutor may read; a non-allocated tutor may NOT', async () => {
    mAlloc.mockResolvedValue(true as never);
    expect(await canReadLearnerProgress(A('t1', 'TUTOR'), LEARNER)).toBe(true);
    expect(mAlloc).toHaveBeenCalledWith('t1', LEARNER);
    mAlloc.mockResolvedValue(false as never);
    expect(await canReadLearnerProgress(A('t2', 'TUTOR'), LEARNER)).toBe(false);
  });

  it('anonymous / empty learner id → false', async () => {
    expect(await canReadLearnerProgress({ authenticated: false } as Actor, LEARNER)).toBe(false);
    expect(await canReadLearnerProgress(A(LEARNER, 'LEARNER'), '')).toBe(false);
  });
});

describe('assertCourseMaterialDownloadAccess (HP/SW-7) — non-material key default-deny', () => {
  const COURSE = 'course-1';
  beforeEach(() => {
    // enrolled learner of a published+active course → passes canReadCourseContent
    mMember.mockResolvedValue(true as never);
    mCourse.mockResolvedValue([{ isPublished: true, status: 'ACTIVE' }] as never);
  });

  it('a non-staff learner may NOT sign a non-materials key (the coursework-IDOR that was open)', async () => {
    await expect(
      assertCourseMaterialDownloadAccess(A(LEARNER, 'LEARNER'), COURSE, ['coursework/other-learner/answer.pdf'])
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('staff bypass the material key-shape check (authoring flow unaffected)', async () => {
    await expect(
      assertCourseMaterialDownloadAccess(A('admin', 'ADMIN'), COURSE, ['coursework/anything/x.pdf'])
    ).resolves.toBeUndefined();
  });
});
