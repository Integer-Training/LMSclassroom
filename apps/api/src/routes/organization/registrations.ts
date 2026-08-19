import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireManagerOrAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { REGISTRATION_STATUS } from '@cio/utils/constants';
import {
  listRegistrationQueue,
  listApprovalCourses,
  getRegistrationDetail,
  approveRegistration,
  rejectRegistration
} from '@api/services/registration/decisions';

// PearlLMS Phase 7 Step 3 — the approval queue routes. Manager/Admin ONLY (requireManagerOrAdmin) on every
// load and action; Tutors + Learners are denied. Mounted at /organization/registrations (before the /:orgId
// param route so it is not captured as an orgId). All org scoping comes from the actor, never a URL value.
const ZListQuery = z.object({ status: z.enum(REGISTRATION_STATUS).optional() });
const ZIdParam = z.object({ id: z.string().uuid() });
const ZApprove = z.object({ courseId: z.string().uuid().optional().nullable() });
const ZReject = z.object({ note: z.string().trim().min(1, 'A note is required') });

export const registrationsRouter = new Hono()
  // The queue (oldest-first). ?status=pending|approved|rejected — default is the full list.
  .get('/', requireManagerOrAdmin, zValidator('query', ZListQuery), async (c) => {
    try {
      const { status } = c.req.valid('query');
      const data = await listRegistrationQueue(c.get('actor') as Actor, status);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load registrations');
    }
  })
  // Published courses for the approve selector. Registered BEFORE /:id so 'courses' isn't parsed as an id.
  .get('/courses', requireManagerOrAdmin, async (c) => {
    try {
      const data = await listApprovalCourses(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load courses');
    }
  })
  // Detail view for one application.
  .get('/:id', requireManagerOrAdmin, zValidator('param', ZIdParam), async (c) => {
    try {
      const { id } = c.req.valid('param');
      const data = await getRegistrationDetail(c.get('actor') as Actor, id);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load registration');
    }
  })
  // Approve → composes the Phase-5 onboarding service (user + enrolment + invite), transactional + race-safe.
  .post(
    '/:id/approve',
    requireManagerOrAdmin,
    zValidator('param', ZIdParam),
    zValidator('json', ZApprove),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const { courseId } = c.req.valid('json');
        const data = await approveRegistration(c.get('actor') as Actor, id, { courseId });
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to approve registration');
      }
    }
  )
  // Reject → status + required note + decided_by/at; audited; nothing created.
  .post('/:id/reject', requireManagerOrAdmin, zValidator('param', ZIdParam), zValidator('json', ZReject), async (c) => {
    try {
      const { id } = c.req.valid('param');
      const { note } = c.req.valid('json');
      const data = await rejectRegistration(c.get('actor') as Actor, id, { note });
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to reject registration');
    }
  });
