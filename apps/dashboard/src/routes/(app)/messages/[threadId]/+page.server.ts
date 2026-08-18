import { requireActor } from '$lib/server/guards';

// PearlLMS Phase 6 Step 4 — a specific conversation (deep link from a notification, or a tutor opening a
// caseload learner's thread). Any authenticated actor may reach the route; the API enforces participant or
// Admin-oversight access on the thread itself.
export const load = async ({ locals, params }) => {
  requireActor(locals);
  return { threadId: params.threadId };
};
