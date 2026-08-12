import {
  ZSubmissionAnswerUpdate,
  ZSubmissionGetParam,
  ZSubmissionGradesUpdate,
  ZSubmissionUpdate
} from '@cio/utils/validation/submission';
import {
  deleteSubmissionService,
  listSubmissionsForGrading,
  updateSubmissionAnswer,
  updateSubmissionGradesBatch,
  updateSubmissionService
} from '@api/services/submission';

import { Hono } from '@api/utils/hono';
import { bindSubmissionToCourse, requireMarkingAccess } from '@api/middlewares/guards';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

// Marking/grading is ADMIN-only in Phase 1 (an allocated TUTOR once Phase 3 lands — denied until
// then), and every :submissionId route additionally binds the submission to the path :courseId so a
// staff member of one course cannot grade/read/delete another course's submission (ACCESS.md gap A).

export const submissionRouter = new Hono()
  .get('/for-grading', requireMarkingAccess(), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = await listSubmissionsForGrading(courseId);

      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list submissions for grading');
    }
  })
  .put(
    '/:submissionId',
    requireMarkingAccess(),
    bindSubmissionToCourse,
    zValidator('param', ZSubmissionGetParam),
    zValidator('json', ZSubmissionUpdate),
    async (c) => {
      try {
        const { submissionId } = c.req.valid('param');
        const data = c.req.valid('json');

        const submission = await updateSubmissionService(submissionId, data);

        return c.json({ success: true, data: submission }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update submission');
      }
    }
  )
  .delete(
    '/:submissionId',
    requireMarkingAccess(),
    bindSubmissionToCourse,
    zValidator('param', ZSubmissionGetParam),
    async (c) => {
      try {
        const { submissionId } = c.req.valid('param');
        const submission = await deleteSubmissionService(submissionId);

        return c.json({ success: true, data: submission }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to delete submission');
      }
    }
  )
  .put(
    '/:submissionId/answer',
    requireMarkingAccess(),
    bindSubmissionToCourse,
    zValidator('param', ZSubmissionGetParam),
    zValidator('json', ZSubmissionAnswerUpdate),
    async (c) => {
      try {
        const { submissionId } = c.req.valid('param');
        const { questionId, ...data } = c.req.valid('json');

        const answer = await updateSubmissionAnswer(submissionId, questionId, { questionId, ...data });

        return c.json({ success: true, data: answer }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update submission answer');
      }
    }
  )
  .put(
    '/:submissionId/grades',
    requireMarkingAccess(),
    bindSubmissionToCourse,
    zValidator('param', ZSubmissionGetParam),
    zValidator('json', ZSubmissionGradesUpdate),
    async (c) => {
      try {
        const { submissionId } = c.req.valid('param');
        const data = c.req.valid('json');

        const submission = await updateSubmissionGradesBatch(submissionId, data);

        return c.json({ success: true, data: submission }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update submission grades');
      }
    }
  );
