import { redirect } from '@sveltejs/kit';
import { ROLE } from '@cio/utils/constants';
import { requireActor } from '$lib/server/guards';
import { homeForRole } from '$lib/utils/functions/routes/homeForRole';

// PearlLMS (closed system): /home used to render the public marketing landing behind auth. There is no
// marketing page any more — bounce every authenticated visitor to their role home instead.
export const load = async ({ locals, parent }) => {
  const actor = requireActor(locals);
  const { org, orgSiteName } = await parent();
  throw redirect(303, homeForRole(ROLE[actor.role as keyof typeof ROLE], orgSiteName || org?.siteName || ''));
};
