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

/** Query for the paginated allocations table (filters are all optional). */
export const ZAllocationListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  tutorId: z.uuid().optional(),
  learnerId: z.uuid().optional(),
  search: z.string().trim().max(100).optional()
});
export type AllocationListQuery = z.infer<typeof ZAllocationListQuery>;

/**
 * Query for the allocation typeahead pickers. `role` picks which side is searched; `pairedWith` hides people
 * already allocated to the counterpart chosen in the form (a tutor id when searching learners, and vice versa).
 */
export const ZAssignablePeopleQuery = z.object({
  role: z.enum(['tutor', 'learner']),
  search: z.string().trim().max(100).optional(),
  pairedWith: z.uuid().optional()
});
export type AssignablePeopleQuery = z.infer<typeof ZAssignablePeopleQuery>;
