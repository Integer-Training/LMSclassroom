import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { isRole } from '@cio/utils/auth';
import {
  getAnnouncementById,
  getEnrolledLearnerIds,
  getOrgLearnerIds,
  insertAnnouncement,
  listAnnouncementsForCourse,
  listAnnouncementsForLearner,
  listAnnouncementsForOrg,
  type AnnouncementRow
} from '@cio/db/queries/comms';
import {
  getCourseEnrolmentTarget,
  listPublishedCoursesForOrg,
  type OnboardingCourse
} from '@cio/db/queries/onboarding';
import { isEnrolledLearner } from '@api/middlewares/guards';
import { getOrganizationById } from '@cio/db/queries/organization';
import { emitNotification } from '@api/services/comms/notify';
import { buildEmailBranding } from '@cio/email';
import { getAppBaseUrl } from '@cio/core/config/dashboard-url';

// PearlLMS Phase 6 Step 5 — announcements (docs/COMMS-MODEL.md §4, D1). POST is Admin/Manager only (Tutor
// does NOT broadcast — a course announcement reaches ALL enrolled learners, not just a tutor's allocated
// ones; a tutor's channel is messaging). Visibility is server-scoped: a learner sees provider-wide + their
// enrolled published courses' announcements. Publish-immediate — no drafts, no scheduling. On publish, the
// scoped recipients get announcement.published through the ONE framework (in-app always; email only if the
// recipient opted the announcement category IN — default OFF); the publish is audited (id + scope only).

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

export interface AnnouncementItem {
  id: string;
  courseId: string | null;
  scope: 'course' | 'provider-wide';
  title: string;
  body: string;
  publishedAt: string;
}

function toItem(row: AnnouncementRow): AnnouncementItem {
  return {
    id: row.id,
    courseId: row.courseId,
    scope: row.courseId ? 'course' : 'provider-wide',
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt
  };
}

export interface PublishAnnouncementInput {
  courseId: string | null; // null = provider-wide
  title: string;
  body: string;
}

/** Publish an announcement (Admin/Manager only). Emits announcement.published to the scoped recipients + audits. */
export async function publishAnnouncement(actor: Actor, input: PublishAnnouncementInput): Promise<AnnouncementItem> {
  assertAuthed(actor);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) {
    throw new AppError('Only an admin or manager can publish announcements', ErrorCodes.FORBIDDEN, 403);
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new AppError('A title is required', ErrorCodes.VALIDATION_ERROR, 400, 'title');
  if (!body) throw new AppError('A message is required', ErrorCodes.VALIDATION_ERROR, 400, 'body');

  // Course scope must be a published course in the actor's org.
  if (input.courseId) {
    const target = await getCourseEnrolmentTarget(input.courseId);
    if (!target || target.orgId !== actor.orgId) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
    if (!target.isPublished) {
      throw new AppError('You can only announce to a published course', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
    }
  }

  const row = await insertAnnouncement({
    organizationId: actor.orgId,
    authorId: actor.userId,
    courseId: input.courseId,
    title,
    body
  });

  // Notify the scoped recipients — enrolled learners (course) or all org learners (provider-wide). In-app
  // always; email only if the recipient opted the announcement category in (default OFF). Fire-and-forget.
  try {
    const recipientIds = input.courseId
      ? await getEnrolledLearnerIds(input.courseId)
      : await getOrgLearnerIds(actor.orgId);
    if (recipientIds.length > 0) {
      const org = await getOrganizationById(actor.orgId);
      const emailFields = {
        announcementsUrl: `${getAppBaseUrl()}/lms`,
        branding: buildEmailBranding({ name: org?.name ?? '', avatarUrl: org?.avatarUrl, theme: org?.theme })
      };
      await emitNotification({
        type: 'announcement.published',
        recipients: recipientIds.map((userId) => ({ userId, emailFields })),
        entityType: 'announcement',
        entityId: row.id,
        emailTemplateId: 'announcementPublished'
      });
    }
  } catch (error) {
    console.error('[announcements] notification failed (announcement still published):', error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    entityType: 'announcement',
    entityId: row.id,
    metadata: { announcementId: row.id, scope: input.courseId ? 'course' : 'provider-wide', courseId: input.courseId }
  });

  return toItem(row);
}

/** The actor's announcement feed: staff → all org announcements; learner → provider-wide + enrolled courses'. */
export async function listAnnouncements(actor: Actor): Promise<AnnouncementItem[]> {
  assertAuthed(actor);
  const rows = isRole(actor, 'ADMIN', 'MANAGER', 'TUTOR')
    ? await listAnnouncementsForOrg(actor.orgId)
    : await listAnnouncementsForLearner(actor.orgId, actor.userId);
  return rows.map(toItem);
}

/** A course's announcements — an enrolled learner (of a published course) or staff. */
export async function listCourseAnnouncements(actor: Actor, courseId: string): Promise<AnnouncementItem[]> {
  assertAuthed(actor);
  const isStaff = isRole(actor, 'ADMIN', 'MANAGER', 'TUTOR');
  if (!isStaff && !(await isEnrolledLearner(actor, courseId))) {
    throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
  }
  const rows = await listAnnouncementsForCourse(courseId);
  return rows.map(toItem);
}

/** Published courses in the actor's org — the compose scope selector (Admin/Manager). */
export async function listAnnouncementCourses(actor: Actor): Promise<OnboardingCourse[]> {
  assertAuthed(actor);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) {
    throw new AppError('Only an admin or manager can compose announcements', ErrorCodes.FORBIDDEN, 403);
  }
  return listPublishedCoursesForOrg(actor.orgId);
}

/** For the compose form — a single announcement by id, scoped to the actor's org (staff). */
export async function getAnnouncement(actor: Actor, id: string): Promise<AnnouncementItem> {
  assertAuthed(actor);
  const row = await getAnnouncementById(id);
  if (!row || row.organizationId !== actor.orgId)
    throw new AppError('Announcement not found', ErrorCodes.NOT_FOUND, 404);
  return toItem(row);
}
