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

/**
 * Unit types EXEMPT from Phase-4 sequential gating (owner-confirmed for iCQ: induction + ID check).
 * Exempt units are always open AND transparent to the chain — a gated unit gates on the nearest preceding
 * NON-exempt unit, skipping these (docs/UNLOCK-MODEL.md §1, D1/D2). Single config source: gating reads only
 * this list, never a literal. Extend the set here (not in queries/guards) to change what is exempt.
 */
export const GATING_EXEMPT_UNIT_TYPES = ['induction', 'id-check'] as const;

/** Is this unit type exempt from sequential gating? A null/unknown type is NOT exempt (a normal gated unit). */
export function isExemptUnitType(value: unknown): boolean {
  return typeof value === 'string' && (GATING_EXEMPT_UNIT_TYPES as readonly string[]).includes(value);
}

/**
 * Is this unit NON-GATING — always open, transparent to the unlock chain, and excluded from required
 * progress? True for an exempt unit TYPE (induction/id-check) OR an explicitly OPTIONAL unit (author toggle,
 * `lesson.is_optional`). The single predicate gating + progress + completion use so the two exemption
 * mechanisms stay in lockstep. Reads only `unitType` + `isOptional`; a missing `isOptional` = false.
 */
export function isNonGatingUnit(unit: { unitType: string | null; isOptional?: boolean | null }): boolean {
  return isExemptUnitType(unit.unitType) || unit.isOptional === true;
}

/**
 * The index of the nearest preceding GATING unit for `units[idx]`, or null if none precedes it — the ONE
 * place the "look back past exempt/optional units" chain walk lives (Phase 4). Both the isUnitUnlocked guard
 * and the outline unlock-map compose this pure function, so there is no duplicated chain logic anywhere.
 * Generic over the ordered unit shape (reads `unitType` + optional `isOptional`).
 */
export function findGatePredecessorIndex(
  units: ReadonlyArray<{ unitType: string | null; isOptional?: boolean | null }>,
  idx: number
): number | null {
  for (let p = idx - 1; p >= 0; p--) {
    if (!isNonGatingUnit(units[p])) return p;
  }
  return null;
}
