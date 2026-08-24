import {
  categoryForNotificationType,
  emailDefaultForCategory,
  NOTIFICATION_COALESCE_WINDOW_MS,
  type NotificationCategory,
  type NotificationType
} from '@cio/utils/constants';
import { getNotificationPreference, hasRecentUnreadForEntity, insertNotification } from '@cio/db/queries/comms';
import { enqueueTransactionalEmail } from '@api/services/jobs';
import type { EmailId } from '@cio/email';

// PearlLMS Phase 6 — the ONE notification pipeline (docs/COMMS-MODEL.md §2). Every event flows through
// emitNotification: an in-app row is ALWAYS written per recipient; a content-light email is sent only when
// the recipient's per-category preference is on (config default when no row) and, for coalesced categories,
// not suppressed by the backstop window. The whole emit is best-effort and never throws to the caller — it
// is additionally called fire-and-forget from the parent write, so a notification failure can never roll
// back a submission / result / message / announcement.

export interface NotifyRecipient {
  /** The recipient's profile id (= notification.user_id). */
  userId: string;
  /** Recipient email — omit/null to skip the email leg (in-app only). */
  email?: string | null;
  /** Content-light fields for the email template (no bodies/feedback/files). */
  emailFields?: Record<string, unknown>;
}

export interface NotifyInput {
  type: NotificationType;
  recipients: NotifyRecipient[];
  entityType?: string | null;
  entityId?: string | null;
  /** Omit → in-app only (no email leg at all). */
  emailTemplateId?: EmailId;
  /** When true, the message-style per-thread coalescing applies (needs entityId). */
  coalesce?: boolean;
}

/** Resolve a recipient's email preference for a category: their row, else the config default. */
export async function getCategoryEmailEnabled(userId: string, category: NotificationCategory): Promise<boolean> {
  const row = await getNotificationPreference(userId, category);
  return row ? row.emailEnabled : emailDefaultForCategory(category);
}

export async function emitNotification(input: NotifyInput): Promise<void> {
  const category = categoryForNotificationType(input.type);

  for (const recipient of input.recipients) {
    // 1. In-app row — ALWAYS (best-effort; a failure here must not stop the email or the next recipient).
    let notificationId: string | null = null;
    try {
      const row = await insertNotification({
        userId: recipient.userId,
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null
      });
      notificationId = row.id;
    } catch (error) {
      console.error(`[notify] in-app write failed for ${input.type} → ${recipient.userId} (continuing):`, error);
    }

    // 2. Email — only when a template is given, the recipient has an email, the preference is on, and (for
    //    coalesced categories) the backstop window has not suppressed it. Best-effort.
    if (!input.emailTemplateId || !recipient.email) continue;
    try {
      const emailEnabled = await getCategoryEmailEnabled(recipient.userId, category);
      if (!emailEnabled) continue;

      if (input.coalesce && input.entityId) {
        const coalesced = await hasRecentUnreadForEntity(
          recipient.userId,
          input.entityType ?? null,
          input.entityId,
          notificationId,
          NOTIFICATION_COALESCE_WINDOW_MS
        );
        if (coalesced) continue;
      }

      await enqueueTransactionalEmail(input.emailTemplateId, {
        to: recipient.email,
        // Fields are built dynamically per notification type; the registry validates them at runtime
        // (definition.schema.parse), so cast to the template-input type the generic expects.
        fields: (recipient.emailFields ?? {}) as Parameters<typeof enqueueTransactionalEmail>[1]['fields']
      });
    } catch (error) {
      console.error(`[notify] email enqueue failed for ${input.type} → ${recipient.userId} (continuing):`, error);
    }
  }
}
