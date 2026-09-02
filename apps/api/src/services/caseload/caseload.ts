import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import {
  DUE_SOON_WINDOW_DAYS,
  deriveCaseloadState,
  isPassingResult,
  resolveMarkingSlaHours,
  type CaseloadState
} from '@cio/utils/constants';
import { listAllocatedLearnersForOrg, listLearnersForTutor, type AllocatedLearner } from '@cio/db/queries/allocation';
import {
  getAssessmentItemsByLesson,
  getSubmissionsWithContextForLearners,
  type SubmissionWithContext
} from '@cio/db/queries/coursework';
import {
  getCoursesForLearners,
  getLessonIdsForCourses,
  getProfileStatusForIds,
  type RosterCourse
} from '@cio/db/queries/caseload';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
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

// ── Tutor grading pipeline (PearlLMS Phase 8) — queues + stats derived from coursework submissions ──
// Extends the plain caseload roster into the pipeline dashboard: the marking queues + outcome stats, all
// derived per ASSESSMENT ITEM. NB: "due soon" covers assessments a learner has already engaged with (a
// full not-yet-started catalog scan is deferred — flagged to the owner as a later enrichment).

export interface PipelineItem {
  submissionId: string;
  learnerId: string;
  learnerName: string | null;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  unitTitle: string;
  assessmentKey: string | null;
  assessmentName: string;
  submissionType: string;
  version: number;
  submittedAt: string;
  dueAt: string | null;
}
export interface TutorPipelineStats {
  learners: number;
  // Learner activity buckets (Phase 9). suspended = DEACTIVATED; neverLoggedIn = no login ever;
  // inactive = last seen > 30 days ago; active = seen within 30 days. Buckets are exclusive + sum to learners.
  activeLearners: number;
  inactiveLearners: number;
  neverLoggedIn: number;
  suspendedLearners: number;
  learnersWithPendingWork: number;
  // Caseload scope
  courses: number;
  assignments: number;
  // Queues
  awaitingMarking: number;
  resubmissions: number;
  awaitingDraftFeedback: number;
  overdue: number;
  dueSoon: number;
  // Grading outcomes
  totalGraded: number;
  passCount: number;
  referCount: number;
  /** Average days from a final submission to its verdict, or null if nothing graded yet. */
  avgTurnaroundDays: number | null;
}
export interface ProgrammeRow {
  courseId: string;
  title: string;
  learners: number;
}
export interface TutorPipeline {
  stats: TutorPipelineStats;
  awaitingMarking: PipelineItem[];
  resubmissions: PipelineItem[];
  awaitingDraftFeedback: PipelineItem[];
  overdue: PipelineItem[];
  dueSoon: PipelineItem[];
  /** Assigned courses + roster learner distribution (the "Programmes & Caseload" table). */
  programmes: ProgrammeRow[];
}

/**
 * The tutor's grading pipeline — the queue lists + headline stats. Roster is allocation-sourced (Admin =
 * org-wide); everything is derived from the allocated learners' submissions, per assessment item:
 *  - awaitingMarking: latest FINAL is unmarked and no prior Refer (a first submission to grade)
 *  - resubmissions: latest FINAL is unmarked AND a prior FINAL was Refer'd (a resubmission to re-review)
 *  - awaitingDraftFeedback: latest DRAFT is unmarked (feedback-only, never a verdict)
 *  - overdue: an awaiting FINAL older than the marking SLA (default 72h)
 *  - dueSoon: an engaged, not-yet-passed assessment whose dueAt is within the window
 *  - totalGraded / passCount / referCount: verdict outcomes across all versions
 */
