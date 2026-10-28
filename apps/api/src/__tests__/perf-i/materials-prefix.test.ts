import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { getMaterialKeyLessonMap } from '@cio/db/queries/lesson';
import { assertCourseMaterialDownloadAccess } from '@api/middlewares/guards';

// Phase I (staff-can-sign-arbitrary-keys) — the materials route also refuses the two namespaces that have their own
// guarded endpoints (tutor feedback files, learner video recordings), for EVERY role including staff. The rest of the
// staff bypass is unchanged (authoring a just-uploaded key still works).

vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/lesson', () => ({ getMaterialKeyLessonMap: vi.fn(async () => new Map()) }));
vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(async () => false),
  getOrderedUnitsForCourse: vi.fn(async () => [])
}));

const ORG = 'org-1';
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const learner: Actor = { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };

const FEEDBACK = 'coursework-feedback/c1/l1/unit1/wb/1/fb.docx';
const RECORDING = 'exercise-recordings/org-1/c1/ex1/3/gm1/abc.webm';

async function status(p: Promise<void>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCourseGroupMember).mockResolvedValue(true);
  vi.mocked(getCourseById).mockResolvedValue([{ isPublished: true, status: 'ACTIVE' }] as never);
});

describe('materials route blocks the feedback and recording namespaces', () => {
  it.each([
    ['admin', admin],
    ['tutor', tutor],
    ['learner', learner]
  ])('%s cannot sign a coursework-feedback/ key (course-bound)', async (_n, actor) => {
    expect(await status(assertCourseMaterialDownloadAccess(actor, 'c1', [FEEDBACK]))).toBe(403);
  });

  it.each([
    ['admin', admin],
    ['tutor', tutor],
    ['learner', learner]
  ])('%s cannot sign an exercise-recordings/ key (course-bound)', async (_n, actor) => {
    expect(await status(assertCourseMaterialDownloadAccess(actor, 'c1', [RECORDING]))).toBe(403);
  });

  it('also blocked on the org-level (no courseId) path, and when mixed with an allowed key', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, undefined, [FEEDBACK]))).toBe(403);
    expect(await status(assertCourseMaterialDownloadAccess(admin, undefined, [RECORDING]))).toBe(403);
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'c1', ['materials/c1/a.pdf', RECORDING]))).toBe(403);
  });

  it('the existing coursework/ block is unchanged', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'c1', ['coursework/c1/l1/x.pdf']))).toBe(403);
  });

  it('staff bypass otherwise unchanged: a just-uploaded or flat key still signs', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'c1', ['materials/c1/fresh-upload.pdf']))).toBe(0);
    expect(await status(assertCourseMaterialDownloadAccess(tutor, 'c1', ['flat-key.pdf']))).toBe(0);
    expect(await status(assertCourseMaterialDownloadAccess(admin, undefined, ['media-library/x.mp4']))).toBe(0);
  });

  it('a prefix lookalike is not caught (only the exact namespaces)', async () => {
    expect(
      await status(assertCourseMaterialDownloadAccess(admin, 'c1', ['materials/c1/exercise-recordings/a.pdf']))
    ).toBe(0);
  });
});
