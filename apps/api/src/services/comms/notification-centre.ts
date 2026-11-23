import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { listAllocatedLearnerIdsByTutors } from '@cio/db/queries/allocation';
import {
  countUnreadNotifications,
  getLessonLinkTargets,
  getProfileNamesByIds,
  getThreadsByIds,
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

/** Everything the per-row wording needs, resolved once per page (see getNotificationCentre). */
interface EnrichContext {
  lessons: Map<string, { courseId: string; title: string | null }>;
  homePath: string;
  recipientId: string;
  /** profile id -> display name (batched). */
  names: Map<string, string | null>;
  /** message_thread id -> its two participants. */
  threads: Map<string, { tutorId: string; learnerId: string }>;
  /** Learners CURRENTLY allocated to the recipient tutor; null = recipient is not a tutor (Admin sees any name). */
  allowedLearners: Set<string> | null;
  /** Whether the recipient may be shown any learner name at all (tutor with allocation, or Admin). */
  mayNameLearners: boolean;
}

const suffixFor = (variant: string | null): string =>
  variant === 'draft' ? ' (Draft)' : variant === 'final' ? ' (Final)' : '';

function enrich(row: NotificationRow, ctx: EnrichContext): NotificationItem {
  const { lessons, homePath } = ctx;
  const base = { id: row.id, type: row.type, createdAt: row.createdAt, read: row.readAt != null };
  const lesson = row.entityType === 'lesson' && row.entityId ? lessons.get(row.entityId) : undefined;
  const lessonTitle = lesson?.title ?? 'a session';
  const lessonLink = lesson ? `/courses/${lesson.courseId}/lessons/${row.entityId}` : homePath;

  switch (row.type) {
    case 'submission.created': {
      // Named + deep-linked ONLY when the actor learner is CURRENTLY allocated to the recipient (privacy rule);
      // old rows (no actor), de-allocated learners and forged actor ids all fall back to the generic text.
      const learnerId = row.actorId;
      const learnerName = learnerId ? ctx.names.get(learnerId) : null;
      const permitted =
        !!learnerId &&
        !!learnerName &&
        !!row.entityId &&
        (ctx.allowedLearners ? ctx.allowedLearners.has(learnerId) : ctx.mayNameLearners);
      if (permitted) {
        return {
          ...base,
          subject: `${learnerName} submitted ${lessonTitle}${suffixFor(row.variant)}`,
          link: `/caseload/${learnerId}#unit-${row.entityId}`
        };
      }
      return { ...base, subject: `New coursework submitted — ${lessonTitle}`, link: '/caseload' };
    }
    case 'result.recorded': {
      const markerName = row.actorId ? ctx.names.get(row.actorId) : null;
      if (markerName) {
        return {
          ...base,
          subject:
            row.variant === 'draft'
              ? `${markerName} gave feedback on your draft — ${lessonTitle}`
              : `${markerName} marked ${lessonTitle}`,
          link: lessonLink
        };
      }
      return { ...base, subject: `Your coursework was marked — ${lessonTitle}`, link: lessonLink };
    }
    case 'session.unlocked':
      return { ...base, subject: `New session unlocked — ${lessonTitle}`, link: lessonLink };
    case 'announcement.published':
      // The broadcast banner lives on the recipient's dashboard — a tutor's is /caseload, a learner's /lms.
      return { ...base, subject: 'New announcement', link: homePath };
    case 'message.received': {
      // Deep-link straight to the thread (entityId is the message_thread id) — the /messages/:threadId route is
      // role-agnostic (participant/Admin enforced server-side), so it works for the tutor and the learner.
      // The sender is derived from the THREAD (the other participant), never from actor_id, so it also works for
      // rows written before actor tracking and cannot be spoofed.
      const thread = row.entityId ? ctx.threads.get(row.entityId) : undefined;
      const senderId = thread
        ? ctx.recipientId === thread.tutorId
          ? thread.learnerId
          : ctx.recipientId === thread.learnerId
            ? thread.tutorId
            : null
        : null;
      // Same privacy rule as submissions: a TUTOR is shown a learner's name only while that learner is still
      // allocated to them (old messages from a since-moved learner fall back to "New message").
      const senderAllowed =
        !!senderId &&
        !(thread && ctx.recipientId === thread.tutorId && ctx.allowedLearners && !ctx.allowedLearners.has(senderId));
      const senderName = senderId && senderAllowed ? ctx.names.get(senderId) : null;
      return {
        ...base,
        subject: senderName ? `New message from ${senderName}` : 'New message',
        link: row.entityId ? `/messages/${row.entityId}` : homePath
      };
    }
    default:
      return { ...base, subject: 'Notification', link: homePath };
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
  const threadIds = [
    ...new Set(rows.filter((r) => r.type === 'message.received' && r.entityId).map((r) => r.entityId as string))
  ];
  // PRIVACY GATE: a tutor's current allocation set decides every learner name shown to them — submission actors AND
  // message senders. Keep BOTH row types here: dropping message rows would leak a moved learner's name.
  const needsAllocationGate = rows.some(
    (r) => (r.type === 'submission.created' && r.actorId) || (r.type === 'message.received' && r.entityId)
  );
  const [lessons, threadRows, allocation] = await Promise.all([
    getLessonLinkTargets(lessonIds),
    getThreadsByIds(threadIds),
    actor.role === 'TUTOR' && needsAllocationGate
      ? listAllocatedLearnerIdsByTutors([actor.userId])
      : Promise.resolve(null)
  ]);
  const threads = new Map(threadRows.map((t) => [t.id, { tutorId: t.tutorId, learnerId: t.learnerId }]));
  const allowedLearners = allocation ? new Set(allocation.get(actor.userId) ?? []) : null;

  // ONE batched name lookup for every person the page mentions (submitting learner / marker / thread sender).
  const nameIds = new Set<string>();
  for (const r of rows) {
    if (r.type === 'message.received' && r.entityId) {
      const t = threads.get(r.entityId);
      if (t) nameIds.add(actor.userId === t.tutorId ? t.learnerId : t.tutorId);
    } else if (r.actorId && (r.type === 'submission.created' || r.type === 'result.recorded')) {
      nameIds.add(r.actorId);
    }
  }
  const names = new Map((await getProfileNamesByIds([...nameIds])).map((p) => [p.id, p.name]));

  // The recipient's home dashboard — where their broadcast banner + feed live (tutor → /caseload, else /lms).
  const homePath = actor.role === 'TUTOR' ? '/caseload' : '/lms';

  const ctx: EnrichContext = {
    lessons,
    homePath,
    recipientId: actor.userId,
    names,
    threads,
    allowedLearners,
    // A tutor is named-only via the allocation set; an Admin may see any name; nobody else is ever shown one.
    mayNameLearners: actor.role === 'ADMIN'
  };
  return { items: rows.map((r) => enrich(r, ctx)), unreadCount };
}

/** Just the actor's own unread count — the cheap background poll for the bell badge (no list, no enrichment). */
export async function getOwnUnreadCount(actor: Actor): Promise<{ unreadCount: number }> {
  assertAuthed(actor);
  return { unreadCount: await countUnreadNotifications(actor.userId) };
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
