import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 7 Step 3 — the approval-queue routes are Manager/Admin ONLY on every load + action. Tutor and
// Learner are denied (403); anon is refused (401). The service is mocked so the router loads without a DB.

vi.mock('@api/services/registration/decisions', () => ({
  listRegistrationQueue: vi.fn(async () => []),
  getRegistrationDetail: vi.fn(async () => ({ id: 'r1' })),
  approveRegistration: vi.fn(async () => ({ userId: 'u1', courseId: 'c1' })),
  rejectRegistration: vi.fn(async () => ({ id: 'r1', status: 'rejected' }))
}));

import { registrationsRouter } from '@api/routes/organization/registrations';

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  admin: A('u-admin', 'ADMIN'),
  manager: A('u-mgr', 'MANAGER'),
  tutor: A('u-tutor', 'TUTOR'),
  learner: A('u-learner', 'LEARNER'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/registrations', registrationsRouter);

const ID = '11111111-1111-4111-8111-111111111111';
const hdr = (a: string) => ({ 'x-actor': a, 'content-type': 'application/json' });
const list = (a: string) => app.request('/registrations', { headers: hdr(a) }).then((r) => r.status);
const detail = (a: string) => app.request(`/registrations/${ID}`, { headers: hdr(a) }).then((r) => r.status);
const approve = (a: string) =>
  app.request(`/registrations/${ID}/approve`, { method: 'POST', headers: hdr(a), body: '{}' }).then((r) => r.status);
const reject = (a: string) =>
  app
    .request(`/registrations/${ID}/reject`, { method: 'POST', headers: hdr(a), body: JSON.stringify({ note: 'x' }) })
    .then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('approval queue — Manager/Admin only', () => {
  it('Manager and Admin reach every endpoint (2xx)', async () => {
    for (const who of ['manager', 'admin']) {
      expect(await list(who)).toBe(200);
      expect(await detail(who)).toBe(200);
      expect(await approve(who)).toBe(200);
      expect(await reject(who)).toBe(200);
    }
  });

  it('Tutor is denied (403) on queue, detail, approve, reject', async () => {
    expect(await list('tutor')).toBe(403);
    expect(await detail('tutor')).toBe(403);
    expect(await approve('tutor')).toBe(403);
    expect(await reject('tutor')).toBe(403);
  });

  it('Learner is denied (403) everywhere', async () => {
    expect(await list('learner')).toBe(403);
    expect(await detail('learner')).toBe(403);
    expect(await approve('learner')).toBe(403);
    expect(await reject('learner')).toBe(403);
  });

  it('anonymous is refused (401) everywhere', async () => {
    expect(await list('anon')).toBe(401);
    expect(await detail('anon')).toBe(401);
    expect(await approve('anon')).toBe(401);
    expect(await reject('anon')).toBe(401);
  });
});
