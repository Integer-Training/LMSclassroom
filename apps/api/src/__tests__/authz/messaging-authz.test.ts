import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 4 — the messaging routes require an authenticated actor; the participant/allocation
// rules live in the service (proven in messaging.test.ts + the live harness). Here: anon → 401; the send
// route only accepts a bounded text body (text-only). Service mocked.

vi.mock('@api/services/comms/messaging', () => ({
  getMyTutor: vi.fn(async () => null),
  openThread: vi.fn(async () => ({ threadId: 'th1' })),
  getThreadView: vi.fn(async () => ({ threadId: 'th1', messages: [] })),
  sendMessage: vi.fn(async () => ({ id: 'm1', mine: true })),
  markThreadRead: vi.fn(async () => {})
}));

import { messagesRouter } from '@api/routes/comms/messages';

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  tutor: A('t1', 'TUTOR'),
  learner: A('lA', 'LEARNER'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/messages', messagesRouter);

const TH = '11111111-1111-4111-8111-111111111111';
const CP = '22222222-2222-4222-8222-222222222222';

beforeEach(() => vi.clearAllMocks());

describe('messaging routes — authed only', () => {
  it('authed reaches the routes', async () => {
    expect((await app.request('/messages/my-tutor', { headers: { 'x-actor': 'learner' } })).status).toBe(200);
    expect(
      (
        await app.request('/messages/open', {
          method: 'POST',
          headers: { 'x-actor': 'learner', 'content-type': 'application/json' },
          body: JSON.stringify({ counterpartId: CP })
        })
      ).status
    ).toBe(200);
    expect((await app.request(`/messages/threads/${TH}`, { headers: { 'x-actor': 'tutor' } })).status).toBe(200);
    expect(
      (
        await app.request(`/messages/threads/${TH}/messages`, {
          method: 'POST',
          headers: { 'x-actor': 'tutor', 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'hi' })
        })
      ).status
    ).toBe(201);
  });

  it('anonymous → 401 on every route', async () => {
    expect((await app.request('/messages/my-tutor')).status).toBe(401);
    expect((await app.request(`/messages/threads/${TH}`)).status).toBe(401);
    expect(
      (
        await app.request('/messages/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ counterpartId: CP })
        })
      ).status
    ).toBe(401);
  });

  it('text-only: a non-string / oversized body is rejected by the validator (400)', async () => {
    const huge = 'a'.repeat(5000);
    expect(
      (
        await app.request(`/messages/threads/${TH}/messages`, {
          method: 'POST',
          headers: { 'x-actor': 'tutor', 'content-type': 'application/json' },
          body: JSON.stringify({ body: huge })
        })
      ).status
    ).toBe(400);
    // no attachments field is even accepted — body must be a string
    expect(
      (
        await app.request(`/messages/threads/${TH}/messages`, {
          method: 'POST',
          headers: { 'x-actor': 'tutor', 'content-type': 'application/json' },
          body: JSON.stringify({ body: { file: 'x' } })
        })
      ).status
    ).toBe(400);
  });
});