export async function getTutorPipeline(actor: Actor): Promise<TutorPipeline> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (actor.role !== 'ADMIN' && actor.role !== 'TUTOR') {
    throw new AppError('You do not have a caseload', ErrorCodes.FORBIDDEN, 403);
  }

  const roster: AllocatedLearner[] =
    actor.role === 'ADMIN' ? await listAllocatedLearnersForOrg(actor.orgId) : await listLearnersForTutor(actor.userId);
  const nameOf = new Map(roster.map((l) => [l.learnerId, l.name] as const));
  const subs = await getSubmissionsWithContextForLearners(roster.map((l) => l.learnerId));

  const lessonIds = [...new Set(subs.map((s) => s.lessonId))];
  const itemsByLesson = await getAssessmentItemsByLesson(lessonIds);
  const metaOf = (lessonId: string, key: string | null): { name: string; dueAt: string | null } => {
    if (!key) return { name: 'Coursework', dueAt: null };
    const item = itemsByLesson.get(lessonId)?.find((i) => i.key === key);
    return { name: item?.name ?? 'Assessment', dueAt: item?.dueAt ?? null };
  };

  // Group every version per (learner, unit, assessment).
  const groups = new Map<string, SubmissionWithContext[]>();
  for (const s of subs) {
    const k = `${s.learnerId}::${s.lessonId}::${s.assessmentKey ?? ''}`;
    const arr = groups.get(k);
    if (arr) arr.push(s);
    else groups.set(k, [s]);
  }

  const stats: TutorPipelineStats = {
    learners: roster.length,
    activeLearners: 0,
    inactiveLearners: 0,
    neverLoggedIn: 0,
    suspendedLearners: 0,
    learnersWithPendingWork: 0,
    courses: 0,
    assignments: 0,
    awaitingMarking: 0,
    resubmissions: 0,
    awaitingDraftFeedback: 0,
    overdue: 0,
    dueSoon: 0,
    totalGraded: 0,
    passCount: 0,
    referCount: 0,
    avgTurnaroundDays: null
  };
  const awaitingMarking: PipelineItem[] = [];
  const resubmissions: PipelineItem[] = [];
  const awaitingDraftFeedback: PipelineItem[] = [];
  const overdue: PipelineItem[] = [];
  const dueSoon: PipelineItem[] = [];

  const slaMs = resolveMarkingSlaHours({ MARKING_SLA_HOURS: process.env.MARKING_SLA_HOURS }) * 3_600_000;
  const dueSoonMs = DUE_SOON_WINDOW_DAYS * 86_400_000;
  const now = Date.now();

  const toItem = (s: SubmissionWithContext): PipelineItem => {
    const meta = metaOf(s.lessonId, s.assessmentKey);
    return {
      submissionId: s.id,
      learnerId: s.learnerId,
      learnerName: nameOf.get(s.learnerId) ?? null,
      courseId: s.courseId,
      courseTitle: s.courseTitle,
      lessonId: s.lessonId,
      unitTitle: s.unitTitle,
      assessmentKey: s.assessmentKey,
      assessmentName: meta.name,
      submissionType: s.submissionType,
      version: s.version,
      submittedAt: s.submittedAt,
      dueAt: meta.dueAt
    };
  };
  const pickLatest = (list: SubmissionWithContext[]): SubmissionWithContext | null =>
    list.reduce<SubmissionWithContext | null>((a, b) => (!a || b.version > a.version ? b : a), null);

  for (const arr of groups.values()) {
    for (const s of arr) {
      if (s.resultKind === 'verdict' && s.result) {
        stats.totalGraded++;
        if (isPassingResult(s.result)) stats.passCount++;
        else stats.referCount++;
      }
    }

    const latestFinal = pickLatest(arr.filter((s) => s.submissionType === 'final'));
    const latestDraft = pickLatest(arr.filter((s) => s.submissionType === 'draft'));
    const assessmentPassed = arr.some((s) => s.resultKind === 'verdict' && s.result && isPassingResult(s.result));
    const priorRefer = arr.some(
      (s) => s.submissionType === 'final' && s.resultKind === 'verdict' && s.result && !isPassingResult(s.result)
    );

    if (latestFinal && latestFinal.resultKind == null && !assessmentPassed) {
      const item = toItem(latestFinal);
      if (priorRefer) {
        resubmissions.push(item);
        stats.resubmissions++;
      } else {
        awaitingMarking.push(item);
        stats.awaitingMarking++;
      }
      if (now - new Date(latestFinal.submittedAt).getTime() > slaMs) {
        overdue.push(item);
        stats.overdue++;
      }
    }
    if (latestDraft && latestDraft.resultKind == null && !assessmentPassed) {
      awaitingDraftFeedback.push(toItem(latestDraft));
      stats.awaitingDraftFeedback++;
    }

    const latest = latestFinal ?? latestDraft;
    if (latest) {
      const { dueAt } = metaOf(latest.lessonId, latest.assessmentKey);
      if (dueAt && !assessmentPassed) {
        const due = new Date(dueAt).getTime();
        if (due >= now && due - now <= dueSoonMs) {
          dueSoon.push(toItem(latest));
          stats.dueSoon++;
        }
      }
    }
  }

  const oldestFirst = (a: PipelineItem, b: PipelineItem) =>
    new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
  awaitingMarking.sort(oldestFirst);
  resubmissions.sort(oldestFirst);
  awaitingDraftFeedback.sort(oldestFirst);
  overdue.sort(oldestFirst);
  dueSoon.sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());

  // ── Enrichment (Phase 9): learner activity, caseload scope, grading turnaround ──────────────────
  const learnerIds = roster.map((l) => l.learnerId);
  const [lastSeen, statusMap, programmes] = await Promise.all([
    getLastSeenForUserIds(learnerIds),
    getProfileStatusForIds(learnerIds),
    getCoursesForLearners(learnerIds)
  ]);

  const THIRTY_DAYS_MS = 30 * 86_400_000;
  for (const l of roster) {
    if (statusMap.get(l.learnerId) === 'DEACTIVATED') {
      stats.suspendedLearners++;
      continue;
    }
    const seen = lastSeen.get(l.learnerId);
    if (!seen) stats.neverLoggedIn++;
    else if (now - new Date(seen).getTime() > THIRTY_DAYS_MS) stats.inactiveLearners++;
    else stats.activeLearners++;
  }

  stats.courses = programmes.length;
  const courseLessonIds = await getLessonIdsForCourses(programmes.map((p: RosterCourse) => p.courseId));
  const assessmentsByLesson = await getAssessmentItemsByLesson(courseLessonIds);
  for (const items of assessmentsByLesson.values()) stats.assignments += items.length;

  // Average grading turnaround (final submission → verdict), in days.
  let turnSum = 0;
  let turnCount = 0;
  for (const s of subs) {
    if (s.resultKind === 'verdict' && s.resultRecordedAt) {
      const d = new Date(s.resultRecordedAt).getTime() - new Date(s.submittedAt).getTime();
      if (d >= 0) {
        turnSum += d;
        turnCount++;
      }
    }
  }
  stats.avgTurnaroundDays = turnCount > 0 ? Math.round((turnSum / turnCount / 86_400_000) * 10) / 10 : null;

  // Distinct learners with work pending the tutor's action (across the action queues).
  const pending = new Set<string>();
  for (const item of [...awaitingMarking, ...resubmissions, ...awaitingDraftFeedback, ...overdue]) {
    pending.add(item.learnerId);
  }
  stats.learnersWithPendingWork = pending.size;

  return { stats, awaitingMarking, resubmissions, awaitingDraftFeedback, overdue, dueSoon, programmes };
}

export interface LearnerDetailSubmission {
  id: string;
  version: number;
  submittedAt: string;
  status: string;
  assessmentKey: string | null;
  assessmentName: string;
  submissionType: string;
  resultKind: string | null;
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
  const itemsByLesson = await getAssessmentItemsByLesson([...new Set(subs.map((s) => s.lessonId))]);
  const assessmentNameOf = (lessonId: string, key: string | null): string =>
    key ? (itemsByLesson.get(lessonId)?.find((i) => i.key === key)?.name ?? 'Assessment') : 'Coursework';

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
      assessmentKey: s.assessmentKey,
      assessmentName: assessmentNameOf(s.lessonId, s.assessmentKey),
      submissionType: s.submissionType,
      resultKind: s.resultKind,
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
