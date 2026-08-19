/**
 * Notification framework config (PearlLMS Phase 6). The single CONFIG source for the comms centre — the DB
 * `notification.type` and `notification_preference.category` columns are plain varchars whose allowed set
 * lives HERE (not a Postgres enum requiring a migration to extend), mirroring UNIT_TYPES / RESULT_VALUES.
 *
 * See docs/COMMS-MODEL.md §1 (event catalogue) + §4 (config). Every event always writes an in-app
 * notification; email is sent only when the recipient's per-category preference is on (these defaults when
 * no preference row exists).
 */

/** The notification event types (docs/COMMS-MODEL.md §1; Phase-7 adds registration.submitted). */
export const NOTIFICATION_TYPES = [
  'submission.created',
  'result.recorded',
  'message.received',
  'announcement.published',
  'session.unlocked',
  'registration.submitted'
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isAllowedNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Preference categories — email toggles are per-category, not per-type. */
export const NOTIFICATION_CATEGORIES = ['coursework', 'messaging', 'announcement', 'session', 'registration'] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isAllowedNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** Which category each event type belongs to (drives the email preference lookup). */
export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  'submission.created': 'coursework',
  'result.recorded': 'coursework',
  'message.received': 'messaging',
  'announcement.published': 'announcement',
  'session.unlocked': 'session',
  'registration.submitted': 'registration'
};

export function categoryForNotificationType(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TYPE_CATEGORY[type];
}

/**
 * Per-category email default when the recipient has NO preference row (docs/COMMS-MODEL.md D3, owner-confirmed):
 * coursework + messaging emails ON, announcement + session emails OFF (in-app always fires regardless).
 */
export const NOTIFICATION_EMAIL_DEFAULTS: Record<NotificationCategory, boolean> = {
  coursework: true,
  messaging: true,
  announcement: false,
  session: false,
  // PearlLMS Phase 7 — a new learner registration is staff-actionable, so managers/admins get the email by
  // default (in-app always fires regardless). The applicant is never notified (docs/ONBOARDING-MODEL.md D1).
  registration: true
};

export function emailDefaultForCategory(category: NotificationCategory): boolean {
  return NOTIFICATION_EMAIL_DEFAULTS[category];
}

/** Human labels for the per-category email toggles on the settings surface (single config source). */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  coursework: 'Coursework — submissions & feedback',
  messaging: 'Messages from your tutor',
  announcement: 'Announcements',
  session: 'New sessions unlocked',
  registration: 'New learner registrations'
};

/**
 * Coalescing backstop window for per-thread message emails (docs/COMMS-MODEL.md D3): while a thread already
 * has an unread message notification newer than this window, a further message does not re-email (in-app
 * still fires). Past the window, an email is sent again even if still unread — so a learner who never opens
 * the app is not silenced forever.
 */
export const NOTIFICATION_COALESCE_WINDOW_MS = 30 * 60 * 1000;

/** Max length of a single message body (docs/COMMS-MODEL.md §8 — messages are TEXT ONLY, no attachments). */
export const MESSAGE_MAX_LENGTH = 4000;
