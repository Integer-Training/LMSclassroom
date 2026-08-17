import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// PearlLMS Phase 3 Step 4 — caseload route guard, behavioral. Mount the REAL caseloadRouter with an
// injected fixture Actor; the service is mocked so a 2xx comes ONLY from the guard chain. Matrix: TUTOR
// and ADMIN allowed; LEARNER and MANAGER denied (403); anon 401.

vi.mock('@api/services/caseload/caseload', () => ({
  getTutorCaseload: vi.fn(async () => ({ learners: [], awaiting: [] })),
  getCaseloadLearnerDetail: vi.fn(async () => ({ learner: { id: 'u-L1', name: null, email: null }, courses: [] }))
}));

import { caseloadRouter } from '@api/routes/caseload/caseload';

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
  .route('/caseload', caseloadRouter as unknown as Hono);

const LEARNER_UUID = '11111111-1111-4111-8111-111111111111';
function req(path: string, actor: string) {
  return app.request(path, { method: 'GET', headers: { 'x-test-actor': actor } });
}

const ROUTES = ['/caseload', `/caseload/learners/${LEARNER_UUID}`];

describe('caseload routes — TUTOR/ADMIN only', () => {
  for (const path of ROUTES) {
    it(`GET ${path}: LEARNER/MANAGER → 403, anon → 401, TUTOR/ADMIN → 200`, async () => {
      expect((await req(path, 'learner')).status).toBe(403);
      expect((await req(path, 'manager')).status).toBe(403);
      expect((await req(path, 'anon')).status).toBe(401);
      expect((await req(path, 'tutor')).status).toBe(200);
      expect((await req(path, 'admin')).status).toBe(200);
    });
  }
});
