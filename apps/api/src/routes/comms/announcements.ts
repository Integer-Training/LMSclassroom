import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireActor, requireAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  archiveAnnouncement,
  deleteAnnouncement,
  listAnnouncementCourses,
  listAnnouncementLearners,
  listAnnouncements,
  listAnnouncementTutors,
  listCourseAnnouncements,
  publishAnnouncement
} from '@api/services/comms/announcements';

// PearlLMS broadcasts. Compose + manage (publish / archive / delete / audience pickers) is ADMIN-ONLY
// (Manager/Tutor/Learner denied). Reads of the feed are requireActor + server-side scoping in the service
// (a learner sees all_learners + enrolled courses' + broadcasts targeted at them; a tutor sees tutor-addressed).
// Mounted at /announcements.
const ZPublish = z.object({
  audienceType: z.enum(['all_learners', 'all_tutors', 'course', 'learner', 'tutor']),
  courseId: z.string().uuid().nullable().optional(),
  targetUserId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000)
});
const ZCourseParam = z.object({ courseId: z.string().uuid() });
const ZIdParam = z.object({ id: z.string().uuid() });
const ZArchive = z.object({ archived: z.boolean() });

export const announcementsRouter = new Hono()
  // The actor's feed (admin → all org [manage]; tutor → tutor-addressed; learner → scoped).
  .get('/', requireActor(), async (c) => {
    try {
      const data = await listAnnouncements(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load announcements');
    }
  })
  // Published courses for the compose audience selector (Admin). Static path before /course/:courseId.
  .get('/courses', requireAdmin, async (c) => {
    try {
      const data = await listAnnouncementCourses(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load courses');
    }
  })
  // Tutors for the compose audience selector (Admin).
  .get('/tutors', requireAdmin, async (c) => {
    try {
      const data = await listAnnouncementTutors(c.get('actor') as Actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load tutors');
    }
  })
  // Learner search for the "specific learner" audience selector (Admin).
  .get('/learners', requireAdmin, zValidator('query', z.object({ search: z.string().optional() })), async (c) => {
    try {
      const { search } = c.req.valid('query');
      const data = await listAnnouncementLearners(c.get('actor') as Actor, search ?? '');
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learners');
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
  // Publish a broadcast (Admin only). Emits announcement.published + audits.
  .post('/', requireAdmin, zValidator('json', ZPublish), async (c) => {
    try {
      const input = c.req.valid('json');
      const data = await publishAnnouncement(c.get('actor') as Actor, {
        audienceType: input.audienceType,
        courseId: input.courseId ?? null,
        targetUserId: input.targetUserId ?? null,
        title: input.title,
        body: input.body
      });
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to publish broadcast');
    }
  })
  // Archive / unarchive a broadcast (Admin only). Archived broadcasts leave recipient feeds.
  .post('/:id/archive', requireAdmin, zValidator('param', ZIdParam), zValidator('json', ZArchive), async (c) => {
    try {
      const { id } = c.req.valid('param');
      const { archived } = c.req.valid('json');
      const data = await archiveAnnouncement(c.get('actor') as Actor, id, archived);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to update broadcast');
    }
  })
  // Soft-delete a broadcast sent by mistake (Admin only).
  .delete('/:id', requireAdmin, zValidator('param', ZIdParam), async (c) => {
    try {
      const { id } = c.req.valid('param');
      const data = await deleteAnnouncement(c.get('actor') as Actor, id);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to delete broadcast');
    }
  });
