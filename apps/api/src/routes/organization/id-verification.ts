import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ID_VERIFICATION_STATUS, ID_VERIFICATION_METHODS } from '@cio/utils/constants';
import {
  getMyIdVerification,
  getLearnerIdVerification,
  recordIdVerification
} from '@api/services/registration/id-verification';

// PearlLMS Phase 7 Step 4 — ID-verification routes (docs/ONBOARDING-MODEL.md §8). requireActor at the boundary;
// the service enforces the real access rule (Manager/Admin OR the learner's allocated Tutor for staff reads +
// records; self-only for /me). NO document/file field exists anywhere. Mounted at /organization/id-verification
// (before the /:orgId param route so it isn't captured as an orgId).
const ZLearnerParam = z.object({ learnerId: z.string().uuid() });
const ZRecord = z.object({
  status: z.enum(ID_VERIFICATION_STATUS),
  method: z.enum(ID_VERIFICATION_METHODS).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable()
});

export const idVerificationRouter = new Hono()
  // The requesting learner's OWN status (informational, self-only) — used by the id-check unit tie-in.
  .get('/me', requireActor(), async (c) => {
    try {
      const data = await getMyIdVerification(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load ID verification status');
    }
  })
  // Staff view of a learner's full record (Manager/Admin or the allocated Tutor — enforced in the service).
  .get('/learner/:learnerId', requireActor(), zValidator('param', ZLearnerParam), async (c) => {
    try {
      const { learnerId } = c.req.valid('param');
      const data = await getLearnerIdVerification(c.get('actor') as Actor, learnerId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load ID verification');
    }
  })
  // Record (upsert) a learner's ID verification. Manager/Admin or the allocated Tutor.
  .put(
    '/learner/:learnerId',
    requireActor(),
    zValidator('param', ZLearnerParam),
    zValidator('json', ZRecord),
    async (c) => {
      try {
        const { learnerId } = c.req.valid('param');
        const { status, method, note } = c.req.valid('json');
        const data = await recordIdVerification(c.get('actor') as Actor, learnerId, { status, method, note });
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to record ID verification');
      }
    }
  );
