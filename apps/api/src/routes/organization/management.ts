import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createLearner,
  createTutor,
  getLearnerManagement,
  getTutorManagement
} from '@api/services/organization/management';
import { resetUserPassword } from '@api/services/organization/users';
import { listPublishedCoursesForOrg } from '@cio/db/queries/onboarding';
import { listOrgTutors } from '@cio/db/queries/comms';

// Admin Learner-/Tutor-management. All endpoints requireAdmin (the services also assert ADMIN). Mounted at
// /organization/management.
const ZName = z.string().trim().min(1).max(100);
const ZCreateLearner = z.object({
  firstName: ZName,
  lastName: ZName,
  email: z.string().email(),
  courseId: z.string().uuid().nullable().optional(),
  tutorId: z.string().uuid().nullable().optional()
});
const ZCreateTutor = z.object({ firstName: ZName, lastName: ZName, email: z.string().email() });
const ZMemberParam = z.object({ memberId: z.coerce.number().int().positive() });

export const managementRouter = new Hono()
  .get('/learners', requireAdmin, async (c) => {
    try {
      const data = await getLearnerManagement(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learners');
    }
  })
  .get('/tutors', requireAdmin, async (c) => {
    try {
      const data = await getTutorManagement(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load tutors');
    }
  })
  // Course + tutor options for the Create-Learner form.
  .get('/options', requireAdmin, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const orgId = actor.authenticated ? actor.orgId : '';
      const [courses, tutors] = await Promise.all([listPublishedCoursesForOrg(orgId), listOrgTutors(orgId)]);
      return c.json({ success: true, data: { courses, tutors } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load options');
    }
  })
  .post('/learners', requireAdmin, zValidator('json', ZCreateLearner), async (c) => {
    try {
      const data = await createLearner(c.get('actor') as Actor, c.req.valid('json'));
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create learner');
    }
  })
  .post('/tutors', requireAdmin, zValidator('json', ZCreateTutor), async (c) => {
    try {
      const data = await createTutor(c.get('actor') as Actor, c.req.valid('json'));
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create tutor');
    }
  })
  // "Send login" — regenerate a temp password + reveal it (email delivery is dormant).
  .post('/members/:memberId/reset-password', requireAdmin, zValidator('param', ZMemberParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      if (!actor.authenticated) return c.json({ success: false }, 401);
      const { memberId } = c.req.valid('param');
      const data = await resetUserPassword(actor.orgId, actor, memberId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to reset password');
    }
  });
