import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { getEnrolmentsForLearners, getMonthlyStudyForLearner } from '@cio/db/queries/caseload';
import { computeLearnerCourseProgress, type CourseProgress } from '@cio/db/queries/progress';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileById } from '@cio/db/queries/auth';
import { getLearnerMessageSummary, type RecentThreadRow } from '@cio/db/queries/comms';
import { getUserLoginStreak } from '@cio/db/queries/dash';
import { getLearnerAssignments, type LearnerAssignment } from '@api/services/lms/assignments';

// PearlLMS — the LEARNER HOME summary (the `/lms` dashboard). ONE self-scoped aggregate powering the KPI
// tiles, progress donut, My Tutor, Draft Feedbacks, Upcoming Due Dates, Course Progression, Recent Messages
// and the Study Hours chart. Learner is the authenticated actor (never a param); reuses the same primitives
// as the tutor progression view + the learner assignments aggregate, so every number matches those surfaces.

export interface DashboardKpis {
  enrolledCourses: number;
  /** Assessments still needing the learner's action (not passed, not already awaiting a mark). */
  dueAssignments: number;
  /** Courses the learner has fully completed. */
  completed: number;
  /** Passed units / total units across all courses, 0-100. */
  overallProgressPercent: number;
  unreadMessages: number;
  // Extras beyond the reference dashboard.
  streakDays: number;
  awaitingMarking: number;
  /** Soonest FUTURE due date among not-passed assessments, or null. */
  nextDueAt: string | null;
}

export interface ProgressSummary {
  courses: number;
  passedUnits: number;
  totalUnits: number;
  percent: number;
}

export interface CourseProgressionRow {
  courseId: string;
  title: string;
  passed: number;
  total: number;
  percent: number;
  completed: boolean;
}

export interface DraftFeedbackRow {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  assessmentKey: string | null;
  unitTitle: string;
  name: string;
  feedback: string | null;
  markedAt: string | null;
}

export interface UpcomingDueRow {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  assessmentKey: string | null;
  unitTitle: string;
  name: string;
  kind: string;
  dueAt: string;
  state: string;
  overdue: boolean;
}

export interface StudyHours {
  year: number;
  totalSeconds: number;
  /** Exactly 12 entries, month 1-12, seconds summed across courses (0 for months with no study). */
  monthly: { month: number; seconds: number }[];
}

export interface LearnerDashboard {
  kpis: DashboardKpis;
  progressSummary: ProgressSummary;
  tutor: { name: string; email: string | null } | null;
  courseProgression: CourseProgressionRow[];
  draftFeedbacks: DraftFeedbackRow[];
  upcomingDueDates: UpcomingDueRow[];
  recentMessages: RecentThreadRow[];
  studyHours: StudyHours;
}

const DRAFT_FEEDBACK_LIMIT = 6;
const UPCOMING_LIMIT = 6;

