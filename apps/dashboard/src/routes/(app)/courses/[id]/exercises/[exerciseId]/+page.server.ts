import type { GetExerciseSuccess, ListExerciseSubmissionsSuccess } from '$features/course/utils/types';
import { classroomio, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — the stock exercise (quiz) surface is admin-only here; PearlLMS assessment is the
// coursework loop, not exercises. Guards itself now that the course layout admits enrolled learners.
export const load = async ({ params, cookies, locals }) => {
  requireAdmin(locals);
  const courseId = params.id || '';
  const exerciseId = params.exerciseId || '';

  if (!courseId || !exerciseId) {
    console.log('courseId', courseId, 'exerciseId', exerciseId);
    return { courseId, exerciseId, exercise: null, submissions: [], mySubmissions: [] };
  }

  const headers = getApiHeaders(cookies);

  const [exerciseResult, overviewResult] = await Promise.all([
    safeServerApi<GetExerciseSuccess>(() =>
      classroomio.course[':courseId'].exercise[':exerciseId'].$get({ param: { courseId, exerciseId } }, headers)
    ),
    safeServerApi<ListExerciseSubmissionsSuccess>(() =>
      classroomio.course[':courseId'].exercise[':exerciseId']['submissions'].$get(
        { param: { courseId, exerciseId } },
        headers
      )
    )
  ]);
  const exercise = exerciseResult.ok && exerciseResult.body.data ? exerciseResult.body.data : null;
  const overview =
    overviewResult.ok && overviewResult.body.data ? overviewResult.body.data : { mySubmission: [], allSubmissions: [] };

  const mySubmissionData = Array.isArray(overview.mySubmission) ? overview.mySubmission : [];
  const mySubmissions = mySubmissionData;

  const submissions = Array.isArray(overview.allSubmissions) ? overview.allSubmissions : [];
  console.log('submissions', submissions.length, 'mySubmissions', mySubmissions.length);

  return {
    courseId,
    exerciseId,
    exercise,
    submissions,
    mySubmissions
  };
};
