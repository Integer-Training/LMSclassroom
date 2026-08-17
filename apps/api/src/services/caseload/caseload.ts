import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { deriveCaseloadState, type CaseloadState } from '@cio/utils/constants';
import { listAllocatedLearnersForOrg, listLearnersForTutor, type AllocatedLearner } from '@cio/db/queries/allocation';
import { getSubmissionsWithContextForLearners, type SubmissionWithContext } from '@cio/db/queries/coursework';
import { getProfileById } from '@cio/db/queries/auth';
import { isAllocatedTutor } from '@api/middlewares/guards';

// Tutor caseload (PearlLMS Phase 3 Step 4) — read-only review of allocated learners' coursework. The
// roster is sourced ONLY from tutor_allocation (via the allocation queries), so a non-allocated learner
// can never appear; the learner-detail path re-checks isAllocatedTutor so a tutor cannot reach another
// tutor's learner by tampering with the id. Result entry arrives in Step 5.

export interface CaseloadUnit {
  lessonId: string;
  title: string;
  latestVersion: number;
  submissionCount: number;
  submittedAt: string;
  state: CaseloadState;
}
export interface CaseloadCourse {
  courseId: string;
  title: string;
  units: CaseloadUnit[];
}
export interface CaseloadLearner {
  learnerId: string;
  name: string | null;
  email: string | null;
  courses: CaseloadCourse[];
  submissionCount: number;
}
export interface AwaitingItem {
  submissionId: string;
  learnerId: string;
  learnerName: string | null;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  unitTitle: string;
  version: number;
  submittedAt: string;
}