/** Non-throwing wrapper so one optional widget's failure never blanks the whole dashboard. */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function getLearnerDashboard(actor: Actor): Promise<LearnerDashboard> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  const learnerId = actor.userId;
  const now = Date.now();
  const year = new Date().getUTCFullYear();

  // Fan out the independent reads. Each optional piece is wrapped so a single failure degrades gracefully.
  const [enrolments, assignments, messageSummary, tutors, monthly, streak] = await Promise.all([
    safe(getEnrolmentsForLearners([learnerId]), []),
    safe(getLearnerAssignments(actor), { courses: [], items: [] as LearnerAssignment[] }),
    safe(getLearnerMessageSummary(learnerId, { limit: 5 }), { unreadCount: 0, recent: [] }),
    safe(listTutorsForLearner(learnerId), []),
    safe(getMonthlyStudyForLearner(learnerId, year), []),
    safe(getUserLoginStreak(learnerId), { daysActive: 0 })
  ]);

  // Per-course progress (authoritative passed/total over non-exempt units) — one per enrolled course.
  const progress = await Promise.all(
    enrolments.map(async (e) => {
      const p = await safe<CourseProgress>(computeLearnerCourseProgress(learnerId, e.courseId), {
        courseId: e.courseId,
        passed: 0,
        total: 0,
        completed: false,
        completedAt: null,
        currentPosition: null
      });
      return { title: e.title, ...p };
    })
  );

  const courseProgression: CourseProgressionRow[] = progress.map((p) => ({
    courseId: p.courseId,
    title: p.title,
    passed: p.passed,
    total: p.total,
    percent: p.total > 0 ? Math.round((p.passed / p.total) * 100) : 0,
    completed: !!p.completed
  }));

  const passedUnits = progress.reduce((a, p) => a + p.passed, 0);
  const totalUnits = progress.reduce((a, p) => a + p.total, 0);
  const overallProgressPercent = totalUnits > 0 ? Math.round((passedUnits / totalUnits) * 100) : 0;
  const completedCount = progress.filter((p) => p.completed).length;

  // Assignment-derived counts + lists (same source as the /lms/exercises board, so states agree).
  // ACTIONABLE = the learner can act on it now: not passed, not already awaiting a mark, and NOT locked
  // (a sequential-unlock unit they can't open yet is on the roadmap but isn't "due"). This keeps the KPI,
  // upcoming list and next-due countdown honest under gating.
  const items = assignments.items;
  const actionable = items.filter((i) => i.state !== 'passed' && i.state !== 'awaiting_marking' && !i.locked);
  const dueAssignments = actionable.length;
  const awaitingMarking = items.filter((i) => i.state === 'awaiting_marking').length;

  const draftFeedbacks: DraftFeedbackRow[] = items
    .filter((i) => i.state === 'draft_feedback')
    .sort((a, b) => new Date(b.markedAt ?? 0).getTime() - new Date(a.markedAt ?? 0).getTime())
    .slice(0, DRAFT_FEEDBACK_LIMIT)
    .map((i) => ({
      courseId: i.courseId,
      courseTitle: i.courseTitle,
      lessonId: i.lessonId,
      assessmentKey: i.assessmentKey,
      unitTitle: i.unitTitle,
      name: i.name,
      feedback: i.feedback,
      markedAt: i.markedAt
    }));

  // Upcoming/overdue: an ACTIONABLE item (unlocked, not passed) with a real due date, soonest first.
  const dueItems = actionable.filter((i) => i.dueAt);
  const upcomingDueDates: UpcomingDueRow[] = dueItems
    .slice()
    .sort((a, b) => new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime())
    .slice(0, UPCOMING_LIMIT)
    .map((i) => ({
      courseId: i.courseId,
      courseTitle: i.courseTitle,
      lessonId: i.lessonId,
      assessmentKey: i.assessmentKey,
      unitTitle: i.unitTitle,
      name: i.name,
      kind: i.kind,
      dueAt: i.dueAt as string,
      state: i.state,
      overdue: new Date(i.dueAt as string).getTime() < now
    }));

  // Soonest FUTURE due date among actionable items (for the countdown KPI).
  const nextDueAt =
    dueItems
      .map((i) => i.dueAt as string)
      .filter((d) => new Date(d).getTime() >= now)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

  // Tutor (name + email). listTutorsForLearner gives id+email; name comes from the profile.
  let tutor: { name: string; email: string | null } | null = null;
  const firstTutor = tutors[0];
  if (firstTutor) {
    const p = await safe(getProfileById(firstTutor.tutorId), null);
    tutor = { name: p?.fullname ?? 'Your tutor', email: firstTutor.email };
  }

  // Study hours: monthly series (12 months, zero-filled) + the YEAR total (sum of the same buckets, so the
  // card's headline total always equals the visible chart — no lifetime-vs-year mismatch).
  const monthlyByKey = new Map<string, number>();
  for (const m of monthly) monthlyByKey.set(m.yearMonth, m.seconds);
  const monthlySeries = Array.from({ length: 12 }, (_, idx) => {
    const key = `${year}-${String(idx + 1).padStart(2, '0')}`;
    return { month: idx + 1, seconds: monthlyByKey.get(key) ?? 0 };
  });
  const totalSeconds = monthlySeries.reduce((a, m) => a + m.seconds, 0);

  return {
    kpis: {
      enrolledCourses: enrolments.length,
      dueAssignments,
      completed: completedCount,
      overallProgressPercent,
      unreadMessages: messageSummary.unreadCount,
      streakDays: streak.daysActive,
      awaitingMarking,
      nextDueAt
    },
    progressSummary: {
      courses: enrolments.length,
      passedUnits,
      totalUnits,
      percent: overallProgressPercent
    },
    tutor,
    courseProgression,
    draftFeedbacks,
    upcomingDueDates,
    recentMessages: messageSummary.recent,
    studyHours: { year, totalSeconds, monthly: monthlySeries }
  };
}
