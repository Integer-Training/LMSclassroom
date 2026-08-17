import { ZCaseloadLearnerParam, ZMarkSubmission, ZSubmissionIdParam } from '@cio/utils/validation/coursework';
import { getCaseloadLearnerDetail, getTutorCaseload } from '@api/services/caseload/caseload';
import { recordResult } from '@api/services/coursework/marking';

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
  })
  // Record a result + feedback on a submission version (Step 5). requireStaff gates ADMIN/TUTOR at the
  // route; recordResult additionally requires an ALLOCATED tutor (or Admin) and enforces latest-only /
  // no-re-mark. Manager and Learner are denied.
  .post(
    '/submissions/:submissionId/result',
    requireStaff,
    zValidator('param', ZSubmissionIdParam),
    zValidator('json', ZMarkSubmission),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const { submissionId } = c.req.valid('param');
        const { result, feedback } = c.req.valid('json');
        const data = await recordResult(actor, submissionId, { result, feedback });
        return c.json({ success: true, data }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to record result');
      }
    }
  );
