import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor, requireManagerOrAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  listAnnouncementCourses,
  listAnnouncements,
  listCourseAnnouncements,
  publishAnnouncement
} from '@api/services/comms/announcements';

// PearlLMS Phase 6 Step 5 — announcements. POST is requireManagerOrAdmin (Tutor + Learner denied — D1
// refined: tutors do not broadcast). Reads are requireActor + server-side scoping in the service (a learner
// sees provider-wide + their enrolled courses'). Mounted at /announcements.
const ZPublish = z.object({
  courseId: z.string().uuid().nullable(), // null = provider-wide
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000)
});
const ZCourseParam = z.object({ courseId: z.string().uuid() });

export const announcementsRouter = new Hono()
  // The actor's feed (staff → all org; learner → provider-wide + enrolled courses').
  .get('/', requireActor(), async (c) => {
    try {
      const data = await listAnnouncements(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load announcements');
    }
  })
  // Published courses for the compose scope selector (Admin/Manager). Static path before /course/:courseId.
  .get('/courses', requireManagerOrAdmin, async (c) => {
    try {
      const data = await listAnnouncementCourses(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load courses');
    }
  })
  // A course's announcements (enrolled learner or staff).
  .get('/course/:courseId', requireActor(), zValidator('param', ZCourseParam), async (c) => {
    try {
      const { courseId } = c.req.valid('param');
      const data = await listCourseAnnouncements(c.get('actor') as Actor, courseId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load course announcements');
    }
  })
  // Publish (Admin/Manager only). Emits announcement.published + audits.
  .post('/', requireManagerOrAdmin, zValidator('json', ZPublish), async (c) => {
    try {
      const data = await publishAnnouncement(c.get('actor') as Actor, c.req.valid('json'));
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to publish announcement');
    }
  });
