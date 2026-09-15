import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { setCookie, setSignedCookie } from 'hono/cookie';
import {
  createLearner,
  createTutor,
  getLearnerManagement,
  getTutorManagement,
  startImpersonation
} from '@api/services/organization/management';
import { resetUserPassword } from '@api/services/organization/users';
import { getOrgProgression, getProgressionDetail } from '@api/services/progression/progression';
import { listPublishedCoursesForOrg } from '@cio/db/queries/onboarding';
import { listOrgTutors } from '@cio/db/queries/comms';

// Secret for signing the "return to admin" cookie (tamper-proof so a non-admin can't forge it).
const IMP_COOKIE_SECRET = process.env.BETTER_AUTH_SECRET ?? 'insecure-dev-secret-change-me';
function loginLinkPath(token: string): string {
  return `/api/auth/login-link?token=${encodeURIComponent(token)}&redirect=/`;
}

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
  // Org-wide learner progression (admin). Same shape as the tutor /caseload/progression.
  .get(
    '/progression',
    requireAdmin,
    zValidator('query', z.object({ courseId: z.string().uuid().optional() })),
    async (c) => {
      try {
        const { courseId } = c.req.valid('query');
        const data = await getOrgProgression(c.get('actor') as Actor, courseId);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load progression');
      }
    }
  )
  .get(
    '/progression/:learnerId',
    requireAdmin,
    zValidator('param', z.object({ learnerId: z.string().uuid() })),
    async (c) => {
      try {
        const { learnerId } = c.req.valid('param');
        const data = await getProgressionDetail(c.get('actor') as Actor, learnerId);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load learner progression');
      }
    }
  )
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
  })
  // "Login as" — impersonate a learner/tutor. Sets a signed cookie remembering the admin (for return), a
  // readable flag cookie (drives the "you are impersonating" banner), and returns a login-link path the
  // client navigates to. Only a learner/tutor can be impersonated (enforced in the service).
  .post('/members/:memberId/login-as', requireAdmin, zValidator('param', ZMemberParam), async (c) => {
    try {
      const { memberId } = c.req.valid('param');
      const { token, adminUserId, adminEmail, targetName } = await startImpersonation(
        c.get('actor') as Actor,
        memberId
      );
      await setSignedCookie(c, 'imp_admin', JSON.stringify({ adminUserId, adminEmail }), IMP_COOKIE_SECRET, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60
      });
      setCookie(c, 'impersonating', targetName ? encodeURIComponent(targetName) : '1', {
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60
      });
      return c.json({ success: true, data: { loginLinkPath: loginLinkPath(token) } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to start impersonation');
    }
  });
