import { redirect } from '@sveltejs/kit';
import { COMMUNITY_ENABLED } from '$lib/utils/constants/features';

// Community is hidden for now (reversible). A layout load covers /lms/community and its /ask + /[slug]
// subroutes so no direct URL can reach it. Bounce back to the learner home.
export const load = () => {
  if (!COMMUNITY_ENABLED) throw redirect(303, '/lms');
};
