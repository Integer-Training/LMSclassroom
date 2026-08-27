import { redirect } from '@sveltejs/kit';
import { ROLE } from '@cio/utils/constants';
import { homeForRole } from '$lib/utils/functions/routes/homeForRole';

// PearlLMS (closed system): `/` has no public landing. A logged-in user is sent to their role home
// (server-side, so there is no flash of the old marketing page); an anonymous visitor is sent to login.
// (`/` was removed from PUBLIC_ROUTES, so hooks.server.ts already bounces the logged-out case here too —
// this redirect is the authoritative + belt-and-suspenders handling.)
export const load = async ({ locals, parent }) => {
  const { org, orgSiteName } = await parent();
  const siteName = orgSiteName || org?.siteName || '';
  const actor = locals.actor;

  if (actor?.authenticated) {
    const roleId = ROLE[actor.role as keyof typeof ROLE];
    throw redirect(303, homeForRole(roleId, siteName));
  }

  throw redirect(303, '/login');
};
