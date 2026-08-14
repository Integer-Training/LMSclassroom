import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// PearlLMS Phase 3 — tutor↔learner allocation. Two proofs:
//  (A) Predicate: the real DB-backed isAllocatedTutor (guards) resolves TUTOR-only + allocation-row
//      presence; the underlying table read is mocked so only the decision logic runs.
//  (B) Behavioral: mount the REAL allocationsRouter with an injected fixture Actor. The service is
//      mocked so a non-2xx can come ONLY from the guard chain (requireManagerOrAdmin runs before the
//      body validator, so a denied role is 401/403 regardless of body).

// ── (A) isAllocatedTutor predicate ───────────────────────────────────────────────────────────────
vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));

import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { isAllocatedTutor } from '@api/middlewares/guards';

const mockedIsAllocated = vi.mocked(isTutorAllocatedToLearner);

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const manager: Actor = { authenticated: true, userId: 'u-manager', role: 'MANAGER', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const anon: Actor = { authenticated: false, reason: 'anonymous' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAllocatedTutor — DB-backed, TUTOR-only', () => {
  it('TUTOR allocated to the learner → true (reads the allocation table)', async () => {
    mockedIsAllocated.mockResolvedValue(true);
    expect(await isAllocatedTutor(tutor, 'u-learner')).toBe(true);
    expect(mockedIsAllocated).toHaveBeenCalledWith('u-tutor', 'u-learner');
  });

  it('TUTOR NOT allocated → false', async () => {
    mockedIsAllocated.mockResolvedValue(false);
    expect(await isAllocatedTutor(tutor, 'u-learner')).toBe(false);
  });

  it('non-TUTOR roles never allocated — no table read (admin/manager/learner/anon → false)', async () => {
    expect(await isAllocatedTutor(admin, 'u-learner')).toBe(false);
    expect(await isAllocatedTutor(manager, 'u-learner')).toBe(false);
    expect(await isAllocatedTutor(learner, 'u-learner')).toBe(false);
    expect(await isAllocatedTutor(anon, 'u-learner')).toBe(false);
    expect(mockedIsAllocated).not.toHaveBeenCalled();
  });

  it('null/undefined learner id → false (no widening), no table read', async () => {
    expect(await isAllocatedTutor(tutor, null)).toBe(false);
    expect(await isAllocatedTutor(tutor, undefined)).toBe(false);
    expect(mockedIsAllocated).not.toHaveBeenCalled();
  });
});

// ── (B) allocationsRouter — Manager/Admin only ───────────────────────────────────────────────────
vi.mock('@api/services/organization/allocation', () => ({
  listOrgAllocations: vi.fn(async () => []),
  getAssignablePeople: vi.fn(async () => ({ tutors: [], learners: [] })),
  createTutorAllocation: vi.fn(async () => ({ id: 'a-new' })),
  removeTutorAllocation: vi.fn(async () => ({ id: 'a-1' }))
}));

import { allocationsRouter } from '@api/routes/organization/allocations';

const ACTORS: Record<string, Actor> = { anon, learner, tutor, manager, admin };

const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    const key = c.req.header('x-test-actor') ?? 'anon';
    c.set('actor', ACTORS[key] ?? anon);
    await next();
  })
  .route('/organization/allocations', allocationsRouter as unknown as Hono);

function req(method: string, path: string, actor: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'x-test-actor': actor, 'content-type': 'application/json', 'cio-org-id': ORG },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'GET', path: '/organization/allocations' },
  { method: 'GET', path: '/organization/allocations/assignable' },
  { method: 'POST', path: '/organization/allocations', body: { tutorId: UUID_A, learnerId: UUID_B } },
  { method: 'DELETE', path: `/organization/allocations/${UUID_C}` }
];

describe('allocationsRouter — Manager/Admin only', () => {
  for (const { method, path, body } of ROUTES) {
    it(`${method} ${path}: LEARNER/TUTOR → 403, anon → 401`, async () => {
      expect((await req(method, path, 'learner', body)).status).toBe(403);
      expect((await req(method, path, 'tutor', body)).status).toBe(403);
      expect((await req(method, path, 'anon', body)).status).toBe(401);
    });

    it(`${method} ${path}: MANAGER and ADMIN pass the guard (2xx)`, async () => {
      expect((await req(method, path, 'manager', body)).status).toBeLessThan(300);
      expect((await req(method, path, 'admin', body)).status).toBeLessThan(300);
    });
  }
});
