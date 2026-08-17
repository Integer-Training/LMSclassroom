// Pure audit helpers (no DB). The metadata-sanitiser and row-builder used by recordAudit
// (@cio/db). See docs/AUDIT.md for the action-name convention and the no-PII-values rule.

import type { Actor } from './actor';

/** Dot-namespaced action names. Phase 1 actions (wired in Steps 6–7). */
export const AUDIT_ACTIONS = {
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_STATUS_CHANGED: 'user.status_changed',
  PROFILE_UPDATED: 'profile.updated',
  // Phase 3 — tutor↔learner allocation (ids only in metadata; never names/emails).
  ALLOCATION_CREATED: 'allocation.created',
  ALLOCATION_REMOVED: 'allocation.removed',
  // Phase 3 — learner coursework submission (ids + counts only; never file names/contents).
  COURSEWORK_SUBMITTED: 'coursework.submitted'
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

// Keys whose SCALAR value would be personal data. metadata must record the field NAME
// (e.g. { fields: ['email','ni_number'] }), never the value (e.g. { email: 'a@b.com' }).
const PII_VALUE_KEYS = new Set([
  'email',
  'name',
  'fullname',
  'full_name',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'username',
  'phone',
  'telephone',
  'mobile',
  'address',
  'postcode',
  'zip',
  'dob',
  'date_of_birth',
  'ni_number',
  'nino',
  'national_insurance',
  'ssn',
  'password',
  'token',
  'avatar_url',
  'avatarurl'
]);

const isScalar = (v: unknown): boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint';

/**
 * Strip metadata entries that look like PII VALUES: a PII-named key holding a scalar
 * (e.g. `email: 'a@b.com'`). Field-name lists (arrays) and non-PII keys pass through — so
 * `{ fields: ['email','address'] }` is allowed (names, not values). Returns the cleaned copy
 * plus the list of stripped keys so recordAudit can warn.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined | null): {
  clean: Record<string, unknown>;
  stripped: string[];
} {
  const clean: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (PII_VALUE_KEYS.has(key.toLowerCase()) && isScalar(value)) {
      stripped.push(key);
      continue;
    }
    clean[key] = value;
  }
  return { clean, stripped };
}

/** Throws if metadata carries an obvious PII value. Used to fail loudly in tests. */
export function assertAuditMetadataSafe(metadata: Record<string, unknown> | undefined | null): void {
  const { stripped } = sanitizeAuditMetadata(metadata);
  if (stripped.length > 0) {
    throw new Error(`audit metadata may not contain PII values; offending keys: ${stripped.join(', ')}`);
  }
}

export type AuditRow = {
  actorUserId: string | null;
  organizationId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
};

export type RecordAuditInput = {
  /** The resolved Actor, or explicit ids for system/background actions. */
  actor: Actor | { userId?: string | null; orgId?: string | null } | null | undefined;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Override the org (else taken from the actor). */
  organizationId?: string | null;
};

/** Pure: resolve actor→ids and sanitise metadata into the row to insert. */
export function buildAuditRow(input: RecordAuditInput): AuditRow {
  const actor = input.actor;
  const actorUserId =
    actor && 'authenticated' in actor
      ? actor.authenticated
        ? actor.userId
        : (actor.userId ?? null)
      : (actor?.userId ?? null);
  const actorOrgId =
    actor && 'authenticated' in actor && actor.authenticated
      ? actor.orgId
      : ((actor as { orgId?: string })?.orgId ?? null);

  const { clean } = sanitizeAuditMetadata(input.metadata);
  return {
    actorUserId: actorUserId ?? null,
    organizationId: input.organizationId ?? actorOrgId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: clean
  };
}
