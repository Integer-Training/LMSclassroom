import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from '@cio/utils/constants';
import { getMyTutor, getThreadView, markThreadRead, openThread, sendMessage } from '@api/services/comms/messaging';

// PearlLMS Phase 6 Step 4 — allocation-bound messaging. Every route is requireActor; participant/allocation/
// archived rules are enforced in the service (isAllocatedTutor / participant / not-archived). TEXT ONLY: the
// send body is a bounded string — there is no file field anywhere. Mounted at /messages.
const ZOpen = z.object({ counterpartId: z.string().uuid() });
const ZSend = z.object({ body: z.string().min(1).max(MESSAGE_MAX_LENGTH) });
const ZThreadParam = z.object({ threadId: z.string().uuid() });

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
  .get('/threads/:threadId', requireActor(), zValidator('param', ZThreadParam), async (c) => {
    try {
      const { threadId } = c.req.valid('param');
      const data = await getThreadView(c.get('actor') as Actor, threadId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load conversation');
    }
  })
  // Send a text message (participant of an active, still-allocated pair only).
  .post(
    '/threads/:threadId/messages',
    requireActor(),
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
