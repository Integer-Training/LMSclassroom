import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';
import {
  requireActor,
  requireAdmin,
  requireManagerOrAdmin,
  requireMarkingAccess,
  requireSameOrg,
  requireSelfParam,
  requireStaff
} from '@api/middlewares/guards';

// Guard-layer matrix tests. A synthetic Hono app mounts the REAL guards that ship, with a
// test-only middleware that injects the exact Actor shape resolveActor() produces for each fixture
// role (this IS "authenticating as each fixture role", deterministically — no DB, no session).
// Asserted from the docs/ACCESS.md target matrix.

const ORG = 'org-1';
const ACTORS: Record<string, Actor> = {
  anonymous: { authenticated: false, reason: 'anonymous' },
  deactivated: { authenticated: false, reason: 'deactivated', userId: 'u-deact' },
  learnerA: { authenticated: true, userId: 'learner-A', role: 'LEARNER', status: 'ACTIVE', orgId: ORG },
  learnerB: { authenticated: true, userId: 'learner-B', role: 'LEARNER', status: 'ACTIVE', orgId: ORG },
  tutor: { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG },
  manager: { authenticated: true, userId: 'u-manager', role: 'MANAGER', status: 'ACTIVE', orgId: ORG },
  admin: { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG },
  adminOrg2: { authenticated: true, userId: 'u-admin2', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-2' }
};

let app: Hono<AuthSession>;

beforeAll(() => {
  app = new Hono<AuthSession>()
    // actor injector — stands in for the app.ts session→resolveActor middleware
    .use('*', async (c, next) => {
      const key = c.req.header('x-test-actor') ?? 'anonymous';
      c.set('actor', ACTORS[key] ?? ACTORS.anonymous);
      await next();
    })
    .get('/need-actor', requireActor(), (c) => c.json({ ok: true }))
    .get('/admin-only', requireAdmin, (c) => c.json({ ok: true }))
    .get('/staff', requireStaff, (c) => c.json({ ok: true }))
    .get('/manager-admin', requireManagerOrAdmin, (c) => c.json({ ok: true }))
    .get('/marking', requireMarkingAccess(), (c) => c.json({ ok: true }))
    .get('/self/:userId', requireSelfParam('userId'), (c) => c.json({ ok: true }))
    .get('/org-scoped', requireSameOrg(), (c) => c.json({ ok: true }));
});

const as = (actor: string, path: string, extraHeaders: Record<string, string> = {}) =>
  app.request(path, { headers: { 'x-test-actor': actor, ...extraHeaders } });

const AUTHED_ROUTES = ['/need-actor', '/admin-only', '/staff', '/manager-admin', '/marking'];

describe('anonymous & deactivated → 401 on every authenticated endpoint', () => {
  for (const who of ['anonymous', 'deactivated']) {
    for (const route of AUTHED_ROUTES) {
      it(`${who} → ${route} = 401`, async () => {
        expect((await as(who, route)).status).toBe(401);
      });
    }
  }
});

describe('each role → allowed endpoints (2xx) and forbidden groups (403)', () => {
  it('LEARNER: own surface ok; every staff/admin surface 403', async () => {
    expect((await as('learnerA', '/need-actor')).status).toBe(200);
    expect((await as('learnerA', '/admin-only')).status).toBe(403);
    expect((await as('learnerA', '/staff')).status).toBe(403);
    expect((await as('learnerA', '/manager-admin')).status).toBe(403);
    expect((await as('learnerA', '/marking')).status).toBe(403);
  });

  it('TUTOR: staff ok; admin/user-mgmt/manager surfaces 403; marking denied (no allocation in P1)', async () => {
    expect((await as('tutor', '/need-actor')).status).toBe(200);
    expect((await as('tutor', '/staff')).status).toBe(200);
    expect((await as('tutor', '/admin-only')).status).toBe(403);
    expect((await as('tutor', '/manager-admin')).status).toBe(403);
    expect((await as('tutor', '/marking')).status).toBe(403);
  });

  it('MANAGER: provider-wide ok; config/user-mgmt(admin) and staff-only surfaces 403', async () => {
    expect((await as('manager', '/need-actor')).status).toBe(200);
    expect((await as('manager', '/manager-admin')).status).toBe(200);
    expect((await as('manager', '/admin-only')).status).toBe(403);
    expect((await as('manager', '/staff')).status).toBe(403);
    expect((await as('manager', '/marking')).status).toBe(403);
  });

  it('ADMIN: everything', async () => {
    for (const route of AUTHED_ROUTES) {
      expect((await as('admin', route)).status).toBe(200);
    }
  });
});

describe('ownership: learner A cannot reach learner B; client id never widens', () => {
  it('learner A → /self/learner-A = 200, → /self/learner-B = 403', async () => {
    expect((await as('learnerA', '/self/learner-A')).status).toBe(200);
    expect((await as('learnerA', '/self/learner-B')).status).toBe(403);
  });
  it('learner B → /self/learner-A = 403 (symmetric)', async () => {
    expect((await as('learnerB', '/self/learner-A')).status).toBe(403);
  });
});

describe('org scope: a client-supplied org id cannot pull another org', () => {
  it('matching org claim (header) passes', async () => {
    expect((await as('admin', '/org-scoped', { 'cio-org-id': ORG })).status).toBe(200);
    expect((await as('admin', '/org-scoped')).status).toBe(200); // no claim → scoped to actor.orgId
  });
  it('mismatched ?orgId is 403 even when the header matches (closes the ?orgId hole)', async () => {
    expect((await as('admin', '/org-scoped?orgId=org-2', { 'cio-org-id': ORG })).status).toBe(403);
  });
  it('an org-2 admin cannot claim org-1 via header', async () => {
    expect((await as('adminOrg2', '/org-scoped', { 'cio-org-id': ORG })).status).toBe(403);
  });
});
