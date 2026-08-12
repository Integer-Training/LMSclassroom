import { requireActor } from '$lib/server/guards';

// Baseline guard for the whole authenticated app group. Every (app) route requires a live,
// authenticated actor — this closes the hooks.server.ts gap where a stale `cio` cookie with no
// valid session still rendered the app (requireActor denies unless locals.actor is authenticated).
// Sub-layouts (org/[slug], courses/[id], cohorts/[id]) add role requirements on top of this.
export const load = async ({ locals }) => {
  requireActor(locals);
  return {};
};
