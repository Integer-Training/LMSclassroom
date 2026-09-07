import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { authMiddleware } from '@api/middlewares/auth';
import { getLearnerAssignments } from '@api/services/lms/assignments';

// PearlLMS — learner-self LMS surfaces (mounted at /lms). Self-scoped: every endpoint derives the learner
// from the authenticated actor, never a param, so a caller only ever sees their own data.
export const lmsRouter = new Hono()
  // The learner's assessments (workbooks / case studies / assignments) across all their enrolled courses,
  // each with its state, due date and (under sequential unlock) lock status.
  .get('/assignments', authMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getLearnerAssignments(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load assignments');
    }
  });
