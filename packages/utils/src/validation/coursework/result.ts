import * as z from 'zod';

import { RESULT_VALUES, type ResultValue } from '../../constants/result';

/**
 * Zod schema for a coursework RESULT value (PearlLMS Phase 3). Values come from the shared
 * RESULT_VALUES config — the ONLY allowed set — so a tutor can never persist an off-list verdict.
 */
export const ZResult = z.enum(RESULT_VALUES);

export { RESULT_VALUES, type ResultValue };
