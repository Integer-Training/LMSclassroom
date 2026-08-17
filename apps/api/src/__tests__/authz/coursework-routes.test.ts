import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// PearlLMS Phase 3 Step 4 — coursework SUBMIT guard, behavioral. Mount the REAL courseworkRouter with an
// injected fixture Actor; the service is mocked so a 2xx can come ONLY from the guard chain. Proves the
// write door: only an ENROLLED LEARNER of a PUBLISHED course may submit — non-learner roles, an
// unenrolled learner, and a draft course are all denied; anon is 401.

vi.mock('@api/services/coursework/coursework', () => ({
  presignCourseworkUploads: vi.fn(async () => ({ version: 1, files: [] })),
  createCourseworkSubmission: vi.fn(async () => ({ id: 'sub-1', version: 1 })),
  listOwnCourseworkForUnit: vi.fn(async () => []),
  getCourseworkSubmissionForReader: vi.fn(async () => ({ id: 'sub-1' })),
  signCourseworkDownloads: vi.fn(async () => ({}))
}));
vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({ getSubmissionByFileKey: vi.fn(async () => null) }));
vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn(async () => false) }));

import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { courseworkRouter } from '@api/routes/course/coursework';

const mockedIsMember = vi.mocked(isCourseGroupMember);
const mockedGetCourse = vi.mocked(getCourseById);

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
    c.set('actor', ACTORS[c.req.header('x-test-actor') ?? 'anon'] ?? ACTORS.anon);
    await next();
  })
  .route('/course/:courseId/lesson/:lessonId/coursework', courseworkRouter as unknown as Hono);

const BASE = '/course/c-1/lesson/l-1/coursework';
const published = [{ isPublished: true, status: 'ACTIVE' }] as never;
const draft = [{ isPublished: false, status: 'ACTIVE' }] as never;

function req(method: string, path: string, actor: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'x-test-actor': actor, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const SUBMIT_ROUTES: Array<{ method: string; path: string; body: unknown }> = [
  { method: 'POST', path: `${BASE}/presign`, body: { files: [{ fileName: 'w.docx', fileType: 'application/pdf' }] } },
  {
    method: 'POST',
    path: BASE,
    body: { version: 1, files: [{ key: 'coursework/c-1/u-learner/l-1/1/x.docx', name: 'w.docx' }] }
  }
];

describe('coursework submit guard — enrolled learner of a published course only', () => {
  for (const { method, path, body } of SUBMIT_ROUTES) {
    it(`${method} ${path}: non-learner roles → 403, anon → 401`, async () => {
      mockedIsMember.mockResolvedValue(true);
      mockedGetCourse.mockResolvedValue(published);
      expect((await req(method, path, 'tutor', body)).status).toBe(403);
      expect((await req(method, path, 'manager', body)).status).toBe(403);
      expect((await req(method, path, 'admin', body)).status).toBe(403);
      expect((await req(method, path, 'anon', body)).status).toBe(401);
    });

    it(`${method} ${path}: unenrolled learner → 403`, async () => {
      mockedIsMember.mockResolvedValue(false);
      mockedGetCourse.mockResolvedValue(published);
      expect((await req(method, path, 'learner', body)).status).toBe(403);
    });

    it(`${method} ${path}: enrolled learner but DRAFT course → 403`, async () => {
      mockedIsMember.mockResolvedValue(true);
      mockedGetCourse.mockResolvedValue(draft);
      expect((await req(method, path, 'learner', body)).status).toBe(403);
    });

    it(`${method} ${path}: enrolled learner + published → passes guard (2xx)`, async () => {
      mockedIsMember.mockResolvedValue(true);
      mockedGetCourse.mockResolvedValue(published);
      expect((await req(method, path, 'learner', body)).status).toBeLessThan(300);
    });
  }
});

describe('coursework read routes — require an authenticated actor', () => {
  it('GET list: anon → 401, learner → 200 (self-scoped)', async () => {
    expect((await req('GET', BASE, 'anon')).status).toBe(401);
    expect((await req('GET', BASE, 'learner')).status).toBe(200);
  });
  it('GET detail + POST download: anon → 401', async () => {
    expect((await req('GET', `${BASE}/sub-1`, 'anon')).status).toBe(401);
    expect((await req('POST', `${BASE}/download`, 'anon', { keys: ['k'] })).status).toBe(401);
  });
});
