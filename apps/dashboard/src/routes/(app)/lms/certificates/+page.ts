import { redirect } from '@sveltejs/kit';
import { CERTIFICATES_ENABLED } from '$lib/utils/constants/features';

// Certificates are issued off-platform in PearlLMS — page hidden; bounce direct hits to the learner home.
export const load = () => {
  if (!CERTIFICATES_ENABLED) throw redirect(303, '/lms');
};
