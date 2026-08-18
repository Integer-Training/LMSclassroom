import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getNotificationCentre,
  markAllOwnNotificationsRead,
  markOwnNotificationRead
} from '@api/services/comms/notification-centre';

// PearlLMS Phase 6 Step 3 — the in-app notification centre. STRICTLY self-only: every handler takes the
// actor from the resolved session (requireActor) and passes ONLY actor.userId to the service — there is no
// userId path/query anywhere, so one user can never read or mutate another's notifications. Mounted at
// /notifications.
const ZListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional()
});
const ZIdParam = z.object({ id: z.string().uuid() });

export const notificationsRouter = new Hono()
  // The actor's own notifications (newest first) + unread count.
  .get('/', requireActor(), zValidator('query', ZListQuery), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { limit, offset } = c.req.valid('query');
      const data = await getNotificationCentre(actor, { limit, offset });
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load notifications');
    }
  })
  // Mark all read — registered before /:id/read (distinct segment, but keep it explicit).
  .post('/read-all', requireActor(), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await markAllOwnNotificationsRead(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to mark all read');
    }
  })
  // Mark ONE read — scoped to the actor; a foreign id marks nothing.
  .post('/:id/read', requireActor(), zValidator('param', ZIdParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { id } = c.req.valid('param');
      const data = await markOwnNotificationRead(actor, id);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to mark read');
    }
  });
