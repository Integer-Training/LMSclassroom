import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';
import { MESSAGE_SEND_RATE_LIMIT } from '@cio/utils/constants';

// Phase E (messages-oldest-200) — the thread route returns the NEWEST page, accepts a validated `before` cursor
// (page size capped at 100), and the send route sits behind a per-user 30/min limiter.

vi.mock('@api/services/comms/messaging', () => ({
  getMyTutor: vi.fn(),
  getThreadView: vi.fn(async () => ({ threadId: 't', messages: [], hasMore: false })),
  listConversations: vi.fn(),
  markThreadRead: vi.fn(),
  openThread: vi.fn(),
  sendMessage: vi.fn(async () => ({ id: 'm' }))
}));

import { getThreadView } from '@api/services/comms/messaging';
import { messagesRouter } from '@api/routes/comms/messages';

const learner: Actor = { authenticated: true, userId: 'u-l', role: 'LEARNER', status: 'ACTIVE', orgId: 'o1' };
const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', learner);
    await next();
  })
  .route('/messages', messagesRouter as unknown as Hono);

const TH = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('GET /messages/threads/:threadId paging', () => {
  it('defaults to the newest page (no cursor)', async () => {
    const res = await app.request(`/messages/threads/${TH}`);
    expect(res.status).toBe(200);
    expect(getThreadView).toHaveBeenCalledWith(learner, TH, {});
  });

  it('forwards a valid before cursor (postgres timestamptz string) and limit', async () => {
    const before = encodeURIComponent('2026-10-28 11:22:33.123456+00');
    const res = await app.request(`/messages/threads/${TH}?before=${before}&limit=50`);
    expect(res.status).toBe(200);
    expect(getThreadView).toHaveBeenCalledWith(learner, TH, { before: '2026-10-28 11:22:33.123456+00', limit: 50 });
  });

  it('rejects limit > 100 and a malformed cursor', async () => {
    expect((await app.request(`/messages/threads/${TH}?limit=101`)).status).toBe(400);
    const bad = encodeURIComponent('x; drop table message;--');
    expect((await app.request(`/messages/threads/${TH}?before=${bad}`)).status).toBe(400);
    expect(getThreadView).not.toHaveBeenCalled();
  });
});

describe('send limiter config', () => {
  it('is 30 messages per minute per user', () => {
    expect(MESSAGE_SEND_RATE_LIMIT).toEqual({ windowMs: 60_000, maxPerWindow: 30 });
  });
});
