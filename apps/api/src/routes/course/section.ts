import { Hono } from '@api/utils/hono';
import { requireAdmin } from '@api/middlewares/guards';
import { handleError } from '@api/utils/errors';
import {
  createCourseSection,
  deleteCourseSectionService,
  promoteUngroupedSection,
  reorderCourseSections,
  updateCourseSectionService
} from '@cio/core/services/course/section';
import {
  ZCourseSectionCreate,
  ZCourseSectionGetParam,
  ZCourseSectionPromoteUngrouped,
  ZCourseSectionReorder,
  ZCourseSectionUpdate
} from '@cio/utils/validation/course';
import { zValidator } from '@hono/zod-validator';

export const sectionRouter = new Hono()
  .post('/', requireAdmin, zValidator('json', ZCourseSectionCreate), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      const section = await createCourseSection(courseId, { ...data, courseId });

      return c.json({ success: true, data: section }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create course section');
    }
  })
  .post('/promote-ungrouped', requireAdmin, zValidator('json', ZCourseSectionPromoteUngrouped), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      const result = await promoteUngroupedSection(courseId, data);

      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to promote ungrouped section');
    }
  })
  .put(
    '/:sectionId',
    requireAdmin,
    zValidator('param', ZCourseSectionGetParam),
    zValidator('json', ZCourseSectionUpdate),
    async (c) => {
      try {
        const { sectionId } = c.req.valid('param');
        const data = c.req.valid('json');

        const section = await updateCourseSectionService(sectionId, data);

        return c.json({ success: true, data: section }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update course section');
      }
    }
  )
  .delete('/:sectionId', requireAdmin, zValidator('param', ZCourseSectionGetParam), async (c) => {
    try {
      const { sectionId } = c.req.valid('param');
      const section = await deleteCourseSectionService(sectionId);

      return c.json({ success: true, data: section }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to delete course section');
    }
  })
  .post('/reorder', requireAdmin, zValidator('json', ZCourseSectionReorder), async (c) => {
    try {
      const { sections } = c.req.valid('json');

      const updated = await reorderCourseSections(sections);

      return c.json({ success: true, data: updated }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to reorder course sections');
    }
  });
