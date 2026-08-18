import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import {
  countUnreadNotifications,
  getLessonLinkTargets,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow
} from '@cio/db/queries/comms';

// PearlLMS Phase 6 Step 3 — the in-app notification centre service. STRICTLY self-only: every read/mutation
// uses the ACTOR's own id (taken from the resolved session, never from the URL) — there is no way to name
// another user. Each row is enriched with a subject line + a deep link resolved from its type + entity; the
// link is a CONVENIENCE — the target surface's own guards are the access control, not the link.

export interface NotificationItem {
  id: string;
  type: string;
  subject: string;
  link: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationCentre {
  items: NotificationItem[];
  unreadCount: number;
}

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

function enrich(
  row: NotificationRow,
  lessons: Map<string, { courseId: string; title: string | null }>
): NotificationItem {
  const base = { id: row.id, type: row.type, createdAt: row.createdAt, read: row.readAt != null };
  const lesson = row.entityType === 'lesson' && row.entityId ? lessons.get(row.entityId) : undefined;
  const lessonTitle = lesson?.title ?? 'a session';
  const lessonLink = lesson ? `/courses/${lesson.courseId}/lessons/${row.entityId}` : '/lms';

  switch (row.type) {
    case 'submission.created':
      // Tutor: goes to the caseload / awaiting-marking queue (the tutor's guarded surface).
      return { ...base, subject: `New coursework submitted — ${lessonTitle}`, link: '/caseload' };
    case 'result.recorded':
      return { ...base, subject: `Your coursework was marked — ${lessonTitle}`, link: lessonLink };
    case 'session.unlocked':
      return { ...base, subject: `New session unlocked — ${lessonTitle}`, link: lessonLink };
    case 'announcement.published':
      return { ...base, subject: 'New announcement', link: '/lms' }; // Step 5 refines the target
    case 'message.received':
      return { ...base, subject: 'New message', link: '/lms' }; // Step 4 refines the target
    default:
      return { ...base, subject: 'Notification', link: '/lms' };
  }
}

/** The actor's own notifications (newest first) + their unread count. Self-only. */
export async function getNotificationCentre(
  actor: Actor,
  opts: { limit?: number; offset?: number } = {}
): Promise<NotificationCentre> {
  assertAuthed(actor);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = await listNotificationsForUser(actor.userId, { limit, offset });
  const unreadCount = await countUnreadNotifications(actor.userId);

  const lessonIds = [
    ...new Set(rows.filter((r) => r.entityType === 'lesson' && r.entityId).map((r) => r.entityId as string))
  ];
  const lessons = await getLessonLinkTargets(lessonIds);

  return { items: rows.map((r) => enrich(r, lessons)), unreadCount };
}

/** Mark ONE of the actor's own notifications read — scoped to actor.userId (a foreign id affects nothing). */
export async function markOwnNotificationRead(actor: Actor, notificationId: string): Promise<{ marked: number }> {
  assertAuthed(actor);
  return { marked: await markNotificationRead(notificationId, actor.userId) };
}

/** Mark ALL of the actor's own notifications read. */
export async function markAllOwnNotificationsRead(actor: Actor): Promise<{ marked: number }> {
  assertAuthed(actor);
  return { marked: await markAllNotificationsRead(actor.userId) };
}
