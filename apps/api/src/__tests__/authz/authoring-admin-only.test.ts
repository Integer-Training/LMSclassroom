import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';
import { ZLessonUpdate } from '@cio/utils/validation/lesson';

// PearlLMS Phase 2 Step 3 — course/unit/phase authoring is ADMIN-only. Two proofs:
//  (1) Behavioral: mount the REAL sectionRouter and drive it with an injected fixture Actor. Its
//      services are mocked so a non-2xx can come ONLY from the guard chain (requireAdmin runs before
//      the body validator, so a denied role is 401/403 regardless of body).
//  (2) Static sweep: assert every authoring WRITE route across the five route files is wired to
//      requireAdmin and that the fully-swapped files no longer reference the learner-open middleware.
//      (Behavioral mounting of the other routers is avoided — they transitively import 3-level
//      @cio/core/@cio/utils subpaths the vite resolver can't load, the pre-existing packaging quirk.)

vi.mock('@cio/core/services/course/section', () => ({
  createCourseSection: vi.fn(async () => ({ id: 's-new' })),
  deleteCourseSectionService: vi.fn(async () => ({ id: 's1' })),
  promoteUngroupedSection: vi.fn(async () => ({ id: 's1' })),
  reorderCourseSections: vi.fn(async () => []),
  updateCourseSectionService: vi.fn(async () => ({ id: 's1' }))
}));

import { sectionRouter } from '@api/routes/course/section';

const ORG = 'org-1';
const ACTORS: Record<string, Actor> = {
  anon: { authenticated: false, reason: 'anonymous' },
  learner: { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG },
  tutor: { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG },
  manager: { authenticated: true, userId: 'u-manager', role: 'MANAGER', status: 'ACTIVE', orgId: ORG },
  admin: { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG }
};

const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    const key = c.req.header('x-test-actor') ?? 'anon';
    c.set('actor', ACTORS[key] ?? ACTORS.anon);
    await next();
  })
  .route('/course/:courseId/section', sectionRouter as unknown as Hono);

function req(method: string, path: string, actor: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'x-test-actor': actor, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

// Every write route on the phase (section) authoring router. requireAdmin is first in each chain,
// so a denied role short-circuits before body validation — body omitted for the denial cases.
const WRITES: Array<{ method: string; path: string }> = [
  { method: 'POST', path: '/course/c-1/section' },
  { method: 'POST', path: '/course/c-1/section/promote-ungrouped' },
  { method: 'PUT', path: '/course/c-1/section/s1' },
  { method: 'DELETE', path: '/course/c-1/section/s1' },
  { method: 'POST', path: '/course/c-1/section/reorder' }
];

describe('sectionRouter (phase authoring) — non-admins denied server-side', () => {
  for (const { method, path } of WRITES) {
    it(`${method} ${path}: LEARNER/TUTOR/MANAGER → 403, anon → 401`, async () => {
      expect((await req(method, path, 'learner')).status).toBe(403);
      expect((await req(method, path, 'tutor')).status).toBe(403);
      expect((await req(method, path, 'manager')).status).toBe(403);
      expect((await req(method, path, 'anon')).status).toBe(401);
    });
  }

  it('ADMIN passes the guard: DELETE /section/:id → 200, POST /section/reorder → 200', async () => {
    expect((await req('DELETE', '/course/c-1/section/s1', 'admin')).status).toBe(200);
    expect(
      (await req('POST', '/course/c-1/section/reorder', 'admin', { sections: [{ id: 's1', order: 0 }] })).status
    ).toBe(200);
  });

  it('ADMIN create passes the guard + validator → 201', async () => {
    const res = await req('POST', '/course/c-1/section', 'admin', { title: 'Phase 1', courseId: 'c-1' });
    expect(res.status).toBe(201);
  });
});

// ── Static wiring sweep across the whole authoring surface ────────────────────────────────────────
const routeSrc = (file: string) => readFileSync(resolve(process.cwd(), 'src/routes/course', file), 'utf8');

describe('authoring routes are wired to requireAdmin (static sweep)', () => {
  it('section.ts — all writes admin-only; no learner-open middleware left', () => {
    const src = routeSrc('section.ts');
    expect(src).toContain('requireAdmin');
    expect(src).not.toContain('courseMemberMiddleware');
  });

  it('content.ts — write routes admin-only; plain courseTeamMemberMiddleware removed', () => {
    const src = routeSrc('content.ts');
    expect(src).toMatch(/\.put\('\/', requireAdmin/);
    expect(src).toMatch(/\.delete\('\/', requireAdmin/);
    // The plain team-member guard is gone (the automation-key variant on /reorder is a different name).
    expect(src).not.toMatch(/courseTeamMemberMiddleware\b/);
  });

  it('lesson.ts — the four unit-authoring writes are admin-only, learner reads/writes untouched', () => {
    const src = routeSrc('lesson.ts');
    expect(src).toMatch(/\.post\('\/reorder', requireAdmin/);
    expect(src).toMatch(/\.post\('\/', requireAdmin/);
    expect(src).toMatch(/\.delete\('\/:lessonId', requireAdmin/);
    expect(src).toMatch(/'\/:lessonId',\s*requireAdmin,/); // the PUT block
    // learner content read stays enrolment-gated (not admin-only)
    expect(src).toMatch(/\.get\('\/:lessonId', authMiddleware, courseMemberMiddleware/);
  });

  it('lesson-language.ts — content writes admin-only, GETs still enrolment-gated', () => {
    const src = routeSrc('lesson-language.ts');
    expect(src).toMatch(/'\/',\s*requireAdmin,\s*zValidator\('param', ZLessonLanguageGetParam\)/);
    expect(src).toMatch(/'\/:locale',\s*requireAdmin,/);
    expect(src).toMatch(/\.get\('\/', authMiddleware, courseMemberMiddleware/);
  });

  it('course.ts — create/update/delete/tags admin-only', () => {
    const src = routeSrc('course.ts');
    expect(src).toMatch(/\.post\('\/', requireAdmin, zValidator\('json', ZCourseCreate\)/);
    expect(src).toMatch(/'\/:courseId',\s*requireAdmin,\s*zValidator\('param', ZCourseUpdateParam\)/);
    expect(src).toMatch(/'\/:courseId',\s*requireAdmin,\s*zValidator\('param', ZCourseDeleteParam\)/);
    expect(src).toMatch(/'\/:courseId\/tags',\s*requireAdmin,/);
  });
});

// ── The unit type label validates only configured values (Part B) ────────────────────────────────
describe('ZLessonUpdate.unitType — config-driven, blank allowed', () => {
  it('accepts a configured label, null, and omission', () => {
    expect(ZLessonUpdate.safeParse({ unitType: 'session' }).success).toBe(true);
    expect(ZLessonUpdate.safeParse({ unitType: null }).success).toBe(true);
    expect(ZLessonUpdate.safeParse({}).success).toBe(true);
  });
  it('rejects an off-list type label', () => {
    expect(ZLessonUpdate.safeParse({ unitType: 'quiz' }).success).toBe(false);
    expect(ZLessonUpdate.safeParse({ unitType: 'Session' }).success).toBe(false);
  });
});
