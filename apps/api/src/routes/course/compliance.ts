import {
  ZCourseComplianceExtend,
  ZCourseComplianceLearnerParam,
  ZCourseComplianceParam,
  ZCourseComplianceReset,
  ZCourseComplianceWaive
} from '@cio/utils/validation/course/compliance';
import {
  extendCourseCompliance,
  getCourseComplianceOverview,
  getLearnerComplianceHistory,
  resetCourseCompliance,
  waiveCourseCompliance
} from '@api/services/course/compliance';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseMemberMiddleware } from '@api/middlewares/course-member';
import { requireAdmin, requireCourseInOrg } from '@api/middlewares/guards';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

export const complianceRouter = new Hono()
  .get(
    '/',
    authMiddleware,
    requireAdmin,
    requireCourseInOrg(),
    zValidator('param', ZCourseComplianceParam),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const data = await getCourseComplianceOverview(courseId);

        return c.json(
          {
            success: true,
            data
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to fetch course compliance overview');
      }
    }
  )
  .get(
    '/learners/:profileId',
    authMiddleware,
    courseMemberMiddleware,
    requireCourseInOrg(),
    zValidator('param', ZCourseComplianceLearnerParam),
    async (c) => {
      try {
        const { courseId, profileId } = c.req.valid('param');
        const user = c.get('user')!;
        const data = await getLearnerComplianceHistory(courseId, user.id, profileId, c.get('actor') as Actor);

        return c.json(
          {
            success: true,
            data
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to fetch learner compliance history');
      }
    }
  )
  .post(
    '/reset',
    authMiddleware,
    requireAdmin,
    requireCourseInOrg(),
    zValidator('param', ZCourseComplianceParam),
    zValidator('json', ZCourseComplianceReset),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const payload = c.req.valid('json');
        const data = await resetCourseCompliance(courseId, payload);

        return c.json(
          {
            success: true,
            data
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to reset course compliance');
      }
    }
  )
  .post(
    '/extend',
    authMiddleware,
    requireAdmin,
    requireCourseInOrg(),
    zValidator('param', ZCourseComplianceParam),
    zValidator('json', ZCourseComplianceExtend),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const payload = c.req.valid('json');
        const data = await extendCourseCompliance(courseId, payload);

        return c.json(
          {
            success: true,
            data
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to extend course compliance');
      }
    }
  )
  .post(
    '/waive',
    authMiddleware,
    requireAdmin,
    requireCourseInOrg(),
    zValidator('param', ZCourseComplianceParam),
    zValidator('json', ZCourseComplianceWaive),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const payload = c.req.valid('json');
        const user = c.get('user')!;
        const data = await waiveCourseCompliance(courseId, user.id, payload);

        return c.json(
          {
            success: true,
            data
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to waive course compliance');
      }
    }
  );
