import { requireActor } from '$lib/server/guards';

// Interim landing for roles whose real home arrives in a later phase (Tutor caseload = Phase 3,
// Manager reports = Phase 5). Any authenticated actor may view it; the page states what's coming.
export const load = async ({ locals }) => {
  const actor = requireActor(locals);
  return {
    role: actor.role
  };
};
