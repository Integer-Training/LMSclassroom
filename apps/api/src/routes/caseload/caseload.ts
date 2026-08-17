import { ZCaseloadLearnerParam } from '@cio/utils/validation/coursework';
import { getCaseloadLearnerDetail, getTutorCaseload } from '@api/services/caseload/caseload';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireStaff } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';

// Tutor caseload (PearlLMS Phase 3 Step 4) — read-only. requireStaff = ADMIN or TUTOR across the board
// (Manager and Learner denied; Manager gets reports in Phase 5). The roster is allocation-sourced in the
// service, and learner-detail re-checks isAllocatedTutor so a tutor cannot open another tutor's learner
// by id. Mounted at /caseload.
export const caseloadRouter = new Hono()
  .get('/', requireStaff, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getTutorCaseload(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load caseload');
    }
  })
  .get('/learners/:learnerId', requireStaff, zValidator('param', ZCaseloadLearnerParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { learnerId } = c.req.valid('param');
      const data = await getCaseloadLearnerDetail(actor, learnerId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learner');
    }
  });
