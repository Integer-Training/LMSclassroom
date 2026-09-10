import { redirect } from '@sveltejs/kit';
import { COHORTS_ENABLED } from '$lib/utils/constants/features';

// Cohorts are unused in this deployment — bounce any direct hit back to the learner home.
export const load = () => {
  if (!COHORTS_ENABLED) throw redirect(303, '/lms');
};
