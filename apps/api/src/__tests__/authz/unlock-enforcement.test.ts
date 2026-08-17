import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// PearlLMS Phase 4 Step 2 — server enforcement (TEST-FIRST). Every learner-facing content/material/upload
// guard must REFUSE a locked unit (403) via the SAME isUnitUnlocked path; URL/id tampering is futile (the
// lock is computed from the path lessonId / the material key's owning lesson, never trusted from input);
// staff are unaffected; a toggle-off course is fully open. DB reads are mocked so only the guard logic runs.

vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(),
  getOrderedUnitsForCourse: vi.fn()
}));
vi.mock('@cio/db/queries/coursework', () => ({
  hasLearnerPassedUnit: vi.fn(),
  getSubmissionByFileKey: vi.fn(),
  isUnitUploadClosed: vi.fn(async () => false)
}));
vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn(async () => true) }));
vi.mock('@cio/db/queries/course', () => ({
  getCourseById: vi.fn(async () => [{ isPublished: true, status: 'ACTIVE' }])
}));
vi.mock('@cio/db/queries/lesson', () => ({
  getCourseMaterialKeys: vi.fn(),
  getMaterialKeyLessonMap: vi.fn()
}));

import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { getCourseMaterialKeys, getMaterialKeyLessonMap } from '@cio/db/queries/lesson';
import {
  requireCourseContentRead,
  requireCourseworkSubmit,
  assertCourseMaterialDownloadAccess
} from '@api/middlewares/guards';

const mToggle = vi.mocked(getCourseSequentialUnlock);
const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mPassed = vi.mocked(hasLearnerPassedUnit);
const mMatKeys = vi.mocked(getCourseMaterialKeys);
const mKeyLesson = vi.mocked(getMaterialKeyLessonMap);

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'L', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'A', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'T', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const ACTORS: Record<string, Actor> = { learner, admin, tutor };

// Course c1: u1(session) → u2(session). u2 is locked until u1 is passed.
const CHAIN = [
  { lessonId: 'u1', unitType: 'session' },
  { lessonId: 'u2', unitType: 'session' }
];
const MAT_KEY = 'materials/c1/u2-file.pdf';

beforeEach(() => {
  vi.clearAllMocks();
  mToggle.mockResolvedValue(true); // gated
  mUnits.mockResolvedValue(CHAIN as never);
  mPassed.mockResolvedValue(false); // u1 not passed → u2 locked
  mMatKeys.mockResolvedValue(new Set([MAT_KEY]) as never); // key is a current material of c1
  mKeyLesson.mockResolvedValue(new Map([[MAT_KEY, 'u2']]) as never); // that material belongs to u2
});

function status(p: Promise<unknown>): Promise<number> {
  return p.then(() => 0).catch((e) => (e as { statusCode?: number })?.statusCode ?? -1);
}

// ── Content read (routes 1/2) ──────────────────────────────────────────────────────────────────
const contentApp = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', ACTORS[c.req.header('x-actor') ?? 'learner']);
    c.set('user', {
      id: ACTORS[c.req.header('x-actor') ?? 'learner'].authenticated
        ? (ACTORS[c.req.header('x-actor') ?? 'learner'] as any).userId
        : ''
    } as any);
    await next();
  })
  .get('/course/:courseId/lesson/:lessonId', requireCourseContentRead, (c) => c.json({ ok: true }, 200));

const contentReq = (actor: string, lessonId = 'u2') =>
  contentApp.request(`/course/c1/lesson/${lessonId}`, { headers: { 'x-actor': actor } });

describe('requireCourseContentRead — locked unit content refused for a learner', () => {
  it('LEARNER + locked unit → 403', async () => {
    expect((await contentReq('learner')).status).toBe(403);
  });
  it('LEARNER + predecessor PASSED → 200 (unlocked)', async () => {
    mPassed.mockResolvedValue(true);
    expect((await contentReq('learner')).status).toBe(200);
  });
  it('URL/id tampering futile — a learner requesting a different LOCKED lessonId still 403', async () => {
    mUnits.mockResolvedValue([...CHAIN, { lessonId: 'u3', unitType: 'session' }] as never);
    mPassed.mockResolvedValue(false); // nothing passed
    expect((await contentReq('learner', 'u3')).status).toBe(403);
  });
  it('STAFF unaffected — Admin + Tutor reach a locked unit (200), passed-helper never consulted', async () => {
    expect((await contentReq('admin')).status).toBe(200);
    expect((await contentReq('tutor')).status).toBe(200);
    expect(mPassed).not.toHaveBeenCalled();
  });
  it('toggle OFF → learner reaches every unit (200)', async () => {
    mToggle.mockResolvedValue(false);
    expect((await contentReq('learner')).status).toBe(200);
  });
});

// ── Coursework submit (routes 3/4) ─────────────────────────────────────────────────────────────
const submitApp = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', ACTORS[c.req.header('x-actor') ?? 'learner']);
    await next();
  })
  .post('/course/:courseId/lesson/:lessonId/coursework', requireCourseworkSubmit, (c) => c.json({ ok: true }, 201));

const submitReq = (actor: string) =>
  submitApp.request('/course/c1/lesson/u2/coursework', { method: 'POST', headers: { 'x-actor': actor } });

describe('requireCourseworkSubmit — submission to a locked unit refused', () => {
  it('LEARNER + locked unit → 403', async () => {
    expect((await submitReq('learner')).status).toBe(403);
  });
  it('LEARNER + predecessor PASSED → passes the guard (2xx)', async () => {
    mPassed.mockResolvedValue(true);
    expect((await submitReq('learner')).status).toBeLessThan(300);
  });
  it('toggle OFF → learner may submit (2xx)', async () => {
    mToggle.mockResolvedValue(false);
    expect((await submitReq('learner')).status).toBeLessThan(300);
  });
});

// ── Material download (route 5) — by key, tampering simulated ──────────────────────────────────
describe('assertCourseMaterialDownloadAccess — locked unit material refused (by key)', () => {
  it('LEARNER + material key of a LOCKED unit → 403 (id tampering futile)', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', [MAT_KEY]))).toBe(403);
  });
  it('LEARNER + predecessor PASSED → allowed', async () => {
    mPassed.mockResolvedValue(true);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', [MAT_KEY]))).toBe(0);
  });
  it('STAFF unaffected — Admin allowed even when locked, gating not consulted', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'c1', [MAT_KEY]))).toBe(0);
    expect(mPassed).not.toHaveBeenCalled();
  });
  it('toggle OFF → learner may download', async () => {
    mToggle.mockResolvedValue(false);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', [MAT_KEY]))).toBe(0);
  });
});
