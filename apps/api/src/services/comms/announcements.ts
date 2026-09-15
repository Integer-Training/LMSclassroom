import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { isRole } from '@cio/utils/auth';
import {
  getAnnouncementById,
  getCourseTitlesByIds,
  getEnrolledLearnerIds,
  getOrgLearnerIds,
  getOrgTutorIds,
  getProfileNamesByIds,
  insertAnnouncement,
  listAnnouncementsForCourse,
  listAnnouncementsForLearner,
  listAnnouncementsForOrg,
  listAnnouncementsForTutor,
  listOrgTutors,
  setAnnouncementArchived,
  softDeleteAnnouncement,
  type AnnouncementAudience,
  type AnnouncementRow,
  type OrgTutorOption
} from '@cio/db/queries/comms';
import { getOrgMemberRoleId, listLearnersForTutor } from '@cio/db/queries/allocation';
import { searchOrgAudience } from '@cio/db/queries/audience';
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

// PearlLMS broadcast system (docs/COMMS-MODEL.md §4). Compose + manage is ADMIN-ONLY (Manager/Tutor/Learner
// denied). A broadcast's `audienceType` decides recipients: all_learners | all_tutors | course | learner |
// tutor. Visibility is server-scoped in the query layer (a learner never sees another learner's targeted
// broadcast). Publish-immediate — no drafts/scheduling. On publish, the scoped recipients get
// announcement.published through the ONE notification framework (in-app always; email only if opted in). An
// admin can archive (hide from recipients, keep in history) or soft-delete a broadcast sent by mistake.

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

function assertAdmin(actor: Extract<Actor, { authenticated: true }>): void {
  if (!isRole(actor, 'ADMIN')) {
    throw new AppError('Only an admin can broadcast', ErrorCodes.FORBIDDEN, 403);
  }
}

const AUDIENCE_TYPES: AnnouncementAudience[] = ['all_learners', 'all_tutors', 'course', 'learner', 'tutor'];

export interface AnnouncementItem {
  id: string;
  audienceType: AnnouncementAudience;
  courseId: string | null;
  targetUserId: string | null;
  /** Resolved display label for the target (course title / learner or tutor name) — admin manage view only. */
  targetLabel: string | null;
  title: string;
  body: string;
  publishedAt: string;
  archived: boolean;
}

function toItem(row: AnnouncementRow, targetLabel: string | null = null): AnnouncementItem {
  return {
    id: row.id,
    audienceType: (row.audienceType as AnnouncementAudience) ?? 'all_learners',
    courseId: row.courseId,
    targetUserId: row.targetUserId,
    targetLabel,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt,
    archived: !!row.archivedAt
  };
}

/** Enrich a set of rows with human labels for their course / user targets (admin manage list). */
async function toItemsWithLabels(rows: AnnouncementRow[]): Promise<AnnouncementItem[]> {
  const courseIds = [...new Set(rows.filter((r) => r.audienceType === 'course' && r.courseId).map((r) => r.courseId!))];
  const userIds = [
    ...new Set(
      rows
        .filter((r) => (r.audienceType === 'learner' || r.audienceType === 'tutor') && r.targetUserId)
        .map((r) => r.targetUserId!)
    )
  ];
  const [courseTitles, profileNames] = await Promise.all([
    getCourseTitlesByIds(courseIds),
    getProfileNamesByIds(userIds)
  ]);
  const courseMap = new Map(courseTitles.map((c) => [c.id, c.title]));
  const nameMap = new Map(profileNames.map((p) => [p.id, p.name]));
  return rows.map((row) => {
    let label: string | null = null;
    if (row.audienceType === 'course' && row.courseId) label = courseMap.get(row.courseId) ?? 'Course';
    else if ((row.audienceType === 'learner' || row.audienceType === 'tutor') && row.targetUserId)
      label = nameMap.get(row.targetUserId) ?? 'User';
    return toItem(row, label);
  });
}

export interface PublishAnnouncementInput {
  audienceType: AnnouncementAudience;
  courseId: string | null; // required when audienceType === 'course'
  targetUserId: string | null; // required when audienceType === 'learner' | 'tutor'
  title: string;
  body: string;
}

