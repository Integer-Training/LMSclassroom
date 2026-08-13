import * as z from 'zod';

import { UNIT_TYPES, type UnitType } from '../../constants/unit-type';

/**
 * Zod schema for a unit/session `type` label (PearlLMS Phase 2). Values come from the shared
 * UNIT_TYPES config — the ONLY allowed set — so an author can never persist an off-list label.
 */
export const ZUnitType = z.enum(UNIT_TYPES);

/**
 * The label as it travels on a lesson write: a configured type, or `null`/absent for a session with
 * no special type (the `lesson.unit_type` column is nullable). Use in lesson create/update payloads.
 */
export const ZUnitTypeNullable = ZUnitType.nullable().optional();

export { UNIT_TYPES, type UnitType };
