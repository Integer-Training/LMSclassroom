/**
 * Allowed unit/session TYPE labels (PearlLMS Phase 2). This is the single CONFIG source — the
 * Drizzle validation, the Zod validator, and the authoring UI all import from here; no hardcoded
 * type-label literals live in queries or components. Phase 4's exemption logic references these.
 *
 * The DB column (`lesson.unit_type`) is a plain nullable varchar so the allowed set stays in config
 * (not a Postgres enum requiring a migration to extend). A session with no special type is `null`.
 */
export const UNIT_TYPES = ['induction', 'id-check', 'session', 'portfolio-review'] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

/** Human-readable labels for the authoring UI. */
export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  induction: 'Induction',
  'id-check': 'ID check',
  session: 'Session',
  'portfolio-review': 'Portfolio review'
};

/** Runtime membership check against the configured list (nullable = no type). */
export function isAllowedUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && (UNIT_TYPES as readonly string[]).includes(value);
}
