import { redirect } from '@sveltejs/kit';
import { EXPLORE_ENABLED } from '$lib/utils/constants/features';

// Explore is hidden in this closed deployment — bounce any direct hit back to the learner home.
export const load = () => {
  if (!EXPLORE_ENABLED) throw redirect(303, '/lms');
};