/** Resolve the recipient learner/tutor ids for a validated broadcast. */
async function resolveRecipients(
  actor: Extract<Actor, { authenticated: true }>,
  input: PublishAnnouncementInput
): Promise<string[]> {
  switch (input.audienceType) {
    case 'all_learners':
      return getOrgLearnerIds(actor.orgId);
    case 'all_tutors':
      return getOrgTutorIds(actor.orgId);
    case 'course':
      return getEnrolledLearnerIds(input.courseId!);
    case 'learner':
      return [input.targetUserId!];
    case 'tutor':
      return (await listLearnersForTutor(input.targetUserId!)).map((l) => l.learnerId);
    default:
      return [];
  }
}

/** Publish a broadcast (Admin only). Validates the target, emits announcement.published, audits. */
export async function publishAnnouncement(actor: Actor, input: PublishAnnouncementInput): Promise<AnnouncementItem> {
  assertAuthed(actor);
  assertAdmin(actor);

  if (!AUDIENCE_TYPES.includes(input.audienceType)) {
    throw new AppError('Invalid audience', ErrorCodes.VALIDATION_ERROR, 400, 'audienceType');
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new AppError('A title is required', ErrorCodes.VALIDATION_ERROR, 400, 'title');
  if (!body) throw new AppError('A message is required', ErrorCodes.VALIDATION_ERROR, 400, 'body');

  let courseId: string | null = null;
  let targetUserId: string | null = null;

  if (input.audienceType === 'course') {
    if (!input.courseId) throw new AppError('Select a course', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
    const target = await getCourseEnrolmentTarget(input.courseId);
    if (!target || target.orgId !== actor.orgId) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
    if (!target.isPublished) {
      throw new AppError('You can only broadcast to a published course', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
    }
    courseId = input.courseId;
  } else if (input.audienceType === 'learner') {
    if (!input.targetUserId) throw new AppError('Select a learner', ErrorCodes.VALIDATION_ERROR, 400, 'targetUserId');
    const roleId = await getOrgMemberRoleId(actor.orgId, input.targetUserId);
    if (roleId !== 3) throw new AppError('Learner not found', ErrorCodes.NOT_FOUND, 404, 'targetUserId');
    targetUserId = input.targetUserId;
  } else if (input.audienceType === 'tutor') {
    if (!input.targetUserId) throw new AppError('Select a tutor', ErrorCodes.VALIDATION_ERROR, 400, 'targetUserId');
    const roleId = await getOrgMemberRoleId(actor.orgId, input.targetUserId);
    if (roleId !== 2) throw new AppError('Tutor not found', ErrorCodes.NOT_FOUND, 404, 'targetUserId');
    targetUserId = input.targetUserId;
  }

  const row = await insertAnnouncement({
    organizationId: actor.orgId,
    authorId: actor.userId,
    audienceType: input.audienceType,
    courseId,
    targetUserId,
    title,
    body
  });

  // Notify the scoped recipients. In-app always; email only if the recipient opted the announcement category
  // in (default OFF). Fire-and-forget — a notification failure must not fail the publish.
  try {
    const recipientIds = await resolveRecipients(actor, { ...input, courseId, targetUserId });
    const unique = [...new Set(recipientIds)];
    if (unique.length > 0) {
      const org = await getOrganizationById(actor.orgId);
      const emailFields = {
        announcementsUrl: `${getAppBaseUrl()}/lms`,
        branding: buildEmailBranding({ name: org?.name ?? '', avatarUrl: org?.avatarUrl, theme: org?.theme })
      };
      await emitNotification({
        type: 'announcement.published',
        recipients: unique.map((userId) => ({ userId, emailFields })),
        entityType: 'announcement',
        entityId: row.id,
        emailTemplateId: 'announcementPublished'
      });
    }
  } catch (error) {
    console.error('[announcements] notification failed (broadcast still published):', error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    entityType: 'announcement',
    entityId: row.id,
    metadata: { announcementId: row.id, audienceType: input.audienceType, courseId, targetUserId }
  });

  return toItem(row);
}

/** The actor's feed: admin → all org broadcasts (manage, with labels + archived); tutor → tutor-addressed;
 *  learner → all_learners + enrolled courses' + directly-targeted + their tutor's group. */
export async function listAnnouncements(actor: Actor): Promise<AnnouncementItem[]> {
  assertAuthed(actor);
  if (isRole(actor, 'ADMIN')) {
    return toItemsWithLabels(await listAnnouncementsForOrg(actor.orgId));
  }
  if (isRole(actor, 'TUTOR')) {
    return (await listAnnouncementsForTutor(actor.orgId, actor.userId)).map((r) => toItem(r));
  }
  return (await listAnnouncementsForLearner(actor.orgId, actor.userId)).map((r) => toItem(r));
}

/** A course's live announcements — an enrolled learner (of a published course) or staff. */
export async function listCourseAnnouncements(actor: Actor, courseId: string): Promise<AnnouncementItem[]> {
  assertAuthed(actor);
  const isStaff = isRole(actor, 'ADMIN', 'MANAGER', 'TUTOR');
  if (!isStaff && !(await isEnrolledLearner(actor, courseId))) {
    throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
  }
  return (await listAnnouncementsForCourse(courseId)).map((r) => toItem(r));
}

/** Published courses in the actor's org — the compose scope selector (Admin). */
export async function listAnnouncementCourses(actor: Actor): Promise<OnboardingCourse[]> {
  assertAuthed(actor);
  assertAdmin(actor);
  return listPublishedCoursesForOrg(actor.orgId);
}

/** The org's tutors — the compose audience picker (Admin). */
export async function listAnnouncementTutors(actor: Actor): Promise<OrgTutorOption[]> {
  assertAuthed(actor);
  assertAdmin(actor);
  return listOrgTutors(actor.orgId);
}

export interface AnnouncementLearnerOption {
  id: string;
  name: string;
  email: string;
}

/** Search the org's learners for the "specific learner" audience picker (Admin). */
export async function listAnnouncementLearners(actor: Actor, search: string): Promise<AnnouncementLearnerOption[]> {
  assertAuthed(actor);
  assertAdmin(actor);
  const rows = await searchOrgAudience(actor.orgId, search ?? '', 20);
  return rows
    .filter((r): r is typeof r & { profileId: string } => !!r.profileId)
    .map((r) => ({ id: r.profileId, name: r.name, email: r.email }));
}

/** Archive / unarchive a broadcast (Admin). Archived broadcasts disappear from recipient feeds. */
export async function archiveAnnouncement(actor: Actor, id: string, archived: boolean): Promise<AnnouncementItem> {
  assertAuthed(actor);
  assertAdmin(actor);
  const row = await setAnnouncementArchived(id, actor.orgId, archived);
  if (!row) throw new AppError('Broadcast not found', ErrorCodes.NOT_FOUND, 404);
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_ARCHIVED,
    entityType: 'announcement',
    entityId: row.id,
    metadata: { announcementId: row.id, archived }
  });
  return toItem(row);
}

/** Soft-delete a broadcast sent by mistake (Admin). Removed from everyone; row retained (deleted_at). */
export async function deleteAnnouncement(actor: Actor, id: string): Promise<{ id: string }> {
  assertAuthed(actor);
  assertAdmin(actor);
  const row = await softDeleteAnnouncement(id, actor.orgId);
  if (!row) throw new AppError('Broadcast not found', ErrorCodes.NOT_FOUND, 404);
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_DELETED,
    entityType: 'announcement',
    entityId: row.id,
    metadata: { announcementId: row.id, deleted: true }
  });
  return { id: row.id };
}

/** For the compose form — a single announcement by id, scoped to the actor's org (Admin). */
export async function getAnnouncement(actor: Actor, id: string): Promise<AnnouncementItem> {
  assertAuthed(actor);
  assertAdmin(actor);
  const row = await getAnnouncementById(id);
  if (!row || row.organizationId !== actor.orgId || row.deletedAt)
    throw new AppError('Announcement not found', ErrorCodes.NOT_FOUND, 404);
  return toItem(row);
}