/** The latest submission (by version) for each (learner, unit) key, plus that unit's version count. */
function latestByUnit(subs: SubmissionWithContext[]): {
  latest: Map<string, SubmissionWithContext>;
  counts: Map<string, number>;
} {
  const latest = new Map<string, SubmissionWithContext>();
  const counts = new Map<string, number>();
  for (const s of subs) {
    const key = `${s.learnerId}::${s.lessonId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const cur = latest.get(key);
    if (!cur || s.version > cur.version) latest.set(key, s);
  }
  return { latest, counts };
}

/**
 * The tutor's caseload: every allocated learner (Admin sees the org-wide union), each learner's courses
 * and per-unit latest state, plus a flat "awaiting marking" queue (latest unmarked version per unit)
 * sorted oldest-first. Learners with no submissions are still listed (empty).
 */
export async function getTutorCaseload(
  actor: Actor
): Promise<{ learners: CaseloadLearner[]; awaiting: AwaitingItem[] }> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  // Defense-in-depth: only ADMIN or TUTOR own a caseload (the route's requireStaff enforces this too;
  // this makes the service self-defending — a Manager/Learner is denied even if a caller forgets the guard).
  if (actor.role !== 'ADMIN' && actor.role !== 'TUTOR') {
    throw new AppError('You do not have a caseload', ErrorCodes.FORBIDDEN, 403);
  }

  const roster: AllocatedLearner[] =
    actor.role === 'ADMIN' ? await listAllocatedLearnersForOrg(actor.orgId) : await listLearnersForTutor(actor.userId);

  const learnerIds = roster.map((l) => l.learnerId);
  const subs = await getSubmissionsWithContextForLearners(learnerIds);

  const { latest, counts } = latestByUnit(subs);

  // Group latest-per-unit rows by learner → course → units.
  const byLearner = new Map<string, Map<string, CaseloadCourse>>();
  const awaiting: AwaitingItem[] = [];

  for (const [key, s] of latest) {
    const state = deriveCaseloadState(s.result);
    const courseMap = byLearner.get(s.learnerId) ?? new Map<string, CaseloadCourse>();
    const course = courseMap.get(s.courseId) ?? { courseId: s.courseId, title: s.courseTitle, units: [] };
    course.units.push({
      lessonId: s.lessonId,
      title: s.unitTitle,
      latestVersion: s.version,
      submissionCount: counts.get(key) ?? 1,
      submittedAt: s.submittedAt,
      state
    });
    courseMap.set(s.courseId, course);
    byLearner.set(s.learnerId, courseMap);

    if (state.awaitingMarking) {
      awaiting.push({
        submissionId: s.id,
        learnerId: s.learnerId,
        learnerName: roster.find((l) => l.learnerId === s.learnerId)?.name ?? null,
        courseId: s.courseId,
        courseTitle: s.courseTitle,
        lessonId: s.lessonId,
        unitTitle: s.unitTitle,
        version: s.version,
        submittedAt: s.submittedAt
      });
    }
  }

  const learners: CaseloadLearner[] = roster.map((l) => {
    const courseMap = byLearner.get(l.learnerId);
    const courses = courseMap ? [...courseMap.values()] : [];
    const submissionCount = courses.reduce((n, c) => n + c.units.reduce((m, u) => m + u.submissionCount, 0), 0);
    return { learnerId: l.learnerId, name: l.name, email: l.email, courses, submissionCount };
  });

  // Oldest-first: the longest-waiting submission is at the top of the marking queue.
  awaiting.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return { learners, awaiting };
}

export interface LearnerDetailSubmission {
  id: string;
  version: number;
  submittedAt: string;
  status: string;
  result: string | null;
  feedback: string | null;
  files: { key: string; name: string; size?: number; type?: string }[];
}
export interface LearnerDetailUnit {
  lessonId: string;
  title: string;
  state: CaseloadState;
  submissions: LearnerDetailSubmission[];
}
export interface LearnerDetailCourse {
  courseId: string;
  title: string;
  units: LearnerDetailUnit[];
}

/**
 * One allocated learner's full submission history (all versions per unit, newest first). A TUTOR must be
 * allocated to this learner (else 403 — this is the URL-tamper defence); an ADMIN may view any. Files
 * are returned as keys only and downloaded through the guarded coursework endpoint.
 */
export async function getCaseloadLearnerDetail(
  actor: Actor,
  learnerId: string
): Promise<{ learner: { id: string; name: string | null; email: string | null }; courses: LearnerDetailCourse[] }> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  // Only an ADMIN or a TUTOR ALLOCATED to this learner may open the detail. A tutor tampering with a
  // learner id they are not allocated to — and a Manager/Learner reaching the service past the route —
  // are both denied (URL-tamper + defense-in-depth).
  const isAdmin = actor.role === 'ADMIN';
  const isAllocated = actor.role === 'TUTOR' && (await isAllocatedTutor(actor, learnerId));
  if (!isAdmin && !isAllocated) {
    throw new AppError('This learner is not in your caseload', ErrorCodes.FORBIDDEN, 403);
  }

  const profile = await getProfileById(learnerId);
  if (!profile) {
    throw new AppError('Learner not found', ErrorCodes.NOT_FOUND, 404);
  }

  const subs = await getSubmissionsWithContextForLearners([learnerId]);

  // Group into course → unit → versions (newest version first). Latest version drives the unit state.
  const courseMap = new Map<string, Map<string, LearnerDetailUnit>>();
  for (const s of subs) {
    const units = courseMap.get(s.courseId) ?? new Map<string, LearnerDetailUnit>();
    const unit =
      units.get(s.lessonId) ??
      ({
        lessonId: s.lessonId,
        title: s.unitTitle,
        state: deriveCaseloadState(null),
        submissions: []
      } as LearnerDetailUnit);
    unit.submissions.push({
      id: s.id,
      version: s.version,
      submittedAt: s.submittedAt,
      status: s.status,
      result: s.result,
      feedback: s.feedback,
      files: s.files
    });
    units.set(s.lessonId, unit);
    courseMap.set(s.courseId, units);
  }

  const courses: LearnerDetailCourse[] = [];
  for (const [courseId, units] of courseMap) {
    const unitList = [...units.values()].map((u) => {
      u.submissions.sort((a, b) => b.version - a.version);
      return { ...u, state: deriveCaseloadState(u.submissions[0]?.result) };
    });
    courses.push({
      courseId,
      title: subs.find((s) => s.courseId === courseId)?.courseTitle ?? 'Untitled course',
      units: unitList
    });
  }

  return {
    learner: { id: profile.id, name: profile.fullname ?? null, email: profile.email ?? null },
    courses
  };
}
