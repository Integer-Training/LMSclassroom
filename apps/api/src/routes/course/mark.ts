import { Hono } from '@api/utils/hono';
import { requireMarkingAccess } from '@api/middlewares/guards';
import { getGradebook } from '@api/services/mark/gradebook';
import { getMarks } from '@api/services/mark';
import { handleError } from '@api/utils/errors';

// Marking surfaces expose every learner's grades for the whole course, so they are gated by
// requireMarkingAccess (ADMIN; an allocated TUTOR once Phase 3 lands — denied until then). This
// closes the ACCESS.md "gradebook allows students" gap: courseMemberMiddleware let any enrolled
// learner pull the entire class's marks.
export const markRouter = new Hono()
  .get('/gradebook', requireMarkingAccess(), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const gradebook = await getGradebook(courseId);
      return c.json({ success: true, data: gradebook }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to get gradebook');
    }
  })
  .get('/', requireMarkingAccess(), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const marks = await getMarks(courseId);

      return c.json({ success: true, data: marks }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to get marks');
    }
  });
