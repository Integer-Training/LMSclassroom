import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 7 Step 4 — ID-verification routes require an authed actor on every path (anon → 401). The
// role + allocation rule itself lives in the service (unit-tested separately); here it is mocked so we assert
// the requireActor wiring + that the handler passes the requesting actor.

vi.mock('@api/services/registration/id-verification', () => ({
  getMyIdVerification: vi.fn(async () => ({ status: 'not_verified', verifiedAt: null })),
  getLearnerIdVerification: vi.fn(async () => ({ status: 'verified' })),
  recordIdVerification: vi.fn(async () => ({ status: 'verified' }))
}));

import { getMyIdVerification } from '@api/services/registration/id-verification';
import { idVerificationRouter } from '@api/routes/organization/id-verification';

const mMine = vi.mocked(getMyIdVerification);
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  learner: A('l1', 'LEARNER'),
  tutor: A('t1', 'TUTOR'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/id-verification', idVerificationRouter);

const ID = '11111111-1111-4111-8111-111111111111';
const hdr = (a: string) => ({ 'x-actor': a, 'content-type': 'application/json' });
const me = (a: string) => app.request('/id-verification/me', { headers: hdr(a) }).then((r) => r.status);
const getLearner = (a: string) =>
  app.request(`/id-verification/learner/${ID}`, { headers: hdr(a) }).then((r) => r.status);
const put = (a: string) =>
  app
    .request(`/id-verification/learner/${ID}`, {
      method: 'PUT',
      headers: hdr(a),
      body: JSON.stringify({ status: 'verified', method: 'passport' })
    })
    .then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('ID-verification routes — requireActor on every path', () => {
  it('anon is refused (401) on /me, /learner GET and PUT', async () => {
    expect(await me('anon')).toBe(401);
    expect(await getLearner('anon')).toBe(401);
    expect(await put('anon')).toBe(401);
  });

  it('/me resolves for the REQUESTING actor (self)', async () => {
    expect(await me('learner')).toBe(200);
    expect((mMine.mock.calls[0][0] as Actor & { userId: string }).userId).toBe('l1');
  });

  it('an authed actor reaches the guarded handlers (service enforces the role/allocation rule)', async () => {
    expect(await getLearner('tutor')).toBe(200);
    expect(await put('tutor')).toBe(200);
  });
});
