/**
 * Identity-verification config (PearlLMS Phase 7 Step 4). The record is who/when/method + an optional note —
 * NO identity document is ever stored, uploaded or attached (docs/ONBOARDING-MODEL.md D2). Allowed sets live
 * HERE (the DB columns are plain varchars), mirroring the other config-driven enums in this phase.
 */

/** Verification state. `not_verified` is the default; `verified`/`failed` are set by staff. */
export const ID_VERIFICATION_STATUS = ['not_verified', 'verified', 'failed'] as const;
export type IdVerificationStatus = (typeof ID_VERIFICATION_STATUS)[number];
export function isAllowedIdVerificationStatus(value: unknown): value is IdVerificationStatus {
  return typeof value === 'string' && (ID_VERIFICATION_STATUS as readonly string[]).includes(value);
}

/** The kind of ID that was sighted — a small config list (labels, never literals in code/UI). */
export const ID_VERIFICATION_METHODS = ['passport', 'driving_licence', 'other'] as const;
export type IdVerificationMethod = (typeof ID_VERIFICATION_METHODS)[number];
export function isAllowedIdVerificationMethod(value: unknown): value is IdVerificationMethod {
  return typeof value === 'string' && (ID_VERIFICATION_METHODS as readonly string[]).includes(value);
}

export const ID_VERIFICATION_STATUS_LABELS: Record<IdVerificationStatus, string> = {
  not_verified: 'Not yet verified',
  verified: 'Verified',
  failed: 'Could not be verified'
};

export const ID_VERIFICATION_METHOD_LABELS: Record<IdVerificationMethod, string> = {
  passport: 'Passport',
  driving_licence: 'Driving licence',
  other: 'Other'
};
