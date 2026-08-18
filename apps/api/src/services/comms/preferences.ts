import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  isAllowedNotificationCategory,
  type NotificationCategory
} from '@cio/utils/constants';
import { listNotificationPreferences, upsertNotificationPreference } from '@cio/db/queries/comms';
import { getCategoryEmailEnabled } from '@api/services/comms/notify';

// PearlLMS Phase 6 Step 6 — the per-user email preference surface. STRICTLY self-only: every read/write uses
// the ACTOR's own id (from the session), never a URL value. The effective on/off value is resolved by the
// SAME framework function the send path uses (getCategoryEmailEnabled = row ?? config default) — this file
// does NOT fork that logic; it only adds a `isDefault` flag (whether an explicit row exists yet).

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

export interface PreferenceItem {
  category: NotificationCategory;
  label: string;
  emailEnabled: boolean;
  /** true = no saved row yet (the value shown is the config default). */
  isDefault: boolean;
}

/** The actor's per-category email preferences, effective values (config default until saved). Self-only. */
export async function getMyPreferences(actor: Actor): Promise<PreferenceItem[]> {
  assertAuthed(actor);
  const explicit = new Set((await listNotificationPreferences(actor.userId)).map((r) => r.category));
  return Promise.all(
    NOTIFICATION_CATEGORIES.map(async (category) => ({
      category,
      label: NOTIFICATION_CATEGORY_LABELS[category],
      emailEnabled: await getCategoryEmailEnabled(actor.userId, category), // the ONE resolution path
      isDefault: !explicit.has(category)
    }))
  );
}

/** Set the actor's email preference for a category. Self-only; writes only the actor's own row. */
export async function setMyPreference(actor: Actor, category: string, emailEnabled: boolean): Promise<PreferenceItem> {
  assertAuthed(actor);
  if (!isAllowedNotificationCategory(category)) {
    throw new AppError('Unknown notification category', ErrorCodes.VALIDATION_ERROR, 400, 'category');
  }
  await upsertNotificationPreference(actor.userId, category, emailEnabled);
  return {
    category,
    label: NOTIFICATION_CATEGORY_LABELS[category],
    emailEnabled: await getCategoryEmailEnabled(actor.userId, category),
    isDefault: false
  };
}
