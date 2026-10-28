import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, MESSAGE_SEND_RATE_LIMIT } from '@cio/utils/constants';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import {
  getMyTutor,
  getThreadView,
  listConversations,
  markThreadRead,
  openThread,
  sendMessage
} from '@api/services/comms/messaging';

// PearlLMS Phase 6 Step 4 — allocation-bound messaging. Every route is requireActor; participant/allocation/
// archived rules are enforced in the service (isAllocatedTutor / participant / not-archived). TEXT ONLY: the
// send body is a bounded string — there is no file field anywhere. Mounted at /messages.
const ZOpen = z.object({ counterpartId: z.string().uuid() });
const ZSend = z.object({ body: z.string().min(1).max(MESSAGE_MAX_LENGTH) });
const ZThreadParam = z.object({ threadId: z.string().uuid() });
// History paging: newest page by default; `before` (a message createdAt) pages back. Page size is capped at 100.
const ZThreadQuery = z.object({
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

// Per-user send cap (30/min), keyed by user id — never a shared pool. Prod-only like every limiter; runs after
// requireActor so the key is the authenticated user. Bounds a scripted/buggy client spamming a counterpart.
const sendRateLimit = createRateLimiter({
  windowMs: MESSAGE_SEND_RATE_LIMIT.windowMs,
  maxRequests: MESSAGE_SEND_RATE_LIMIT.maxPerWindow,
  message: 'You are sending messages too quickly. Please wait a moment.',
  keyGenerator: (c) => `message-send:${(c.get('actor') as Actor).userId}`
});

export const messagesRouter = new Hono()
  // Learner convenience: their allocated tutor (or null → the empty state).
  .get('/my-tutor', requireActor(), async (c) => {
    try {
      const tutor = await getMyTutor(c.get('actor') as Actor);
      return c.json({ success: true, data: { tutor } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load tutor');
    }
  })
  // The actor's conversation list (inbox) — tutor sees their learners, learner sees their tutors.
  .get('/threads', requireActor(), async (c) => {
    try {
      const data = await listConversations(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load conversations');
    }
  })
  // Open/ensure the thread for an allocated pair (both sides). Returns the full view.
  .post('/open', requireActor(), zValidator('json', ZOpen), async (c) => {
    try {
      const { counterpartId } = c.req.valid('json');
      const data = await openThread(c.get('actor') as Actor, counterpartId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to open conversation');
    }
  })
  // View a thread by id — participant or Admin (D2). Advances the participant's read cursor.
  .get(
    '/threads/:threadId',
    requireActor(),
    zValidator('param', ZThreadParam),
    zValidator('query', ZThreadQuery),
    async (c) => {
      try {
        const { threadId } = c.req.valid('param');
        const data = await getThreadView(c.get('actor') as Actor, threadId, c.req.valid('query'));
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load conversation');
      }
    }
  )
  // Send a text message (participant of an active, still-allocated pair only).
  .post(
    '/threads/:threadId/messages',
    requireActor(),
    sendRateLimit,
    zValidator('param', ZThreadParam),
    zValidator('json', ZSend),
    async (c) => {
      try {
        const { threadId } = c.req.valid('param');
        const { body } = c.req.valid('json');
        const data = await sendMessage(c.get('actor') as Actor, threadId, body);
        return c.json({ success: true, data }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to send message');
      }
    }
  )
  // Mark a thread read (participant).
  .post('/threads/:threadId/read', requireActor(), zValidator('param', ZThreadParam), async (c) => {
    try {
      const { threadId } = c.req.valid('param');
      await markThreadRead(c.get('actor') as Actor, threadId);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to mark read');
    }
  });
