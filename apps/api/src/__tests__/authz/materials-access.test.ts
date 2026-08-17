import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { getCourseMaterialKeys } from '@cio/db/queries/lesson';
import { assertCourseMaterialDownloadAccess, requireCourseContentRead } from '@api/middlewares/guards';

// PearlLMS Phase 2 Step 4 — guarded material serving.
//  - assertCourseMaterialDownloadAccess (gap G3): the standalone download binding. DB reads are
//    mocked so only the decision logic runs.
//  - requireCourseContentRead (gap G2): the lesson/lesson-language read gate, exercised behaviorally.
// (The "no public bucket URL for documents/videos" fact is verified live via curl; the storage
// config exposes a public base URL only for the `media` bucket.)

vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/lesson', () => ({
  getCourseMaterialKeys: vi.fn(),
  getMaterialKeyLessonMap: vi.fn(async () => new Map())
}));
// Phase 4 gating is OFF here (this is a Phase-2 material-access test) — isUnitUnlocked short-circuits open.
vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(async () => false),
  getOrderedUnitsForCourse: vi.fn(async () => [])
}));

const mockedIsMember = vi.mocked(isCourseGroupMember);
const mockedGetCourse = vi.mocked(getCourseById);
const mockedMaterialKeys = vi.mocked(getCourseMaterialKeys);

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const anon: Actor = { authenticated: false, reason: 'anonymous' };

const published = [{ isPublished: true, status: 'ACTIVE' }] as never;
const draft = [{ isPublished: false, status: 'ACTIVE' }] as never;

const MAT = 'materials/course-1/abc-file.pdf'; // a materials-prefixed key
const OTHER_MAT = 'materials/course-1/removed-file.pdf';
const SUBMISSION = 'nanoid-submission.pdf'; // a flat, non-material key (e.g. exercise submission)

/** Run the guard; return the AppError statusCode, or 0 when access is granted. */
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
});

describe('assertCourseMaterialDownloadAccess — G3 course-bound download', () => {
  it('anonymous → 401', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(anon, 'course-1', [MAT]))).toBe(401);
  });

  it('no courseId (org-asset path) → staff only', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(learner, undefined, [SUBMISSION]))).toBe(403);
    expect(await status(assertCourseMaterialDownloadAccess(admin, undefined, [SUBMISSION]))).toBe(0);
  });

  it('unenrolled learner → 403', async () => {
    mockedIsMember.mockResolvedValue(false);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'course-1', [MAT]))).toBe(403);
  });

  it('enrolled learner on a DRAFT course → 403', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(draft);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'course-1', [MAT]))).toBe(403);
  });

  it('staff → allowed, bypassing the currency check (no material lookup)', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'course-1', [MAT]))).toBe(0);
    expect(mockedMaterialKeys).not.toHaveBeenCalled();
  });

  it('enrolled learner, published, CURRENT material key → allowed', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(published);
    mockedMaterialKeys.mockResolvedValue(new Set([MAT]));
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'course-1', [MAT]))).toBe(0);
  });

  it('enrolled learner, published, REMOVED/foreign material key → 403 (currency)', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(published);
    mockedMaterialKeys.mockResolvedValue(new Set([MAT])); // OTHER_MAT no longer current
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'course-1', [OTHER_MAT]))).toBe(403);
  });

  it('enrolled learner, published, non-material (flat) key → allowed (currency applies only to materials/ keys)', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(published);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'course-1', [SUBMISSION]))).toBe(0);
    expect(mockedMaterialKeys).not.toHaveBeenCalled();
  });
});

// ── requireCourseContentRead (G2) behavioral ─────────────────────────────────────────────────────
const ACTORS: Record<string, Actor> = { anon, learner, admin };

const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', ACTORS[c.req.header('x-test-actor') ?? 'anon'] ?? anon);
    await next();
  })
  .get('/course/:courseId/lesson/:lessonId', requireCourseContentRead, (c) => c.json({ ok: true }));

const read = (actor: string) => app.request('/course/course-1/lesson/l-1', { headers: { 'x-test-actor': actor } });

describe('requireCourseContentRead — G2 draft/enrolment gate on the material read', () => {
  it('anonymous → 401', async () => {
    expect((await read('anon')).status).toBe(401);
  });

  it('unenrolled learner → 403', async () => {
    mockedIsMember.mockResolvedValue(false);
    expect((await read('learner')).status).toBe(403);
  });

  it('enrolled learner on a DRAFT course → 403 (closes G2)', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(draft);
    expect((await read('learner')).status).toBe(403);
  });

  it('enrolled learner on a PUBLISHED course → 200', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(published);
    expect((await read('learner')).status).toBe(200);
  });

  it('staff → 200 (author/review, incl. drafts)', async () => {
    expect((await read('admin')).status).toBe(200);
  });
});
