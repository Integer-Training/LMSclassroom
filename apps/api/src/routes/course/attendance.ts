import { Hono } from '@api/utils/hono';
import { ZAttendanceUpsert } from '@cio/utils/validation/attendance';
import { forbidden, isAllocatedTutor, requireCourseInOrg, requireStaff } from '@api/middlewares/guards';
import { handleError } from '@api/utils/errors';
import { upsertAttendanceService } from '@api/services/attendance';
import { zValidator } from '@hono/zod-validator';
import type { Actor } from '@cio/db/actor';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import { getLessonById } from '@cio/db/queries/lesson';
import { getProfileByGroupMemberId } from '@cio/db/queries/course/people';

// Recording attendance is a staff action. courseMemberMiddleware let any enrolled STUDENT upsert an
// arbitrary attendance body (ACCESS.md gap J) — now ADMIN, or a TUTOR for a learner allocated to them.
// `studentId` is the learner's groupmember id. For everyone the body must target the PATH course and a lesson
// of it, and `studentId` must be enrolled in that course; a tutor's learner must additionally be allocated to them.
export const attendanceRouter = new Hono().post(
  '/',
  requireStaff,
  requireCourseInOrg(),
  zValidator('json', ZAttendanceUpsert),
  async (c) => {
    try {
      const data = c.req.valid('json');
      const actor = c.get('actor') as Actor;
      const pathCourseId = c.req.param('courseId');

      if (!pathCourseId || data.courseId !== pathCourseId) return forbidden(c);

      const lesson = await getLessonById(data.lessonId);
      if (!lesson || lesson.courseId !== pathCourseId) return forbidden(c);

      // Everyone: studentId must be a member of the PATH course. A tutor's learner must also be allocated.
      const learner = await getProfileByGroupMemberId(data.studentId);
      if (!learner) return forbidden(c);

      const enrolledMemberId = await getGroupMemberIdByCourseAndProfile(pathCourseId, learner.id);
      if (enrolledMemberId !== data.studentId) return forbidden(c);

      if (actor.authenticated && actor.role === 'TUTOR' && !(await isAllocatedTutor(actor, learner.id))) {
        return forbidden(c);
      }

      const attendance = await upsertAttendanceService(data);

      return c.json({ success: true, data: attendance }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to upsert attendance');
    }
  }
);
