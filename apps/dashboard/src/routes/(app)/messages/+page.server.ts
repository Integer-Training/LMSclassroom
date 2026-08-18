import { requireActor } from '$lib/server/guards';

// PearlLMS Phase 6 Step 4 — the learner's "message my tutor" surface. Any authenticated actor may reach it;
// the API enforces participant + allocation on every read/write.
export const load = async ({ locals }) => {
  requireActor(locals);
  return {};
};
