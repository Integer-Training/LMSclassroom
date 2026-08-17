import { classroomio, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { requireAdmin } from '$lib/server/guards';
import type { MarksPageData } from '$features/course/utils/marks-utils';

// PearlLMS Phase 4 — admin-only marking page; guards itself now that the course layout admits learners.
export const load = async ({ params, cookies, locals }) => {
  requireAdmin(locals);
  const courseId = params.id || '';
  if (!courseId) {
    return {
      courseId: '',
      marksData: null
    };
  }

  const result = await safeServerApi<{ success: true; data: MarksPageData }>(() =>
    classroomio.course[':courseId'].mark.gradebook.$get({ param: { courseId } }, getApiHeaders(cookies, ''))
  );
  const marksData: MarksPageData | null = result.ok ? result.body.data : null;

  return {
    courseId,
    marksData
  };
};
