import { requireActor } from '$lib/server/guards';

// Shared course surface. The LESSON VIEW (`lessons`, `lessons/[lessonId]`) is open to any authenticated
// actor here — an ENROLLED learner reaches their course content in view mode (PearlLMS Phase 4 Step 3);
// non-members are stopped by the layout's `isPermitted` dialog, and the API enforces content-read + unlock.
// Every ADMIN-ONLY sub-page (settings, people, marks, submissions, analytics, compliance, attendance,
// certificates[/editor], landingpage, ai-tutor, exercises/[id]) carries its OWN `requireAdmin` in its
// `+page.server.ts`/`+layout.server.ts`, so relaxing this layer does not widen access to authoring/marking.
export const load = async ({ params, locals }) => {
  requireActor(locals);

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
