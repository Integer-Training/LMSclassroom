import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// PearlLMS scalability Phase C4 — the per-request identity middleware: a DB failure while resolving the session or
// the Actor must answer 503 + Retry-After and NEVER fall through to anonymous (401), and the rest of the request
// must run inside the per-request memo scope.

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActor: vi.fn(),
  scopes: 0
}));

vi.mock('@cio/db/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@cio/db/actor', () => ({
  resolveActor: mocks.resolveActor,
  ANONYMOUS_ACTOR: { authenticated: false, reason: 'anonymous' }
}));
vi.mock('@cio/db/request-memo', () => ({
  runWithRequestMemo: (fn: () => unknown) => {
    mocks.scopes += 1;

    return fn();
  }
}));
vi.mock('@api/middlewares/cors', () => ({ isPublicCorsPath: (p: string) => p.startsWith('/public') }));
vi.mock('@sentry/node', () => ({ setUser: vi.fn() }));

import { identityMiddleware } from '@api/middlewares/identity';

const build = () =>
  new Hono()
    .use('*', identityMiddleware())
    .get('/x', (c) => c.json({ actor: c.get('actor' as never), user: c.get('user' as never) }))
    .get('/public/y', (c) => c.json({ actor: c.get('actor' as never) }));

const ADMIN_ACTOR = { authenticated: true, userId: 'u1', role: 'ADMIN', status: 'ACTIVE', orgId: 'o1' };

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.resolveActor.mockReset();
  mocks.scopes = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('identityMiddleware', () => {
  it('runs the request inside one memo scope and sets the fresh actor', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's' }, orgRoles: { o1: 1 } });
    mocks.resolveActor.mockResolvedValue(ADMIN_ACTOR);

    const res = await build().request('/x', { headers: { 'cio-org-id': 'o1' } });

    expect(res.status).toBe(200);
    expect((await res.json()).actor).toEqual(ADMIN_ACTOR);
    expect(mocks.scopes).toBe(1);
    expect(mocks.resolveActor).toHaveBeenCalledWith('u1', 'o1');
  });

  it('no session -> anonymous actor, request continues', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await build().request('/x');

    expect(res.status).toBe(200);
    expect((await res.json()).actor).toEqual({ authenticated: false, reason: 'anonymous' });
    expect(mocks.resolveActor).not.toHaveBeenCalled();
  });

  it('getSession DB error -> 503 + Retry-After (not anonymous / 401)', async () => {
    mocks.getSession.mockRejectedValue(new Error('connection terminated'));

    const res = await build().request('/x');

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect((await res.json()).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('resolveActor DB error -> 503 + Retry-After (not 401)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's' } });
    mocks.resolveActor.mockRejectedValue(new Error('connection terminated'));

    const res = await build().request('/x');

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(401);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('public CORS paths skip the session entirely (anonymous)', async () => {
    const res = await build().request('/public/y');

    expect(res.status).toBe(200);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.scopes).toBe(0);
  });
});
