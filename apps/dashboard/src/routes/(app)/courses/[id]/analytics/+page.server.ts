import type { CourseAnalytics } from '$features/course/utils/types';
import { classroomio } from '$lib/utils/services/api';
import { getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — admin-only analytics page; guards itself now that the course layout admits learners.
export const load = async ({ params, cookies, locals }) => {
  requireAdmin(locals);
  const courseId = params.id || '';
  if (!courseId) {
    return {
      courseId: '',
      courseAnalytics: null
    };
  }

  // Fetch analytics using single API call
  const result = await safeServerApi<{ success: true; data: CourseAnalytics }>(() =>
    classroomio.course[':courseId']['analytics'].$get(
      {
        param: { courseId }
      },
      getApiHeaders(cookies, '')
    )
  );
  const courseAnalytics: CourseAnalytics | null = result.ok ? result.body.data : null;

  return {
    courseId,
    courseAnalytics
  };
};
