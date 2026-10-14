import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { authMiddleware } from '@api/middlewares/auth';
import { requireActor } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { ZTutorFeedbackSubmit } from '@cio/utils/validation/tutor-feedback';
import { getLearnerAssignments } from '@api/services/lms/assignments';
import { getLearnerDashboard } from '@api/services/lms/dashboard';
import { getTutorFeedbackStatus, submitTutorFeedback } from '@api/services/lms/tutor-feedback';

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
  })
  // The learner HOME summary — KPIs, progress, tutor, draft feedbacks, upcoming due dates, course
  // progression, recent messages and study-hours. One aggregate call for the whole dashboard.
  .get('/dashboard', authMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getLearnerDashboard(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load dashboard');
    }
  })
  // Is periodic tutor feedback due for the calling learner? (the every-N-units popup). Returns the due
  // milestone + the tutor it is about, or nulls when nothing is due.
  .get('/tutor-feedback', authMiddleware, requireActor(), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getTutorFeedbackStatus(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load tutor feedback status');
    }
  })
  // Submit the learner's tutor feedback. Milestone + tutor are derived server-side; one per milestone (409).
  .post('/tutor-feedback', authMiddleware, requireActor(), zValidator('json', ZTutorFeedbackSubmit), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await submitTutorFeedback(actor, c.req.valid('json'));
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to submit tutor feedback');
    }
  });
