import { Hono } from '@api/utils/hono';
import { ZAttendanceUpsert } from '@cio/utils/validation/attendance';
import { requireStaff } from '@api/middlewares/guards';
import { handleError } from '@api/utils/errors';
import { upsertAttendanceService } from '@api/services/attendance';
import { zValidator } from '@hono/zod-validator';

// Recording attendance is a staff action. courseMemberMiddleware let any enrolled STUDENT upsert an
// arbitrary attendance body (ACCESS.md gap J) — now ADMIN/TUTOR only.
export const attendanceRouter = new Hono().post('/', requireStaff, zValidator('json', ZAttendanceUpsert), async (c) => {
  try {
    const data = c.req.valid('json');
    const attendance = await upsertAttendanceService(data);

    return c.json({ success: true, data: attendance }, 201);
  } catch (error) {
    return handleError(c, error, 'Failed to upsert attendance');
  }
});
