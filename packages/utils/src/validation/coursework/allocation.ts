import * as z from 'zod';

/**
 * Validators for tutor↔learner allocation (PearlLMS Phase 3). Only the two account user ids travel
 * over the wire; role validity (tutor must be a TUTOR, learner a STUDENT) is enforced server-side in
 * the service against the org membership, not here.
 */
export const ZAllocationCreate = z.object({
  tutorId: z.uuid(),
  learnerId: z.uuid()
});
export type AllocationCreateInput = z.infer<typeof ZAllocationCreate>;

/** Path param for the remove-allocation route. */
export const ZAllocationIdParam = z.object({
  allocationId: z.uuid()
});
