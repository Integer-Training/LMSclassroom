import type { Actor } from '@cio/db/actor';
import { computeLearnerCourseProgress, type CourseProgress } from '@cio/db/queries/progress';

// PearlLMS Phase 5 Step 3 — the learner self-view service. Progress is ALWAYS computed for the requesting
// actor's OWN id (docs/PROGRESS-MODEL.md §7). There is deliberately NO learnerId parameter anywhere in this
// path, so a learner can never request another learner's progress — the enrolment check is the
// courseMemberMiddleware at the route; this seam guarantees the id is the actor's.

export async function getOwnCourseProgress(actor: Actor, courseId: string): Promise<CourseProgress> {
  // The route guards this for an authenticated learner (userId always present); assert for the union type.
  return computeLearnerCourseProgress(actor.userId!, courseId);
}
