import { requireAdmin } from '$lib/server/guards';

// Course authoring + marking surface — ADMIN only in Phase 1. (Tutor marking is per-allocated-learner
// and the allocation table arrives in Phase 3, so a tutor has nothing to do here yet; they land on
// /welcome.) Server-side enforcement of the ACCESS.md matrix; the API is the ultimate authority.
export const load = async ({ params, locals }) => {
  requireAdmin(locals);

  const courseId = params.id || '';
  if (!courseId) {
    return {
      courseId: ''
    };
  }

  return {
    courseId
  };
};
