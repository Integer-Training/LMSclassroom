// FROZEN pre-H1 copy of computePipelineForRoster (apps/api/src/services/caseload/caseload.ts at the commit before
// scalability H1): heavy submission rows, one query set per call. Used ONLY by the H1 parity tests as the "before"
// reference — do not import it from application code.
import { DUE_SOON_WINDOW_DAYS, isPassingResult, resolveMarkingSlaHours } from '@cio/utils/constants';
import { type AllocatedLearner } from '@cio/db/queries/allocation';
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
 * The marking pipeline + activity/outcome stats for an EXPLICIT learner roster. Extracted verbatim from
 * getTutorPipeline so the admin dashboard can run the identical computation over the ORG-WIDE learner set
 * (getOrgLearnerIds) or a single tutor's roster — independent of tutor_allocation. Counts-only callers can
 * pass a roster with name/email null.
 */
export async function computePipelineForRoster(roster: AllocatedLearner[]): Promise<TutorPipeline> {
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
